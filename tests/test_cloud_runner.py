"""The job runner: handlers, heartbeats, the watchdog, cancellation and exception mapping.

docs/saas/18-test-plan.md §18.7 "Runner" (SC-0396). Threads here wait on events with generous
timeouts; nothing depends on how long a sleep lasts.
"""

from __future__ import annotations

import threading
from collections import Counter
from pathlib import Path

import pytest
from test_cloud_jobs_support import (
    Outputs,
    expire_lease,
    made_provenance,
    make_store,
    output,
    worker,
)

from selecta import jobs as engine_jobs
from selecta.work.enqueue import JobSpec
from selecta.work.errors import StaleLease
from selecta.work.model import AttemptOutcome, ErrorClass, JobState
from selecta.workers.context import (
    PROGRESS_EVERY_S,
    AttemptSignals,
    InputInvalid,
    JobContext,
    JobOutput,
    ResourceExhausted,
    TransientError,
    classify,
    describe,
)
from selecta.workers.giveway import GIVE_WAY
from selecta.workers.runner import WorkerRunner

WAIT = 10.0


def wait_for(condition, timeout: float = WAIT) -> None:
    pause = threading.Event()
    for _ in range(int(timeout / 0.005)):
        if condition():
            return
        pause.wait(0.005)
    raise AssertionError("The condition never came true.")


class Spy:
    """The real store, counting calls and failing the ones a test names (once each)."""

    def __init__(self, store):
        self.store = store
        self.calls: Counter = Counter()
        self.failures: dict[str, BaseException] = {}

    def __getattr__(self, name):
        value = getattr(self.store, name)
        if not callable(value):
            return value

        def call(*args, **kwargs):
            self.calls[name] += 1
            problem = self.failures.pop(name, None)
            if problem is not None:
                raise problem
            return value(*args, **kwargs)

        return call


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def store(cloud_engine):
    return make_store(cloud_engine)


def runner(store, handlers, **values) -> WorkerRunner:
    values.setdefault("heartbeat_s", 0.01)
    values.setdefault("idle_s", 0.01)
    return WorkerRunner(store, worker(), handlers, **values)


def until_stopped(ctx: JobContext) -> None:
    """A long engine step: calls `selecta.jobs.check_in()` until something stops it."""
    for _ in range(int(WAIT / 0.005)):
        engine_jobs.check_in()
        threading.Event().wait(0.005)
    raise AssertionError("The attempt was never stopped.")


# --- Running and completing --------------------------------------------------------------------


def test_a_runner_runs_a_handler_completes_the_job_and_removes_its_scratch_folder(store):
    job = store.enqueue(JobSpec("w1", "analyse.song", input_ref={"song": "s1"})).job
    seen = {}

    def analyse(current, ctx):
        seen["scratch"] = ctx.scratch
        (ctx.scratch / "features.npz").write_bytes(b"x")
        assert current.state == JobState.RUNNING
        return {"bpm": 120, "song": current.input_ref["song"]}

    result = runner(store, {"analyse.song": analyse}).run_once()

    assert (result.job_id, result.state, result.outcome) == (job.id, "succeeded", "succeeded")
    assert store.job(job.id).result == {"bpm": 120, "song": "s1"}
    assert not Path(seen["scratch"]).exists()


def test_the_scratch_folder_is_removed_even_when_the_handler_raises(store, tmp_path):
    store.enqueue(JobSpec("w1", "analyse.song"))
    seen = {}

    def broken(current, ctx):
        seen["scratch"] = ctx.scratch
        (ctx.scratch / "half-written.wav").write_bytes(b"x")
        raise ValueError("engine bug")

    result = runner(store, {"analyse.song": broken}, scratch_root=tmp_path / "scratch").run_once()

    assert result.outcome == "failed"
    assert Path(seen["scratch"]).parent == tmp_path / "scratch"
    assert not Path(seen["scratch"]).exists()


def test_nothing_to_claim_returns_none(store):
    assert runner(store, {}).run_once() is None


