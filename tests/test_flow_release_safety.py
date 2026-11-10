"""Turning features off and back on is a reversible release switch (SF-0241-03).

A release slice can be rolled back by switching its flag off. That has to leave the person's music
files, the current mix, drafts and requests exactly as they were, so switching it back on (or
rolling forward again) finds everything in place. The cross-checkout version of this check is
`tests/rollback_check.py`; this one runs in the ordinary suite.
"""

from __future__ import annotations

import hashlib

import pytest
from fastapi.testclient import TestClient
from mix_helpers import ANALYSIS_VERSION

from selecta import db, flags, mix
from selecta.api import create_app
from selecta.config import Settings


@pytest.fixture
def home(tmp_path):
    settings = Settings(tmp_path)
    settings.ensure_dirs()
    music = tmp_path / "music"
    music.mkdir()
    conn = db.connect(settings.db_path)
    for song_id in range(1, 7):
        path = music / f"song-{song_id}.flac"
        path.write_bytes(b"fLaC" + bytes([song_id]) * 64)
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (
                song_id,
                str(path),
                str(music),
                68,
                1.0,
                200.0,
                f"Artist {song_id}",
                f"Song {song_id}",
            ),
        )
        conn.execute(
            "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
            (song_id, ANALYSIS_VERSION, 120.0, "8A"),
        )
    conn.commit()
    conn.close()
    return settings


def _snapshot(client: TestClient, settings: Settings) -> dict:
    mix = client.get("/api/mix").json()
    drafts = client.get("/api/drafts").json()["drafts"]
    draft = client.get(f"/api/mix?draft={drafts[0]['id']}").json() if drafts else {"mix": []}
    requests = client.get("/api/requests").json()["requests"]
    music = {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted((settings.home / "music").iterdir())
    }
    return {
        "mix": [item["song_id"] for item in mix["mix"]],
        "drafts": [(item["id"], item["name"]) for item in drafts],
        "draft_songs": [item["song_id"] for item in draft["mix"]],
        "requests": sorted((row["id"], row["song_id"]) for row in requests),
        "music": music,
    }


def test_switching_every_optional_feature_off_and_back_changes_no_stored_music_or_mix(home):
    client = TestClient(create_app(home, home.home / "no-web"), headers={"host": "127.0.0.1"})
    made = client.post("/api/drafts", json={"name": "Saturday"}).json()
    draft = made.get("id") or client.get("/api/drafts").json()["drafts"][0]["id"]
    # Persist the mix directly: the synthetic fixture audio is intentionally
    # not decodable, and this test is about feature rollback, not decoding.
    with db.connect(home.db_path) as conn:
        for song_id in (4, 5):
            mix.add_song(conn, song_id, draft=draft)
    client.post("/api/requests", json={"song_id": 6}).raise_for_status()
    before = _snapshot(client, home)
    assert before["draft_songs"] == [4, 5] and before["requests"]

    # the rollback: only core features left, and the pages a person would open still answer
    flags.use("minimal")
    assert client.get("/api/status").status_code == 200
    assert client.get("/api/mix").status_code == 200
    assert client.get("/api/drafts").status_code == 403, (
        "a switched-off feature is refused, not emptied"
    )

    # and forward again: nothing was rewritten while it was off
    flags.use("")
    assert _snapshot(client, home) == before


def test_a_feature_switched_off_mid_session_keeps_what_it_saved(home):
    client = TestClient(create_app(home, home.home / "no-web"), headers={"host": "127.0.0.1"})
    client.post("/api/requests", json={"song_id": 2}).raise_for_status()
    before = _snapshot(client, home)
    flags.use("-requests")
    assert client.get("/api/requests").status_code == 403
    flags.use("")
    assert _snapshot(client, home) == before
