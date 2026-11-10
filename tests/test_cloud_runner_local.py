"""The local app's in-process runner (docs/saas/18-test-plan.md §18.6-18.7, SC-0396).

A one-slot pool runs spare-time work when idle and gives way at the next `check_in()` the moment
other work arrives; shutdown is graceful; several threads never run the same job.
"""

from __future__ import annotations

import threading
from collections import Counter

import pytest
from test_cloud_jobs_support import make_store
from test_cloud_runner import WAIT, Spy, until_stopped, wait_for

from selecta import jobs as engine_jobs
from selecta.persistence import transaction
from selecta.work import fleet
from selecta.work.enqueue import JobSpec
from selecta.work.model import JobState
from selecta.workers.giveway import GIVE_WAY, GiveWay
from selecta.workers.runner import LocalRunner


@pytest.fixture
def store(cloud_engine):
    return make_store(cloud_engine)


def local(store, handlers, **values) -> LocalRunner:
    values.setdefault("heartbeat_s", 60.0)
    values.setdefault("idle_s", 0.02)
    return LocalRunner(store, "cpu-heavy", handlers, **values)


def slots(store) -> int:
    with transaction(store.engine) as connection:
        return fleet.pool_slots(connection, "cpu-heavy", 0.0)


def test_a_one_slot_pool_runs_spare_time_work_when_idle_and_gives_way_when_work_arrives(store):
    order = []
    first_sweep = threading.Event()

    def sweep(job, ctx):
        order.append("sweep")
        if order.count("sweep") == 1:
            first_sweep.set()
            until_stopped(ctx)
        return {"swept": True}

    def analyse(job, ctx):
        order.append("analyse")
        return {"bpm": 120}

    spare = store.enqueue(JobSpec("w1", "discover.sweep")).job
    runner = local(store, {"discover.sweep": sweep, "analyse.song": analyse}, threads=1)
    runner.start()
    try:
        assert first_sweep.wait(WAIT)
        asked = store.enqueue(JobSpec("w2", "analyse.song")).job
        wait_for(lambda: store.job(spare.id).state == JobState.SUCCEEDED)
    finally:
        assert runner.stop(WAIT)
    assert order == ["sweep", "analyse", "sweep"]
    assert store.job(asked.id).state == JobState.SUCCEEDED
    assert store.job(spare.id).attempt_count == 1, "giving way didn't use up an attempt"


def test_graceful_shutdown_finishes_in_flight_work_and_claims_nothing_new(store):
    entered, proceed = threading.Event(), threading.Event()

    def analyse(job, ctx):
        entered.set()
        assert proceed.wait(WAIT)
        return {"done": True}

    first = store.enqueue(JobSpec("w1", "analyse.song")).job
    runner = local(store, {"analyse.song": analyse}, threads=2)
    runner.start()
    assert slots(store) == 2
    assert entered.wait(WAIT)
    finished = []
    stopping = threading.Thread(target=lambda: finished.append(runner.stop(WAIT)))
    stopping.start()
    wait_for(runner._stop.is_set)
    later = store.enqueue(JobSpec("w1", "analyse.song")).job
    proceed.set()
    stopping.join(WAIT)

    assert finished == [True]
    assert store.job(first.id).state == JobState.SUCCEEDED
    assert store.job(later.id).state == JobState.QUEUED
    assert slots(store) == 0, "a stopped runner's workers are retired"


def test_several_threads_never_run_the_same_job(store):
    ran: Counter = Counter()
    lock = threading.Lock()

    def analyse(job, ctx):
        with lock:
            ran[job.id] += 1
        return {"ok": True}

    ids = [store.enqueue(JobSpec(f"w{i % 5}", "analyse.song")).job.id for i in range(40)]
    runner = local(store, {"analyse.song": analyse}, threads=4)
    runner.start()
    try:
        wait_for(lambda: all(store.job(job_id).state == JobState.SUCCEEDED for job_id in ids),
                 timeout=60.0)
    finally:
        assert runner.stop(WAIT)
    assert set(ran) == set(ids)
    assert set(ran.values()) == {1}


