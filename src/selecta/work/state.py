"""The one place a job's state changes (§4A.3).

Every change is checked against the lifecycle, guarded on the state the caller read (so a change
made from a stale read fails instead of overwriting), and writes its outbox event in the same
transaction. Fields that aren't the state (lane, progress) change through `update_fields`, under
the same guard.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import replace
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.work import outbox
from selecta.work.errors import ConcurrentChange, UnknownJob
from selecta.work.model import Job, JobState, check_transition
from selecta.work.schema import jobs
from selecta.work.sql import locked


def lock_job(connection: Connection, job_id: str) -> Job:
    """Read a job and hold its row until the transaction ends."""
    row = connection.execute(locked(sa.select(jobs).where(jobs.c.id == job_id))).one_or_none()
    if row is None:
        raise UnknownJob(job_id)
    return Job.from_row(row)


def read_job(connection: Connection, job_id: str) -> Job | None:
    row = connection.execute(sa.select(jobs).where(jobs.c.id == job_id)).one_or_none()
    return None if row is None else Job.from_row(row)


def insert_job(connection: Connection, values: dict[str, Any], now: float) -> Job:
    """Create a job straight into its first real state (`created` is never stored)."""
    check_transition(JobState.CREATED, values["state"])
    connection.execute(jobs.insert().values(**values))
    event = {
        "job_id": values["id"],
        "type": values["type"],
        "from": str(JobState.CREATED),
        "to": str(values["state"]),
    }
    outbox.emit(connection, f"job.{values['state']}", values["workspace_id"], event, now)
    return Job.from_row({column.name: values.get(column.name) for column in jobs.columns})


def set_state(
    connection: Connection,
    job: Job,
    new: JobState,
    now: float,
    *,
    through: Iterable[JobState] = (),
    payload: dict[str, Any] | None = None,
    **values: Any,
) -> Job:
    """Move `job` to `new` (via any `through` states, checked but not stored) and record it.

    Returns the job as it now is.
    """
    current = JobState(job.state)
    for step in (*through, new):
        check_transition(current, step)
        current = JobState(step)
    values = {**values, "state": str(new), "updated_at": now}
    result = connection.execute(
        jobs.update().where(jobs.c.id == job.id, jobs.c.state == job.state).values(**values)
    )
    if result.rowcount != 1:
        raise ConcurrentChange(f"Job {job.id} changed while it was being moved to {new}.")
    event = {"job_id": job.id, "type": job.type, "from": job.state, "to": str(new)}
    if payload:
        event.update(payload)
    outbox.emit(connection, f"job.{new}", job.workspace_id, event, now)
    return _replaced(job, values)


def update_fields(
    connection: Connection, job: Job, now: float, topic: str | None = None, **values: Any
) -> Job:
    """Change fields other than the state, guarded on the state the caller read."""
    values = {**values, "updated_at": now}
    result = connection.execute(
        jobs.update().where(jobs.c.id == job.id, jobs.c.state == job.state).values(**values)
    )
    if result.rowcount != 1:
        raise ConcurrentChange(f"Job {job.id} changed while it was being updated.")
    if topic is not None:
        event = {"job_id": job.id, "type": job.type, **_plain(values)}
        outbox.emit(connection, topic, job.workspace_id, event, now)
    return _replaced(job, values)


def _plain(values: dict) -> dict:
    return {key: value for key, value in values.items() if key not in {"updated_at", "result"}}


def _replaced(job: Job, values: dict) -> Job:
    known = {key: value for key, value in values.items() if hasattr(job, key)}
    return replace(job, **known)
