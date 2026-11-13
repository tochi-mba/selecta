"""What happens to a job while and after a worker holds it: every path is fenced (§4A.6, §4A.9).

Only the attempt whose fencing token equals the job's `lease_generation` may change the job, and
only while the attempt is live. `complete` publishes results, artifacts and dependents in the same
transaction that marks the job succeeded; repeating it for an attempt that already succeeded
returns the same success, so a worker that lost the response can safely retry.

Cancel and complete race fairly: whichever transaction commits first wins. A cancelled job never
publishes, and a succeeded job is never cancelled afterwards.

Functions here run inside a transaction the store opens. Those that must report a problem after
their changes are committed return the exception for the store to raise once the commit is done.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.work import artifacts, dependents, heads, outbox, provenance
from selecta.work.errors import (
    CompletionRejected,
    JobCancelled,
    ResultRejected,
    StaleLease,
    UnknownJob,
)
from selecta.work.holds import STAFF_HOLD, STAFF_HOLD_REASON
from selecta.work.model import (
    ACTIVE,
    TERMINAL,
    Attempt,
    AttemptOutcome,
    ErrorClass,
    Job,
    JobState,
    after_failure,
    lookup,
)
from selecta.work.ports import ApplyContext, ArtifactOutput
from selecta.work.schema import job_attempts, jobs
from selecta.work.state import lock_job, read_job, set_state, update_fields

if TYPE_CHECKING:
    from selecta.work.store import JobStore

S = JobState
Outcome = AttemptOutcome


@dataclass(frozen=True)
class Heartbeat:
    cancel_requested: bool
    lease_expires_at: float
    cancel_reason: str | None = None


def read_attempt(connection: Connection, attempt_id: str) -> Attempt | None:
    row = connection.execute(
        sa.select(job_attempts).where(job_attempts.c.id == attempt_id)
    ).one_or_none()
    return None if row is None else Attempt.from_row(row)


def _attempt(connection: Connection, attempt_id: str, token: int) -> Attempt:
    attempt = read_attempt(connection, attempt_id)
    if attempt is None or attempt.fencing_token != token:
        raise StaleLease(f"Attempt {attempt_id} doesn't hold that lease.")
    return attempt


def _held(connection: Connection, attempt: Attempt) -> Job:
    """The job, locked, if this live attempt still holds it."""
    if attempt.outcome is not None:
        raise StaleLease(f"Attempt {attempt.id} already ended ({attempt.outcome}).")
    job = lock_job(connection, attempt.job_id)
    if job.lease_generation != attempt.fencing_token or job.state not in ACTIVE:
        raise StaleLease(f"Attempt {attempt.id} no longer holds job {job.id}.")
    return job


def _cost(attempt: Attempt, cost_s: float | None, now: float) -> float:
    """Reference seconds the attempt used: the worker's figure, else database time elapsed."""
    return max(float(cost_s), 0.0) if cost_s is not None else max(now - attempt.started_at, 0.0)


def close_attempt(
    connection: Connection,
    attempt: Attempt,
    outcome: AttemptOutcome,
    now: float,
    cost_s: float,
    error_class: str | None = None,
    detail: str | None = None,
) -> None:
    connection.execute(
        job_attempts.update()
        .where(job_attempts.c.id == attempt.id)
        .values(
            outcome=str(outcome),
            ended_at=now,
            cost_s=cost_s,
            error_class=error_class,
            error_detail=detail,
        )
    )


def free_slot(
    connection: Connection, store: JobStore, attempt: Attempt, cost_s: float, now: float
) -> None:
    """Release the attempt's place in its head and correct V by what it really cost."""
    config = store.config
    # Completion, failure, cancellation and release run inside a write transaction.
    # Cloud entitlements must reuse that connection: opening a second SQLite
    # BEGIN IMMEDIATE here would wait for a lock held by this very transaction.
    standing_in_tx = getattr(store.entitlements, "standing_in_tx", None)
    standing = (
        standing_in_tx(connection, attempt.workspace_id)
        if standing_in_tx is not None
        else store.entitlements.standing(attempt.workspace_id)
    )
    tier = standing.tier
    heads.job_finished(
        connection,
        attempt.pool,
        attempt.lane,
        attempt.workspace_id,
        est_cost_s=attempt.est_cost_s,
        actual_cost_s=cost_s,
        weight=config.weight(tier),
        lane_weight=config.lane_weight(attempt.lane),
        clamp_s=config.correction_clamp_s,
        now=now,
    )


