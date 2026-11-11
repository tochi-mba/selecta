"""Heartbeat, progress, complete, release and cancel: every path is fenced.

docs/saas/18-test-plan.md §18.7 "Heartbeat and progress", "Complete", "Cancel" (SC-0394).
"""

from __future__ import annotations

import threading

import pytest
import sqlalchemy as sa
from test_cloud_jobs_support import (
    Outputs,
    drift,
    expire_lease,
    head,
    make_store,
    outbox,
    output,
    run_to_success,
    statements,
    worker,
)

from selecta.persistence import db_now, transaction
from selecta.scheduling.policy import PolicyConfig
from selecta.work import lifecycle
from selecta.work.enqueue import JobSpec
from selecta.work.errors import (
    CompletionRejected,
    JobCancelled,
    ResultRejected,
    ResultTooLarge,
    StaleLease,
    UnknownJob,
)
from selecta.work.model import AttemptOutcome, ErrorClass, JobState
from selecta.work.schema import job_attempts, jobs, outbox_events


@pytest.fixture
def store(cloud_engine):
    return make_store(cloud_engine)


def running(store, job_type: str = "analyse.song", workspace: str = "w1", **values):
    job = store.enqueue(JobSpec(workspace, job_type, **values)).job
    claim = store.claim(job.pool, worker(job.pool))
    store.start(claim.attempt_id, claim.fencing_token)
    return job, claim


# --- Heartbeat and progress ---------------------------------------------------------------------


def test_a_heartbeat_extends_only_the_attempt_row(store):
    job, claim = running(store)
    before = store.job(job.id)
    events = len(outbox(store))
    with statements(store.engine) as seen:
        beat = store.heartbeat(claim.attempt_id, claim.fencing_token)
    writes = [s for s in seen if s.lstrip().upper().startswith(("UPDATE", "INSERT", "DELETE"))]
    assert writes and all("job_attempts" in s for s in writes)
    assert store.job(job.id) == before, "the jobs row isn't touched"
    assert len(outbox(store)) == events
    assert beat.cancel_requested is False
    assert store.attempt(claim.attempt_id).lease_expires_at == beat.lease_expires_at


def test_a_heartbeat_with_a_stale_token_is_refused(store):
    _, claim = running(store)
    with pytest.raises(StaleLease):
        store.heartbeat(claim.attempt_id, claim.fencing_token + 1)


def test_a_heartbeat_returns_cancel_requested_after_a_cancel(store):
    job, claim = running(store)
    store.cancel("w1", job.id)
    beat = store.heartbeat(claim.attempt_id, claim.fencing_token)
    assert (beat.cancel_requested, beat.cancel_reason) == (True, "cancel")


def test_after_a_reap_the_old_attempts_heartbeat_is_refused(store):
    job, claim = running(store)
    expire_lease(store, claim.attempt_id)
    with pytest.raises(StaleLease):
        store.heartbeat(claim.attempt_id, claim.fencing_token)
    store.reap_expired()
    with pytest.raises(StaleLease):
        store.heartbeat(claim.attempt_id, claim.fencing_token)
    assert store.job(job.id).state == JobState.QUEUED


def test_an_unknown_attempt_is_a_stale_lease(store):
    with pytest.raises(StaleLease, match="no attempt"):
        store.heartbeat("0190f2a4-0000-7000-8000-000000000000", 1)


def test_progress_records_real_work_units_on_both_rows(store):
    job, claim = running(store)
    store.progress(claim.attempt_id, claim.fencing_token, 3, 10)
    store.progress(claim.attempt_id, claim.fencing_token, 4)
    now = store.job(job.id)
    assert (now.progress_done, now.progress_total) == (4, 10)
    assert store.attempt(claim.attempt_id).progress_done == 4
    assert [t for t, _ in outbox(store)].count("job.progress") == 2
    with pytest.raises(StaleLease):
        store.progress(claim.attempt_id, claim.fencing_token + 1, 5)


def test_starting_twice_is_harmless_and_a_stale_start_is_refused(store):
    job, claim = running(store)
    assert store.start(claim.attempt_id, claim.fencing_token).state == JobState.RUNNING
    with pytest.raises(StaleLease):
        store.start(claim.attempt_id, 99)


# --- Complete -----------------------------------------------------------------------------------


