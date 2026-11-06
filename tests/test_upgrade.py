"""A library from before Selecta 2.0 keeps everything, and a backup brings it all back."""

from __future__ import annotations

import shutil

import pytest
from fastapi.testclient import TestClient

from selecta import db, mix
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings


def _library(home):
    settings = Settings(home)
    settings.ensure_dirs()
    conn = db.connect(settings.db_path)
    for song_id in (1, 2, 3):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,'f',1,1.0,200.0,'Someone',?,1)",
            (song_id, f"song-{song_id}.flac", f"Song {song_id}"),
        )
        conn.execute(
            "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,120.0,'8A')",
            (song_id, ANALYSIS_VERSION),
        )
    conn.commit()
    mix.add_song(conn, 1)
    mix.add_song(conn, 2)
    draft = mix.create_draft(conn, "Friday")
    mix.add_song(conn, 3, None, draft)
    db.set_preference(conn, "never_play", [3])
    conn.commit()
    return settings, conn, draft


def _what_it_holds(client, draft):
    return {
        "mix": [item["song_id"] for item in client.get("/api/mix").json()["mix"]],
        "draft": [item["song_id"] for item in client.get(f"/api/mix?draft={draft}").json()["mix"]],
        "never": sorted(s["id"] for s in client.get("/api/songs").json() if s["never"]),
    }


@pytest.fixture
def old_library(tmp_path):
    """As it would be on disk before corrections existed."""
    settings, conn, draft = _library(tmp_path / "home")
    conn.execute("DROP TABLE song_overrides")
    conn.commit()
    conn.close()
    return settings, draft


def test_a_library_from_before_keeps_everything(old_library, tmp_path):
    settings, draft = old_library
    client = TestClient(create_app(settings, tmp_path / "no-web"))
    assert _what_it_holds(client, draft) == {"mix": [1, 2], "draft": [3], "never": [3]}


def test_a_library_from_before_can_take_corrections(old_library, tmp_path):
    settings, _draft = old_library
    client = TestClient(create_app(settings, tmp_path / "no-web"))
    assert client.post("/api/songs/1/correct", json={"bpm": 200.0}).status_code == 200
    page = client.get("/api/library", params={"q": "Song 1", "state": "all"}).json()
    assert page["songs"][0]["bpm"] == 200.0
    assert page["songs"][0]["detected_bpm"] == 120.0


def test_a_copy_of_the_folder_is_a_full_backup(tmp_path):
    settings, conn, draft = _library(tmp_path / "home")
    conn.close()
    client = TestClient(create_app(settings, tmp_path / "no-web"))
    client.post("/api/songs/1/correct", json={"bpm": 200.0})
    before = _what_it_holds(client, draft)

    backup = tmp_path / "backup"
    shutil.copytree(settings.home, backup)
    client.delete(f"/api/drafts/{draft}")
    client.post("/api/mix/clear")

    restored = tmp_path / "restored"
    shutil.copytree(backup, restored)
    again = TestClient(create_app(Settings(restored), tmp_path / "no-web"))
    assert _what_it_holds(again, draft) == before
    page = again.get("/api/library", params={"q": "Song 1", "state": "all"}).json()
    assert page["songs"][0]["bpm"] == 200.0