def test_a_runner_survives_a_failed_claim_and_a_failed_attempt(store):
    spy = Spy(store)
    spy.failures["claim"] = RuntimeError("database restarting")
    spy.failures["start"] = RuntimeError("connection reset")
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    runner = LocalRunner(spy, "cpu-heavy", {"analyse.song": lambda job, ctx: 1},
                         heartbeat_s=60.0, idle_s=0.02)
    runner.start()
    try:
        wait_for(lambda: spy.calls["start"] >= 1 and spy.calls["claim"] >= 3)
        assert store.job(job.id).state == JobState.LEASED, "its lease will run out and requeue"
    finally:
        assert runner.stop(WAIT)


def test_a_runner_needs_a_thread_and_starts_once(store):
    with pytest.raises(ValueError, match="thread"):
        local(store, {}, threads=0)
    runner = local(store, {}, name="desk")
    assert runner.runners[0].caps.worker_id == "desk-0"
    runner.start()
    try:
        with pytest.raises(RuntimeError, match="already"):
            runner.start()
    finally:
        assert runner.stop(WAIT)


def test_wake_ups_for_other_pools_and_after_stopping_are_ignored(store):
    spy = Spy(store)
    runner = LocalRunner(spy, "cpu-heavy", {}, idle_s=10.0)
    runner.wake("gpu")
    assert spy.calls["request_preemption"] == 0
    runner.wake("cpu-heavy")
    assert spy.calls["request_preemption"] == 1
    LocalRunner(spy, "cpu-heavy", {}, preempt=False).wake("cpu-heavy")
    assert spy.calls["request_preemption"] == 1
    runner._stop.set()
    runner.wake("cpu-heavy")
    assert spy.calls["request_preemption"] == 1


def test_a_failed_preemption_check_is_logged_and_ignored(store):
    spy = Spy(store)
    spy.failures["request_preemption"] = RuntimeError("blip")
    assert LocalRunner(spy, "cpu-heavy", {}).give_way() is None


def test_a_preempted_attempt_held_elsewhere_is_left_to_its_own_heartbeat(store):
    store.enqueue(JobSpec("w1", "discover.sweep"))
    from test_cloud_jobs_support import worker

    claim = store.claim("cpu-heavy", worker(worker_id="remote-1"))
    store.enqueue(JobSpec("w2", "analyse.song", lane="interactive"))
    runner = LocalRunner(store, "cpu-heavy", {})
    assert runner.give_way() == claim.attempt_id
    assert store.heartbeat(claim.attempt_id, claim.fencing_token).cancel_reason == "preempt"


# --- The give-way hook --------------------------------------------------------------------------


def test_the_hook_stays_while_any_thread_runs_a_handler_and_is_restored_after_the_last():
    hooks = GiveWay()
    stops = {"a": threading.Event(), "b": threading.Event()}
    original = engine_jobs._should_give_way
    with hooks.watching(stops["a"].is_set):
        inner_ready, release = threading.Event(), threading.Event()

        def second():
            with hooks.watching(stops["b"].is_set):
                inner_ready.set()
                release.wait(WAIT)

        other = threading.Thread(target=second)
        other.start()
        assert inner_ready.wait(WAIT)
        stops["b"].set()
        assert engine_jobs._should_give_way() is False, "this thread's own attempt decides"
    assert engine_jobs._should_give_way == hooks._check, "the other thread is still running"
    release.set()
    other.join(WAIT)
    assert engine_jobs._should_give_way is original


def test_a_hook_someone_else_installed_meanwhile_is_left_in_place():
    hooks = GiveWay()
    replacement = lambda: False  # noqa: E731
    try:
        with hooks.watching(lambda: False):
            engine_jobs.give_way_when(replacement)
        assert engine_jobs._should_give_way is replacement
    finally:
        engine_jobs.give_way_when(engine_jobs._nothing_waiting)


def test_threads_outside_handlers_fall_back_to_no_waiting_when_there_was_no_hook():
    hooks = GiveWay()
    engine_jobs.give_way_when(engine_jobs._nothing_waiting)
    with hooks.watching(lambda: True):
        hooks._previous = None
        answer = []
        helper = threading.Thread(target=lambda: answer.append(hooks._check()))
        helper.start()
        helper.join(WAIT)
        with pytest.raises(engine_jobs.Interrupted):
            engine_jobs.check_in()
    assert answer == [False]
    assert engine_jobs._should_give_way is engine_jobs._nothing_waiting
    assert GIVE_WAY is not hooks