def test_results_are_applied_by_the_job_types_applier_inside_the_same_transaction(store):
    seen = {}

    def apply(connection, job, result, context):
        attempt = connection.execute(
            sa.select(job_attempts.c.outcome).where(job_attempts.c.id == context.attempt_id)
        ).scalar_one()
        seen["attempt_live"] = attempt is None
        seen["now"] = context.now
        connection.execute(outbox_events.insert().values(
            topic="analysis.saved", workspace_id=job.workspace_id, payload=result,
            created_at=context.now,
        ))

    store.register_applier("analyse.song", apply)
    job, claim = running(store)
    done = store.complete(claim.attempt_id, claim.fencing_token, result={"bpm": 128})
    assert done.state == JobState.SUCCEEDED and done.result == {"bpm": 128}
    assert seen["attempt_live"] is True
    assert ("analysis.saved", {"bpm": 128}) in [tuple(row) for row in outbox(store)]


@pytest.mark.parametrize(
    ("problem", "error_class", "state"),
    [
        (ResultRejected("The analysis is empty."), "input_invalid", JobState.FAILED),
        (ResultRejected("Storage blip.", "transient"), "transient", JobState.RETRY_SCHEDULED),
        (KeyError("bpm"), "engine_bug", JobState.RETRY_SCHEDULED),
    ],
)
def test_an_applier_that_raises_rolls_back_its_writes_and_the_job_stays_unfinished(
    store, problem, error_class, state
):
    def apply(connection, job, result, context):
        connection.execute(outbox_events.insert().values(
            topic="analysis.saved", workspace_id=job.workspace_id, payload={},
            created_at=context.now,
        ))
        connection.execute(jobs.update().where(jobs.c.id == job.id).values(result={"x": 1}))
        raise problem

    store.register_applier("analyse.song", apply)
    job, claim = running(store)
    with pytest.raises(CompletionRejected) as rejected:
        store.complete(claim.attempt_id, claim.fencing_token, result={"bpm": 1},
                       artifacts=[output()])
    assert rejected.value.error_class == error_class
    after = store.job(job.id)
    assert (after.state, after.result, after.error_class) == (state, None, error_class)
    assert "analysis.saved" not in [topic for topic, _ in outbox(store)]
    assert store.find_artifact("w1", "analysis", "a" * 64) is None
    assert drift(store) == []


def test_an_applier_must_be_for_a_known_type(store):
    from selecta.work.model import UnknownJobType

    with pytest.raises(UnknownJobType):
        store.register_applier("nope", lambda *args: None)


@pytest.mark.invariants_off("records artifacts under a shared test key")
def test_artifacts_are_recorded_and_found_by_their_input_hash(store):
    job, claim = running(store)
    store.complete(claim.attempt_id, claim.fencing_token, artifacts=[output("b" * 64)])
    found = store.find_artifact("w1", "analysis", "b" * 64, touch=False)
    assert (found.job_id, found.attempt_id) == (job.id, claim.attempt_id)
    assert store.find_artifact("w2", "analysis", "b" * 64) is None, "no sharing across accounts"
    touched = store.find_artifact("w1", "analysis", "b" * 64)
    assert touched.last_used_at >= found.last_used_at
    second_job, second = running(store)
    store.complete(second.attempt_id, second.fencing_token, artifacts=[output("b" * 64)])
    assert store.find_artifact("w1", "analysis", "b" * 64).attempt_id == second.attempt_id


def test_outputs_that_fail_verification_are_refused_and_the_job_retries(cloud_engine):
    outputs = Outputs()
    outputs.refused.add("f" * 64)
    store = make_store(cloud_engine, verifier=outputs)
    job, claim = running(store)
    with pytest.raises(CompletionRejected, match="checksum"):
        store.complete(claim.attempt_id, claim.fencing_token, artifacts=[output("f" * 64)])
    assert store.job(job.id).state == JobState.RETRY_SCHEDULED


def test_repeating_complete_for_a_succeeded_attempt_returns_the_same_success(store):
    job, claim = running(store)
    first = store.complete(claim.attempt_id, claim.fencing_token, result={"bpm": 120})
    again = store.complete(claim.attempt_id, claim.fencing_token, result={"bpm": 999})
    assert first == again
    assert again.result == {"bpm": 120}
    assert [t for t, _ in outbox(store)].count("job.succeeded") == 1


def test_a_stale_token_cannot_publish(store):
    job, claim = running(store)
    with pytest.raises(StaleLease):
        store.complete(claim.attempt_id, claim.fencing_token + 1, result={"bpm": 1})
    assert store.job(job.id).state == JobState.RUNNING


