"""Seam renders through the local durable job host (SC-0394-04, ADR-0394).

The seam worker's order, mapped onto lanes and urgency as §4A.5 says, holds under a flood of
spare-time and analysis work; interactive work preempts speculative work through `check_in()`;
the same ask makes one job; two claimers never render one seam twice; and a worker that dies
mid-render is reaped and its seam rendered once more, never twice once it was published.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import asdict

import pytest

from selecta import jobs
from selecta.config import Settings
from selecta.scheduling.policy import LATER, LINE, MIX, PREPARING, REQUEST, URGENT
from selecta.seams import SeamRequest
from selecta.work.model import JobState
from selecta.workers import local_analysis, local_host
from selecta.workers.local_seams import DurableSeamStore, SeamWorker, job_key


@pytest.fixture(autouse=True)
def _keep_this_process_priority(monkeypatch):
    monkeypatch.setattr(jobs, "set_render_priority", lambda _important: None)


def make_store(home) -> DurableSeamStore:
    store = DurableSeamStore(Settings(home), local_host.open_store(home))
    store.start = lambda: None  # no worker process in these tests
    return store


def seam(a: int, b: int = 0) -> SeamRequest:
    return SeamRequest(a, b or a + 1000, "echo_out")


class FakeRender:
    """Stands in for `SeamStore.render_now`: checks in like the engine, then publishes."""

    def __init__(self, store: DurableSeamStore, steps: int = 3):
        self.store = store
        self.steps = steps
        self.rendered: list[str] = []
        self.started: list[str] = []
        self.during: dict[str, callable] = {}

    def __call__(self, _conn, request: SeamRequest) -> dict:
        self.started.append(request.key)
        hook = self.during.pop(request.key, None)
        if hook is not None:
            hook()
        for _ in range(self.steps):
            jobs.check_in()
        self.store.before_publish()
        folder = self.store.folder(request.key)
        folder.mkdir(parents=True, exist_ok=True)
        state = {
            "status": "ready",
            "key": request.key,
            "request": asdict(request),
            "style": request.move,
            "tried": [],
        }
        (folder / "seam.json").write_text(json.dumps(state), "utf-8")
        self.rendered.append(request.key)
        return state


def make_worker(store: DurableSeamStore, steps: int = 3) -> tuple[SeamWorker, FakeRender]:
    render = FakeRender(store, steps)
    store.render_now = render
    worker = SeamWorker(store, idle_s=0.01, heartbeat_s=30.0, waiting_s=0.0, mix_check_s=0.0)
    store.work.register_worker(worker.caps)
    return worker, render


def drain(worker: SeamWorker, limit: int = 500) -> None:
    for _ in range(limit):
        if not worker.run_once():
            return
    raise AssertionError("the worker never ran out of work")


def jobs_of(store: DurableSeamStore, key: str):
    return store.live_jobs._rows(
        "SELECT state, base_urgency, attempt_count FROM jobs WHERE idempotency_key LIKE ?",
        (f"{key}@%",),
    )


def test_ranks_map_onto_lanes_and_urgency_as_4a5_says(tmp_path):
    store = make_store(tmp_path)
    expected = {
        URGENT: ("interactive", 0),
        REQUEST: ("interactive", 1),
        MIX: ("standard", 2),
        LINE: ("standard", 3),
        LATER: ("standard", 4),
        PREPARING: ("speculative", 5),
    }
    for rank, (lane, urgency) in expected.items():
        job = store.enqueue(seam(rank + 1), rank)
        assert (str(job.lane), job.urgency) == (lane, urgency)
        assert job.pool == local_host.SEAM_POOL
        assert job.idempotency_key == job_key(seam(rank + 1).key, rank)
    assert store.work.job(store.enqueue(seam(9), PREPARING).id).flag_id == "render.spare_time"


def test_a_flood_of_spare_time_and_analysis_never_delays_the_mix(tmp_path):
    store = make_store(tmp_path)
    worker, render = make_worker(store)
    for number in range(40):
        store.enqueue(seam(100 + number), PREPARING)
        store.enqueue(seam(200 + number), LATER)
        local_analysis.enqueue_song(store.work, 300 + number, LATER)
    store.enqueue(seam(5), LINE)
    store.enqueue(seam(4), REQUEST)
    store.enqueue(seam(1), URGENT)
    mix_seam = seam(2)
    store.next_mix_seam = lambda: (
        mix_seam if store.status(mix_seam.key)["status"] == "none" else None
    )

    for _ in range(4):
        assert worker.run_once()
    assert list(worker.claimed)[:4] == [
        (seam(1).key, URGENT),
        (seam(4).key, REQUEST),
        (mix_seam.key, MIX),
        (seam(5).key, LINE),
    ]
    drain(worker)
    ranks = [rank for _, rank in worker.claimed]
    assert ranks == sorted(ranks), "every claim came in rank order"
    assert ranks.count(LATER) == 40 and ranks.count(PREPARING) == 40
    # analysis lives in its own pool and process: none of it reached the seam worker
    assert local_analysis.waiting_count(tmp_path) == 40


def test_the_mix_seam_that_appears_mid_render_preempts_spare_time(tmp_path):
    store = make_store(tmp_path)
    worker, render = make_worker(store, steps=50)
    for number in range(30):
        store.enqueue(seam(100 + number), PREPARING)
    arrived = seam(7)
    wanted: list[SeamRequest] = []
    store.next_mix_seam = lambda: next(
        (r for r in wanted if store.status(r.key)["status"] == "none"), None
    )
    first = seam(100).key
    render.during[first] = lambda: wanted.append(arrived)  # the mix needs a seam right now

    assert worker.run_once()
    assert first in render.started and first not in render.rendered, "spare time gave way"
    assert [row[0] for row in jobs_of(store, first)] == ["queued"], "and went back in line"
    assert worker.run_once()
    assert render.rendered == [arrived.key], "the mix's seam went next"
    drain(worker)
    assert render.rendered.count(first) == 1, "the preempted seam was finished once, later"


def test_urgent_preempts_the_rest_of_the_mix_but_later_work_does_not(tmp_path):
    store = make_store(tmp_path)
    worker, render = make_worker(store, steps=50)
    store.enqueue(seam(2), MIX)
    render.during[seam(2).key] = lambda: store.enqueue(seam(3), LATER)
    assert worker.run_once()
    assert render.rendered == [seam(2).key], "MIX doesn't give way to LATER"

    store.enqueue(seam(4), MIX)
    render.during[seam(4).key] = lambda: store.enqueue(seam(5), URGENT)
    assert worker.run_once()
    assert seam(4).key not in render.rendered, "MIX gives way to URGENT"
    assert worker.run_once()
    assert render.rendered[-1] == seam(5).key


def test_a_seam_from_a_replaced_mix_stops_and_is_dropped(tmp_path):
    store = make_store(tmp_path)
    worker, render = make_worker(store, steps=50)
    store.keep_for_now = lambda: {seam(2).key}
    store.enqueue(seam(2), MIX)
    render.during[seam(2).key] = lambda: setattr(store, "keep_for_now", lambda: {"another"})
    assert worker.run_once()
    assert seam(2).key not in render.rendered
    assert [row[0] for row in jobs_of(store, seam(2).key)] == ["cancelled"]


def test_the_same_ask_repeated_makes_one_job_and_one_render(tmp_path):
    store = make_store(tmp_path)
    worker, render = make_worker(store)
    request = seam(1)
    for _ in range(3):
        assert store.submit(request)["status"] == "queued"
    for _ in range(2):
        store.submit(request, urgent=True)
    ranks = sorted(row[1] for row in jobs_of(store, request.key))
    assert ranks == [URGENT, LATER], "one job per rank, however often it's asked"
    drain(worker)
    assert render.rendered == [request.key], "the second job found it made and did nothing"
    assert store.status(request.key)["status"] == "ready"
    assert {row[0] for row in jobs_of(store, request.key)} == {"succeeded"}


def test_concurrent_claimers_never_render_one_seam_twice(tmp_path):
    store = make_store(tmp_path)
    for number in range(24):
        store.enqueue(seam(number + 1), LATER)
    workers = []
    for _ in range(3):
        other = make_store(tmp_path)  # its own engine, as another process would have
        workers.append(make_worker(other, steps=1))
    threads = [threading.Thread(target=drain, args=(worker,)) for worker, _ in workers]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(60)
    rendered = [key for _, render in workers for key in render.rendered]
    assert sorted(rendered) == sorted(seam(number + 1).key for number in range(24))
    assert len(rendered) == len(set(rendered))


def test_a_worker_that_died_mid_render_is_reaped_and_renders_once_more(tmp_path, clock):
    store = make_store(tmp_path)
    request = seam(1)
    store.submit(request, urgent=True)
    caps = SeamWorker(store).caps
    store.work.register_worker(caps)
    claim = store.work.claim(local_host.SEAM_POOL, caps)
    store.work.start(claim.attempt_id, claim.fencing_token)
    store.work.engine.dispose()  # the seam worker process died

    store.refresh()
    assert store.status(request.key)["status"] == "rendering"
    clock.advance(3_600)
    again = make_store(tmp_path)
    again.work.reap_expired()
    worker, render = make_worker(again)
    drain(worker)
    assert render.rendered == [request.key]
    (state, _, attempts), = jobs_of(again, request.key)
    assert (state, attempts) == ("succeeded", 2)


def test_a_seam_published_just_before_a_crash_is_not_rendered_again(tmp_path, clock):
    store = make_store(tmp_path)
    request = seam(1)
    store.submit(request)
    worker, render = make_worker(store)
    claim = worker.claim()
    store.work.start(claim.attempt_id, claim.fencing_token)
    render(None, request)  # the record was written, then the process died before completing
    store.work.engine.dispose()

    clock.advance(3_600)
    again = make_store(tmp_path)
    again.work.reap_expired()
    second, render_again = make_worker(again)
    drain(second)
    assert render_again.rendered == [], "a finished seam is never rendered twice"
    assert [row[0] for row in jobs_of(again, request.key)] == ["succeeded"]


def test_a_stale_attempt_cannot_publish_its_seam(tmp_path, clock):
    store = make_store(tmp_path)
    request = seam(1)
    store.submit(request)
    render = FakeRender(store, steps=0)
    store.render_now = render
    worker = SeamWorker(store, idle_s=0.01, heartbeat_s=0.02, waiting_s=0.0, mix_check_s=0.0)
    store.work.register_worker(worker.caps)

    def lose_the_lease() -> None:
        clock.advance(3_600)
        store.work.reap_expired()  # its lease ran out while it rendered
        time.sleep(0.4)  # long enough for its heartbeat to hear so

    render.during[request.key] = lose_the_lease
    result = worker.runner.run_claim(worker.claim())
    assert result.outcome == "superseded"
    assert render.rendered == []
    assert not (store.folder(request.key) / "seam.json").exists(), "nothing was published"


def test_a_request_waits_for_the_seams_heard_before_it_then_goes_first(tmp_path):
    store = make_store(tmp_path)
    worker, render = make_worker(store)
    before = seam(1)
    store.enqueue(before, MIX)
    store.enqueue(seam(50), LATER)
    asked = seam(2)
    store.submit(asked, after=[before.key])
    (state, rank, _), = jobs_of(store, asked.key)
    assert (state, rank) == ("waiting_deps", REQUEST)
    drain(worker)
    assert render.rendered[:2] == [before.key, asked.key]

    dropped = seam(3)
    store.enqueue(seam(4), LATER)
    store.submit(dropped, after=[seam(4).key])
    store.keep_requested(set())
    assert [row[0] for row in jobs_of(store, dropped.key)] == ["cancelled"]
    assert store.status(dropped.key)["status"] == "none"


def test_status_comes_from_the_store_not_from_the_worker_process(tmp_path):
    store = make_store(tmp_path)
    request = seam(1)
    assert store.status(request.key)["status"] == "none"
    store.submit(request)
    store.refresh()
    assert store.status(request.key)["status"] == "queued"
    assert store.status_reader()(request.key)["status"] == "queued"
    (job,) = store.live_jobs._rows("SELECT id FROM jobs")
    store.work.cancel(local_host.LOCAL_WORKSPACE, job[0])
    store.refresh()
    assert store.status(request.key)["status"] == "none"
    assert store.work.job(job[0]).state == JobState.CANCELLED


def test_the_real_seam_worker_process_takes_its_work_from_the_store(tmp_path):
    """No pipe: the worker process is started with nothing on its input, finds the job in the
    store, and publishes a record (a failed one here, as the songs don't exist)."""
    import subprocess

    from selecta.jobs import kill_tree

    store = make_store(tmp_path)
    request = seam(1)
    store.submit(request, urgent=True)
    process = local_host.spawn_worker(tmp_path, "selecta.seam_worker", "--durable")
    try:
        for _ in range(900):
            if store.status(request.key)["status"] == "failed" or process.poll() is not None:
                break
            time.sleep(0.1)
        assert process.poll() is None, "the worker is still running, waiting for more"
        assert store.status(request.key)["status"] == "failed"
        store.refresh()
        assert [row[0] for row in jobs_of(store, request.key)] == ["succeeded"]
    finally:
        kill_tree(process.pid)
        process.wait(timeout=30)
    assert process.returncode is not None and subprocess.DEVNULL
