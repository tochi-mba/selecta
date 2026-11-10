"""Failures, retries, quarantine and the jobs that wait on them.

docs/saas/18-test-plan.md §18.7 "Fail and retry" (SC-0394), with §4A.7's error classes.
"""

from __future__ import annotations

import random

import pytest
from test_cloud_jobs_support import drift, expire_lease, make_store, run_to_success, worker

from selecta.scheduling.policy import PolicyConfig
from selecta.work import model, retrying
from selecta.work.enqueue import JobSpec
from selecta.work.errors import UnknownJob
from selecta.work.model import (
    RETRY_RULES,
    ErrorClass,
    IllegalTransition,
    JobState,
    after_failure,
    backoff_s,
    check_transition,
)


@pytest.fixture
def store(cloud_engine):
    return make_store(cloud_engine)


def decide(error_class, **values):
    values.setdefault("failures_of_class", 1)
    values.setdefault("attempt_count", 1)
    values.setdefault("max_attempts", 6)
    values.setdefault("crashed_workers", 0)
    values.setdefault("poison_workers", 3)
    values.setdefault("worker_class", 0)
    values.setdefault("largest_worker_class", 0)
    values.setdefault("rng", random.Random(1))
    return after_failure(error_class, **values)


# --- The policy for each error class ------------------------------------------------------------


def test_transient_errors_retry_with_backoff_until_attempts_run_out():
    first = decide(ErrorClass.TRANSIENT)
    assert first.state == JobState.RETRY_SCHEDULED and 2.5 <= first.delay_s <= 5.0
    assert decide(ErrorClass.TRANSIENT, attempt_count=6).state == JobState.FAILED


@pytest.mark.parametrize("failures", range(1, 12))
def test_backoff_stays_within_its_jittered_bounds(failures):
    rule = RETRY_RULES[ErrorClass.TRANSIENT]
    step = min(600.0, 5.0 * 2 ** (failures - 1))
    for seed in range(50):
        delay = backoff_s(failures, rule, random.Random(seed))
        assert step / 2 <= delay <= step
    assert backoff_s(0, rule, random.Random(0)) <= 5.0


def test_a_resource_error_retries_one_worker_class_up_or_fails_as_too_large():
    bigger = decide(ErrorClass.RESOURCE, worker_class=0, largest_worker_class=2)
    assert (bigger.state, bigger.min_worker_class) == (JobState.RETRY_SCHEDULED, 1)
    assert bigger.delay_s <= 1.0
    too_large = decide(ErrorClass.RESOURCE, worker_class=2, largest_worker_class=2)
    assert too_large.state == JobState.FAILED
    assert too_large.reason == "It's too large for any worker."


def test_invalid_input_fails_at_once_and_a_dependency_error_blocks():
    assert decide(ErrorClass.INPUT_INVALID).state == JobState.FAILED
    assert decide(ErrorClass.DEPENDENCY).state == JobState.BLOCKED


def test_an_engine_bug_retries_once_then_fails():
    assert decide(ErrorClass.ENGINE_BUG, failures_of_class=1).state == JobState.RETRY_SCHEDULED
    second = decide(ErrorClass.ENGINE_BUG, failures_of_class=2, attempt_count=2)
    assert (second.state, second.reason) == (JobState.FAILED, "It hit the same problem twice.")


def test_poison_and_three_crashed_workers_quarantine():
    assert decide(ErrorClass.POISON).state == JobState.QUARANTINED
    assert decide(ErrorClass.WORKER_LOST, crashed_workers=3).state == JobState.QUARANTINED
    assert decide(ErrorClass.WORKER_LOST, crashed_workers=2).state == JobState.QUEUED


def test_only_allowed_transitions_happen_and_terminal_states_never_change():
    check_transition("queued", "leased")
    with pytest.raises(IllegalTransition, match="succeeded to queued"):
        check_transition("succeeded", "queued")
    for terminal in model.TERMINAL:
        assert model.TRANSITIONS[terminal] == frozenset()
        assert model.is_terminal(terminal)
    assert not model.is_terminal("running")