def test_a_job_type_with_no_handler_fails_closed_as_an_engine_bug(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    result = runner(store, {}).run_once()
    assert result.outcome == "failed"
    assert store.job(job.id).error_class == ErrorClass.ENGINE_BUG


@pytest.mark.invariants_off("its handler publishes under shared test keys")
def test_outputs_published_by_the_handler_are_recorded_as_artifacts(store):
    store.enqueue(JobSpec("w1", "seam.render"))

    def render(current, ctx):
        ctx.artifacts.publish("seam", "b" * 64, ["w/w1/seam/clip.flac"], checksum="c" * 64,
                              size_bytes=3, provenance=made_provenance("seam"))
        return JobOutput(result={"ok": True}, artifacts=(output("d" * 64),))

    assert runner(store, {"seam.render": render}).run_once().outcome == "succeeded"
    assert store.find_artifact("w1", "seam", "b" * 64) is not None
    assert store.find_artifact("w1", "analysis", "d" * 64) is not None


# --- Exception mapping --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("problem", "error_class", "state"),
    [
        (MemoryError(), ErrorClass.RESOURCE, JobState.FAILED),
        (ResourceExhausted("scratch full"), ErrorClass.RESOURCE, JobState.FAILED),
        (InputInvalid("That file isn't audio."), ErrorClass.INPUT_INVALID, JobState.FAILED),
        (TransientError("R2 said 503"), ErrorClass.TRANSIENT, JobState.RETRY_SCHEDULED),
        (ConnectionError(), ErrorClass.TRANSIENT, JobState.RETRY_SCHEDULED),
        (TimeoutError(), ErrorClass.TRANSIENT, JobState.RETRY_SCHEDULED),
        (KeyError("oops"), ErrorClass.ENGINE_BUG, JobState.RETRY_SCHEDULED),
    ],
    ids=["memory", "resource", "input-invalid", "transient", "connection", "timeout", "bug"],
)
def test_each_exception_maps_to_its_error_class(store, problem, error_class, state):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job

    def handler(current, ctx):
        raise problem

    result = runner(store, {"analyse.song": handler}).run_once()

    final = store.job(job.id)
    assert (final.error_class, final.state) == (error_class, state)
    assert result.outcome == "failed"
    if error_class == ErrorClass.INPUT_INVALID:
        assert final.error_detail == "That file isn't audio."


def test_classify_and_describe_give_a_plain_reason_then_a_short_traceback():
    assert classify(InputInvalid("x")) == ErrorClass.INPUT_INVALID
    assert classify(RuntimeError()) == ErrorClass.ENGINE_BUG
    try:
        raise RuntimeError("deep " * 2_000)
    except RuntimeError as problem:
        text = describe(problem, limit=300)
    assert len(text) == 300
    assert describe(InputInvalid("Corrupt FLAC.")) == "Corrupt FLAC."


# --- Cancellation and preemption ----------------------------------------------------------------


