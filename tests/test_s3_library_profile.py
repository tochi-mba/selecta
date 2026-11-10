"""S3-0062-07: a 20,000-song library paged while background analysis keeps writing results.

The profile pages the whole library twice through the real /api/library handler (called directly, so
the test client's per-request thread hand-off on a shared machine isn't what gets measured), once idle and once
while a second connection saves analysis rows as fast as it can (db.save_analysis, the same write and
commit the analysis pipeline makes per song). It prints both profiles so the run log carries the
numbers, and holds the budget that decides whether any optimisation is needed: every song reachable
exactly once, no page over a second and the slow pages at most a few times the idle ones.
"""

from __future__ import annotations

import statistics
import threading
import time

import pytest

from selecta import db
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings

SONGS = 20_000


@pytest.fixture
def library(tmp_path):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    conn.executemany(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,'f',1,1.0,200.0,'Someone',?,1)",
        [(n, f"song-{n}.flac", f"Song {n:05d}") for n in range(1, SONGS + 1)],
    )
    conn.commit()
    conn.close()
    app = create_app(settings, tmp_path / "no-web")
    handler = next(
        route.endpoint
        for route in app.routes
        if getattr(route, "path", "") == "/api/library" and "GET" in getattr(route, "methods", ())
    )
    return settings, handler


def _page_through(handler) -> tuple[set[int], list[float]]:
    seen: set[int] = set()
    timings: list[float] = []
    after = None
    while True:
        started = time.perf_counter()
        page = handler(q="", state="all", sort="title", limit=200, after=after)
        timings.append(time.perf_counter() - started)
        ids = [song["id"] for song in page["songs"]]
        assert not seen.intersection(ids), "a song came back on two pages"
        seen.update(ids)
        after = page["next"]
        if not after:
            return seen, timings


def _profile(timings: list[float]) -> dict[str, float]:
    ordered = sorted(timings)
    return {
        "pages": len(ordered),
        "p50_ms": round(statistics.median(ordered) * 1000, 1),
        "p95_ms": round(ordered[int(len(ordered) * 0.95)] * 1000, 1),
        "worst_ms": round(ordered[-1] * 1000, 1),
    }


def test_twenty_thousand_songs_page_quickly_while_analysis_writes_in_the_background(library):
    settings, handler = library
    idle_seen, idle = _page_through(handler)
    assert len(idle_seen) == SONGS

    stop = threading.Event()
    written = 0

    def analyse() -> None:
        nonlocal written
        writer = db.connect(settings.db_path)
        try:
            song_id = 1
            while not stop.is_set() and song_id <= SONGS:
                db.save_analysis(
                    writer, song_id,
                    {"version": ANALYSIS_VERSION, "bpm": 120.0, "camelot": "8A", "energy": 0.5},
                )
                written += 1
                song_id += 1
        finally:
            writer.close()

    worker = threading.Thread(target=analyse, daemon=True)
    worker.start()
    try:
        busy_seen, busy = _page_through(handler)
    finally:
        stop.set()
        worker.join(timeout=30)

    idle_profile, busy_profile = _profile(idle), _profile(busy)
    print(f"S3-0062-07 idle {idle_profile}")
    print(f"S3-0062-07 under analysis {busy_profile}, analysis rows written meanwhile: {written}")
    assert written > 100, "the background analysis must actually be writing during the profile"
    assert busy_seen == idle_seen, "every song is still reachable exactly once while analysis runs"
    assert busy_profile["worst_ms"] < 1000
    # slower under a competing writer is expected; a lock stall or a full rescan per page is not
    assert busy_profile["p95_ms"] < max(250.0, idle_profile["p95_ms"] * 5)