def test_a_cancelled_job_cannot_publish(store):
    job, claim = running(store)
    store.cancel("w1", job.id)
    with pytest.raises(JobCancelled):
        store.complete(claim.attempt_id, claim.fencing_token, result={"bpm": 1},
                       artifacts=[output()])
    after = store.job(job.id)
    assert (after.state, after.result) == (JobState.CANCELLED, None)
    assert store.find_artifact("w1", "analysis", "a" * 64) is None
    with pytest.raises(StaleLease):
        store.complete(claim.attempt_id, claim.fencing_token, result={"bpm": 1})


def test_a_job_requeued_by_the_reaper_cannot_be_published_by_its_old_attempt(store):
    job, claim = running(store)
    expire_lease(store, claim.attempt_id)
    store.reap_expired()
    newer = store.claim("cpu-heavy", worker(worker_id="worker-2"))
    with pytest.raises(StaleLease):
        store.complete(claim.attempt_id, claim.fencing_token, result={"zombie": True},
                       artifacts=[output()])
    assert store.find_artifact("w1", "analysis", "a" * 64) is None
    store.complete(newer.attempt_id, newer.fencing_token, result={"fresh": True})
    assert store.job(job.id).result == {"fresh": True}


def test_a_payload_over_the_cap_is_refused_before_touching_the_job(cloud_engine):
    store = make_store(cloud_engine, PolicyConfig(max_result_bytes=100))
    job, claim = running(store)
    with pytest.raises(ResultTooLarge):
        store.complete(claim.attempt_id, claim.fencing_token, result={"x": "y" * 200})
    assert store.job(job.id).state == JobState.RUNNING
    store.complete(claim.attempt_id, claim.fencing_token, result={"x": "small"})


def test_completing_corrects_virtual_time_by_what_the_job_really_cost(store):
    job, claim = running(store, est_cost_s=60.0)
    assert head(store, "w1").vtime == 10.0
    store.complete(claim.attempt_id, claim.fencing_token, cost_s=120.0)
    assert head(store, "w1").vtime == 20.0
    assert store.job(job.id).actual_cost_s == 120.0
    assert (head(store, "w1").running_count, head(store, "w1").queued_count) == (0, 0)


def test_cost_defaults_to_database_time_elapsed(sqlite_engine, clock):
    store = make_store(sqlite_engine)
    job, claim = running(store, est_cost_s=60.0)
    clock.advance(30.0)
    store.complete(claim.attempt_id, claim.fencing_token)
    assert store.job(job.id).actual_cost_s == 30.0


def test_completion_fills_progress_to_its_total(store):
    job, claim = running(store)
    store.progress(claim.attempt_id, claim.fencing_token, 3, 8)
    store.complete(claim.attempt_id, claim.fencing_token)
    assert store.job(job.id).progress_done == 8


# --- Release ------------------------------------------------------------------------------------


def test_a_released_attempt_goes_back_in_line_without_using_an_attempt(store):
    job, claim = running(store)
    back = store.release(claim.attempt_id, claim.fencing_token, cost_s=5.0)
    assert (back.state, back.attempt_count) == (JobState.QUEUED, 0)
    assert store.release(claim.attempt_id, claim.fencing_token).state == JobState.QUEUED
    assert store.attempt(claim.attempt_id).outcome == AttemptOutcome.RELEASED
    assert drift(store) == []


def test_releasing_a_job_that_was_asked_to_cancel_cancels_it(store):
    job, claim = running(store)
    store.cancel("w1", job.id)
    assert store.release(claim.attempt_id, claim.fencing_token).state == JobState.CANCELLED
    assert store.release(claim.attempt_id, claim.fencing_token).state == JobState.CANCELLED


# --- Cancel -------------------------------------------------------------------------------------


