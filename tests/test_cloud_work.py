"""Durable job lifecycle and scheduler contracts (ADR-0394/0395)."""

from __future__ import annotations

import random

import pytest

from selecta.persistence import make_engine, migrate, transaction
from selecta.scheduling.policy import (
    Candidate,
    EligibilityContext,
    Ineligible,
    Lane,
    PolicyConfig,
    WorkerCaps,
    charge,
    choose_lanes,
    job_blocker,
    speculative_allowed,
)
from selecta.work.enqueue import JobSpec
from selecta.work.errors import JobCancelled, StaleLease
from selecta.work.model import ErrorClass, JobState
from selecta.work.schema import job_attempts
from selecta.work.store import JobStore


@pytest.fixture
def store(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'work.sqlite'}")
    migrate.upgrade(engine)
    result = JobStore(engine, rng=random.Random(7))
    try:
        yield result
    finally:
        engine.dispose()


def worker(pool: str = "cpu-heavy", **kwargs) -> WorkerCaps:
    kwargs.setdefault("worker_id", "worker-1")
    return WorkerCaps(pool=pool, **kwargs)


def test_enqueuing_same_live_idempotency_key_returns_one_job(store):
    spec = JobSpec(
        "workspace-1", "analyse.song", input_ref={"song": "s1"}, idempotency_key="analyse-s1"
    )

    first = store.enqueue(spec)
    second = store.enqueue(spec)

    assert first.created is True
    assert second.created is False
    assert first.job.id == second.job.id


def test_complete_is_idempotent_and_only_the_current_token_can_publish(store):
    enqueued = store.enqueue(JobSpec("workspace-1", "analyse.song"))
    claim = store.claim("cpu-heavy", worker())
    assert claim is not None
    assert claim.job.id == enqueued.job.id
    store.start(claim.attempt_id, claim.fencing_token)

    completed = store.complete(claim.attempt_id, claim.fencing_token, result={"bpm": 120})
    repeated = store.complete(claim.attempt_id, claim.fencing_token, result={"bpm": 120})

    assert completed.state == JobState.SUCCEEDED
    assert repeated.state == JobState.SUCCEEDED
    assert repeated.result == {"bpm": 120}
    with pytest.raises(StaleLease):
        store.complete(claim.attempt_id, claim.fencing_token + 1, result={"bpm": 121})


def test_expired_lease_is_requeued_and_old_worker_is_fenced(store):
    enqueued = store.enqueue(JobSpec("workspace-1", "analyse.song"))
    first = store.claim("cpu-heavy", worker())
    assert first is not None

    with transaction(store.engine) as connection:
        connection.execute(
            job_attempts.update()
            .where(job_attempts.c.id == first.attempt_id)
            .values(lease_expires_at=0.0)
        )

    assert store.reap_expired() == [first.attempt_id]
    assert store.job(enqueued.job.id).state == JobState.QUEUED
    second = store.claim("cpu-heavy", worker(worker_id="worker-2"))
    assert second is not None
    # Reaping invalidates the old generation, and claiming allocates the next one. A gap is
    # harmless; the invariant is monotonic fencing, never token reuse.
    assert second.fencing_token > first.fencing_token
    with pytest.raises(StaleLease):
        store.complete(first.attempt_id, first.fencing_token, result={"stale": True})
    assert store.job(enqueued.job.id).state == JobState.LEASED


def test_cancel_running_job_cannot_publish_results(store):
    enqueued = store.enqueue(JobSpec("workspace-1", "analyse.song"))
    claim = store.claim("cpu-heavy", worker())
    assert claim is not None
    store.start(claim.attempt_id, claim.fencing_token)

    assert store.cancel("workspace-1", enqueued.job.id).state == JobState.CANCEL_REQUESTED
    heartbeat = store.heartbeat(claim.attempt_id, claim.fencing_token)
    assert heartbeat.cancel_requested is True
    with pytest.raises(JobCancelled):
        store.complete(claim.attempt_id, claim.fencing_token, result={"bpm": 120})

    final = store.job(enqueued.job.id)
    assert final.state == JobState.CANCELLED
    assert final.result is None


def test_input_error_fails_without_retry_and_unblocks_nothing(store):
    store.enqueue(JobSpec("workspace-1", "analyse.song"))
    claim = store.claim("cpu-heavy", worker())
    assert claim is not None

    failed = store.fail(claim.attempt_id, claim.fencing_token, ErrorClass.INPUT_INVALID, "bad file")

    assert failed.state == JobState.FAILED
    assert store.claim("cpu-heavy", worker()) is None


def test_idempotency_key_can_be_reused_after_terminal_failure(store):
    spec = JobSpec("workspace-1", "analyse.song", idempotency_key="same-key")
    first = store.enqueue(spec)
    claim = store.claim("cpu-heavy", worker())
    assert claim is not None
    store.fail(claim.attempt_id, claim.fencing_token, ErrorClass.INPUT_INVALID, "bad file")

    replacement = store.enqueue(spec)

    assert replacement.created is True
    assert replacement.job.id != first.job.id


def test_policy_keeps_speculative_work_behind_requested_work():
    lanes = choose_lanes(
        {str(Lane.INTERACTIVE): 3.0, str(Lane.STANDARD): 1.0},
        {Lane.INTERACTIVE, Lane.STANDARD, Lane.SPECULATIVE},
        speculative_ok=True,
    )
    assert lanes == [Lane.STANDARD, Lane.INTERACTIVE, Lane.SPECULATIVE]
    assert speculative_allowed(slots=1, busy=0, config=PolicyConfig()) is True
    assert speculative_allowed(slots=4, busy=3, config=PolicyConfig()) is False
    assert charge(2.0, est_cost_s=30.0, weight=3.0) == 12.0


def test_candidate_eligibility_reasons_are_explicit():
    candidate = Candidate("stems.window", gpu_memory_mb=8_000, scratch_mb=500)
    caps = WorkerCaps(pool="gpu", gpu_memory_mb=4_000, scratch_mb=1_000)
    context = EligibilityContext(now=10, running=0, cap=1)

    assert job_blocker(candidate, caps, context) == Ineligible.GPU
    assert (
        job_blocker(candidate, caps, EligibilityContext(now=10, running=1, cap=1, entitled=False))
        == Ineligible.NOT_ENTITLED
    )
