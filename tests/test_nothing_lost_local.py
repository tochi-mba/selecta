"""Nothing lost on a local restart (`library.scan_resume`, PR #119).

A scan cut off part way keeps the songs it had read, in batches, and carries on at the next start;
with the flag off a cut-off scan writes nothing, as before. Songs that have gone are only removed
when a scan finishes. An export or lyric lookup cut off by a restart is offered again, and an
export starts again from exactly the songs and transitions it froze. With
`core.durable_local_jobs` the job host carries on by itself, so nothing is offered again and
nothing answers 409.
"""

from __future__ import annotations

import json
import subprocess
import threading
import time
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient
from mix_helpers import _song_row
from mutagen.flac import FLAC

from selecta import api, db, flags
from selecta.api import create_app
from selecta.config import Settings
from selecta.library import scan as scan_module
from selecta.library.scan import ScanStopped, interrupted_scan, scan_folder
from selecta.routes import library as library_routes
from selecta.seams import SeamStore

WAIT = 20.0


def wait_for(check, timeout: float = WAIT) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return True
        time.sleep(0.02)
    return check()


def _song(path, title):
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, np.zeros((6000, 2)), 100, format="FLAC", subtype="PCM_16")
    tags = FLAC(path)
    tags["title"], tags["artist"], tags["genre"] = title, f"Artist {title}", "Pop"
    tags.save()


def _music(tmp_path, count=6):
    root = tmp_path / "music"
    for number in range(count):
        _song(root / f"{number}.flac", f"Song {number}")
    return root


class Killed(Exception):
    """The process went away part way through reading."""


def _reads(monkeypatch) -> list[int]:
    """Counts the files read. (should_stop is also asked while listing, so it can't count.)"""
    read = [0]
    real = scan_module.read_file

    def counted(path):
        read[0] += 1
        return real(path)

    monkeypatch.setattr(scan_module, "read_file", counted)
    return read


def _dies_at(monkeypatch, file_number: int):
    """A should_stop that kills the scan once this many files are read, as a restart would."""
    read = _reads(monkeypatch)

    def should_stop() -> bool:
        if read[0] == file_number:
            raise Killed
        return False

    return should_stop


def _count(conn) -> int:
    return conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]


# --- the scan itself ---


def test_a_scan_cut_off_part_way_keeps_its_batches_and_carries_on(tmp_path, monkeypatch):
    monkeypatch.setattr(scan_module, "CHECKPOINT_EVERY", 2)
    root = _music(tmp_path)
    path = tmp_path / "library.sqlite"
    conn = db.connect(path)
    with pytest.raises(Killed):
        scan_folder(conn, root, should_stop=_dies_at(monkeypatch, 5), checkpoint=True)
    conn.close()

    restarted = db.connect(path)
    # two batches of two were saved before the kill; the fifth song was still being read
    assert _count(restarted) == 4
    state = interrupted_scan(restarted)
    assert state is not None
    assert state["folder"] == str(root.resolve())
    assert state["found"] == 6 and state["done"] == 4

    report = scan_folder(restarted, root, checkpoint=True)
    assert report.found == 6
    assert report.new_or_changed == 2, "the saved songs match on size and time, not read again"
    total, distinct = restarted.execute(
        "SELECT COUNT(*), COUNT(DISTINCT path) FROM songs"
    ).fetchone()
    assert total == distinct == 6
    assert interrupted_scan(restarted) is None, "a finished scan leaves nothing to carry on"


def test_with_checkpoints_off_a_cut_off_scan_writes_nothing_as_before(tmp_path, monkeypatch):
    monkeypatch.setattr(scan_module, "CHECKPOINT_EVERY", 2)
    root = _music(tmp_path)
    path = tmp_path / "library.sqlite"
    conn = db.connect(path)
    with pytest.raises(Killed):
        scan_folder(conn, root, should_stop=_dies_at(monkeypatch, 5))
    conn.close()

    restarted = db.connect(path)
    assert _count(restarted) == 0, "all the writing is at the end"
    assert interrupted_scan(restarted) is None
    report = scan_folder(restarted, root)
    assert report.new_or_changed == 6 and _count(restarted) == 6


