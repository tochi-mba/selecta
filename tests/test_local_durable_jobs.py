"""Analysis, exports and the lyric lookup through the local durable job host (SC-0394-04).

Each job type resumes after a crash or a restart without being done twice, the analysis worker
stays one warm process however many songs are asked for, worker processes never inherit a pipe,
and with `core.durable_local_jobs` off the app is exactly as it was.
"""

from __future__ import annotations

import subprocess
import threading
import time

import pytest
from fastapi.testclient import TestClient
from mix_helpers import _song_row

from selecta import db, flags, jobs, mix
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.scheduling.policy import LATER, REQUEST
from selecta.seams import SeamStore
from selecta.work.model import JobState
from selecta.workers import local_analysis, local_app, local_exports, local_host
from selecta.workers.local_analysis import AnalysisWorker, DurableBackground
from selecta.workers.local_seams import DurableSeamStore

WAIT = 20.0


@pytest.fixture(autouse=True)
def _keep_this_process_priority(monkeypatch):
    monkeypatch.setattr(jobs, "set_render_priority", lambda _important: None)


def wait_for(check, timeout: float = WAIT) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return True
        time.sleep(0.02)
    return check()


def library(home, analysed=(), waiting=()):
    conn = db.connect(Settings(home).db_path)
    for song_id in analysed:
        _song_row(conn, song_id, f"Artist {song_id}", f"Song {song_id}")
    for song_id in waiting:
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (song_id, f"{song_id}.flac", "f", 1, 1.0, 200.0, "A", f"Song {song_id}"),
        )
    conn.commit()
    conn.close()


def crash_mid_run(store, pool: str, job_types: frozenset[str]) -> None:
    """A worker claims and starts the next job in `pool`, then its process dies."""
    from selecta.scheduling.policy import WorkerCaps

    caps = WorkerCaps(pool=pool, job_types=job_types, worker_id="dead-worker")
    store.register_worker(caps)
    claim = store.claim(pool, caps)
    assert claim is not None
    store.start(claim.attempt_id, claim.fencing_token)
    store.engine.dispose()


# --- analysis ---


class FakeAnalysis:
    def __init__(self):
        self.songs: list[int] = []

    def __call__(self, conn, _settings, row, _analysers):
        self.songs.append(row["id"])
        conn.execute(
            "INSERT OR REPLACE INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
            (row["id"], ANALYSIS_VERSION, 120.0, "8A"),
        )
        conn.commit()
        return object()


def analysis_worker(home, fake):
    worker = AnalysisWorker(Settings(home), local_host.open_store(home), idle_s=0.01,
                            analyse=fake)
    worker.work.register_worker(worker.caps)
    return worker


def run_all(worker) -> None:
    for _ in range(200):
        if worker.runner.run_once() is None:
            return


def test_analysis_whose_worker_died_mid_song_resumes_and_analyses_once(tmp_path, clock):
    library(tmp_path, waiting=[1, 2])
    store = local_host.open_store(tmp_path)
    for song in (1, 2):
        local_analysis.enqueue_song(store, song, LATER)
    crash_mid_run(store, local_host.ANALYSIS_POOL, frozenset({"analyse.song"}))

    clock.advance(3_600)
    fake = FakeAnalysis()
    worker = analysis_worker(tmp_path, fake)
    worker.work.reap_expired()
    run_all(worker)
    assert sorted(fake.songs) == [1, 2], "each song analysed once"
    local_analysis.enqueue_song(worker.work, 1, REQUEST)  # asked for again, already done
    run_all(worker)
    assert sorted(fake.songs) == [1, 2]


def test_a_song_someone_asks_for_goes_before_the_library(tmp_path):
    library(tmp_path, waiting=range(1, 8))
    fake = FakeAnalysis()
    worker = analysis_worker(tmp_path, fake)
    for song in range(1, 7):
        local_analysis.enqueue_song(worker.work, song, LATER)
    local_analysis.enqueue_song(worker.work, 7, REQUEST)
    run_all(worker)
    assert fake.songs[0] == 7 and sorted(fake.songs) == list(range(1, 8))


def test_the_library_pauses_while_the_mix_renders_and_a_pause_cancels_it(tmp_path):
    library(tmp_path, waiting=[1, 2])
    fake = FakeAnalysis()
    worker = analysis_worker(tmp_path, fake)
    jobs.mark_mix_rendering(tmp_path, True)
    local_analysis.enqueue_song(worker.work, 1, LATER)
    ran = threading.Thread(target=worker.runner.run_once)
    ran.start()
    time.sleep(0.3)
    assert fake.songs == [], "it waits between songs while the mix renders"
    jobs.mark_mix_rendering(tmp_path, False)
    ran.join(WAIT)
    assert fake.songs == [1]

    with db.connect(Settings(tmp_path).db_path) as conn:
        db.set_preference(conn, "analysis_paused", True)
    job = local_analysis.enqueue_song(worker.work, 2, LATER)
    run_all(worker)
    assert fake.songs == [1]
    assert worker.work.job(job.id).state == JobState.CANCELLED


