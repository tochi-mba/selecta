"""Song facts on a Desktop library through the engine store (`core.engine_store`, ADR-0479).

Flag off: loading a song leaves the library exactly as it was. Flag on: a library made by today's
`db.connect` loads the same `SongInfo` and arrays through the store, from the features artifact
or the older file; the migration meets a half-done earlier state and changes nothing the second
time; the hash job fills only missing hashes; a backup carries the facts and the stamp. A small
synthetic library in a temporary home: no audio is decoded.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import sqlite3
from pathlib import Path

import numpy as np
import pytest

from selecta import db, flags
from selecta.analysis.pipeline import features_path, load_features
from selecta.analysis.song import SongInfo, load_song
from selecta.backup import activate_pending_restore, export_backup, stage_restore
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.engine_store import library, song_hashes
from selecta.engine_store import songs as stored

FLAG_ON = "+core.engine_store"
SECTIONS = [
    {"start_bar": 0, "end_bar": 8, "label": "verse", "energy": 0.5, "group": 0, "chorus_prob": 0.2},
    {
        "start_bar": 8,
        "end_bar": 16,
        "label": "chorus",
        "energy": 0.8,
        "group": 1,
        "chorus_prob": 0.9,
    },
]
LRC = "[00:01.00] hello there my friend\n[00:05.00] hello there my friend again\n"
FACTS = ("songs", "analysis", "lyrics", "song_overrides")


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "home"))
    settings = Settings(tmp_path / "home")
    settings.home.mkdir(parents=True)
    yield settings
    flags.use(None)
    library.forget(settings.db_path)


def _arrays(seed: int) -> dict[str, np.ndarray]:
    rng = np.random.default_rng(seed)
    bars = 16
    return {
        "beats": np.arange(64) * 0.5 + 0.1,
        "bar_starts": np.arange(0, 64, 4, dtype=np.int32),
        "raw_beats": (np.arange(64) * 0.5).astype(np.float32),
        "raw_downbeats": (np.arange(0, 64, 4) * 0.5).astype(np.float32),
        "chroma_bars": rng.random((bars, 12)).astype(np.float16),
        "mfcc_bars": rng.random((bars, 13)).astype(np.float16),
        "energy_bars": rng.random(bars).astype(np.float16),
        "rms_db_bars": (rng.random(bars) * -20).astype(np.float16),
        "low_share_bars": rng.random(bars).astype(np.float16),
        "peaks": rng.random(200).astype(np.float32),
    }


def _library(settings: Settings) -> None:
    """Today's library, made with the flag off: three analysed songs, lyrics and corrections."""
    flags.use("")
    settings.features_dir.mkdir(parents=True, exist_ok=True)
    music = settings.home / "music"
    music.mkdir()
    conn = db.connect(settings.db_path)
    for song_id in (1, 2, 3):
        file = music / f"{song_id}.flac"
        file.write_bytes(bytes([song_id]) * (1000 + song_id))
        facts = file.stat()
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,genre,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,?,1)",
            (
                song_id,
                str(file),
                "music",
                facts.st_size,
                facts.st_mtime,
                32.0,
                f"Artist {song_id}",
                f"Song {song_id}",
                "Afrobeats",
            ),
        )
        db.save_analysis(
            conn,
            song_id,
            {
                "version": ANALYSIS_VERSION,
                "bpm": 120.0,
                "constant_tempo": 1,
                "grid_confidence": 0.9,
                "beats_per_bar": 4,
                "key": "A minor",
                "camelot": "8A",
                "key_confidence": 0.8,
                "key_agrees_chroma": 1,
                "lufs": -9.5,
                "peak_db": -0.4,
                "energy": 0.6,
                "sections": SECTIONS,
                "timbre": [0.1, 0.2],
                "timings": {"total": 1.0},
            },
        )
        np.savez_compressed(features_path(settings, song_id), **_arrays(song_id))
    db.save_lyrics(conn, 1, "synced", LRC, None)
    db.save_lyrics(conn, 2, "instrumental", None, None)
    conn.execute("INSERT INTO song_overrides(song_id,bpm,camelot) VALUES(2,240.0,'9A')")
    conn.execute("INSERT INTO song_overrides(song_id,bpm,camelot) VALUES(3,NULL,'10B')")
    conn.commit()
    conn.close()