# --- Through the store --------------------------------------------------------------------------


def failed_once(store, error_class, **values):
    job = store.enqueue(JobSpec("w1", "analyse.song", **values)).job
    claim = store.claim("cpu-heavy", worker())
    return job, store.fail(claim.attempt_id, claim.fencing_token, error_class, "detail", 3.0)


@pytest.mark.parametrize(
    ("error_class", "state"),
    [
        (ErrorClass.TRANSIENT, JobState.RETRY_SCHEDULED),
        (ErrorClass.RESOURCE, JobState.FAILED),
        (ErrorClass.INPUT_INVALID, JobState.FAILED),
        (ErrorClass.DEPENDENCY, JobState.BLOCKED),
        (ErrorClass.POISON, JobState.QUARANTINED),
        (ErrorClass.ENGINE_BUG, JobState.RETRY_SCHEDULED),
        (ErrorClass.WORKER_LOST, JobState.QUEUED),
    ],
)
def test_each_error_class_follows_its_policy_through_the_store(store, error_class, state):
    job, after = failed_once(store, error_class)
    assert (after.state, after.error_class, after.error_detail) == (state, error_class, "detail")
    if state == JobState.RETRY_SCHEDULED:
        assert after.not_before > after.updated_at
    if state in model.TERMINAL:
        assert after.finished_at is not None
    assert drift(store) == []


def test_a_resource_failure_moves_the_job_to_a_bigger_worker_class(cloud_engine):
    store = make_store(cloud_engine, PolicyConfig(largest_worker_class={"cpu-heavy": 1}))
    job, after = failed_once(store, ErrorClass.RESOURCE)
    assert (after.state, after.min_worker_class) == (JobState.RETRY_SCHEDULED, 1)


def test_a_due_retry_returns_to_the_queue_and_attempts_running_out_fails_it(sqlite_engine, clock):
    store = make_store(sqlite_engine)
    job, after = failed_once(store, ErrorClass.TRANSIENT, max_attempts=2)
    assert store.promote_due_retries() == 0
    clock.advance(after.not_before - clock.now)
    assert store.promote_due_retries() == 1
    claim = store.claim("cpu-heavy", worker())
    assert claim.fencing_token == 2
    final = store.fail(claim.attempt_id, claim.fencing_token, ErrorClass.TRANSIENT, "again")
    assert (final.state, final.attempt_count) == (JobState.FAILED, 2)