def test_one_analysis_worker_however_many_songs_are_asked_for(tmp_path, monkeypatch):
    library(tmp_path, waiting=range(1, 6))
    started = []

    class Running:
        def poll(self):
            return None

    background = DurableBackground(tmp_path, local_host.open_store(tmp_path),
                                   Settings(tmp_path).db_path)
    monkeypatch.setattr(background, "_spawn", lambda: started.append(1) or Running())
    background.supervisor._start = background._spawn
    for song in range(1, 6):
        background.ask_for(song)
    assert len(started) == 1
    assert background.asked == [1, 2, 3, 4, 5]


# --- exports ---


def exports_for(home, monkeypatch, written):
    settings = Settings(home)
    work_store = local_host.open_store(home)
    seams = DurableSeamStore(settings, work_store)
    monkeypatch.setattr(DurableSeamStore, "status", lambda _s, key: {"status": "ready", "key": key})

    def snapshot(_conn, _settings, _store, target, songs, keys):
        written.append(target.name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"flac")
        return {"seconds": 400.0}

    monkeypatch.setattr(mix, "export_snapshot", snapshot)
    monkeypatch.setattr(local_exports, "verify_export", lambda _path, _seconds: "abc123")
    return local_exports.DurableExports(settings, seams, work_store)


FROZEN = {
    "scope": "current",
    "draft": None,
    "mix_name": "Tonight",
    "songs": [{"song_id": 1, "title": "One", "artist": "A"}, {"song_id": 2, "title": "Two",
                                                            "artist": "B"}],
    "seams": [{"key": "k1", "settings": {}, "a": 1, "b": 2, "from": "One", "to": "Two"}],
    "seconds_estimate": 400.0,
    "revision": "r1",
}


def test_an_export_whose_app_died_mid_run_is_reaped_and_run_once_more(tmp_path, monkeypatch,
                                                                      clock):
    written: list[str] = []
    exports = exports_for(tmp_path, monkeypatch, written)
    shown = exports.start(dict(FROZEN), "export-op-1")
    assert shown["state"] == "preparing" and shown["can_cancel"] is True
    crash_mid_run(exports.work, local_host.EXPORT_POOL, frozenset({"export.render"}))

    clock.advance(3_600)
    again = exports_for(tmp_path, monkeypatch, written)
    host = local_host.open_local_work(
        tmp_path, {"export.render": again.handle}, pools={local_host.EXPORT_POOL: 1},
        store=again.work, heartbeat_s=60.0, idle_s=0.02, upkeep_s=0.05,
    )
    host.start()
    try:
        job = again.find(shown["id"])
        assert wait_for(lambda: again.work.job(job.id).state == JobState.SUCCEEDED)
    finally:
        assert host.stop(timeout=WAIT)
    record = again.record(again.find(shown["id"]))
    assert record["state"] == "ready" and record["checksum"] == "abc123"
    assert record["seams_ready"] == 1 and record["songs"] == FROZEN["songs"]
    assert written == [record["name"]], "encoded once"
    assert again.work.job(job.id).attempt_count == 2
    # the same operation, after the restart, is the same export
    assert again.start(dict(FROZEN), "export-op-1")["id"] == shown["id"]


def test_a_verified_export_is_never_encoded_twice(tmp_path, monkeypatch):
    written: list[str] = []
    exports = exports_for(tmp_path, monkeypatch, written)
    shown = exports.start(dict(FROZEN), None)
    exports_dir = tmp_path / "exports"
    exports_dir.mkdir()
    (exports_dir / shown["name"]).write_bytes(b"flac")
    (exports_dir / f".{shown['name']}.verified").write_text('{"seconds": 400.0, "checksum": "x"}')
    host = local_host.open_local_work(
        tmp_path, {"export.render": exports.handle}, pools={local_host.EXPORT_POOL: 1},
        store=exports.work, heartbeat_s=60.0, idle_s=0.02, upkeep_s=0.05,
    )
    host.start()
    try:
        assert wait_for(lambda: exports.record(exports.find(shown["id"]))["state"] == "ready")
    finally:
        assert host.stop(timeout=WAIT)
    assert written == []


def test_the_same_frozen_mix_under_way_is_one_export(tmp_path, monkeypatch):
    exports = exports_for(tmp_path, monkeypatch, [])
    first = exports.start(dict(FROZEN), None)
    assert exports.start(dict(FROZEN), None)["id"] == first["id"]
    cancelled = exports.cancel(exports.find(first["id"]))
    assert cancelled["state"] == "cancelling"
    assert exports.record(exports.find(first["id"]))["state"] == "cancelled"


