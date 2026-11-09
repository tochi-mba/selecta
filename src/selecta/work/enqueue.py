"""Creating jobs: defaults from the catalogue, no duplicate work, dependencies without cycles.

A producer describes the work in a `JobSpec`. Lane and urgency come from the server (the
catalogue, or a rank of today's seam worker via `JobSpec.from_rank`), never from a client. The
same idempotency key for the same workspace and type returns the job that already exists while
it's unfinished, so two tabs, a retried click or a producer racing itself make one job.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from selecta.persistence import new_id
from selecta.scheduling.policy import DEFAULT_URGENCY, Lane, from_rank
from selecta.work import dependents, heads
from selecta.work.errors import DependencyCycle, UnknownJob
from selecta.work.model import TERMINAL, UNSUCCESSFUL, Job, JobState, flag_for, lookup
from selecta.work.schema import job_dependencies, jobs
from selecta.work.sql import insert_ignore
from selecta.work.state import insert_job, lock_job, read_job, set_state

S = JobState
CATALOGUE_FLAG = "<catalogue>"
"""`JobSpec.flag_id` default: take the owning flag from the catalogue."""


@dataclass(frozen=True)
class JobSpec:
    workspace_id: str
    type: str
    input_ref: Any = field(default_factory=dict)
    idempotency_key: str | None = None
    lane: Lane | str | None = None
    urgency: int | None = None
    needed_by: float | None = None
    line_position: int | None = None
    est_cost_s: float | None = None
    max_attempts: int | None = None
    max_run_s: float | None = None
    not_before: float | None = None
    engine_version_required: int | None = None
    gpu_memory_mb: int | None = None
    scratch_mb: int | None = None
    depends_on: tuple[str, ...] = ()
    parent_id: str | None = None
    created_by: str | None = None
    entitlement_version: int | None = None
    flag_id: str | None = CATALOGUE_FLAG

    @classmethod
    def from_rank(cls, workspace_id: str, type: str, rank: int, **values: Any) -> JobSpec:
        """A job ranked the way `seams.py` ranks work today (URGENT ... PREPARING)."""
        lane, urgency = from_rank(rank)
        return cls(workspace_id=workspace_id, type=type, lane=lane, urgency=urgency, **values)


@dataclass(frozen=True)
class Enqueued:
    job: Job
    created: bool
    """False when an unfinished job for the same work already existed and is returned instead."""


def _live_duplicate(connection: Connection, spec: JobSpec) -> Job | None:
    if spec.idempotency_key is None:
        return None
    row = connection.execute(
        sa.select(jobs).where(
            jobs.c.workspace_id == spec.workspace_id,
            jobs.c.type == spec.type,
            jobs.c.idempotency_key == spec.idempotency_key,
            jobs.c.state.notin_([str(state) for state in TERMINAL]),
        )
    ).first()
    return None if row is None else Job.from_row(row)


def _prerequisite_states(connection: Connection, spec: JobSpec) -> list[str]:
    wanted = list(dict.fromkeys(spec.depends_on))
    if not wanted:
        return []
    rows = connection.execute(
        sa.select(jobs.c.id, jobs.c.workspace_id, jobs.c.state).where(jobs.c.id.in_(wanted))
    ).all()
    found = {row.id: row for row in rows}
    for job_id in wanted:
        if job_id not in found or found[job_id].workspace_id != spec.workspace_id:
            raise UnknownJob(f"There's no job {job_id} in this workspace to depend on.")
    return [found[job_id].state for job_id in wanted]


def values_for(spec: JobSpec, state: JobState, now: float) -> dict[str, Any]:
    """The full row for a new job, with the catalogue filling what the spec leaves out."""
    kind = lookup(spec.type)
    lane = Lane(spec.lane) if spec.lane is not None else kind.lane
    urgency = DEFAULT_URGENCY[lane] if spec.urgency is None else int(spec.urgency)
    if not 0 <= urgency <= 5:
        raise ValueError(f"Urgency runs from 0 to 5, not {urgency}.")
    flag_id = flag_for(spec.type, lane) if spec.flag_id == CATALOGUE_FLAG else spec.flag_id
    return {
        "id": new_id(),
        "workspace_id": spec.workspace_id,
        "type": spec.type,
        "pool": kind.pool,
        "lane": str(lane),
        "base_lane": str(lane),
        "urgency": urgency,
        "base_urgency": urgency,
        "needed_by": spec.needed_by,
        "line_position": spec.line_position,
        "input_ref": spec.input_ref,
        "idempotency_key": spec.idempotency_key,
        "est_cost_s": kind.est_cost_s if spec.est_cost_s is None else float(spec.est_cost_s),
        "state": str(state),
        "attempt_count": 0,
        "max_attempts": spec.max_attempts or kind.max_attempts,
        "not_before": spec.not_before,
        "engine_version_required": spec.engine_version_required,
        "min_worker_class": 0,
        "gpu_memory_mb": spec.gpu_memory_mb,
        "scratch_mb": spec.scratch_mb,
        "max_run_s": kind.max_run_s if spec.max_run_s is None else float(spec.max_run_s),
        "entitlement_version": spec.entitlement_version,
        "created_by": spec.created_by,
        "flag_id": flag_id,
        "parent_id": spec.parent_id,
        "lease_generation": 0,
        "progress_done": 0.0,
        "created_at": now,
        "updated_at": now,
        "queued_at": now if state == S.QUEUED else None,
        "finished_at": now if state == S.SUCCEEDED else None,
    }


def enqueue(connection: Connection, spec: JobSpec, now: float) -> Enqueued:
    """Create the job (or find its live twin), its dependency edges and its head counts."""
    existing = _live_duplicate(connection, spec)
    if existing is not None:
        return Enqueued(existing, False)
    kind = lookup(spec.type)
    state = dependents.initial_state(_prerequisite_states(connection, spec), kind.workflow)
    values = values_for(spec, state, now)
    savepoint = connection.begin_nested()
    try:
        job = insert_job(connection, values, now)
        savepoint.commit()
    except IntegrityError:
        # Another transaction made the same job between our check and our insert.
        savepoint.rollback()
        existing = _live_duplicate(connection, spec)
        if existing is None:
            raise
        return Enqueued(existing, False)
    for prerequisite_id in dict.fromkeys(spec.depends_on):
        insert_ignore(
            connection,
            job_dependencies,
            {"job_id": job.id, "depends_on": prerequisite_id, "workspace_id": job.workspace_id},
            ("job_id", "depends_on"),
        )
    if state == S.QUEUED:
        heads.job_queued(connection, job.pool, job.lane, job.workspace_id, job.est_cost_s, now)
    elif state == S.WAITING_DEPS:
        dependents.promote(connection, job.id, job.lane, job.urgency, now)
    return Enqueued(job, True)


def add_dependency(
    connection: Connection, workspace_id: str, job_id: str, prerequisite_id: str, now: float
) -> Job:
    """Make an unstarted job also wait for another job of the same workspace."""
    job = lock_job(connection, job_id)
    prerequisite = read_job(connection, prerequisite_id)
    if job.workspace_id != workspace_id:
        raise UnknownJob(job_id)
    if prerequisite is None or prerequisite.workspace_id != workspace_id:
        raise UnknownJob(prerequisite_id)
    if job.state not in (S.WAITING_DEPS, S.QUEUED, S.BLOCKED):
        raise ValueError(f"Job {job_id} has already started or finished ({job.state}).")
    if dependents.would_cycle(connection, job_id, prerequisite_id):
        raise DependencyCycle(f"Job {prerequisite_id} already waits on job {job_id}.")
    insert_ignore(
        connection,
        job_dependencies,
        {"job_id": job_id, "depends_on": prerequisite_id, "workspace_id": workspace_id},
        ("job_id", "depends_on"),
    )
    if prerequisite.state == S.SUCCEEDED:
        return job
    if job.state == S.QUEUED:
        heads.job_unqueued(connection, job.pool, job.lane, job.workspace_id, job.est_cost_s, now)
    if prerequisite.state in UNSUCCESSFUL or prerequisite.state == S.BLOCKED:
        if job.state != S.BLOCKED:
            detail = f"It needs job {prerequisite_id}, which didn't finish."
            job = set_state(connection, job, S.BLOCKED, now, error_class="dependency",
                            error_detail=detail)
            dependents.block(connection, job.id, now, detail)
        return job
    if job.state == S.QUEUED:
        job = set_state(connection, job, S.WAITING_DEPS, now, queued_at=None)
    dependents.promote(connection, job.id, job.lane, job.urgency, now)
    return job
