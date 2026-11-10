"""A person's "Retry" button: run a job that didn't succeed again, and unblock what waited on it.

Terminal states never change, so a retried job is a new job with the same inputs and idempotency
key. Everything that waited on the old one now waits on the new one, and jobs that were blocked
only because of it go back to waiting (§4A.3: blocked "may be retried by user"; §4A.7: dependency
errors resume when the prerequisite is retried successfully).
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from selecta.work import dependents, heads
from selecta.work.enqueue import JobSpec, _live_duplicate, values_for
from selecta.work.errors import UnknownJob
from selecta.work.holds import STAFF_HOLD
from selecta.work.model import TERMINAL, UNSUCCESSFUL, Job, JobState, lookup
from selecta.work.schema import job_dependencies, jobs
from selecta.work.sql import insert_ignore
from selecta.work.state import insert_job, lock_job, read_job, set_state

S = JobState


def _prerequisites(connection: Connection, job_id: str) -> list[tuple[str, str]]:
    rows = connection.execute(
        sa.select(jobs.c.id, jobs.c.state)
        .select_from(job_dependencies.join(jobs, jobs.c.id == job_dependencies.c.depends_on))
        .where(job_dependencies.c.job_id == job_id)
        .order_by(jobs.c.id)
    ).all()
    return [(row.id, row.state) for row in rows]


def _waiting_on(connection: Connection, job_id: str, states=None) -> list[str]:
    query = (
        sa.select(jobs.c.id)
        .select_from(job_dependencies.join(jobs, jobs.c.id == job_dependencies.c.job_id))
        .where(job_dependencies.c.depends_on == job_id)
        .order_by(jobs.c.id)
    )
    if states is None:
        query = query.where(jobs.c.state.notin_([str(state) for state in TERMINAL]))
    else:
        query = query.where(jobs.c.state.in_([str(state) for state in states]))
    return list(connection.execute(query).scalars())


def retry(connection: Connection, workspace_id: str, job_id: str, now: float) -> Job:
    """Retry a failed, cancelled, quarantined or blocked job. Returns the job that will run."""
    job = lock_job(connection, job_id)
    if job.workspace_id != workspace_id:
        raise UnknownJob(job_id)
    if job.state == S.BLOCKED:
        for prerequisite_id, state in _prerequisites(connection, job.id):
            if state in UNSUCCESSFUL or state == S.BLOCKED:
                retry(connection, workspace_id, prerequisite_id, now)
        unblock(connection, [job.id], now)
        return read_job(connection, job.id)
    if job.state not in UNSUCCESSFUL:
        raise ValueError(f"Job {job_id} is {job.state}; only jobs that didn't succeed can retry.")
    return _again(connection, job, now)


def _again(connection: Connection, old: Job, now: float) -> Job:
    spec = JobSpec(
        workspace_id=old.workspace_id,
        type=old.type,
        input_ref=old.input_ref,
        idempotency_key=old.idempotency_key,
        lane=old.base_lane,
        urgency=old.base_urgency,
        needed_by=old.needed_by,
        line_position=old.line_position,
        est_cost_s=old.est_cost_s,
        max_attempts=old.max_attempts,
        max_run_s=old.max_run_s,
        engine_version_required=old.engine_version_required,
        gpu_memory_mb=old.gpu_memory_mb,
        scratch_mb=old.scratch_mb,
        parent_id=old.parent_id,
        created_by=old.created_by,
        entitlement_version=old.entitlement_version,
        flag_id=old.flag_id,
    )
    prerequisites = _prerequisites(connection, old.id)
    workflow = lookup(old.type).workflow
    state = dependents.initial_state([state for _, state in prerequisites], workflow)
    savepoint = connection.begin_nested()
    try:
        new = insert_job(connection, values_for(spec, state, now), now)
        savepoint.commit()
    except IntegrityError:
        savepoint.rollback()
        existing = _live_duplicate(connection, spec)
        if existing is None:
            raise
        return existing
    for prerequisite_id, _ in prerequisites:
        insert_ignore(
            connection,
            job_dependencies,
            {"job_id": new.id, "depends_on": prerequisite_id, "workspace_id": new.workspace_id},
            ("job_id", "depends_on"),
        )
    waiting = _waiting_on(connection, old.id)
    for dependent_id in waiting:
        connection.execute(
            job_dependencies.delete().where(
                job_dependencies.c.job_id == dependent_id, job_dependencies.c.depends_on == old.id
            )
        )
        insert_ignore(
            connection,
            job_dependencies,
            {"job_id": dependent_id, "depends_on": new.id, "workspace_id": new.workspace_id},
            ("job_id", "depends_on"),
        )
    if state == S.QUEUED:
        heads.job_queued(connection, new.pool, new.lane, new.workspace_id, new.est_cost_s, now)
    elif state == S.WAITING_DEPS:
        dependents.promote(connection, new.id, new.lane, new.urgency, now)
    elif state == S.SUCCEEDED:
        dependents.release(connection, new.id, now)
    unblock(connection, waiting, now)
    return read_job(connection, new.id)


def unblock(connection: Connection, job_ids: list[str], now: float) -> None:
    """Blocked jobs whose prerequisites can all still succeed go back to waiting (or queue)."""
    stack = list(job_ids)
    while stack:
        job = lock_job(connection, stack.pop())
        if job.state != S.BLOCKED or job.error_class == STAFF_HOLD:
            continue
        states = [state for _, state in _prerequisites(connection, job.id)]
        workflow = lookup(job.type).workflow
        following = dependents.initial_state(states, workflow)
        if following == S.BLOCKED:
            continue
        cleared = {"error_class": None, "error_detail": None}
        if following == S.QUEUED:
            job = set_state(connection, job, S.QUEUED, now, queued_at=now, **cleared)
            heads.job_queued(connection, job.pool, job.lane, job.workspace_id, job.est_cost_s, now)
        else:
            job = set_state(connection, job, S.WAITING_DEPS, now, **cleared)
            if following == S.SUCCEEDED:
                job = set_state(connection, job, S.SUCCEEDED, now, finished_at=now)
                dependents.release(connection, job.id, now)
            else:
                dependents.promote(connection, job.id, job.lane, job.urgency, now)
        stack.extend(_waiting_on(connection, job.id, (S.BLOCKED,)))
