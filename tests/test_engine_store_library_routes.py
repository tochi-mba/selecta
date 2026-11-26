"""The Library routes, the relink and the scattered library reads through the engine store
(`core.engine_store`, ADR-0479 Phase 7).

Two homes hold the same synthetic library over the same music files. Every Library call is made
to one with the flag on and to the other with it off; the answers and the rows left behind must
be the same, and the flag-on calls must have gone through a store connection. A relink through
the store keeps every id, as the old path does. Temporary homes and synthetic files only.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient
from mutagen.flac import FLAC

from selecta import db, flags
from selecta.api import create_app
from selecta.api_common import _counts
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.engine_store import library, library_reads, library_rows
from selecta.eta import analysis_left, analysis_line_left
from selecta.library.relink import commit_relink, preview_relink
from selecta.planner.reel import load_library
from selecta.session import queue

FLAG_ON = "+core.engine_store"


def _library(home: Path, music: Path) -> None:
    flags.use("")
    conn = db.connect(Settings(home).db_path)
    for song_id in range(1, 8):
        path = music / f"song-{song_id}.flac"
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,genre,is_music,"
            "set_aside_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (song_id, str(path), "A", path.stat().st_size, path.stat().st_mtime, 200.0 + song_id,
             f"Artist {song_id % 3}", f"Song {song_id}", "Pop", int(song_id != 7),
             None if song_id != 7 else "shorter than 45 seconds"),
        )
        if song_id <= 4:
            conn.execute(
                "INSERT INTO analysis(song_id,version,bpm,camelot,energy,grid_confidence,error,"
                "timings) VALUES(?,?,?,?,?,?,?,?)",
                (song_id, ANALYSIS_VERSION, 118.0 + song_id, "8A", 0.5, 0.9,
                 "boom" if song_id == 4 else None, json.dumps({"total": 20.0})),
            )
    conn.execute("INSERT INTO lyrics(song_id,status,synced) VALUES(1,'synced','[00:01.00]hi')")
    conn.execute("INSERT INTO lyrics(song_id,status) VALUES(2,'instrumental')")
    conn.execute("INSERT INTO queue(position,song_id) VALUES(0,1),(1,2)")
    db.set_preference(conn, "library_folders", [str(music)])
    conn.commit()
    conn.close()


@pytest.fixture
def homes(tmp_path):
    music = tmp_path / "music"
    music.mkdir()
    for song_id in range(1, 8):
        path = music / f"song-{song_id}.flac"
        sf.write(path, np.zeros((6000, 2)), 100, format="FLAC", subtype="PCM_16")
    on, off = tmp_path / "on", tmp_path / "off"
    for home in (on, off):
        home.mkdir()
        _library(home, music)
    flags.use(FLAG_ON)
    db.connect(Settings(on).db_path).close()  # adopted by the library migrations
    yield on, off
    flags.use(None)
    library.forget(Settings(on).db_path)


@pytest.fixture
def counted(monkeypatch):
    calls = {"n": 0}
    real = library_rows.Rows.execute

    def execute(self, sql, params=()):
        calls["n"] += 1
        return real(self, sql, params)

    monkeypatch.setattr(library_rows.Rows, "execute", execute)
    return calls


def _rows(home: Path) -> dict:
    conn = sqlite3.connect(Settings(home).db_path)
    try:
        return {
            "songs": conn.execute(
                "SELECT id,path,is_music,set_aside_reason,music_override,processing_priority,"
                "duplicate_of FROM songs ORDER BY id"
            ).fetchall(),
            "overrides": conn.execute(
                "SELECT song_id,bpm,camelot FROM song_overrides ORDER BY song_id"
            ).fetchall(),
            "settings": conn.execute("SELECT key,value FROM preferences ORDER BY key").fetchall(),
        }
    finally:
        conn.close()


CALLS = [
    ("get", "/api/library", {"state": "all"}),
    ("get", "/api/library", {"state": "ready"}),
    ("get", "/api/library", {"state": "not_yet"}),
    ("get", "/api/library", {"state": "attention"}),
    ("get", "/api/library", {"state": "set_aside"}),
    ("get", "/api/library", {"q": "Song", "sort": "title"}),
    ("get", "/api/library", {"q": "artist 1", "sort": "artist"}),
    ("get", "/api/library", {"sort": "tempo", "limit": 2}),
    ("get", "/api/library", {"sort": "recent", "limit": 2, "after": "[-5, 5]"}),
    ("get", "/api/library", {"after": "nonsense"}),
    ("get", "/api/songs", {"q": "Song"}),
    ("get", "/api/songs", {"state": "not_yet", "order": "recent"}),
    ("post", "/api/songs/1/priority", {"priority": 100}),
    ("post", "/api/songs/99/priority", {"priority": 100}),
    ("get", "/api/library", {"state": "priority"}),
    ("post", "/api/songs/2/never", None),
    ("post", "/api/library/batch",
     {"action": "prioritize", "entries": [{"id": 3, "expected": False}]}),
    ("post", "/api/library/batch",
     {"action": "never", "entries": [{"id": 3, "expected": True}]}),  # stale: refused whole
    ("post", "/api/library/batch",
     {"action": "never", "entries": [{"id": 1, "expected": False}, {"id": 3, "expected": False}]}),
    ("post", "/api/songs/1/correct", {"bpm": 121.5, "camelot": "9A"}),
    ("post", "/api/songs/1/correct", {"clear": ["camelot"], "is_music": False}),
    ("post", "/api/songs/2/correct", {"bpm": 100.0, "clear": ["bpm"]}),
    ("post", "/api/songs/99/correct", {"bpm": 100.0}),
    ("get", "/api/library", {"state": "all"}),
    ("get", "/api/folders", None),
]


def _call(client: TestClient, method: str, path: str, data):
    if method == "get":
        answer = client.get(path, params=data)
    elif path.endswith(("/priority", "/never")):
        answer = client.post(path, params=data)
    else:
        answer = client.post(path, json=data)
    body = answer.json()
    if isinstance(body, dict):
        body.pop("scan", None)
    return answer.status_code, body


def test_every_library_call_through_the_store_answers_as_the_old_path(homes, counted):
    on, off = homes
    client_on = TestClient(create_app(Settings(on), on / "no-web"))
    client_off = TestClient(create_app(Settings(off), off / "no-web"))
    for method, path, data in CALLS:
        flags.use("")
        expected = _call(client_off, method, path, data)
        flags.use(FLAG_ON)
        before = counted["n"]
        got = _call(client_on, method, path, data)
        assert got == expected, (method, path, data)
        if path != "/api/folders" and expected[0] < 500:
            assert counted["n"] > before or path.endswith(("/priority", "/correct")), path
    assert _rows(on) == _rows(off)


def test_the_scattered_reads_answer_alike_through_the_store(homes, counted):
    on, off = homes

    def reads(home: Path) -> tuple:
        settings = Settings(home)
        conn = db.connect(settings.db_path)
        try:
            return (
                _counts(conn),
                library_reads.music_ids(conn),
                library_reads.analysis_errors(conn),
                library_reads.failed_songs(conn),
                library_reads.analysed_ids(conn, ANALYSIS_VERSION),
                sorted(library_reads.newest_with_tempo(conn)),
                library_reads.priority_paths(conn),
                library_reads.songs_under(conn, "%song-1%"),
                dict(library_reads.song_fields(conn, 3, "artist", "title")),
                library_reads.song_fields(conn, 99, "duration"),
                analysis_left(conn, False, False),
                analysis_line_left(conn, [5, 6]),
                queue(conn),
                [song.id for song in load_library(conn, settings)],
            )
        finally:
            conn.close()

    flags.use("")
    expected = reads(off)
    flags.use(FLAG_ON)
    before = counted["n"]
    assert reads(on) == expected
    assert counted["n"] > before


def test_a_relink_through_the_store_keeps_every_id(tmp_path):
    music = tmp_path / "Music"
    old, new = music / "old", music / "new"
    for name in ("a.flac", "b.flac"):
        path = old / name
        path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(path, np.zeros((6000, 2)), 100, format="FLAC", subtype="PCM_16")
        tags = FLAC(path)
        tags["title"], tags["artist"] = name, "Someone"
        tags.save()
    flags.use("")
    copy = tmp_path / "copy.sqlite"
    conn = db.connect(copy)
    for song_id, name in ((7, "a.flac"), (9, "b.flac")):
        path = old / name
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (song_id, str(path), str(old), path.stat().st_size, 1.0, 60.0, "Someone", name),
        )
    conn.execute("INSERT INTO ratings(song_a,song_b,method,rating) VALUES(7,9,'blend',5)")
    conn.execute("INSERT INTO song_overrides(song_id,bpm) VALUES(7,120)")
    db.set_preference(conn, "library_folders", [str(old)])
    conn.commit()
    conn.close()
    path = tmp_path / "on.sqlite"
    shutil.copy(copy, path)
    old.rename(new)
    try:
        flags.use(FLAG_ON)
        conn = db.connect(path)
        assert library_rows.store_path(conn) is not None
        preview = preview_relink(conn, str(old), str(new))
        assert preview["references"]["ratings"] == 1
        assert preview["references"]["corrections"] == 1
        commit_relink(conn, str(old), str(new), preview["token"])
        conn.close()
        flags.use("")
        conn = db.connect(copy)
        expected = preview_relink(conn, str(old), str(new))
        commit_relink(conn, str(old), str(new), expected["token"])
        conn.close()
        assert preview == expected
        check = [sqlite3.connect(file) for file in (path, copy)]
        rows = [c.execute("SELECT id,path FROM songs ORDER BY id").fetchall() for c in check]
        settings = [
            c.execute("SELECT value FROM preferences WHERE key='library_folders'").fetchall()
            for c in check
        ]
        for c in check:
            c.close()
        assert rows[0] == rows[1] and settings[0] == settings[1]
        assert Path(rows[0][0][1]) == new.resolve() / "a.flac"
    finally:
        flags.use(None)
        library.forget(path)
