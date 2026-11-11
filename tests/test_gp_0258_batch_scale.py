"""GP-0258-08: exact-scope batch actions stay quick and exact in a 20,000-song library.

A full 200-song batch (the most one batch may name) changes exactly those songs, its Undo puts back
exactly those songs, and paging the Library around it stays responsive. Timings are measured on a
shared 4-core laptop under load, so the bounds are generous; the printed numbers are the evidence.
"""

from __future__ import annotations

import statistics
import time

from fastapi.testclient import TestClient

from selecta import db
from selecta.api import create_app
from selecta.config import Settings

SONGS = 20000


def test_gp_0258_08_a_full_batch_in_a_twenty_thousand_song_library(tmp_path):
    connection = db.connect(Settings(tmp_path).db_path)
    connection.executemany(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,'f',1,1.0,200.0,?,?,1)",
        [(n, f"song-{n}.flac", f"Artist {n % 700}", f"Song {n}") for n in range(1, SONGS + 1)],
    )
    connection.commit()
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))

    pages = []
    for offset in range(0, 20):
        started = time.perf_counter()
        answer = client.get(
            "/api/library", params={"state": "all", "limit": 100, "q": f"Song {offset}"}
        )
        pages.append(time.perf_counter() - started)
        assert answer.status_code == 200
    chosen = list(range(5000, 20000, 75))[:200]
    entries = [{"id": n, "expected": False} for n in chosen]
    started = time.perf_counter()
    answer = client.post("/api/library/batch", json={"action": "prioritize", "entries": entries})
    batch = time.perf_counter() - started
    assert answer.status_code == 200, answer.text
    raised = connection.execute("SELECT id FROM songs WHERE processing_priority > 0")
    changed = {row[0] for row in raised}
    assert changed == set(chosen)

    undo = [{"id": n, "expected": True} for n in chosen]
    started = time.perf_counter()
    assert (
        client.post(
            "/api/library/batch", json={"action": "deprioritize", "entries": undo}
        ).status_code
        == 200
    )
    undone = time.perf_counter() - started
    left = connection.execute("SELECT COUNT(*) FROM songs WHERE processing_priority > 0")
    assert left.fetchone()[0] == 0
    p95 = statistics.quantiles(pages, n=20)[-1]
    print(
        f"GP-0258-08: {SONGS} songs, 200-song batch {batch * 1000:.0f} ms, "
        f"undo {undone * 1000:.0f} ms, "
        f"search page p95 {p95 * 1000:.0f} ms"
    )
    connection.close()
    assert batch < 3.0 and undone < 3.0
    assert p95 < 3.0