def after_unsuccessful(connection: Connection, job: Job, now: float) -> None:
    """Block what waits on a job that won't succeed, and hand back any lane it lent out."""
    detail = f"It needs {job.type} job {job.id}, which ended as {job.state}."
    dependents.block(connection, job.id, now, detail)
    dependents.restore(connection, job.id, now)


def finish_cancelled(
    connection: Connection,
    store: JobStore,
    job: Job,
    attempt: Attempt,
    cost_s: float,
    now: float,
    **extra: Any,
) -> Job:
    """A worker stopped (or vanished) after its job was asked to cancel."""
    close_attempt(connection, attempt, Outcome.CANCELLED, now, cost_s)
    free_slot(connection, store, attempt, cost_s, now)
    job = set_state(connection, job, S.CANCELLED, now, finished_at=now, **extra)
    after_unsuccessful(connection, job, now)
    return job


def _crashed_workers(connection: Connection, job: Job, attempt: Attempt, lost: bool) -> int:
    rows = connection.execute(
        sa.select(job_attempts.c.id, job_attempts.c.worker_id).where(
            job_attempts.c.job_id == job.id,
            job_attempts.c.outcome == str(Outcome.LEASE_EXPIRED),
            job_attempts.c.id != attempt.id,
        )
    ).all()
    workers = {row.worker_id or row.id for row in rows}
    if lost:
        workers.add(attempt.worker_id or attempt.id)
    return len(workers)


def record_failure(
    connection: Connection,
    store: JobStore,
    job: Job,
    attempt: Attempt,
    error_class: ErrorClass | str,
    detail: str,
    cost_s: float,
    now: float,
    outcome: AttemptOutcome = Outcome.FAILED,
    **extra: Any,
) -> Job:
    """Close a failed attempt and move the job on as its error class says (§4A.7)."""
    error_class = ErrorClass(error_class)
    earlier = connection.execute(
        sa.select(sa.func.count()).where(
            job_attempts.c.job_id == job.id,
            job_attempts.c.error_class == str(error_class),
            job_attempts.c.id != attempt.id,
        )
    ).scalar_one()
    decision = after_failure(
        error_class,
        failures_of_class=earlier + 1,
        attempt_count=job.attempt_count,
        max_attempts=job.max_attempts,
        crashed_workers=_crashed_workers(
            connection, job, attempt, error_class == ErrorClass.WORKER_LOST
        ),
        poison_workers=store.config.poison_workers,
        worker_class=job.min_worker_class,
        largest_worker_class=int(store.config.largest_worker_class.get(job.pool, 0)),
        rng=store.rng,
    )
    close_attempt(connection, attempt, outcome, now, cost_s, str(error_class), detail)
    free_slot(connection, store, attempt, cost_s, now)
    values: dict[str, Any] = {"error_class": str(error_class), "error_detail": detail, **extra}
    if decision.state == S.RETRY_SCHEDULED:
        values["not_before"] = now + decision.delay_s
        if decision.min_worker_class is not None:
            values["min_worker_class"] = decision.min_worker_class
    elif decision.state == S.QUEUED:
        values["queued_at"] = now
    elif decision.state in TERMINAL:
        values["finished_at"] = now
    payload = {"attempt_id": attempt.id, "error_class": str(error_class), "reason": decision.reason}
    job = set_state(connection, job, decision.state, now, payload=payload, **values)
    if decision.state == S.QUEUED:
        heads.job_queued(connection, job.pool, job.lane, job.workspace_id, job.est_cost_s, now)
    elif decision.state in (S.FAILED, S.QUARANTINED, S.BLOCKED):
        after_unsuccessful(connection, job, now)
    if decision.state == S.QUARANTINED:
        from selecta.observability import metrics

        metrics.add("selecta_jobs_quarantined_total")
    return job


# --- What a worker calls ------------------------------------------------------------------------


def start(connection: Connection, attempt_id: str, token: int, now: float) -> Job:
    """The worker began the work: `leased` becomes `running`."""
    job = _held(connection, _attempt(connection, attempt_id, token))
    if job.state == S.LEASED:
        job = set_state(connection, job, S.RUNNING, now, payload={"attempt_id": attempt_id})
    return job


