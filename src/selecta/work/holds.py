"""Staff holds: take a job out of line for inspection (quarantine), and put it back (release).

A hold is not a failure. Terminal states never change, so a hold uses `blocked`, which can move
on again, marked with the error class `staff_hold` so nothing else mistakes it for a job blocked
by its prerequisites:

- An unstarted job (queued, waiting, scheduled to retry, blocked) is held at once. A queued one
  leaves its fair-share head first.
- A running job is asked to give way, as preemption does, with the reason `staff_hold`. When the
  worker releases it, `lifecycle.release` sends it to `blocked` instead of back in line, and the
  attempt doesn't count against it.
- Releasing clears the mark and lets `retrying.unblock` decide where the job goes: queued, or
  waiting on prerequisites that can still succeed. Releasing a running job whose hold hasn't
  landed yet withdraws the request.

Both are idempotent, so a double click doesn't do anything twice. The admin console calls these
through audited commands (`selecta.admin.commands`), never by editing rows.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.work import heads, outbox
from selecta.work.errors import UnknownJob
from selecta.work.model import ACTIVE, TERMINAL, Job, JobState
from selecta.work.schema import job_attempts
from selecta.work.state import lock_job, read_job, set_state, update_fields

S = JobState
STAFF_HOLD = "staff_hold"
STAFF_HOLD_REASON = "staff_hold"
HOLD_DETAIL = "Held by staff for inspection."


class HoldRefused(ValueError):
    """The job can't be held or released in its current state. The message says why."""


def is_held(job: Job) -> bool:
    return job.state == S.BLOCKED and job.error_class == STAFF_HOLD


def hold_pending(connection: Connection, job_id: str) -> bool:
    """Whether a live attempt of this job has been asked to give way for a staff hold."""
    row = connection.execute(
        sa.select(job_attempts.c.id).where(
            job_attempts.c.job_id == job_id,
            job_attempts.c.outcome.is_(None),
            job_attempts.c.cancel_reason == STAFF_HOLD_REASON,
        )
    ).first()
    return row is not None


def hold_for_staff(connection: Connection, job_id: str, now: float) -> Job:
    """Quarantine a job for inspection (see the module notes). Returns the job as it now is."""
    job = lock_job(connection, job_id)
    if job.state in TERMINAL:
        raise HoldRefused(f"The job has already ended ({job.state}); retry it instead.")
    if is_held(job):
        return job
    if job.state == S.CANCEL_REQUESTED:
        raise HoldRefused("The job is already being cancelled.")
    if job.state in ACTIVE:
        live = connection.execute(
            job_attempts.update()
            .where(
                job_attempts.c.job_id == job.id,
                job_attempts.c.outcome.is_(None),
                job_attempts.c.cancel_requested.is_(False),
            )
            .values(cancel_requested=True, cancel_reason=STAFF_HOLD_REASON)
            .returning(job_attempts.c.id, job_attempts.c.pool)
        ).all()
        for attempt in live:
            outbox.emit(
                connection,
                "attempt.preempted",
                job.workspace_id,
                {"attempt_id": attempt.id, "job_id": job.id, "pool": attempt.pool},
                now,
            )
        return job
    marks = {"error_class": STAFF_HOLD, "error_detail": HOLD_DETAIL}
    if job.state == S.BLOCKED:
        return update_fields(connection, job, now, f"job.{S.BLOCKED}", **marks)
    if job.state == S.QUEUED:
        heads.job_unqueued(connection, job.pool, job.lane, job.workspace_id, job.est_cost_s, now)
    return set_state(connection, job, S.BLOCKED, now, payload={"reason": STAFF_HOLD}, **marks)


def release_staff_hold(connection: Connection, job_id: str, now: float) -> Job:
    """Put a quarantined job back where its prerequisites say it belongs."""
    from selecta.work.retrying import unblock  # retrying imports this module's constants

    job = lock_job(connection, job_id)
    if job.state in ACTIVE:
        connection.execute(
            job_attempts.update()
            .where(
                job_attempts.c.job_id == job.id,
                job_attempts.c.outcome.is_(None),
                job_attempts.c.cancel_reason == STAFF_HOLD_REASON,
            )
            .values(cancel_requested=False, cancel_reason=None)
        )
        return job
    if not is_held(job):
        raise HoldRefused("Only a job held by staff can be released.")
    job = update_fields(connection, job, now, error_class=None, error_detail=None)
    unblock(connection, [job.id], now)
    found = read_job(connection, job.id)
    if found is None:
        raise UnknownJob(job.id)
    return found
