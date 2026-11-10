"""Maintenance tasks on the job tables, each idempotent and safe to run twice at once.

- `reap_expired`: attempts whose lease ran out (by database time) or that overran their job type's
  maximum run time. The job's `lease_generation` is bumped so the lost worker is fenced out at
  once, then the job goes back in line, fails, or is quarantined as poison.
- `promote_due_retries`: `retry_scheduled` jobs whose backoff has passed go back in line.
- `head_suspects` / `fix_head`: the minute reconciler, which recomputes `fair_heads` from `jobs`
  and `job_attempts`. It finds suspects from one snapshot, then re-checks each under its row lock,
  so a claim in flight is never mistaken for drift.
- `rebase`: subtract the minimum V from a pool-lane once it passes a threshold, so virtual times
  stay small numbers.

The maintenance leader (`selecta.work.maintenance`) schedules them; each runs in a transaction
the store opens.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import lock_rows
from selecta.scheduling.policy import COMPETING_LANES
from selecta.work import heads
from selecta.work.lifecycle import close_attempt, finish_cancelled, record_failure
from selecta.work.model import ACTIVE, Attempt, AttemptOutcome, ErrorClass, Job, JobState
from selecta.work.schema import fair_heads, job_attempts, jobs, lane_clock
from selecta.work.sql import locked
from selecta.work.state import set_state

if TYPE_CHECKING:
    from selecta.work.store import JobStore

HeadKey = tuple[str, str, str]


def reap_expired(connection: Connection, store: JobStore, now: float, batch: int) -> list[str]:
    """Reap up to `batch` lost or overrunning attempts. Returns their ids."""
    live = job_attempts.c.outcome.is_(None)
    expired = connection.execute(
        lock_rows(
            sa.select(job_attempts)
            .where(live, job_attempts.c.lease_expires_at < now)
            .order_by(job_attempts.c.lease_expires_at)
            .limit(batch)
        )
    ).all()
    overdue = connection.execute(
        lock_rows(
            sa.select(job_attempts)
            .where(live, job_attempts.c.deadline_at < now, job_attempts.c.lease_expires_at >= now)
            .order_by(job_attempts.c.deadline_at)
            .limit(batch)
        )
    ).all()
    reaped = []
    for row in [*expired, *overdue]:
        attempt = Attempt.from_row(row)
        job_row = connection.execute(
            lock_rows(sa.select(jobs).where(jobs.c.id == attempt.job_id))
        ).one_or_none()
        if job_row is None:
            continue  # held by a transaction finishing it right now; the next pass will see
        job = Job.from_row(job_row)
        cost = max(now - attempt.started_at, 0.0)
        if job.lease_generation != attempt.fencing_token or job.state not in ACTIVE:
            close_attempt(connection, attempt, AttemptOutcome.SUPERSEDED, now, cost)
            reaped.append(attempt.id)
            continue
        bump = {"lease_generation": job.lease_generation + 1}
        if job.state == JobState.CANCEL_REQUESTED:
            finish_cancelled(connection, store, job, attempt, cost, now, **bump)
        elif attempt.lease_expires_at >= now:
            detail = f"It ran past its {job.max_run_s:.0f} s limit."
            record_failure(
                connection, store, job, attempt, ErrorClass.RESOURCE, detail, cost, now,
                AttemptOutcome.TIMED_OUT, **bump,
            )
        else:
            detail = "Its worker stopped answering."
            record_failure(
                connection, store, job, attempt, ErrorClass.WORKER_LOST, detail, cost, now,
                AttemptOutcome.LEASE_EXPIRED, **bump,
            )
        reaped.append(attempt.id)
    return reaped


def promote_due_retries(connection: Connection, now: float, batch: int) -> int:
    rows = connection.execute(
        lock_rows(
            sa.select(jobs)
            .where(jobs.c.state == str(JobState.RETRY_SCHEDULED), jobs.c.not_before <= now)
            .order_by(jobs.c.not_before)
            .limit(batch)
        )
    ).all()
    for row in rows:
        job = set_state(connection, Job.from_row(row), JobState.QUEUED, now, queued_at=now)
        heads.job_queued(connection, job.pool, job.lane, job.workspace_id, job.est_cost_s, now)
    return len(rows)


# --- Reconciling the heads ---------------------------------------------------------------------


@dataclass(frozen=True)
class HeadDiff:
    pool: str
    lane: str
    workspace_id: str
    queued_was: int
    queued_now: int
    running_was: int
    running_now: int
    queued_est_was: float
    queued_est_now: float


def _truth(connection: Connection, key: HeadKey | None = None) -> dict[HeadKey, list]:
    queued = sa.select(
        jobs.c.pool,
        jobs.c.lane,
        jobs.c.workspace_id,
        sa.func.count(),
        sa.func.sum(jobs.c.est_cost_s),
    ).where(jobs.c.state == str(JobState.QUEUED))
    running = sa.select(
        job_attempts.c.pool, job_attempts.c.lane, job_attempts.c.workspace_id, sa.func.count()
    ).where(job_attempts.c.outcome.is_(None))
    if key is not None:
        queued = queued.where(
            jobs.c.pool == key[0], jobs.c.lane == key[1], jobs.c.workspace_id == key[2]
        )
        running = running.where(
            job_attempts.c.pool == key[0],
            job_attempts.c.lane == key[1],
            job_attempts.c.workspace_id == key[2],
        )
    queued = queued.group_by(jobs.c.pool, jobs.c.lane, jobs.c.workspace_id)
    running = running.group_by(
        job_attempts.c.pool, job_attempts.c.lane, job_attempts.c.workspace_id
    )
    truth: dict[HeadKey, list] = {}
    for pool, lane, workspace_id, count, est in connection.execute(queued):
        truth[(pool, lane, workspace_id)] = [count, float(est or 0.0), 0]
    for pool, lane, workspace_id, count in connection.execute(running):
        truth.setdefault((pool, lane, workspace_id), [0, 0.0, 0])[2] = count
    return truth


def _differs(head: tuple[int, float, int], truth: tuple[int, float, int]) -> bool:
    return (
        head[0] != truth[0]
        or head[2] != truth[2]
        or abs(head[1] - truth[1]) > 1e-6 * max(1.0, abs(truth[1]))
    )


def head_suspects(connection: Connection) -> list[HeadKey]:
    """Heads whose counts disagree with the jobs in one snapshot."""
    truth = _truth(connection)
    current = {
        (row.pool, row.lane, row.workspace_id): (
            row.queued_count, row.queued_est_s, row.running_count
        )
        for row in connection.execute(sa.select(fair_heads))
    }
    keys = set(truth) | {key for key, counts in current.items() if counts[0] or counts[2]}
    return sorted(
        key
        for key in keys
        if _differs(current.get(key, (0, 0.0, 0)), tuple(truth.get(key, (0, 0.0, 0))))
    )


def fix_head(connection: Connection, key: HeadKey, now: float) -> HeadDiff | None:
    """Re-check one head under its lock and correct it. None when it was right after all."""
    pool, lane, workspace_id = key
    head = heads.ensure_head(connection, pool, lane, workspace_id, now)
    queued, est, running = _truth(connection, key).get(key, [0, 0.0, 0])
    was = (head.queued_count, head.queued_est_s, head.running_count)
    if not _differs(was, (queued, est, running)):
        return None
    waiting_since = head.waiting_since if queued else None
    if queued and waiting_since is None:
        waiting_since = now
    connection.execute(
        fair_heads.update()
        .where(
            fair_heads.c.pool == pool,
            fair_heads.c.lane == lane,
            fair_heads.c.workspace_id == workspace_id,
        )
        .values(
            queued_count=queued,
            queued_est_s=est,
            running_count=running,
            waiting_since=waiting_since,
            updated_at=now,
        )
    )
    return HeadDiff(pool, lane, workspace_id, was[0], queued, was[2], running, was[1], est)


# --- Keeping virtual times small ----------------------------------------------------------------


def rebase(connection: Connection, threshold: float, now: float) -> list[tuple[str, str, float]]:
    """Shift every pool-lane whose smallest busy V passed `threshold`; then the lane clocks.

    Heads that are idle and below the shift land on 0; they're lifted to the floor anyway when
    they next have work. Returns (pool, lane, shift) for what moved.
    """
    shifted = []
    pairs = connection.execute(sa.select(fair_heads.c.pool, fair_heads.c.lane).distinct()).all()
    for pool, lane in pairs:
        where = sa.and_(fair_heads.c.pool == pool, fair_heads.c.lane == lane)
        smallest = connection.execute(
            sa.select(sa.func.min(fair_heads.c.vtime)).where(
                where, sa.or_(fair_heads.c.queued_count > 0, fair_heads.c.running_count > 0)
            )
        ).scalar()
        if smallest is None or smallest <= threshold:
            continue
        connection.execute(
            fair_heads.update()
            .where(where)
            .values(
                vtime=sa.case(
                    (fair_heads.c.vtime > smallest, fair_heads.c.vtime - smallest), else_=0.0
                )
            )
        )
        clock = heads.ensure_clock(connection, pool, lane, now)
        connection.execute(
            lane_clock.update()
            .where(lane_clock.c.pool == pool, lane_clock.c.lane == lane)
            .values(floor_vtime=max(clock.floor_vtime - smallest, 0.0), updated_at=now)
        )
        shifted.append((pool, lane, smallest))
    competing = [str(lane) for lane in COMPETING_LANES]
    pools = connection.execute(sa.select(lane_clock.c.pool).distinct()).scalars().all()
    for pool in pools:
        rows = connection.execute(
            locked(
                sa.select(lane_clock).where(
                    lane_clock.c.pool == pool, lane_clock.c.lane.in_(competing)
                )
            )
        ).all()
        smallest = min((row.vtime for row in rows), default=None)
        if smallest is None or smallest <= threshold:
            continue
        connection.execute(
            lane_clock.update()
            .where(lane_clock.c.pool == pool, lane_clock.c.lane.in_(competing))
            .values(vtime=lane_clock.c.vtime - smallest, updated_at=now)
        )
        shifted.append((pool, "*lanes*", smallest))
    return shifted
