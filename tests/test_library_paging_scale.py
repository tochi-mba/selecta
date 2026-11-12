"""SF-0235-05: a 20,000-song Library pages quickly, because each page is read straight from a
sort-order index and the count from a covering index, never by sorting every song."""

from __future__ import annotations

import statistics
import time

import pytest
from fastapi.testclient import TestClient

from selecta import db
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings

TOTAL = 20_000
# A whole request, on a loaded shared laptop. The page query itself fell from about 50 ms (a sort of
# all 20,000 songs) to under 1 ms; what is left is connecting, checking each file still exists and
# the test client. The plan test below is what catches the sort coming back.
PAGE_BUDGET_S = 1.0


@pytest.fixture
def library(tmp_path):
    conn = db.connect(Settings(tmp_path).db_path)
    # Shuffled titles (so title order is not id order), repeated names (so ties are paged by id),
    # 300 artists, and every song analysed, like a real library after its first scan.
    conn.executemany(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,'f',1,1.0,200.0,?,?,1)",
        [
            (n, f"song-{n}.flac", f"Artist {n % 300}", f"Song {(n * 7919) % 5000:05d}")
            for n in range(1, TOTAL + 1)
        ],
    )
    conn.execute(
        "INSERT INTO analysis(song_id,version,bpm,camelot) SELECT id,?,120.0,'8A' FROM songs",
        (ANALYSIS_VERSION,),
    )
    conn.commit()
    yield conn
    conn.close()


@pytest.fixture
def client(tmp_path, library):
    return TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))


def _plan(conn, sql, params=()):
    return " | ".join(row[3] for row in conn.execute("EXPLAIN QUERY PLAN " + sql, params))


def test_a_page_seeks_the_sort_order_index_and_never_sorts_the_whole_library(library):
    joins = (
        "FROM songs s LEFT JOIN analysis a ON a.song_id=s.id "
        "LEFT JOIN lyrics l ON l.song_id=s.id LEFT JOIN song_overrides o ON o.song_id=s.id "
    )
    for order, index in (
        ("lower(coalesce(s.title,''))", "songs_title_order"),
        ("lower(coalesce(s.artist,''))", "songs_artist_order"),
    ):
        # the same shape library_page builds for a later page of the whole library
        plan = _plan(
            library,
            f"SELECT s.id {joins}WHERE s.duplicate_of IS NULL AND +s.is_music=1 "  # noqa: S608
            f"AND {order} >= ? AND ({order} > ? OR s.id > ?) ORDER BY {order}, s.id LIMIT 101",
            ("song 02500", "song 02500", 1),
        )
        assert f"SEARCH s USING INDEX {index}" in plan, plan
        assert "TEMP B-TREE" not in plan, plan
    count = _plan(
        library, "SELECT COUNT(*) FROM songs s WHERE s.duplicate_of IS NULL AND s.is_music=1"
    )
    assert "COVERING INDEX songs_listed" in count, count


@pytest.mark.parametrize("sort", ["title", "artist"])
def test_paging_twenty_thousand_songs_reaches_each_once_in_order_and_quickly(client, sort):
    seen, times, after = [], [], None
    while True:
        params = {"limit": 200, "sort": sort}
        if after:
            params["after"] = after
        started = time.perf_counter()
        page = client.get("/api/library", params=params).json()
        times.append(time.perf_counter() - started)
        assert page["total"] == TOTAL
        seen += page["songs"]
        after = page["next"]
        if not after:
            break
    assert len(seen) == TOTAL and len({song["id"] for song in seen}) == TOTAL
    keys = [((song[sort] or "").lower(), song["id"]) for song in seen]
    assert keys == sorted(keys), "a page started in the wrong place"
    # the first request also builds the app's caches, so judge the steady pages
    steady = times[1:]
    assert statistics.median(steady) < PAGE_BUDGET_S / 2, steady
    assert max(steady) < PAGE_BUDGET_S, steady
