"""Bulk work, materialised lazily (ADR-0395 admission control, §4A.4, SC-0395-05).

A request for a lot of the same work (a 20,000-song import, or ten million items from a load
test) is accepted as one `job_plans` row: the job type, a template for each item's input, and how
many items there are. Nothing else is written up front, so accepting it costs the same whether it
holds a hundred items or ten million, and the jobs table, the claim and the API stay small.

The plan then becomes jobs a page at a time (`PolicyConfig.materialise_page`, 500): the first page
when it's submitted, and each later page once the one before has half drained, never past the
type's queued cap (`admission.next_page`). The maintenance loop calls `materialise_due` on its
interval, so the next page appears as the previous drains without anyone asking.

Item `i` of a plan is an ordinary job with `parent_id` = the plan's id, its input the plan's
template plus `{"plan_id", "index"}`, and the idempotency key `plan:{plan_id}:{i}`, so a page
written twice (two maintenance passes racing, or a retry after a crash) still makes one job per
item. A page is written in short transactions of `CHUNK` jobs, each taking the plan's row lock
and checking that nothing else has moved the plan on meanwhile, so no transaction holds the lane
locks for long and claims keep flowing while a plan materialises.

Accepted work is never dropped: a plan stays `open` until every item has been made into a job,
or the workspace cancels it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from selecta.persistence import new_id
from selecta.scheduling import admission
from selecta.scheduling.policy import DEFAULT_URGENCY, Lane, PolicyConfig
from selecta.work import enqueue, outbox
from selecta.work.enqueue import JobSpec
from selecta.work.errors import UnknownJob
from selecta.work.model import TERMINAL, JobState, lookup
from selecta.work.schema import job_plans, jobs
from selecta.work.sql import locked

S = JobState
CHUNK = 100
"""Jobs written per transaction while a page materialises."""
UNSTARTED = [str(state) for state in (S.QUEUED, S.WAITING_DEPS, S.RETRY_SCHEDULED)]
_TERMINAL = [str(state) for state in TERMINAL]


@dataclass(frozen=True)
class PlanSpec:
    workspace_id: str
    type: str
    total: int
    input_ref: dict = field(default_factory=dict)
    idempotency_key: str | None = None
    lane: Lane | str | None = None
    urgency: int | None = None
    created_by: str | None = None


@dataclass(frozen=True)
class Plan:
    id: str
    workspace_id: str
    type: str
    lane: str
    urgency: int
    input_ref: Any
    total: int
    materialised: int
    state: str
    idempotency_key: str | None = None
    created_at: float = 0.0
    finished_at: float | None = None

    @classmethod
    def from_row(cls, row: Any) -> Plan:
        mapping = row._mapping
        return cls(**{name: mapping[name] for name in cls.__dataclass_fields__})

    @property
    def remaining(self) -> int:
        return self.total - self.materialised


def child_key(plan_id: str, index: int) -> str:
    return f"plan:{plan_id}:{index}"


def _open_twin(connection: Connection, spec: PlanSpec) -> Plan | None:
    if spec.idempotency_key is None:
        return None
    row = connection.execute(
        sa.select(job_plans).where(
            job_plans.c.workspace_id == spec.workspace_id,
            job_plans.c.type == spec.type,
            job_plans.c.idempotency_key == spec.idempotency_key,
            job_plans.c.state == "open",
        )
    ).first()
    return None if row is None else Plan.from_row(row)


def submit(connection: Connection, spec: PlanSpec, now: float) -> tuple[Plan, bool]:
    """Accept a plan as one row. Returns it and whether it's new (an open twin is returned)."""
    kind = lookup(spec.type)
    if kind.workflow or kind.pool == "internal":
        raise ValueError(f"{spec.type} isn't work a worker runs, so it can't be planned.")
    if int(spec.total) < 1:
        raise ValueError("A plan needs at least one item.")
    lane = Lane(spec.lane) if spec.lane is not None else kind.lane
    if lane == Lane.SPECULATIVE:
        raise ValueError("Spare-time work is never planned in bulk; it draws on a daily budget.")
    urgency = DEFAULT_URGENCY[lane] if spec.urgency is None else int(spec.urgency)
    twin = _open_twin(connection, spec)
    if twin is not None:
        return twin, False
    values = {
        "id": new_id(),
        "workspace_id": spec.workspace_id,
        "type": spec.type,
        "lane": str(lane),
        "urgency": urgency,
        "input_ref": dict(spec.input_ref or {}),
        "idempotency_key": spec.idempotency_key,
        "total": int(spec.total),
        "materialised": 0,
        "state": "open",
        "created_by": spec.created_by,
        "created_at": now,
        "updated_at": now,
    }
    savepoint = connection.begin_nested()
    try:
        connection.execute(job_plans.insert().values(**values))
        savepoint.commit()
    except IntegrityError:
        savepoint.rollback()
        twin = _open_twin(connection, spec)
        if twin is None:
            raise
        return twin, False
    outbox.emit(connection, "plan.accepted", spec.workspace_id,
                {"plan_id": values["id"], "type": spec.type, "total": int(spec.total)}, now)
    return read(connection, spec.workspace_id, values["id"]), True