def test_a_cut_off_scan_removes_nothing_and_a_finished_one_removes_what_has_gone(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(scan_module, "CHECKPOINT_EVERY", 2)
    root = _music(tmp_path)
    path = tmp_path / "library.sqlite"
    conn = db.connect(path)
    scan_folder(conn, root, checkpoint=True)
    assert _count(conn) == 6
    (root / "0.flac").unlink()
    for number in range(6, 10):
        _song(root / f"{number}.flac", f"Song {number}")

    with pytest.raises(Killed):
        scan_folder(conn, root, should_stop=_dies_at(monkeypatch, 3), checkpoint=True)
    conn.close()
    restarted = db.connect(path)
    paths = {row[0] for row in restarted.execute("SELECT path FROM songs")}
    gone = str((root / "0.flac").resolve())
    assert gone in paths, "a partial scan never removes a song"

    report = scan_folder(restarted, root, checkpoint=True)
    assert report.removed == 1
    paths = {row[0] for row in restarted.execute("SELECT path FROM songs")}
    assert gone not in paths and len(paths) == 9


def test_a_stop_asked_for_keeps_what_was_read_and_is_not_an_interruption(tmp_path, monkeypatch):
    monkeypatch.setattr(scan_module, "CHECKPOINT_EVERY", 2)
    root = _music(tmp_path)
    conn = db.connect(tmp_path / "library.sqlite")
    read = _reads(monkeypatch)
    with pytest.raises(ScanStopped):
        scan_folder(conn, root, should_stop=lambda: read[0] == 3, checkpoint=True)
    assert _count(conn) == 2
    assert interrupted_scan(conn) is None, "nothing carries on after a stop someone asked for"


# --- the app at startup ---


@pytest.fixture
def local_app(tmp_path, monkeypatch):
    """A local app whose startup watcher can be run once, with lyric lookups and analysis faked."""
    captured = {}
    real_routes = api.library_routes

    def keep_ctx(app, ctx):
        captured["ctx"] = ctx
        return real_routes(app, ctx)

    monkeypatch.setattr(api, "library_routes", keep_ctx)
    lookups: list[bool] = []

    def lyrics_run(command, **_kwargs):
        with db.connect(Settings(tmp_path).db_path) as conn:
            lookups.append(db.preference(conn, library_routes.LYRICS_KEY, None) is not None)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(
        library_routes, "subprocess", SimpleNamespace(run=lyrics_run, DEVNULL=subprocess.DEVNULL)
    )

    def build():
        client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
        ctx = captured["ctx"]
        ctx.background.analyse = lambda *_songs: SimpleNamespace(poll=lambda: 0)
        return client, ctx

    return SimpleNamespace(build=build, lookups=lookups)


class _Started(BaseException):
    """Stops the startup watcher after its first step, so a test can look."""


def _start_once(monkeypatch, ctx):
    def stop(_seconds):
        raise _Started

    monkeypatch.setattr(library_routes, "time", SimpleNamespace(time=time.time, sleep=stop))
    with pytest.raises(_Started):
        ctx.watch_for_new_songs()
    monkeypatch.setattr(library_routes, "time", time)


def _cut_off_scan(tmp_path, monkeypatch):
    monkeypatch.setattr(scan_module, "CHECKPOINT_EVERY", 2)
    root = _music(tmp_path)
    conn = db.connect(Settings(tmp_path).db_path)
    with pytest.raises(Killed):
        scan_folder(conn, root, should_stop=_dies_at(monkeypatch, 5), checkpoint=True)
    conn.close()
    return root


def test_at_startup_a_cut_off_scan_carries_on_and_says_so(tmp_path, monkeypatch, local_app):
    root = _cut_off_scan(tmp_path, monkeypatch)
    client, ctx = local_app.build()
    shown = client.get("/api/library/interrupted").json()
    assert shown["scan"]["folder"] == str(root.resolve())
    assert shown["scan"]["done"] == 4 and shown["scan"]["found"] == 6

    seen_while_reading = []
    real = scan_module.scan_folder

    def watched(*args, **kwargs):
        seen_while_reading.append((dict(ctx.background.scan), kwargs.get("checkpoint")))
        return real(*args, **kwargs)

    monkeypatch.setattr(scan_module, "scan_folder", watched)
    _start_once(monkeypatch, ctx)
    assert wait_for(lambda: ctx.background.scan.get("status") == "done"), ctx.background.scan
    running, checkpoint = seen_while_reading[0]
    assert running["status"] == "running" and running["resumed"] == {"done": 4, "found": 6}
    assert checkpoint is True
    with db.connect(Settings(tmp_path).db_path) as conn:
        assert _count(conn) == 6
    assert client.get("/api/library/interrupted").json()["scan"] is None


def test_with_the_flag_off_startup_carries_nothing_on(tmp_path, monkeypatch, local_app):
    _cut_off_scan(tmp_path, monkeypatch)
    flags.use("-library.scan_resume")
    client, ctx = local_app.build()
    assert client.get("/api/library/interrupted").status_code == 403
    _start_once(monkeypatch, ctx)
    assert ctx.background.scan.get("status") != "running"
    with db.connect(Settings(tmp_path).db_path) as conn:
        assert _count(conn) == 4


# --- lyric lookups ---


def test_a_cut_off_lyric_lookup_is_offered_again_and_started(tmp_path, local_app):
    with db.connect(Settings(tmp_path).db_path) as conn:
        db.set_preference(conn, library_routes.LYRICS_KEY, {"at": time.time()})
    client, _ctx = local_app.build()
    assert client.get("/api/library/interrupted").json()["lyrics"] is True

    assert client.post("/api/library/lyrics/again").json() == {"started": True}
    assert wait_for(lambda: local_app.lookups)
    assert local_app.lookups[0] is True, "marked while it runs, so a restart would offer it"
    assert wait_for(lambda: client.get("/api/library/interrupted").json()["lyrics"] is False)
    with db.connect(Settings(tmp_path).db_path) as conn:
        assert db.preference(conn, library_routes.LYRICS_KEY, None) is None


def test_lyric_lookup_turned_off_offers_nothing_and_refuses_again(tmp_path, local_app):
    with db.connect(Settings(tmp_path).db_path) as conn:
        db.set_preference(conn, library_routes.LYRICS_KEY, {"at": time.time()})
    flags.use("-lyrics.lookup")
    client, _ctx = local_app.build()
    assert client.get("/api/library/interrupted").json()["lyrics"] is False
    assert client.post("/api/library/lyrics/again").status_code == 409
    assert local_app.lookups == []


# --- exports ---


def _interrupted_export(home, job_id="b" * 32):
    folder = home / "exports" / "jobs"
    folder.mkdir(parents=True, exist_ok=True)
    job = {
        "id": job_id,
        "operation": "export-1",
        "scope": "current",
        "draft": None,
        "mix_name": "Frozen",
        "state": "encoding",
        "name": "mix.flac",
        "created_at": time.time(),
        "last_progress_at": time.time(),
        "error": None,
        "seams_total": 1,
        "seams_ready": 1,
        "songs": [
            {"song_id": 3, "title": "Song 3", "artist": "Someone"},
            {"song_id": 1, "title": "Song 1", "artist": "Someone"},
        ],
        "seams": [
            {"key": "frozen-key", "settings": {}, "a": 3, "b": 1, "from": "Song 3", "to": "Song 1"}
        ],
        "revision": "r1",
        "seconds_estimate": 400,
        "seconds": None,
    }
    (folder / f"{job_id}.json").write_text(json.dumps(job), encoding="utf-8")
    return job


def test_an_interrupted_export_is_offered_once_and_starts_from_its_frozen_order(
    tmp_path, monkeypatch
):
    job = _interrupted_export(tmp_path)
    monkeypatch.setattr(SeamStore, "status", lambda _s, key: {"status": "ready", "key": key})
    exported = []
    done = threading.Event()

    def export_snapshot(_conn, _settings, _store, _destination, songs, keys):
        exported.append((songs, keys))
        done.set()
        raise ValueError("stopped here by the test")

    monkeypatch.setattr("selecta.mix.export_snapshot", export_snapshot)
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    listed = {shown["id"]: shown for shown in client.get("/api/exports/jobs").json()["jobs"]}
    assert listed[job["id"]]["state"] == "interrupted"
    assert listed[job["id"]]["can_start_again"] is True

    again = client.post(f"/api/exports/jobs/{job['id']}/again")
    assert again.status_code == 200
    fresh = again.json()
    assert fresh["id"] != job["id"]
    assert [song["song_id"] for song in fresh["songs"]] == [3, 1]
    assert [seam["key"] for seam in fresh["seams"]] == ["frozen-key"]
    assert fresh["revision"] == "r1" and fresh["mix_name"] == "Frozen"
    assert done.wait(WAIT)
    assert exported[0] == ([3, 1], ["frozen-key"]), "what the first one set out to save"

    first = client.get(f"/api/exports/jobs/{job['id']}").json()
    assert first["started_again_as"] == fresh["id"]
    assert first["can_start_again"] is False
    assert client.post(f"/api/exports/jobs/{job['id']}/again").status_code == 409
    assert client.post(f"/api/exports/jobs/{fresh['id']}/again").status_code == 409


def test_with_the_flag_off_an_interrupted_export_is_not_offered(tmp_path):
    job = _interrupted_export(tmp_path)
    flags.use("-library.scan_resume")
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    shown = client.get(f"/api/exports/jobs/{job['id']}").json()
    assert shown["state"] == "interrupted" and shown["can_start_again"] is False
    assert client.post(f"/api/exports/jobs/{job['id']}/again").status_code == 403


def test_with_durable_jobs_nothing_is_offered_again_and_nothing_answers_409(tmp_path, monkeypatch):
    from selecta import jobs, mix
    from selecta.workers import local_exports
    from selecta.workers.local_seams import DurableSeamStore

    monkeypatch.setattr(jobs, "set_render_priority", lambda _important: None)
    with db.connect(Settings(tmp_path).db_path) as conn:
        _song_row(conn, 1, "Artist 1", "Song 1")
        _song_row(conn, 2, "Artist 2", "Song 2")
        mix.add_song(conn, 1)
        mix.add_song(conn, 2)
        db.set_preference(conn, library_routes.LYRICS_KEY, {"at": time.time()})
    legacy = _interrupted_export(tmp_path, job_id="c" * 32)
    monkeypatch.setattr(
        DurableSeamStore, "status", lambda _s, key: {"status": "rendering", "key": key}
    )
    monkeypatch.setattr(DurableSeamStore, "start", lambda _s: None)
    monkeypatch.setattr(local_exports, "CHECK_EVERY_SECONDS", 0.01)
    app = create_app(Settings(tmp_path), tmp_path / "no-web", durable=True)
    with TestClient(app) as client:
        job = client.post("/api/exports/jobs", headers={"x-operation-id": "export-d1"}).json()
        listed = client.get("/api/exports/jobs").json()["jobs"]
        assert listed and all(shown["can_start_again"] is False for shown in listed)

        again = client.post(f"/api/exports/jobs/{job['id']}/again")
        assert again.status_code == 200, "answers with the export the job host carries on"
        assert again.json()["id"] == job["id"] and again.json()["can_start_again"] is False
        # an old record from before durable jobs isn't the job host's to start again
        assert client.post(f"/api/exports/jobs/{legacy['id']}/again").status_code == 404

        interrupted = client.get("/api/library/interrupted").json()
        assert interrupted["lyrics"] is False
        assert interrupted["carrying_on"]["exports"] >= 1
        client.delete(f"/api/exports/jobs/{job['id']}")