def _start(path: Path) -> None:
    db.connect(path).close()


def _schema(path: Path) -> list[tuple]:
    conn = sqlite3.connect(path)
    try:
        return conn.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"
        ).fetchall()
    finally:
        conn.close()


def _rows(path: Path, drop: tuple[str, ...] = ()) -> dict[str, list[dict]]:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        return {
            table: [
                {k: row[k] for k in row.keys() if k not in drop}
                for row in conn.execute(f"SELECT * FROM {table} ORDER BY 1")  # noqa: S608
            ]
            for table in FACTS
        }
    finally:
        conn.close()


def _hashes(path: Path) -> dict[int, str | None]:
    conn = sqlite3.connect(path)
    try:
        return dict(conn.execute("SELECT id, content_hash FROM songs ORDER BY id").fetchall())
    finally:
        conn.close()


def _loaded(settings: Settings) -> dict[int, SongInfo]:
    conn = db.connect(settings.db_path)
    try:
        return {song_id: load_song(conn, settings, song_id) for song_id in (1, 2, 3)}
    finally:
        conn.close()


def _same(a: SongInfo, b: SongInfo) -> None:
    for field in dataclasses.fields(SongInfo):
        if field.name.startswith("_"):
            continue
        left, right = getattr(a, field.name), getattr(b, field.name)
        if isinstance(left, np.ndarray) or isinstance(right, np.ndarray):
            assert left.dtype == right.dtype, field.name
            assert np.array_equal(left, right), field.name
        else:
            assert left == right, field.name


def test_flag_off_loading_a_song_leaves_the_library_as_it_was(home):
    _library(home)
    before = _schema(home.db_path)
    flags.use("")
    song = _loaded(home)[1]
    assert song.lines and song.camelot == "8A"
    assert "peaks" in load_features(home, 1, ("peaks",))
    assert _schema(home.db_path) == before
    assert not any(row[1] == library.VERSION_TABLE for row in before)
    assert not any("content_hash" in (row[3] or "") for row in before)
    assert not (home.home / "artifacts").exists()


def test_flag_on_loads_the_same_songs_and_arrays_through_the_store(home):
    _library(home)
    old = _loaded(home)
    old_peaks = load_features(home, 1, ("peaks",))["peaks"]
    flags.use(FLAG_ON)
    new = _loaded(home)
    direct = stored.load_song(
        library.store_for(home.db_path), library.artifacts_for(home), 2, legacy=home.features_dir
    )
    for song_id in (1, 2, 3):
        _same(old[song_id], new[song_id])
    _same(old[2], direct)
    assert new[2].bpm == 240.0 and new[2].instrumental and new[3].camelot == "10B"
    assert np.array_equal(load_features(home, 1, ("peaks",))["peaks"], old_peaks)


def test_flag_on_reads_the_features_artifact_by_content_hash(home):
    _library(home)
    old = _loaded(home)
    flags.use(FLAG_ON)
    _start(home.db_path)
    assert song_hashes.fill_all(library.store_for(home.db_path)) == 3
    content = _hashes(home.db_path)[1]
    assert content == hashlib.sha256((home.home / "music" / "1.flac").read_bytes()).hexdigest()
    key = stored.features_key("local", content, ANALYSIS_VERSION)
    library.artifacts_for(home).publish(key, features_path(home, 1))
    features_path(home, 1).unlink()  # only the artifact is left for song 1
    new = _loaded(home)
    _same(old[1], new[1])
    _same(old[2], new[2])  # no artifact: the older file is read


def test_a_caller_with_pending_writes_reads_them(home):
    _library(home)
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    try:
        conn.execute("UPDATE song_overrides SET camelot='1A' WHERE song_id=3")
        assert conn.in_transaction
        assert load_song(conn, home, 3).camelot == "1A"
        conn.rollback()
        assert load_song(conn, home, 3).camelot == "10B"
    finally:
        conn.close()


