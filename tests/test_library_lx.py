"""LX-0343-05, LX-0347-07, LX-0349-02, LX-0349-05, LX-0349-07, LX-0349-08: the Library's server
side keeps its promises. Batches are all-or-nothing, corrections keep what was measured, set aside
and never play are separate and reversible, a moved file never looks playable, and nothing a
person does in the Library writes to their music file."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from selecta import db, mix
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings


@pytest.fixture
def home(tmp_path):
    return tmp_path


@pytest.fixture
def conn(home):
    connection = db.connect(Settings(home).db_path)
    music = home / "music"
    music.mkdir()
    for song_id in (1, 2, 3, 4):
        path = music / f"song-{song_id}.flac"
        path.write_bytes(bytes(range(256)) * (16 + song_id))
        connection.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,200,'Someone',?,1)",
            (song_id, str(path), str(music), path.stat().st_size, path.stat().st_mtime,
             f"Song {song_id}"),
        )
        if song_id != 4:  # song 4 is not analysed yet: no tempo, no key
            connection.execute(
                "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
                (song_id, ANALYSIS_VERSION, 118.0 + song_id, "8A"),
            )
    connection.commit()
    yield connection
    connection.close()


@pytest.fixture
def client(home, conn):
    return TestClient(create_app(Settings(home), home / "no-web"))


def _song(client, song_id):
    songs = client.get("/api/library", params={"state": "all", "limit": 200}).json()["songs"]
    return next(s for s in songs if s["id"] == song_id)


def _flags(conn):
    priority = dict(conn.execute("SELECT id,processing_priority FROM songs").fetchall())
    never = db.preference(conn, "never_play", [])
    return priority, sorted(never)


def _fingerprints(home: Path) -> dict[str, tuple[str, int]]:
    return {
        path.name: (hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns)
        for path in sorted((home / "music").iterdir())
    }


# ---- LX-0347-07 server atomicity


def test_a_batch_with_one_stale_entry_changes_nothing(client, conn):
    before = _flags(conn)
    answer = client.post("/api/library/batch", json={"action": "prioritize", "entries": [
        {"id": 1, "expected": False}, {"id": 2, "expected": True}, {"id": 3, "expected": False},
    ]})
    assert answer.status_code == 409
    assert _flags(conn) == before


def test_a_batch_naming_a_song_that_is_gone_changes_nothing(client, conn):
    before = _flags(conn)
    answer = client.post("/api/library/batch", json={"action": "never", "entries": [
        {"id": 1, "expected": False}, {"id": 999, "expected": False},
    ]})
    assert answer.status_code == 409
    assert _flags(conn) == before


def test_another_tab_changing_a_song_after_selection_refuses_the_whole_batch(client, conn):
    client.post("/api/songs/2/never")  # someone else excludes song 2 after it was selected
    before = _flags(conn)
    answer = client.post("/api/library/batch", json={"action": "never", "entries": [
        {"id": 1, "expected": False}, {"id": 2, "expected": False},
    ]})
    assert answer.status_code == 409
    assert _flags(conn) == before


@pytest.mark.parametrize("entries", [
    [{"id": 1, "expected": False}, {"id": 1, "expected": False}],
    [{"id": 0, "expected": False}],
])
def test_a_batch_with_repeated_or_impossible_ids_is_refused(client, conn, entries):
    before = _flags(conn)
    assert client.post(
        "/api/library/batch", json={"action": "never", "entries": entries}
    ).status_code == 400
    assert _flags(conn) == before


def test_a_batch_over_the_limit_is_refused(client, conn):
    entries = [{"id": n, "expected": False} for n in range(1, 202)]
    assert client.post(
        "/api/library/batch", json={"action": "never", "entries": entries}
    ).status_code == 422


def test_a_good_batch_changes_exactly_the_named_songs(client, conn):
    answer = client.post("/api/library/batch", json={"action": "prioritize", "entries": [
        {"id": 1, "expected": False}, {"id": 3, "expected": False},
    ]})
    assert answer.status_code == 200
    priority, _ = _flags(conn)
    assert priority == {1: 100, 2: 0, 3: 100, 4: 0}


# ---- LX-0349-02 reset brings back what was measured


def test_reset_restores_the_measurement_and_leaves_the_file(client, conn, home):
    files = _fingerprints(home)
    client.post("/api/songs/1/correct", json={"bpm": 150.0, "camelot": "3B"})
    assert (_song(client, 1)["bpm"], _song(client, 1)["camelot"]) == (150.0, "3B")
    client.post("/api/songs/1/correct", json={"clear": ["bpm", "camelot"]})
    song = _song(client, 1)
    assert (song["bpm"], song["camelot"]) == (119.0, "8A")
    assert (song["detected_bpm"], song["detected_camelot"]) == (119.0, "8A")
    assert song["override_bpm"] is None and song["override_camelot"] is None
    assert _fingerprints(home) == files


# ---- LX-0349-05 never play and set aside are separate, and both undo


def test_never_play_and_set_aside_are_different_states_that_both_reverse(client, conn):
    client.post("/api/songs/1/never")
    assert _song(client, 1)["readiness"]["status"] == "excluded"
    client.post("/api/songs/2/correct", json={"is_music": False})
    aside = client.get("/api/library", params={"state": "set_aside"}).json()["songs"]
    assert [s["id"] for s in aside] == [2]
    assert aside[0]["readiness"]["status"] == "set_aside"
    # the two don't leak into each other
    assert _song(client, 1)["never"] is True
    assert aside[0]["never"] is False
    client.post("/api/songs/1/never")
    client.post("/api/songs/2/correct", json={"clear": ["is_music"]})
    client.post("/api/songs/2/correct", json={"is_music": True})
    assert _song(client, 1)["readiness"]["status"] != "excluded"
    assert _song(client, 2)["readiness"]["status"] != "set_aside"


# ---- LX-0349-07 a moved file never looks playable, and comes back when the file does


def test_a_lost_file_says_missing_and_recovers_when_it_returns(client, conn, home):
    path = home / "music" / "song-1.flac"
    moved = home / "song-1.flac.away"
    path.rename(moved)
    assert _song(client, 1)["readiness"]["status"] == "missing"
    ready = client.get("/api/library", params={"state": "ready"}).json()["songs"]
    assert all(s["readiness"]["status"] != "mix_ready" or s["id"] != 1 for s in ready)
    moved.rename(path)
    assert _song(client, 1)["readiness"]["status"] != "missing"


# ---- LX-0349-04 priority changes analysis order only, never the mix


def test_priority_does_not_reorder_the_current_mix(client, conn):
    for song_id in (1, 2, 3):
        mix.add_song(conn, song_id)
    conn.commit()
    before = [item["song_id"] for item in client.get("/api/mix").json()["mix"]]
    client.post("/api/songs/3/priority", params={"priority": 100})
    after = [item["song_id"] for item in client.get("/api/mix").json()["mix"]]
    assert before == after == [1, 2, 3]


# ---- LX-0343-05 an unknown tempo is labelled unknown, not treated as a match


def test_an_unanalysed_song_has_no_made_up_tempo_in_a_tempo_sort(client):
    songs = client.get("/api/library", params={"state": "all", "sort": "tempo"}).json()["songs"]
    unknown = [s for s in songs if s["id"] == 4]
    assert unknown and unknown[0]["bpm"] is None and unknown[0]["camelot"] is None
    assert unknown[0]["readiness"]["status"] in {"queued", "processing"}
    known = [s["bpm"] for s in songs if s["bpm"] is not None]
    assert known == sorted(known)
    ready = client.get("/api/library", params={"state": "ready", "sort": "tempo"}).json()["songs"]
    assert 4 not in [s["id"] for s in ready]


# ---- LX-0349-08 nothing a person does in the Library writes to a music file


def test_no_library_action_touches_any_music_file_or_unrelated_song(client, conn, home):
    files = _fingerprints(home)
    untouched = conn.execute("SELECT * FROM songs WHERE id=4").fetchone()
    client.post("/api/songs/1/correct", json={"bpm": 140.0, "camelot": "5A"})
    client.post("/api/songs/1/correct", json={"clear": ["bpm"]})
    client.post("/api/songs/2/correct", json={"is_music": False})
    client.post("/api/songs/2/correct", json={"is_music": True})
    client.post("/api/songs/3/priority", params={"priority": 100})
    client.post("/api/songs/3/never")
    client.post("/api/library/batch", json={"action": "prioritize", "entries": [
        {"id": 1, "expected": False}, {"id": 2, "expected": False},
    ]})
    client.post("/api/library/batch", json={"action": "never", "entries": [
        {"id": 1, "expected": False},
    ]})
    assert _fingerprints(home) == files
    assert tuple(conn.execute("SELECT * FROM songs WHERE id=4").fetchone()) == tuple(untouched)