def heartbeat(
    connection: Connection, attempt_id: str, token: int, now: float, lease_s: float
) -> Heartbeat:
    """Extend the lease. Touches only the attempt row; a lease that already ran out stays out."""
    result = connection.execute(
        job_attempts.update()
        .where(
            job_attempts.c.id == attempt_id,
            job_attempts.c.fencing_token == token,
            job_attempts.c.outcome.is_(None),
            job_attempts.c.lease_expires_at >= now,
        )
        .values(heartbeat_at=now, lease_expires_at=now + lease_s)
    )
    if result.rowcount != 1:
        raise StaleLease(f"Attempt {attempt_id} has lost its lease.")
    row = connection.execute(
        sa.select(job_attempts.c.cancel_requested, job_attempts.c.cancel_reason).where(
            job_attempts.c.id == attempt_id
        )
    ).one()
    return Heartbeat(bool(row.cancel_requested), now + lease_s, row.cancel_reason)


def progress(
    connection: Connection,
    attempt_id: str,
    token: int,
    done: float,
    total: float | None,
    now: float,
) -> None:
    """Real work units done, never elapsed time. Also what the no-progress watchdog watches."""
    attempt = _attempt(connection, attempt_id, token)
    job = _held(connection, attempt)
    connection.execute(
        job_attempts.update()
        .where(job_attempts.c.id == attempt_id)
        .values(progress_done=done, progress_at=now)
    )
    values = {"progress_done": done, "progress_at": now}
    if total is not None:
        values["progress_total"] = total
    update_fields(connection, job, now, topic="job.progress", **values)


def complete(
    connection: Connection,
    store: JobStore,
    attempt_id: str,
    token: int,
    result: Any,
    outputs: tuple[ArtifactOutput, ...],
    cost_s: float | None,
    now: float,
) -> tuple[Job, Exception | None]:
    attempt = _attempt(connection, attempt_id, token)
    if attempt.outcome == Outcome.SUCCEEDED:
        return read_job(connection, attempt.job_id), None
    job = _held(connection, attempt)
    cost = _cost(attempt, cost_s, now)
    if job.state == S.CANCEL_REQUESTED:
        job = finish_cancelled(connection, store, job, attempt, cost, now)
        return job, JobCancelled(f"Job {job.id} was cancelled, so its results weren't kept.")
    for output in outputs:
        try:
            provenance.check_output(output)
        except provenance.ProvenanceInvalid as problem:
            job = record_failure(
                connection, store, job, attempt, ErrorClass.ENGINE_BUG, str(problem), cost, now
            )
            return job, CompletionRejected(str(ErrorClass.ENGINE_BUG), str(problem))
    for output in outputs:
        if not store.verifier.verify(job.workspace_id, output):
            detail = f"Its {output.kind} output is missing or doesn't match its checksum."
            job = record_failure(
                connection, store, job, attempt, ErrorClass.TRANSIENT, detail, cost, now
            )
            return job, CompletionRejected(str(ErrorClass.TRANSIENT), detail)
    applier = store.appliers.get(job.type)
    if applier is not None:
        rejected = _apply(connection, applier, job, result, ApplyContext(now, attempt_id, outputs))
        if rejected is not None:
            job = record_failure(connection, store, job, attempt, *rejected, cost, now)
            return job, CompletionRejected(*rejected)
    artifacts.write(connection, job.workspace_id, job.id, attempt_id, outputs, now)
    close_attempt(connection, attempt, Outcome.SUCCEEDED, now, cost)
    free_slot(connection, store, attempt, cost, now)
    job = set_state(
        connection,
        job,
        S.SUCCEEDED,
        now,
        through=(S.VALIDATING,),
        payload={"attempt_id": attempt_id, "cost_s": cost},
        actual_cost_s=cost,
        result=result,
        finished_at=now,
        progress_done=job.progress_total if job.progress_total is not None else job.progress_done,
        error_class=None,
        error_detail=None,
    )
    dependents.release(connection, job.id, now)
    return job, None


def _apply(connection, applier, job, result, context) -> tuple[str, str] | None:
    """Run a result applier in a savepoint; a refusal or a crash rolls back only its writes."""
    savepoint = connection.begin_nested()
    try:
        applier(connection, job, result, context)
    except ResultRejected as problem:
        savepoint.rollback()
        return problem.error_class, problem.detail
    except Exception as problem:  # noqa: BLE001 - a bad applier fails the job, not the gateway
        savepoint.rollback()
        return str(ErrorClass.ENGINE_BUG), f"Applying its results failed: {problem!r}"
    savepoint.commit()
    return None


