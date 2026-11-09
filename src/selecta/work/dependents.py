"""What a job's ending does to the jobs around it (§4A.8 and priority inheritance in §4A.4).

- Success releases dependents whose prerequisites have all succeeded (`waiting_deps` or `blocked`
  to `queued`); a workflow job does no work, so it succeeds as soon as it's released.
- Failure or cancellation blocks everything downstream, with the reason.
- A prerequisite of urgent work runs in that work's lane and urgency, inside the same account,
  until the urgent work is cancelled or finishes; then it returns to its own.

Inheritance is best effort: a prerequisite another transaction holds (because it's being claimed
or finished) is skipped rather than waited for, which also keeps PostgreSQL free of deadlocks.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import lock_rows
from selecta.scheduling import policy
from selecta.work import heads
from selecta.work.model import (
    TERMINAL,
    UNSUCCESSFUL,
    ErrorClass,
    Job,
    JobState,
    lookup,
)
from selecta.work.schema import job_dependencies, jobs
from selecta.work.state import lock_job, set_state, update_fields

S = JobState
_TERMINAL = [str(state) for state in TERMINAL]


def prerequisite_states(connection: Connection, job_id: str) -> list[str]:
    query = (
        sa.select(jobs.c.state)
        .select_from(job_dependencies.join(jobs, jobs.c.id == job_dependencies.c.depends_on))
        .where(job_dependencies.c.job_id == job_id)
    )
    return list(connection.execute(query).scalars())


def _dependents(connection: Connection, job_id: str, states) -> list[str]:
    query = (
        sa.select(jobs.c.id)
        .select_from(job_dependencies.join(jobs, jobs.c.id == job_dependencies.c.job_id))
        .where(job_dependencies.c.depends_on == job_id, jobs.c.state.in_([str(s) for s in states]))
        .order_by(jobs.c.id)
    )
    return list(connection.execute(query).scalars())


def _prerequisites(connection: Connection, job_id: str) -> list[str]:
    query = (
        sa.select(jobs.c.id)
        .select_from(job_dependencies.join(jobs, jobs.c.id == job_dependencies.c.depends_on))
        .where(job_dependencies.c.job_id == job_id, jobs.c.state.notin_(_TERMINAL))
        .order_by(jobs.c.id)
    )
    return list(connection.execute(query).scalars())


def initial_state(prerequisites: list[str], workflow: bool) -> JobState:
    """Where a new job starts, given its prerequisites' states."""
    if any(state in UNSUCCESSFUL or state == S.BLOCKED for state in prerequisites):
        return S.BLOCKED
    if all(state == S.SUCCEEDED for state in prerequisites):
        return S.SUCCEEDED if workflow else S.QUEUED
    return S.WAITING_DEPS


def release(connection: Connection, job_id: str, now: float) -> list[str]:
    """After `job_id` succeeded: queue every dependent that now has all it needs."""
    released, stack = [], [job_id]
    while stack:
        current = stack.pop()
        for dependent_id in _dependents(connection, current, (S.WAITING_DEPS, S.BLOCKED)):
            dependent = lock_job(connection, dependent_id)
            if dependent.state not in (S.WAITING_DEPS, S.BLOCKED):
                continue
            if any(state != S.SUCCEEDED for state in prerequisite_states(connection, dependent.id)):
                continue
            released.append(dependent.id)
            if lookup(dependent.type).workflow:
                set_state(connection, dependent, S.SUCCEEDED, now, finished_at=now)
                stack.append(dependent.id)
                continue
            set_state(
                connection, dependent, S.QUEUED, now, queued_at=now, error_class=None,
                error_detail=None,
            )
            heads.job_queued(
                connection, dependent.pool, dependent.lane, dependent.workspace_id,
                dependent.est_cost_s, now,
            )
    return released


