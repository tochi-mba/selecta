"""S4-0096-08: a server restart or browser reload during the first folder read.

A restart that cuts the write phase short leaves no duplicate songs, and reading the folder again
recovers the exact counts. While a read is running, asking again (a reloaded page pressing Start
again) joins the read in progress instead of starting a second one.
"""

from __future__ import annotations

import threading
import time

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient
from mutagen.flac import FLAC

from selecta import db
from selecta.api import create_app
from selecta.config import Settings
from selecta.library import scan as scan_module
from selecta.library.scan import scan_folder


def _song(path, title):
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, np.zeros((6000, 2)), 100, format="FLAC", subtype="PCM_16")
    tags = FLAC(path)
    tags["title"], tags["artist"], tags["genre"] = title, f"Artist {title}", "Pop"
    tags.save()


def _music(tmp_path, count=5):
    root = tmp_path / "music"
    for number in range(count):
        _song(root / f"{number}.flac", f"Song {number}")
    return root


class Killed(Exception):
    """The process went away part way through writing."""


def test_a_restart_part_way_through_writing_leaves_no_duplicates_and_recovers_counts(
    tmp_path, monkeypatch
):
    root = _music(tmp_path)
    path = tmp_path / "library.sqlite"
    conn = db.connect(path)
    real = db.upsert_song
    written = 0

    def dies_after_two(connection, song):
        nonlocal written
        if written == 2:
            raise Killed
        real(connection, song)
        connection.commit()  # the worst case: what was written before the kill is on disk
        written += 1

    monkeypatch.setattr(scan_module.db, "upsert_song", dies_after_two)
    with pytest.raises(Killed):
        scan_folder(conn, root)
    conn.close()
    monkeypatch.setattr(scan_module.db, "upsert_song", real)

    restarted = db.connect(path)
    assert restarted.execute("SELECT COUNT(*) FROM songs").fetchone()[0] == 2
    report = scan_folder(restarted, root)
    restarted.commit()
    total, distinct = restarted.execute(
        "SELECT COUNT(*), COUNT(DISTINCT path) FROM songs"
    ).fetchone()
    assert total == distinct == 5
    assert report.found == 5
    assert report.music == 5
    # the two written before the restart are recognised, not read again as new
    assert report.new_or_changed == 3
    again = scan_folder(restarted, root)
    assert again.new_or_changed == 0 and again.music == 5
    assert restarted.execute("SELECT COUNT(*) FROM songs").fetchone()[0] == 5
    restarted.close()


def test_asking_again_while_a_read_is_running_never_starts_a_second_one(tmp_path, monkeypatch):
    import selecta.routes.library as library_routes

    root = _music(tmp_path, count=2)
    monkeypatch.setattr(library_routes.subprocess, "run", lambda *_a, **_k: None)
    release = threading.Event()
    runs: list[str] = []
    real = scan_module.scan_folder

    def slow(conn, folder, **kwargs):
        runs.append(str(folder))
        release.wait(10)
        return real(conn, folder, **kwargs)

    monkeypatch.setattr(scan_module, "scan_folder", slow)
    client = TestClient(create_app(Settings(tmp_path / "home"), tmp_path / "no-web"))
    first = client.post("/api/scan", json={"folder": str(root)}).json()
    assert first["status"] == "running"
    deadline = time.monotonic() + 5
    while not runs and time.monotonic() < deadline:
        time.sleep(0.02)
    # a reloaded page sees the read in progress and pressing Start again joins it
    assert client.get("/api/status").json()["scan"]["status"] == "running"
    second = client.post("/api/scan", json={"folder": str(root)}).json()
    assert second["status"] == "running"
    release.set()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        state = client.get("/api/status").json()["scan"]
        if state.get("status") != "running":
            break
        time.sleep(0.05)
    assert len(runs) == 1
    assert state["status"] == "done"
    assert state["music"] == 2