def test_engine_code_calling_check_in_stops_when_the_attempt_is_cancelled(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    started = threading.Event()

    def analyse(current, ctx):
        started.set()
        until_stopped(ctx)

    work = threading.Thread(target=lambda: store.cancel("w1", job.id) if started.wait(WAIT)
                            else None)
    work.start()
    result = runner(store, {"analyse.song": analyse}).run_once()
    work.join()

    assert (result.state, result.outcome) == ("cancelled", "cancelled")
    assert store.job(job.id).state == JobState.CANCELLED
    assert store.job(job.id).result is None


def test_engine_code_calling_check_in_gives_way_to_preemption_and_the_job_requeues(store):
    job = store.enqueue(JobSpec("w1", "discover.sweep")).job
    started = threading.Event()

    def sweep(current, ctx):
        started.set()
        until_stopped(ctx)

    def preempt():
        started.wait(WAIT)
        store.enqueue(JobSpec("w2", "analyse.song", lane="interactive"))
        store.request_preemption("cpu-heavy", slots=1)

    other = threading.Thread(target=preempt)
    other.start()
    result = runner(store, {"discover.sweep": sweep}).run_once()
    other.join()

    assert (result.state, result.outcome, result.detail) == ("queued", "released", "preempt")
    again = store.job(job.id)
    assert again.state == JobState.QUEUED
    assert again.attempt_count == 0, "giving way doesn't use up an attempt"


def test_the_previous_give_way_hook_is_restored_after_the_handler_even_when_it_raises(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    store.enqueue(JobSpec("w1", "analyse.song"))
    calls = []

    def previous() -> bool:
        calls.append(threading.current_thread().name)
        return False

    engine_jobs.give_way_when(previous)
    try:
        during = {}

        def analyse(current, ctx):
            during["hook"] = engine_jobs._should_give_way
            engine_jobs.check_in()
            helper = threading.Thread(target=engine_jobs.check_in, name="helper")
            helper.start()
            helper.join()
            raise ValueError("bug")

        assert runner(store, {"analyse.song": analyse}).run_once().outcome == "failed"
        assert during["hook"] == GIVE_WAY._check
        assert engine_jobs._should_give_way is previous
        assert calls == ["helper"], "other threads keep the hook that was there before"

        assert runner(store, {"analyse.song": lambda job, ctx: 1}).run_once().outcome == (
            "succeeded"
        )
        assert engine_jobs._should_give_way is previous
    finally:
        engine_jobs.give_way_when(engine_jobs._nothing_waiting)


def test_a_handler_that_gives_way_by_itself_goes_back_in_line(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job

    def handler(current, ctx):
        raise engine_jobs.Interrupted

    result = runner(store, {"analyse.song": handler}, heartbeat_s=60.0).run_once()
    assert result.outcome == "released"
    assert store.job(job.id).state == JobState.QUEUED


# --- Heartbeats and the watchdog ----------------------------------------------------------------


def test_heartbeats_happen_while_the_handler_runs(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    spy = Spy(store)

    def analyse(current, ctx):
        wait_for(lambda: spy.calls["heartbeat"] >= 3)
        return {"ok": True}

    assert runner(spy, {"analyse.song": analyse}).run_once().outcome == "succeeded"


def test_a_failed_heartbeat_is_retried_on_the_next_beat(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    spy = Spy(store)
    spy.failures["heartbeat"] = RuntimeError("database blip")

    def analyse(current, ctx):
        wait_for(lambda: spy.calls["heartbeat"] >= 3)

    assert runner(spy, {"analyse.song": analyse}).run_once().outcome == "succeeded"


def test_the_watchdog_stops_a_job_past_its_maximum_run_time_and_stops_heartbeating(store):
    job = store.enqueue(JobSpec("w1", "analyse.song", max_run_s=50.0)).job
    spy, clock = Spy(store), FakeClock()
    counted = {}

    def analyse(current, ctx):
        clock.now = 51.0
        wait_for(ctx.should_stop)
        counted["at_stop"] = spy.calls["heartbeat"]
        threading.Event().wait(0.1)
        counted["later"] = spy.calls["heartbeat"]
        ctx.check_in()

    result = runner(spy, {"analyse.song": analyse}, clock=clock).run_once()

    assert counted["later"] == counted["at_stop"], "a stopped job's lease is left to run out"
    assert result.outcome == "failed"
    assert result.detail == "The worker exceeded the job's runtime limit."
    assert store.job(job.id).error_class == ErrorClass.RESOURCE


def test_the_watchdog_stops_a_job_that_reports_no_progress_for_too_long(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    clock = FakeClock()

    def analyse(current, ctx):
        clock.now = 20.0
        ctx.progress(1, 10)
        clock.now = 40.0
        threading.Event().wait(0.05)
        assert not ctx.should_stop(), "progress 20 s ago is recent enough"
        clock.now = 51.0
        wait_for(ctx.should_stop)
        raise ValueError("the handler noticed late")

    result = runner(store, {"analyse.song": analyse}, clock=clock, no_progress_s=30.0).run_once()

    assert result.detail == "It reported no progress for 30 s."
    assert store.job(job.id).error_class == ErrorClass.RESOURCE
    assert store.job(job.id).progress_done == 1


def test_a_lost_lease_stops_the_handler_and_publishes_nothing(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job

    def analyse(current, ctx):
        expire_lease(store, ctx.attempt_id)
        store.reap_expired()
        wait_for(ctx.should_stop)
        ctx.check_in()

    result = runner(store, {"analyse.song": analyse}).run_once()

    assert (result.outcome, result.detail) == ("superseded", "Its lease ran out.")
    assert store.job(job.id).state == JobState.QUEUED
    assert store.job(job.id).result is None


@pytest.mark.parametrize("raises", [ValueError("late"), engine_jobs.Interrupted()])
def test_a_handler_failing_after_losing_its_lease_reports_superseded(store, raises):
    store.enqueue(JobSpec("w1", "analyse.song"))

    def analyse(current, ctx):
        expire_lease(store, ctx.attempt_id)
        store.reap_expired()
        wait_for(lambda: ctx.signals.lost.is_set())
        raise raises

    assert runner(store, {"analyse.song": analyse}).run_once().outcome == "superseded"


@pytest.mark.parametrize("raises", [ValueError("late"), engine_jobs.Interrupted()])
def test_failing_or_giving_way_on_a_reaped_lease_is_refused_and_reported(store, raises):
    store.enqueue(JobSpec("w1", "analyse.song"))

    def analyse(current, ctx):
        expire_lease(store, ctx.attempt_id)
        store.reap_expired()
        raise raises

    result = runner(store, {"analyse.song": analyse}, heartbeat_s=60.0).run_once()
    assert result.outcome == "superseded"


# --- Publication races --------------------------------------------------------------------------


def test_a_cancel_after_the_handler_finished_keeps_its_results_out(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job

    def analyse(current, ctx):
        store.cancel("w1", current.id)
        return {"bpm": 1}

    result = runner(store, {"analyse.song": analyse}, heartbeat_s=60.0).run_once()
    assert (result.outcome, result.state) == ("cancelled", "cancelled")
    assert store.job(job.id).result is None


def test_refused_outputs_report_the_attempt_as_failed(cloud_engine):
    outputs = Outputs()
    outputs.refused.add("e" * 64)
    store = make_store(cloud_engine, verifier=outputs)
    job = store.enqueue(JobSpec("w1", "seam.render")).job

    def render(current, ctx):
        return JobOutput(result={}, artifacts=(output("e" * 64),))

    result = runner(store, {"seam.render": render}).run_once()
    assert result.outcome == "failed"
    assert store.job(job.id).state == JobState.RETRY_SCHEDULED


def test_completing_on_a_reaped_lease_is_reported_as_superseded(store):
    store.enqueue(JobSpec("w1", "analyse.song"))

    def analyse(current, ctx):
        expire_lease(store, ctx.attempt_id)
        store.reap_expired()
        return {"late": True}

    result = runner(store, {"analyse.song": analyse}, heartbeat_s=60.0).run_once()
    assert result.outcome == "superseded"


def test_an_attempt_that_cannot_start_is_reported_as_superseded(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    claim = store.claim("cpu-heavy", worker())
    expire_lease(store, claim.attempt_id)
    store.reap_expired()

    result = runner(store, {"analyse.song": lambda job, ctx: 1}).run_claim(claim)
    assert result.outcome == str(AttemptOutcome.SUPERSEDED)


# --- Construction and the serve loop ------------------------------------------------------------


def test_a_runner_needs_a_worker_id_and_positive_intervals(store):
    with pytest.raises(ValueError, match="worker_id"):
        WorkerRunner(store, worker(worker_id=None), {})
    with pytest.raises(ValueError, match="positive"):
        WorkerRunner(store, worker(), {}, heartbeat_s=0.0)
    with pytest.raises(ValueError, match="no_progress_s"):
        WorkerRunner(store, worker(), {}, no_progress_s=0.0)
    assert WorkerRunner(store, worker(), {}).heartbeat_s == store.config.heartbeat_s


def test_serve_keeps_polling_after_a_failure_until_it_is_stopped(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    spy = Spy(store)
    spy.failures["claim"] = RuntimeError("database restarting")
    stop = threading.Event()

    def analyse(current, ctx):
        return {"ok": True}

    serving = threading.Thread(target=runner(spy, {"analyse.song": analyse}).serve, args=(stop,))
    serving.start()
    wait_for(lambda: store.job(job.id).state == JobState.SUCCEEDED)
    wait_for(lambda: spy.calls["claim"] >= 3)
    stop.set()
    serving.join(WAIT)
    assert not serving.is_alive()


# --- The handler's context ----------------------------------------------------------------------


def context(report, clock=None) -> JobContext:
    job = None
    values = {} if clock is None else {"clock": clock}
    return JobContext(job, "attempt-1", 1, Path("."), AttemptSignals(), report, **values)


def test_progress_reaches_the_store_at_most_every_five_seconds():
    sent, clock = [], FakeClock()
    ctx = context(lambda done, total: sent.append((done, total)), clock)
    ctx.progress(1, 10)
    clock.now = PROGRESS_EVERY_S - 0.1
    ctx.progress(2, 10)
    clock.now = PROGRESS_EVERY_S
    ctx.progress(3, 10)
    assert sent == [(1, 10), (3, 10)]
    assert ctx.last_progress_at == PROGRESS_EVERY_S


def test_progress_on_a_lost_lease_stops_the_attempt_and_other_errors_are_ignored():
    def lost(done, total):
        raise StaleLease("gone")

    ctx = context(lost)
    ctx.progress(1)
    assert ctx.signals.lost.is_set() and ctx.should_stop()
    with pytest.raises(engine_jobs.Interrupted):
        ctx.check_in()

    def flaky(done, total):
        raise RuntimeError("blip")

    calm = context(flaky)
    calm.progress(1)
    assert not calm.should_stop()


def test_remote_inputs_and_outputs_need_a_remote_worker():
    ctx = context(lambda done, total: None)
    with pytest.raises(RuntimeError, match="downloader"):
        ctx.download_input(0)
    with pytest.raises(RuntimeError, match="publisher"):
        ctx.publish_artifact("seam", "a" * 64, Path("x"), "x.flac")


def test_remote_inputs_and_outputs_go_through_the_functions_the_worker_gives():
    published = output("f" * 64)
    ctx = JobContext(
        None, "attempt-1", 1, Path("."), AttemptSignals(), lambda done, total: None,
        input_downloader=lambda context, selector, destination: Path(f"in-{selector}"),
        artifact_publisher=lambda context, kind, input_hash, source, name, **extra: published,
    )
    assert ctx.download_input(2) == Path("in-2")
    assert ctx.publish_artifact(
        "analysis", "f" * 64, Path("x"), "x.npz", provenance=published.provenance
    ) is published
    assert ctx.artifacts.outputs == [published]


def test_signals_keep_the_first_reason():
    signals = AttemptSignals()
    assert not signals.should_stop()
    signals.stop_for(signals.cancel, "cancel")
    signals.stop_for(signals.lost, "lost")
    assert signals.reason == "cancel" and signals.should_stop()