def test_three_different_workers_crashing_on_one_job_quarantine_it(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    for number in (1, 2, 3):
        claim = store.claim("cpu-heavy", worker(worker_id=f"worker-{number}"))
        expire_lease(store, claim.attempt_id)
        store.reap_expired()
    after = store.job(job.id)
    assert (after.state, after.error_class) == (JobState.QUARANTINED, ErrorClass.WORKER_LOST)


def test_one_worker_crashing_three_times_is_not_poison(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    for _ in range(3):
        claim = store.claim("cpu-heavy", worker(worker_id="same"))
        expire_lease(store, claim.attempt_id)
        store.reap_expired()
    assert store.job(job.id).state == JobState.QUEUED


def test_unnamed_workers_count_one_each(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    for _ in range(3):
        claim = store.claim("cpu-heavy", worker(worker_id=None))
        expire_lease(store, claim.attempt_id)
        store.reap_expired()
    assert store.job(job.id).state == JobState.QUARANTINED


def test_a_permanent_failure_blocks_dependents_and_retrying_it_unblocks_them(store):
    analysis = store.enqueue(JobSpec("w1", "analyse.song", idempotency_key="a1")).job
    seam = store.enqueue(JobSpec("w1", "seam.render", depends_on=(analysis.id,))).job
    claim = store.claim("cpu-heavy", worker())
    store.fail(claim.attempt_id, claim.fencing_token, ErrorClass.INPUT_INVALID, "bad file")
    assert store.job(seam.id).state == JobState.BLOCKED

    again = store.retry("w1", analysis.id)
    assert again.id != analysis.id and again.state == JobState.QUEUED
    assert again.idempotency_key == "a1"
    assert store.job(analysis.id).state == JobState.FAILED, "history stays true"
    assert store.job(seam.id).state == JobState.WAITING_DEPS
    run_to_success(store)
    assert store.job(seam.id).state == JobState.QUEUED
    assert drift(store) == []


def test_retrying_a_blocked_job_retries_whatever_blocked_it(store):
    analysis = store.enqueue(JobSpec("w1", "analyse.song")).job
    other = store.enqueue(JobSpec("w1", "analyse.song")).job
    seam = store.enqueue(JobSpec("w1", "seam.render",
                                 depends_on=(analysis.id, other.id))).job
    store.cancel("w1", analysis.id)
    assert store.job(seam.id).state == JobState.BLOCKED
    assert store.retry("w1", seam.id).state == JobState.WAITING_DEPS
    run_to_success(store)
    run_to_success(store)
    assert store.job(seam.id).state == JobState.QUEUED


def test_a_job_blocked_by_two_failures_stays_blocked_until_both_are_retried(store):
    left = store.enqueue(JobSpec("w1", "analyse.song")).job
    right = store.enqueue(JobSpec("w1", "analyse.song")).job
    seam = store.enqueue(JobSpec("w1", "seam.render", depends_on=(left.id, right.id))).job
    store.cancel("w1", left.id)
    store.cancel("w1", right.id)
    store.retry("w1", left.id)
    assert store.job(seam.id).state == JobState.BLOCKED
    store.retry("w1", right.id)
    assert store.job(seam.id).state == JobState.WAITING_DEPS


def test_retry_refuses_jobs_that_are_fine_or_in_another_workspace(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    with pytest.raises(ValueError, match="only jobs that didn't succeed"):
        store.retry("w1", job.id)
    with pytest.raises(UnknownJob):
        store.retry("w2", job.id)


def test_retrying_while_a_live_twin_exists_returns_the_twin(store):
    spec = JobSpec("w1", "analyse.song", idempotency_key="k")
    first = store.enqueue(spec).job
    store.cancel("w1", first.id)
    twin = store.enqueue(spec).job
    assert store.retry("w1", first.id).id == twin.id


def test_a_conflict_that_is_not_a_live_twin_is_raised(store, monkeypatch):
    spec = JobSpec("w1", "analyse.song", idempotency_key="k")
    first = store.enqueue(spec).job
    store.cancel("w1", first.id)
    store.enqueue(spec)
    monkeypatch.setattr(retrying, "_live_duplicate", lambda connection, wanted: None)
    with pytest.raises(Exception, match="(?i)unique|duplicate"):
        store.retry("w1", first.id)


def test_a_retried_job_keeps_its_own_unfinished_prerequisites(store):
    analysis = store.enqueue(JobSpec("w1", "analyse.song")).job
    seam = store.enqueue(JobSpec("w1", "seam.render", depends_on=(analysis.id,))).job
    store.cancel("w1", seam.id)
    again = store.retry("w1", seam.id)
    assert again.state == JobState.WAITING_DEPS
    run_to_success(store)
    assert store.job(again.id).state == JobState.QUEUED


def test_retrying_a_cancelled_workflow_whose_work_is_done_succeeds_at_once(store):
    seam = store.enqueue(JobSpec("w1", "seam.render")).job
    workflow = store.enqueue(JobSpec("w1", "mix.prepare", depends_on=(seam.id,))).job
    export = store.enqueue(JobSpec("w1", "export.render", depends_on=(workflow.id,))).job
    store.cancel("w1", workflow.id)
    assert store.job(export.id).state == JobState.BLOCKED
    run_to_success(store)
    again = store.retry("w1", workflow.id)
    assert again.state == JobState.SUCCEEDED
    assert store.job(export.id).state == JobState.QUEUED
    assert drift(store) == []


def test_retrying_a_blocked_workflow_whose_prerequisite_workflow_was_cancelled(store):
    seam = store.enqueue(JobSpec("w1", "seam.render")).job
    inner = store.enqueue(JobSpec("w1", "mix.prepare", depends_on=(seam.id,))).job
    outer = store.enqueue(JobSpec("w1", "mix.prepare", depends_on=(inner.id,))).job
    store.cancel("w1", inner.id)
    assert store.job(outer.id).state == JobState.BLOCKED
    run_to_success(store)
    assert store.retry("w1", outer.id).state == JobState.SUCCEEDED
    assert store.job(outer.id).finished_at is not None


def test_retrying_a_blocked_workflow_after_its_work_succeeded_by_another_route(store):
    seam = store.enqueue(JobSpec("w1", "seam.render")).job
    other = store.enqueue(JobSpec("w1", "seam.render")).job
    workflow = store.enqueue(JobSpec("w1", "mix.prepare", depends_on=(seam.id,))).job
    store.add_dependency("w1", workflow.id, other.id)
    store.cancel("w1", other.id)
    assert store.job(workflow.id).state == JobState.BLOCKED
    run_to_success(store)
    store.retry("w1", workflow.id)
    run_to_success(store)
    assert store.job(workflow.id).state == JobState.SUCCEEDED


def test_a_job_failed_with_a_dependency_error_queues_again_when_retried(store):
    job, blocked = failed_once(store, ErrorClass.DEPENDENCY)
    assert blocked.state == JobState.BLOCKED
    again = store.retry("w1", job.id)
    assert (again.id, again.state, again.error_class) == (job.id, JobState.QUEUED, None)
    assert drift(store) == []


def test_a_retried_job_whose_prerequisite_still_failed_starts_blocked(store):
    analysis = store.enqueue(JobSpec("w1", "analyse.song")).job
    seam = store.enqueue(JobSpec("w1", "seam.render", depends_on=(analysis.id,))).job
    store.cancel("w1", seam.id)
    store.cancel("w1", analysis.id)
    assert store.retry("w1", seam.id).state == JobState.BLOCKED


@pytest.mark.invariants_off("forces job states with raw SQL, bypassing the heads")
def test_unblocking_a_workflow_whose_work_all_succeeded_finishes_it(store):
    """The contract of `retrying.unblock` for a workflow left blocked with nothing unfinished."""
    import sqlalchemy as sa

    from selecta.persistence import transaction
    from selecta.work.schema import jobs as job_table

    seam = store.enqueue(JobSpec("w1", "seam.render")).job
    workflow = store.enqueue(JobSpec("w1", "mix.prepare", depends_on=(seam.id,))).job
    after = store.enqueue(JobSpec("w1", "export.render", depends_on=(workflow.id,))).job
    run_to_success(store)
    assert store.job(workflow.id).state == JobState.SUCCEEDED
    with transaction(store.engine) as connection:
        connection.execute(
            sa.update(job_table).where(job_table.c.id.in_([workflow.id, after.id])).values(
                state="blocked", finished_at=None
            )
        )
    store.retry("w1", workflow.id)
    assert store.job(workflow.id).state == JobState.SUCCEEDED
    assert store.job(after.id).state == JobState.QUEUED


def test_jobs_and_attempts_say_whether_they_are_finished_or_live(store):
    job, claim = store.enqueue(JobSpec("w1", "analyse.song")).job, None
    claim = store.claim("cpu-heavy", worker())
    assert store.job(job.id).terminal is False
    assert store.attempt(claim.attempt_id).live is True
    store.complete(claim.attempt_id, claim.fencing_token)
    assert store.job(job.id).terminal is True
    assert store.attempt(claim.attempt_id).live is False