# --- the lyric lookup ---


def test_a_lyric_lookup_cut_off_by_a_crash_runs_again(tmp_path, monkeypatch, clock):
    from selecta.lyrics import lrclib

    calls = []
    monkeypatch.setattr(lrclib, "fetch_all", lambda conn: calls.append(1) or {"synced": 3})
    store = local_host.open_store(tmp_path)
    store.enqueue(local_host.JobSpec(local_host.LOCAL_WORKSPACE, "lyrics.fetch",
                                     idempotency_key="library"))
    crash_mid_run(store, local_host.LYRICS_POOL, frozenset({"lyrics.fetch"}))
    clock.advance(3_600)
    host = local_host.open_local_work(
        tmp_path, {"lyrics.fetch": local_app.lyrics_handler(Settings(tmp_path))},
        pools={local_host.LYRICS_POOL: 1}, heartbeat_s=60.0, idle_s=0.02, upkeep_s=0.05,
    )
    host.start()
    try:
        assert wait_for(lambda: calls == [1])
        twice = host.enqueue("lyrics.fetch", idempotency_key="library")
        assert wait_for(lambda: host.store.job(twice.job.id).state == JobState.SUCCEEDED)
    finally:
        assert host.stop(timeout=WAIT)
    assert len(calls) == 2


# --- worker processes ---


def test_worker_processes_get_no_pipe_and_know_the_app(tmp_path, monkeypatch):
    seen = {}

    def popen(command, **options):
        seen.update(options, command=command)
        return object()

    monkeypatch.setattr(subprocess, "Popen", popen)
    local_host.spawn_worker(tmp_path, "selecta.seam_worker", "--durable")
    assert seen["stdin"] is subprocess.DEVNULL
    assert seen["stdout"] is subprocess.DEVNULL and seen["stderr"] is subprocess.DEVNULL
    assert seen["env"][local_host.PARENT_ENV].isdigit()
    assert seen["command"][-2:] == ["selecta.seam_worker", "--durable"]


# --- the app ---


def test_with_the_flag_off_the_app_is_unchanged(tmp_path, monkeypatch):
    assert not flags.on(local_host.FLAG)
    library(tmp_path, analysed=[1, 2])
    with db.connect(Settings(tmp_path).db_path) as conn:
        mix.add_song(conn, 1)
        mix.add_song(conn, 2)
    monkeypatch.setattr(SeamStore, "status", lambda _s, key: {"status": "rendering", "key": key})
    monkeypatch.setattr(SeamStore, "submit", lambda *_args, **_kw: None)
    with TestClient(create_app(Settings(tmp_path), tmp_path / "no-web")) as client:
        job = client.post("/api/exports/jobs").json()
        assert job["state"] == "preparing"
        assert (tmp_path / "exports" / "jobs" / f"{job['id']}.json").exists()
        client.delete(f"/api/exports/jobs/{job['id']}")
    assert not (tmp_path / local_host.DATABASE).exists(), "no job database is even made"


def test_with_the_flag_on_exports_are_store_jobs_that_survive_a_restart(tmp_path, monkeypatch):
    library(tmp_path, analysed=[1, 2])
    with db.connect(Settings(tmp_path).db_path) as conn:
        mix.add_song(conn, 1)
        mix.add_song(conn, 2)
    monkeypatch.setattr(DurableSeamStore, "status",
                        lambda _s, key: {"status": "rendering", "key": key})
    monkeypatch.setattr(DurableSeamStore, "start", lambda _s: None)
    monkeypatch.setattr(local_exports, "CHECK_EVERY_SECONDS", 0.01)
    with TestClient(create_app(Settings(tmp_path), tmp_path / "no-web", durable=True)) as client:
        job = client.post("/api/exports/jobs", headers={"x-operation-id": "export-a1"}).json()
        assert job["state"] == "preparing" and len(job["id"]) == 32
        again = client.post("/api/exports/jobs", headers={"x-operation-id": "export-a1"}).json()
        assert again["id"] == job["id"]
        assert [shown["id"] for shown in client.get("/api/exports/jobs").json()["jobs"]] == [
            job["id"]
        ]
    assert not (tmp_path / "exports" / "jobs").exists(), "no JSON records, no process dict"
    with TestClient(create_app(Settings(tmp_path), tmp_path / "no-web", durable=True)) as client:
        shown = client.get(f"/api/exports/jobs/{job['id']}").json()
        assert shown["state"] == "preparing", "still under way after the restart, not lost"
        assert client.delete(f"/api/exports/jobs/{job['id']}").json()["state"] == "cancelling"
        assert wait_for(
            lambda: client.get(f"/api/exports/jobs/{job['id']}").json()["state"] == "cancelled"
        )