def read(connection: Connection, workspace_id: str, plan_id: str) -> Plan:
    row = connection.execute(
        sa.select(job_plans).where(
            job_plans.c.id == plan_id, job_plans.c.workspace_id == workspace_id
        )
    ).one_or_none()
    if row is None:
        raise UnknownJob(f"There's no plan {plan_id} in this workspace.")
    return Plan.from_row(row)


def outstanding(connection: Connection, plan_id: str) -> int:
    """The plan's jobs that are made but not finished (bounded by a page or two)."""
    return connection.execute(
        sa.select(sa.func.count()).where(
            jobs.c.parent_id == plan_id, jobs.c.state.notin_(_TERMINAL)
        )
    ).scalar_one()


def page_size(connection: Connection, config: PolicyConfig, plan: Plan) -> int:
    """How many items to make into jobs now (0 while the last page is still draining)."""
    if plan.state != "open":
        return 0
    queued_of_type = connection.execute(
        sa.select(sa.func.count()).where(
            jobs.c.workspace_id == plan.workspace_id,
            jobs.c.type == plan.type,
            jobs.c.state.in_(UNSTARTED),
        )
    ).scalar_one()
    return admission.next_page(
        config,
        job_type=plan.type,
        outstanding=outstanding(connection, plan.id),
        remaining=plan.remaining,
        queued_of_type=queued_of_type,
    )


def lock(connection: Connection, plan_id: str) -> Plan | None:
    row = connection.execute(locked(sa.select(job_plans).where(job_plans.c.id == plan_id))).first()
    return None if row is None else Plan.from_row(row)


def write_chunk(connection: Connection, plan_id: str, start: int, count: int, now: float) -> int:
    """Make items `start .. start+count-1` into jobs, if the plan is still at `start`.

    Returns how many were made: 0 when the plan is closed or something else moved it on."""
    plan = lock(connection, plan_id)
    if plan is None or plan.state != "open" or plan.materialised != start:
        return 0
    count = max(min(count, plan.remaining), 0)
    for index in range(start, start + count):
        enqueue.enqueue(
            connection,
            JobSpec(
                workspace_id=plan.workspace_id,
                type=plan.type,
                input_ref={**(plan.input_ref or {}), "plan_id": plan.id, "index": index},
                idempotency_key=child_key(plan.id, index),
                lane=plan.lane,
                urgency=plan.urgency,
                parent_id=plan.id,
            ),
            now,
        )
    done = start + count
    values: dict[str, Any] = {"materialised": done, "updated_at": now}
    if done >= plan.total:
        values.update(state="done", finished_at=now)
    connection.execute(job_plans.update().where(job_plans.c.id == plan.id).values(**values))
    outbox.emit(connection, "plan.materialised", plan.workspace_id,
                {"plan_id": plan.id, "materialised": done, "total": plan.total}, now)
    return count


def due(connection: Connection, limit: int) -> list[tuple[str, str]]:
    """(workspace, plan) for the open plans, oldest first."""
    rows = connection.execute(
        sa.select(job_plans.c.workspace_id, job_plans.c.id)
        .where(job_plans.c.state == "open")
        .order_by(job_plans.c.created_at, job_plans.c.id)
        .limit(limit)
    ).all()
    return [(row.workspace_id, row.id) for row in rows]


def cancel(connection: Connection, workspace_id: str, plan_id: str, now: float) -> Plan:
    """Stop making jobs from the plan. Jobs already made are the caller's to cancel."""
    plan = lock(connection, plan_id)
    if plan is None or plan.workspace_id != workspace_id:
        raise UnknownJob(f"There's no plan {plan_id} in this workspace.")
    if plan.state == "open":
        connection.execute(
            job_plans.update().where(job_plans.c.id == plan_id)
            .values(state="cancelled", updated_at=now, finished_at=now)
        )
        outbox.emit(connection, "plan.cancelled", workspace_id, {"plan_id": plan_id}, now)
    return read(connection, workspace_id, plan_id)


def live_children(connection: Connection, plan_id: str) -> list[str]:
    return list(connection.execute(
        sa.select(jobs.c.id).where(jobs.c.parent_id == plan_id, jobs.c.state.notin_(_TERMINAL))
    ).scalars())


__all__ = ["CHUNK", "Plan", "PlanSpec", "cancel", "child_key", "due", "page_size", "read",
           "submit", "write_chunk"]
