"""GP-0251: music-aware Library search, proven on a labelled corpus and at 20,000 songs.

The corpus (tests/fixtures/gp_0251_queries.json) labels exact, remix, live, feat, accent, typo,
symbol and no-result queries with the song that must come first, the songs that must not match
and the explanation the first result must carry. Ranking is for finding; the song ID chosen stays
authoritative and the stored names are returned exactly as they are.
"""

from __future__ import annotations

import json
import statistics
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from selecta import db
from selecta.api import create_app
from selecta.config import Settings
from selecta.library.relevance import normalize_music, relevance

CORPUS = json.loads(
    (Path(__file__).parent / "fixtures" / "gp_0251_queries.json").read_text(encoding="utf-8")
)


def _add(conn, song_id: int, title: str, artist: str) -> None:
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,'f',1,1.0,200.0,?,?,1)",
        (song_id, f"song-{song_id}.flac", artist, title),
    )


@pytest.fixture
def conn(tmp_path):
    connection = db.connect(Settings(tmp_path).db_path)
    for song in CORPUS["songs"]:
        _add(connection, song["id"], song["title"], song["artist"])
    connection.commit()
    yield connection
    connection.close()


@pytest.fixture
def client(tmp_path, conn):
    return TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))


def _search(client, q: str) -> list[dict]:
    return client.get("/api/library", params={"q": q, "state": "all", "limit": 200}).json()["songs"]


@pytest.mark.parametrize("case", CORPUS["queries"], ids=lambda case: f"{case['kind']}:{case['q']}")
def test_gp_0251_01_03_every_labelled_query_ranks_the_right_recording_first(client, case):
    found = _search(client, case["q"])
    ids = [song["id"] for song in found]
    assert not set(case["absent"]) & set(ids), f"{case['q']!r} matched {ids}"
    if not case["top"]:
        assert not set(ids) & set(case["absent"])
        if case["kind"] == "none":
            assert ids == []
        return
    assert set(ids[: len(case["top"])]) == set(case["top"]), f"{case['q']!r} ranked {ids}"
    assert found[0]["match"] == case["label"]


def test_gp_0251_02_normalising_for_search_never_changes_what_is_shown(client):
    stored = {song["id"]: song for song in CORPUS["songs"]}
    for q in ("zoe orsted", "deja vu", "cafe del mar", "bjork", "Blue Monday ft. Ana Ruiz"):
        for song in _search(client, q):
            assert song["title"] == stored[song["id"]]["title"]
            assert song["artist"] == stored[song["id"]]["artist"]
    assert normalize_music("Zoë Ørsted") == normalize_music("zoe orsted") == "zoe orsted"
    assert normalize_music("Łódź Æther") == "lodz aether"
    # qualifiers that tell recordings apart survive normalisation
    assert normalize_music("Midnight City (Remix)") != normalize_music("Midnight City (Live)")


def test_gp_0251_03_exact_matches_outrank_approximate_ones():
    exact = relevance("Bohemian Rhapsody", 1, "Crown Street", "Bohemian Rhapsody")
    approximate = relevance("Bohemian Rhapsody", 2, "Crown Street", "Bohemian Rapsodie")
    assert exact is not None and approximate is not None
    assert exact < approximate
    assert relevance("Midnight City", 1, "A", "Midnight City") < relevance(
        "Midnight City", 2, "A", "Midnight City (Remix)"
    )


def test_gp_0251_04_same_titles_stay_separate_recordings_by_artist_version_and_id(client):
    found = _search(client, "Midnight City")
    by_id = {song["id"]: (song["title"], song["artist"]) for song in found}
    assert by_id == {
        1: ("Midnight City", "Neon Harbour"),
        2: ("Midnight City (Remix)", "Neon Harbour"),
        3: ("Midnight City (Live)", "Neon Harbour"),
        4: ("Midnight City", "Paper Lanterns"),
    }
    assert len(found) == len(by_id)  # nothing coalesced, nothing repeated


def test_gp_0251_08_relevance_and_p95_latency_on_twenty_thousand_songs(tmp_path):
    connection = db.connect(Settings(tmp_path).db_path)
    words = ["Night", "City", "Blue", "Harbour", "Lights", "Fire", "Rain", "Gold", "Echo", "Drive"]
    rows = []
    for number in range(100, 100 + 20000):
        title = f"{words[number % 10]} {words[(number // 10) % 10]} {number}"
        rows.append((number, f"song-{number}.flac", f"Artist {number % 700}", title))
    connection.executemany(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,'f',1,1.0,200.0,?,?,1)",
        rows,
    )
    for song in CORPUS["songs"]:
        _add(connection, song["id"], song["title"], song["artist"])
    connection.commit()
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    client.get("/api/library", params={"q": "warm up", "state": "all"})

    timings, right = [], 0
    for case in CORPUS["queries"]:
        started = time.perf_counter()
        found = client.get(
            "/api/library", params={"q": case["q"], "state": "all", "limit": 100}
        ).json()["songs"]
        timings.append(time.perf_counter() - started)
        ids = [song["id"] for song in found]
        if case["top"]:
            right += set(ids[: len(case["top"])]) == set(case["top"])
        else:
            right += not set(ids) & set(case["absent"])
    accuracy = right / len(CORPUS["queries"])
    p95 = statistics.quantiles(timings, n=20)[-1]
    print(f"GP-0251-08: accuracy {accuracy:.0%} on {len(timings)} queries, p95 {p95 * 1000:.0f} ms")
    connection.close()
    assert accuracy == 1.0
    assert p95 < 1.5
