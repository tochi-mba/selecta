"""What happens to queued work when its feature is switched off, and back on (ADR-0414, §11B.4).

Each job type names the flag that owns it, and the flag's `when_off` says what its work does
when the feature goes off:

- `drain` (the default): nothing new starts. A queued job meets the claim path, which moves it to
  `blocked` with the error class `flag_off`, out of its fair-share head, so it no longer holds a
  place in line and isn't skipped over and over. Running work finishes as usual.
- `stop`: the queued job is cancelled instead, and whatever waits on it is blocked, as any
  cancellation would.

Running work of a `stop` flag stops too: every heartbeat of such a job checks the flag
(`JobStore.heartbeat`), and when it's off `stop_running` asks the job to cancel, exactly as a
person's cancel would, with the reason `flag_off`. The heartbeat answers `cancel_requested`, the
worker stops at its next `check_in()`, and its release ends the job `cancelled`. Jobs of `drain`
flags never pay for that check.

A job blocked this way goes back in line by itself: the claim path looks at its pool's
`flag_off` jobs every `JobStore.flag_resume_s` seconds and, for each whose flag is on again,
clears the mark and lets `retrying.unblock` put it where its prerequisites say (queued, or
waiting). Nothing is lost while a feature is off; a staff hold (`holds.py`) is a different mark
and is never released here.
"""

from __future__ import annotations

from collections.abc import Callable

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import flags
from selecta.work import heads
from selecta.work.lifecycle import after_unsuccessful
from selecta.work.model import ACTIVE, Job, JobState
from selecta.work.schema import job_attempts, jobs
from selecta.work.state import lock_job, set_state, update_fields

S = JobState
FLAG_OFF = "flag_off"
DRAIN, STOP = flags.WHEN_OFF
RESUME_BATCH = 100


def when_off(flag_id: str | None) -> str:
    """The flag's `when_off`; a flag the registry doesn't know drains, the safer choice."""
    flag = flags.registry().get(flag_id) if flag_id else None
    return flag.when_off if flag is not None else DRAIN


def park(connection: Connection, job: Job, now: float) -> Job:
    """A queued job whose feature is off: block it (`drain`) or cancel it (`stop`)."""
    heads.job_unqueued(connection, job.pool, job.lane, job.workspace_id, job.est_cost_s, now)
    detail = f"Its feature ({job.flag_id}) was switched off."
    if when_off(job.flag_id) == STOP:
        job = set_state(
            connection, job, S.CANCELLED, now, finished_at=now,
            payload={"reason": FLAG_OFF, "flag": job.flag_id},
            error_class=FLAG_OFF, error_detail=detail,
        )
        after_unsuccessful(connection, job, now)
        return job
    return set_state(
        connection, job, S.BLOCKED, now, payload={"reason": FLAG_OFF, "flag": job.flag_id},
        error_class=FLAG_OFF, error_detail=detail,
    )


def stop_running(connection: Connection, job_id: str, now: float) -> bool:
    """Ask a running job of a switched-off `stop` feature to stop. True when it was asked now."""
    job = lock_job(connection, job_id)
    if job.state not in ACTIVE or job.state == S.CANCEL_REQUESTED:
        return False
    set_state(connection, job, S.CANCEL_REQUESTED, now,
              payload={"reason": FLAG_OFF, "flag": job.flag_id})
    connection.execute(
        job_attempts.update()
        .where(job_attempts.c.job_id == job.id, job_attempts.c.outcome.is_(None))
        .values(cancel_requested=True, cancel_reason=FLAG_OFF)
    )
    return True


def resume(
    connection: Connection, pool: str, flag_on: Callable[[str, str], bool], now: float,
    *, limit: int = RESUME_BATCH,
) -> list[str]:
    """Put back in line this pool's `flag_off` jobs whose flag is on again. Returns their ids."""
    from selecta.work.retrying import unblock  # retrying imports the lifecycle, as we do

    rows = connection.execute(
        sa.select(jobs).where(
            jobs.c.pool == pool, jobs.c.state == str(S.BLOCKED), jobs.c.error_class == FLAG_OFF,
        ).order_by(jobs.c.updated_at, jobs.c.id).limit(limit)
    ).all()
    resumed: list[str] = []
    for row in rows:
        job = Job.from_row(row)
        if job.flag_id is not None and not flag_on(job.workspace_id, job.flag_id):
            continue
        update_fields(connection, job, now, error_class=None, error_detail=None)
        unblock(connection, [job.id], now)
        resumed.append(job.id)
    return resumed


__all__ = ["FLAG_OFF", "park", "resume", "stop_running", "when_off"]