def test_the_migration_meets_an_existing_column_and_runs_once(home):
    _library(home)
    before = _rows(home.db_path)
    conn = sqlite3.connect(home.db_path)
    # as `recovery.recover` leaves an older file after copying a newer one's rows into it
    conn.execute('ALTER TABLE songs ADD COLUMN "workspace_id"')
    conn.execute('ALTER TABLE songs ADD COLUMN "content_hash"')
    conn.execute("UPDATE songs SET content_hash='kept' WHERE id=1")
    conn.commit()
    conn.close()
    flags.use(FLAG_ON)
    _start(home.db_path)
    after = _rows(home.db_path)
    assert {row["workspace_id"] for table in FACTS for row in after[table]} == {"local"}
    assert _hashes(home.db_path) == {1: "kept", 2: None, 3: None}
    assert _rows(home.db_path, ("workspace_id", "content_hash", "audio_id")) == before
    schema, rows = _schema(home.db_path), _rows(home.db_path)
    db._CHECKED.clear()  # the full check again, as a new process would
    _start(home.db_path)
    assert library.bring_forward(home.db_path) == library.head()
    assert _schema(home.db_path) == schema
    assert _rows(home.db_path) == rows


def test_the_hash_job_fills_only_missing_hashes_and_resumes(home):
    _library(home)
    flags.use(FLAG_ON)
    _start(home.db_path)
    store = library.store_for(home.db_path)
    # song 3's file changed after the scan, so its row no longer describes it
    (home.home / "music" / "3.flac").write_bytes(b"changed" * 500)
    # library.audio_identity is on by default, so the job fills audio_id too ("" for these files)
    before = _rows(home.db_path, ("content_hash", "audio_id"))
    assert song_hashes.fill_missing(store, 0, limit=1) == (1, 1)
    assert _hashes(home.db_path)[2] is None
    filled, last = song_hashes.fill_missing(store, 1, limit=5)
    assert (filled, last) == (1, 3)
    assert song_hashes.fill_missing(store, last) == (0, None)
    hashes = _hashes(home.db_path)
    assert hashes[1] and hashes[2] and hashes[3] is None
    assert _rows(home.db_path, ("content_hash", "audio_id")) == before
    assert song_hashes.fill_all(store) == 0
    assert _hashes(home.db_path) == hashes


def test_a_changed_file_loses_its_hash(home):
    _library(home)
    flags.use(FLAG_ON)
    _start(home.db_path)
    song_hashes.fill_all(library.store_for(home.db_path))
    conn = db.connect(home.db_path)
    try:
        rows = {row["id"]: dict(row) for row in conn.execute("SELECT * FROM songs")}
        unchanged = {k: v for k, v in rows[2].items() if k not in {"id", "content_hash"}}
        changed = dict(unchanged, path=rows[1]["path"], size=rows[1]["size"] + 1)
        db.upsert_song(conn, unchanged)
        db.upsert_song(conn, changed)
        conn.commit()
    finally:
        conn.close()
    hashes = _hashes(home.db_path)
    assert hashes[1] is None and hashes[2] == rows[2]["content_hash"]


def test_a_backup_restores_the_song_facts_and_the_stamp(home):
    _library(home)
    flags.use(FLAG_ON)
    _start(home.db_path)
    song_hashes.fill_all(library.store_for(home.db_path))
    facts = _rows(home.db_path)
    conn = db.connect(home.db_path)
    try:
        data = export_backup(conn, home)
        conn.execute("UPDATE analysis SET bpm=99 WHERE song_id=1")
        conn.execute("UPDATE songs SET content_hash=NULL")
        conn.commit()
    finally:
        conn.close()
    stage_restore(home, data, hashlib.sha256(data).hexdigest())
    assert activate_pending_restore(home)
    db._CHECKED.clear()
    _start(home.db_path)
    assert _rows(home.db_path) == facts
    conn = sqlite3.connect(home.db_path)
    try:
        assert library.stamp_of(conn) == library.head()
    finally:
        conn.close()
    assert json.loads(facts["analysis"][0]["sections"]) == SECTIONS
