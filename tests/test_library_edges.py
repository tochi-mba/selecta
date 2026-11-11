"""The library at its awkward edges: very large, songs with odd names, songs missing things."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from selecta import db
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings


def _add(conn, song_id, title, artist="Someone", path=None, analysed=True):
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,?,?,?,?,?,?,1)",
        (song_id, path or f"song-{song_id}.flac", "f", 1, 1.0, 200.0, artist, title),
    )
    if analysed:
        conn.execute(
            "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
            (song_id, ANALYSIS_VERSION, 120.0, "8A"),
        )


@pytest.fixture
def conn(tmp_path):
    connection = db.connect(Settings(tmp_path).db_path)
    yield connection
    connection.close()


@pytest.fixture
def client(tmp_path, conn):
    return TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))


def _everything(client, **params):
    seen, after = [], None
    while True:
        asked = {"limit": 50, "state": "all", **params}
        if after:
            asked["after"] = after
        page = client.get("/api/library", params=asked).json()
        seen += page["songs"]
        after = page["next"]
        if not after:
            return seen


def test_twenty_thousand_songs_are_all_reachable_and_a_page_stays_quick(client, conn):
    conn.executemany(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,'f',1,1.0,200.0,'Someone',?,1)",
        [(n, f"song-{n}.flac", f"Song {n:05d}") for n in range(1, 20001)],
    )
    conn.commit()
    slowest, after, seen = 0.0, None, set()
    while True:
        params = {"limit": 200, "state": "all"}
        if after:
            params["after"] = after
        started = time.perf_counter()
        page = client.get("/api/library", params=params).json()
        slowest = max(slowest, time.perf_counter() - started)
        seen |= {song["id"] for song in page["songs"]}
        after = page["next"]
        if not after:
            break
    assert len(seen) == 20000
    assert slowest < 2.0


def test_songs_with_the_same_name_are_kept_apart(client, conn):
    for song_id in (1, 2, 3):
        _add(conn, song_id, "Same Name", "Same Artist")
    conn.commit()
    assert sorted(song["id"] for song in _everything(client)) == [1, 2, 3]
    pages = client.get("/api/library", params={"limit": 1, "state": "all"}).json()
    rest = client.get(
        "/api/library", params={"limit": 1, "state": "all", "after": pages["next"]}
    ).json()
    assert pages["songs"][0]["id"] != rest["songs"][0]["id"]


@pytest.mark.parametrize(
    "title",
    [
        "שלום עולם",
        "مرحبا",
        "日本語の歌",
        "Beyoncé - Déjà Vu",
        "🔥 Fire 🔥",
        "<script>alert(1)</script>",
        'O\'Neil "Live"',
    ],
)
def test_any_name_comes_back_exactly_as_it_is_and_can_be_searched_for(client, conn, title):
    _add(conn, 1, title)
    conn.commit()
    found = client.get("/api/library", params={"q": title, "state": "all"}).json()["songs"]
    assert [song["title"] for song in found] == [title]


@pytest.mark.parametrize(
    ("q", "wanted"),
    [("100%", "100% Love"), ("a_b", "a_b"), ("back\\slash", "back\\slash")],
)
def test_a_search_means_the_characters_typed(client, conn, q, wanted):
    for song_id, title in enumerate(["100% Love", "1000 Days", "a_b", "axb", "back\\slash"], 1):
        _add(conn, song_id, title)
    conn.commit()
    found = client.get("/api/library", params={"q": q, "state": "all"}).json()["songs"]
    assert [song["title"] for song in found] == [wanted]


@pytest.mark.parametrize("sort", ["title", "artist", "tempo", "recent"])
def test_songs_missing_things_still_turn_up_in_every_order(client, conn, sort):
    _add(conn, 1, "Normal")
    _add(conn, 2, None, None, analysed=False)
    _add(conn, 3, "No tempo yet", analysed=False)
    conn.commit()
    assert sorted(song["id"] for song in _everything(client, sort=sort, limit=1)) == [1, 2, 3]


def test_a_song_analysis_gave_up_on_says_so_rather_than_looking_ready(client, conn):
    _add(conn, 1, "Broken", analysed=False)
    conn.execute(
        "INSERT INTO analysis(song_id,version,error) VALUES(1,?,'bad file')", (ANALYSIS_VERSION,)
    )
    conn.commit()
    song = client.get("/api/library", params={"state": "attention"}).json()["songs"][0]
    assert song["readiness"]["status"] in {"needs_attention", "missing"}


def test_a_song_whose_file_has_moved_says_so(client, conn):
    _add(conn, 1, "Gone", path="Z:/nowhere/gone.flac")
    conn.commit()
    song = client.get("/api/library", params={"state": "all"}).json()["songs"][0]
    assert song["readiness"]["status"] == "missing"


def test_duplicates_of_a_song_stay_out_of_the_list(client, conn):
    _add(conn, 1, "Original")
    _add(conn, 2, "Copy")
    conn.execute("UPDATE songs SET duplicate_of=1 WHERE id=2")
    conn.commit()
    assert [song["id"] for song in _everything(client)] == [1]


def test_a_correction_survives_reanalysis_a_folder_update_and_a_same_named_song(client, conn):
    """S3-0063-05: what the listener corrected stays in use when the song is measured again or its
    file changes on disk, and a song with the same name is never corrected along with it."""
    _add(conn, 1, "Twin", path="twin-a.flac")
    _add(conn, 2, "Twin", path="twin-b.flac")
    conn.commit()
    assert (
        client.post("/api/songs/1/correct", json={"bpm": 240.0, "camelot": "9B"}).status_code < 300
    )
    db.save_analysis(conn, 1, {"version": ANALYSIS_VERSION, "bpm": 118.0, "camelot": "4A"})
    db.upsert_song(
        conn,
        {
            "path": "twin-a.flac",
            "folder": "f",
            "size": 2,
            "mtime": 9.0,
            "duration": 201.0,
            "artist": "Someone",
            "title": "Twin",
            "is_music": 1,
        },
    )
    conn.commit()
    songs = {song["id"]: song for song in _everything(client)}
    assert (songs[1]["bpm"], songs[1]["camelot"]) == (240.0, "9B")
    assert (songs[1]["detected_bpm"], songs[1]["detected_camelot"]) == (118.0, "4A")
    assert (songs[1]["override_bpm"], songs[1]["override_camelot"]) == (240.0, "9B")
    assert songs[2]["override_bpm"] is None and songs[2]["bpm"] == 120.0