def test_a_queued_job_is_cancelled_at_once(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    assert store.cancel("w1", job.id).state == JobState.CANCELLED
    assert head(store, "w1").queued_count == 0
    assert store.claim("cpu-heavy", worker()) is None


def test_a_running_job_gets_cancel_requested_and_its_worker_sees_it(store):
    job, claim = running(store)
    assert store.cancel("w1", job.id).state == JobState.CANCEL_REQUESTED
    assert store.cancel("w1", job.id).state == JobState.CANCEL_REQUESTED
    assert store.attempt(claim.attempt_id).cancel_requested is True


def test_a_terminal_job_is_unchanged_by_cancel(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    run_to_success(store)
    assert store.cancel("w1", job.id).state == JobState.SUCCEEDED


def test_cancelling_another_workspaces_job_is_refused(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    with pytest.raises(UnknownJob):
        store.cancel("w2", job.id)


def test_cancelling_a_waiting_job_blocks_what_waits_on_it(store):
    first = store.enqueue(JobSpec("w1", "analyse.song")).job
    seam = store.enqueue(JobSpec("w1", "seam.render", depends_on=(first.id,))).job
    export = store.enqueue(JobSpec("w1", "export.render", depends_on=(seam.id,))).job
    assert store.cancel("w1", seam.id).state == JobState.CANCELLED
    assert store.job(export.id).state == JobState.BLOCKED
    assert "ended as cancelled" in store.job(export.id).error_detail


def test_cancelling_a_workflow_cancels_its_unfinished_children(store):
    seam = store.enqueue(JobSpec("w1", "seam.render")).job
    workflow = store.enqueue(JobSpec("w1", "mix.prepare", depends_on=(seam.id,))).job
    child = store.enqueue(JobSpec("w1", "seam.render", parent_id=workflow.id)).job
    grand = store.enqueue(JobSpec("w1", "lyrics.fetch", parent_id=child.id)).job
    assert store.cancel("w1", workflow.id).state == JobState.CANCELLED
    assert store.job(child.id).state == JobState.CANCELLED
    assert store.job(grand.id).state == JobState.QUEUED, "only a workflow's own children"
    assert store.job(seam.id).state == JobState.QUEUED


def test_cancel_and_complete_racing_on_two_connections_cancel_first(cloud_engine):
    store = make_store(cloud_engine)
    job, claim = running(store)
    holding, release = threading.Event(), threading.Event()

    def cancel_and_hold():
        with transaction(store.engine, "w1") as connection:
            lifecycle.cancel(connection, "w1", job.id, db_now(connection))
            holding.set()
            release.wait(10.0)

    canceller = threading.Thread(target=cancel_and_hold)
    canceller.start()
    assert holding.wait(10.0)
    outcome = {}

    def complete():
        try:
            store.complete(claim.attempt_id, claim.fencing_token, result={"bpm": 1})
            outcome["won"] = True
        except JobCancelled as problem:
            outcome["lost"] = str(problem)

    completer = threading.Thread(target=complete)
    completer.start()
    completer.join(0.3)
    assert completer.is_alive(), "complete waits for the cancel's transaction"
    release.set()
    canceller.join(10.0)
    completer.join(10.0)
    assert "cancelled" in outcome["lost"]
    assert store.job(job.id).state == JobState.CANCELLED


def test_cancel_and_complete_racing_on_two_connections_complete_first(cloud_engine):
    store = make_store(cloud_engine)
    job, claim = running(store)
    holding, release = threading.Event(), threading.Event()

    def complete_and_hold():
        with transaction(store.engine, "w1") as connection:
            lifecycle.complete(connection, store, claim.attempt_id, claim.fencing_token,
                               {"bpm": 1}, (), None, db_now(connection))
            holding.set()
            release.wait(10.0)

    completer = threading.Thread(target=complete_and_hold)
    completer.start()
    assert holding.wait(10.0)
    seen = {}
    canceller = threading.Thread(target=lambda: seen.update(job=store.cancel("w1", job.id)))
    canceller.start()
    canceller.join(0.3)
    assert canceller.is_alive(), "cancel waits for the completing transaction"
    release.set()
    completer.join(10.0)
    canceller.join(10.0)
    assert seen["job"].state == JobState.SUCCEEDED, "the loser sees the job already succeeded"
    assert store.job(job.id).result == {"bpm": 1}


# --- Fencing at the edges -----------------------------------------------------------------------


def test_an_attempt_that_ended_cannot_act_again(store):
    job, claim = running(store)
    store.fail(claim.attempt_id, claim.fencing_token, ErrorClass.INPUT_INVALID, "bad")
    assert store.fail(claim.attempt_id, claim.fencing_token, "input_invalid").state == "failed"
    with pytest.raises(StaleLease, match="already ended"):
        store.release(claim.attempt_id, claim.fencing_token)
    with pytest.raises(StaleLease):
        store.complete(claim.attempt_id, claim.fencing_token)


def test_failing_a_job_that_was_asked_to_cancel_cancels_it(store):
    job, claim = running(store)
    store.cancel("w1", job.id)
    after = store.fail(claim.attempt_id, claim.fencing_token, ErrorClass.TRANSIENT, "blip")
    assert after.state == JobState.CANCELLED


def test_an_attempt_whose_job_moved_on_is_fenced_out(store):
    job, claim = running(store)
    with transaction(store.engine) as connection:
        connection.execute(jobs.update().where(jobs.c.id == job.id).values(lease_generation=7))
    with pytest.raises(StaleLease, match="no longer holds"):
        store.progress(claim.attempt_id, claim.fencing_token, 1)