def fail(
    connection: Connection,
    store: JobStore,
    attempt_id: str,
    token: int,
    error_class: ErrorClass | str,
    detail: str,
    cost_s: float | None,
    now: float,
) -> Job:
    attempt = _attempt(connection, attempt_id, token)
    if attempt.outcome == Outcome.FAILED:
        return read_job(connection, attempt.job_id)
    job = _held(connection, attempt)
    cost = _cost(attempt, cost_s, now)
    if job.state == S.CANCEL_REQUESTED:
        return finish_cancelled(connection, store, job, attempt, cost, now)
    return record_failure(connection, store, job, attempt, error_class, detail, cost, now)


def release(
    connection: Connection,
    store: JobStore,
    attempt_id: str,
    token: int,
    cost_s: float | None,
    now: float,
) -> Job:
    """The worker gave way (preempted, or shutting down). Back in line without using an attempt;
    or, if the job was asked to cancel, cancelled."""
    attempt = _attempt(connection, attempt_id, token)
    if attempt.outcome in (Outcome.RELEASED, Outcome.CANCELLED):
        return read_job(connection, attempt.job_id)
    job = _held(connection, attempt)
    cost = _cost(attempt, cost_s, now)
    if job.state == S.CANCEL_REQUESTED:
        return finish_cancelled(connection, store, job, attempt, cost, now)
    close_attempt(connection, attempt, Outcome.RELEASED, now, cost)
    free_slot(connection, store, attempt, cost, now)
    if attempt.cancel_reason == STAFF_HOLD_REASON:
        # Staff quarantined it while it ran (`hold_for_staff`): it waits, out of line.
        return set_state(
            connection,
            job,
            S.BLOCKED,
            now,
            payload={"attempt_id": attempt_id, "reason": STAFF_HOLD},
            attempt_count=max(job.attempt_count - 1, 0),
            error_class=STAFF_HOLD,
            error_detail="Held by staff for inspection.",
        )
    job = set_state(
        connection,
        job,
        S.QUEUED,
        now,
        payload={"attempt_id": attempt_id, "reason": attempt.cancel_reason or "released"},
        attempt_count=max(job.attempt_count - 1, 0),
        queued_at=now,
    )
    heads.job_queued(connection, job.pool, job.lane, job.workspace_id, job.est_cost_s, now)
    return job


# --- What the API calls -------------------------------------------------------------------------


def cancel(connection: Connection, workspace_id: str, job_id: str, now: float) -> Job:
    """Unstarted work is cancelled at once; running work is asked to stop at its next check-in.
    Cancelling a workflow cancels its unfinished children too."""
    first: Job | None = None
    pending = [job_id]
    while pending:
        job = lock_job(connection, pending.pop())
        if job.workspace_id != workspace_id:
            raise UnknownJob(job.id)
        if job.state in ACTIVE and job.state != S.CANCEL_REQUESTED:
            job = set_state(connection, job, S.CANCEL_REQUESTED, now)
            connection.execute(
                job_attempts.update()
                .where(job_attempts.c.job_id == job.id, job_attempts.c.outcome.is_(None))
                .values(cancel_requested=True, cancel_reason="cancel")
            )
        elif job.state not in TERMINAL and job.state != S.CANCEL_REQUESTED:
            if job.state == S.QUEUED:
                heads.job_unqueued(
                    connection, job.pool, job.lane, job.workspace_id, job.est_cost_s, now
                )
            job = set_state(connection, job, S.CANCELLED, now, finished_at=now)
            after_unsuccessful(connection, job, now)
        first = first or job
        if lookup(job.type).workflow:
            pending.extend(
                connection.execute(
                    sa.select(jobs.c.id).where(
                        jobs.c.parent_id == job.id,
                        jobs.c.state.notin_([str(state) for state in TERMINAL]),
                    )
                ).scalars()
            )
    return first


def request_preemption(connection: Connection, attempt_id: str, now: float) -> bool:
    """Ask one live attempt to give way; its worker sees it on the next heartbeat."""
    result = connection.execute(
        job_attempts.update()
        .where(
            job_attempts.c.id == attempt_id,
            job_attempts.c.outcome.is_(None),
            job_attempts.c.cancel_requested.is_(False),
        )
        .values(cancel_requested=True, cancel_reason="preempt")
    )
    if result.rowcount != 1:
        return False
    attempt = read_attempt(connection, attempt_id)
    outbox.emit(
        connection,
        "attempt.preempted",
        attempt.workspace_id,
        {"attempt_id": attempt_id, "job_id": attempt.job_id, "pool": attempt.pool},
        now,
    )
    return True