def block(connection: Connection, job_id: str, now: float, detail: str) -> list[str]:
    """After `job_id` failed or was cancelled: block everything that waits on it, transitively."""
    blocked, stack = [], [job_id]
    while stack:
        current = stack.pop()
        for dependent_id in _dependents(connection, current, (S.WAITING_DEPS, S.QUEUED)):
            dependent = lock_job(connection, dependent_id)
            if dependent.state not in (S.WAITING_DEPS, S.QUEUED):
                continue
            if dependent.state == S.QUEUED:
                heads.job_unqueued(
                    connection, dependent.pool, dependent.lane, dependent.workspace_id,
                    dependent.est_cost_s, now,
                )
            set_state(
                connection, dependent, S.BLOCKED, now,
                error_class=str(ErrorClass.DEPENDENCY), error_detail=detail,
            )
            blocked.append(dependent.id)
            stack.append(dependent.id)
    return blocked


def _try_lock(connection: Connection, job_id: str) -> Job | None:
    row = connection.execute(lock_rows(sa.select(jobs).where(jobs.c.id == job_id))).one_or_none()
    return None if row is None else Job.from_row(row)


def move_lane(connection: Connection, job: Job, lane: str, urgency: int, now: float) -> Job:
    """Change a job's lane and urgency, moving it between heads if it's queued."""
    if job.state == S.QUEUED and str(lane) != job.lane:
        heads.job_unqueued(connection, job.pool, job.lane, job.workspace_id, job.est_cost_s, now)
        heads.job_queued(connection, job.pool, str(lane), job.workspace_id, job.est_cost_s, now)
    return update_fields(
        connection, job, now, topic="job.reprioritised", lane=str(lane), urgency=urgency
    )


def promote(connection: Connection, job_id: str, lane: str, urgency: int, now: float) -> None:
    """Lift `job_id`'s unfinished prerequisites, transitively, to at least its lane and urgency."""
    seen, stack = set(), [job_id]
    while stack:
        current = stack.pop()
        for prerequisite_id in _prerequisites(connection, current):
            if prerequisite_id in seen:
                continue
            seen.add(prerequisite_id)
            prerequisite = _try_lock(connection, prerequisite_id)
            if prerequisite is None or prerequisite.state in TERMINAL:
                continue
            new_lane, new_urgency = policy.inherited(
                prerequisite.lane, prerequisite.urgency, [(lane, urgency)]
            )
            if (str(new_lane), new_urgency) != (prerequisite.lane, prerequisite.urgency):
                move_lane(connection, prerequisite, new_lane, new_urgency, now)
            stack.append(prerequisite_id)


def restore(connection: Connection, job_id: str, now: float) -> None:
    """After `job_id` ended: return its prerequisites to whatever their remaining dependents
    (or, with none left, their own lane and urgency) call for."""
    seen, stack = set(), [job_id]
    while stack:
        current = stack.pop()
        for prerequisite_id in _prerequisites(connection, current):
            if prerequisite_id in seen:
                continue
            seen.add(prerequisite_id)
            prerequisite = _try_lock(connection, prerequisite_id)
            if prerequisite is None or prerequisite.state in TERMINAL:
                continue
            demands = connection.execute(
                sa.select(jobs.c.lane, jobs.c.urgency)
                .select_from(job_dependencies.join(jobs, jobs.c.id == job_dependencies.c.job_id))
                .where(
                    job_dependencies.c.depends_on == prerequisite_id,
                    jobs.c.state.notin_(_TERMINAL),
                )
            ).all()
            lane, urgency = policy.inherited(
                prerequisite.base_lane, prerequisite.base_urgency, [tuple(row) for row in demands]
            )
            if (str(lane), urgency) != (prerequisite.lane, prerequisite.urgency):
                move_lane(connection, prerequisite, lane, urgency, now)
                stack.append(prerequisite_id)


def would_cycle(connection: Connection, job_id: str, prerequisite_id: str) -> bool:
    """Would `job_id` depending on `prerequisite_id` close a loop? True if the prerequisite
    already depends, at any distance, on the job."""
    if job_id == prerequisite_id:
        return True
    seen, stack = set(), [prerequisite_id]
    while stack:
        current = stack.pop()
        rows = connection.execute(
            sa.select(job_dependencies.c.depends_on).where(job_dependencies.c.job_id == current)
        ).scalars()
        for upstream in rows:
            if upstream == job_id:
                return True
            if upstream not in seen:
                seen.add(upstream)
                stack.append(upstream)
    return False
