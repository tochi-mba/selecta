"""One row per Lucy turn's model run, pinned when it starts (§9.2).

A run records the deployment it used (a full copy, not just the id), the routing, prompt and
tool-schema versions, and later its outcome, tokens and cost. Because the copy is taken at the
start, editing the registry or activating a new routing version mid-conversation never changes
a turn that is already running; the next turn picks again.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.ai.registry import Deployment, RequestClass, Tier
from selecta.ai.schema import ai_runs
from selecta.persistence import db_now, new_id


class Outcome(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    INCOMPLETE = "incomplete"  # the provider failed mid-stream; the person sees "try again"
    FAILED = "failed"  # nothing came back
    CANCELLED = "cancelled"  # the person stopped it
    ABANDONED = "abandoned"  # the server running it went away


@dataclass(frozen=True)
class RunRecord:
    id: str
    workspace_id: str
    conversation_id: str | None
    tier: Tier
    request_class: RequestClass
    requested_class: RequestClass
    allowance_class: RequestClass | None
    usage_month: str
    deployment: Deployment
    routing_version: int
    prompt_version: str
    tool_schema_version: str
    fallback_used: bool
    limited: str | None
    lease_id: str | None
    spend_day: str | None
    reserved_usd: float
    started_at: float
    finished_at: float | None
    outcome: Outcome
    error_code: str | None
    tokens_in: int
    tokens_out: int
    cache_read_tokens: int
    cache_write_tokens: int
    cost_usd: float

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> RunRecord:
        allowance = row["allowance_class"]
        return cls(
            id=row["id"],
            workspace_id=row["workspace_id"],
            conversation_id=row["conversation_id"],
            tier=Tier(row["tier"]),
            request_class=RequestClass(row["request_class"]),
            requested_class=RequestClass(row["requested_class"]),
            allowance_class=RequestClass(allowance) if allowance else None,
            usage_month=row["usage_month"],
            deployment=Deployment.from_json(row["deployment"]),
            routing_version=row["routing_version"],
            prompt_version=row["prompt_version"],
            tool_schema_version=row["tool_schema_version"],
            fallback_used=bool(row["fallback_used"]),
            limited=row["limited"],
            lease_id=row["lease_id"],
            spend_day=row["spend_day"],
            reserved_usd=float(row["reserved_usd"]),
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            outcome=Outcome(row["outcome"]),
            error_code=row["error_code"],
            tokens_in=row["tokens_in"],
            tokens_out=row["tokens_out"],
            cache_read_tokens=row["cache_read_tokens"],
            cache_write_tokens=row["cache_write_tokens"],
            cost_usd=float(row["cost_usd"]),
        )


def start_run(
    conn: Connection,
    *,
    workspace_id: str,
    deployment: Deployment,
    routing_version: int,
    prompt_version: str,
    tool_schema_version: str,
    tier: Tier | str,
    request_class: RequestClass | str,
    requested_class: RequestClass | str,
    usage_month: str,
    allowance_class: RequestClass | str | None = None,
    conversation_id: str | None = None,
    fallback_used: bool = False,
    limited: str | None = None,
    lease_id: str | None = None,
    spend_day: str | None = None,
    reserved_usd: float = 0.0,
    run_id: str | None = None,
) -> str:
    """Record a run as started and pin everything it will use. Returns the run id."""
    run_id = run_id or new_id()
    conn.execute(
        sa.insert(ai_runs).values(
            id=run_id,
            workspace_id=workspace_id,
            conversation_id=conversation_id,
            tier=Tier(tier).value,
            request_class=RequestClass(request_class).value,
            requested_class=RequestClass(requested_class).value,
            allowance_class=RequestClass(allowance_class).value if allowance_class else None,
            usage_month=usage_month,
            deployment_id=deployment.id,
            deployment=deployment.to_json(),
            routing_version=routing_version,
            prompt_version=prompt_version,
            tool_schema_version=tool_schema_version,
            fallback_used=fallback_used,
            limited=limited,
            lease_id=lease_id,
            spend_day=spend_day,
            reserved_usd=reserved_usd,
            started_at=db_now(conn),
            outcome=Outcome.RUNNING.value,
            tokens_in=0,
            tokens_out=0,
            cache_read_tokens=0,
            cache_write_tokens=0,
            cost_usd=0.0,
        )
    )
    return run_id


def finish_run(
    conn: Connection,
    run_id: str,
    *,
    outcome: Outcome | str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    cost_usd: float = 0.0,
    error_code: str | None = None,
) -> bool:
    """Close a running run once. False if it was already finished, so nothing counts twice."""
    outcome = Outcome(outcome)
    if outcome is Outcome.RUNNING:
        raise ValueError("A run can't finish as running.")
    # Whether a row changed is read from RETURNING, not `rowcount`, which psycopg can report as
    # -1 (as `ai.schema.insert_ignore` found).
    finished = conn.execute(
        sa.update(ai_runs)
        .where(ai_runs.c.id == run_id, ai_runs.c.outcome == Outcome.RUNNING.value)
        .values(
            outcome=outcome.value,
            finished_at=db_now(conn),
            error_code=error_code,
            tokens_in=max(0, tokens_in),
            tokens_out=max(0, tokens_out),
            cache_read_tokens=max(0, cache_read_tokens),
            cache_write_tokens=max(0, cache_write_tokens),
            cost_usd=max(0.0, cost_usd),
        )
        .returning(ai_runs.c.id)
    ).first()
    return finished is not None


def get_run(conn: Connection, run_id: str) -> RunRecord | None:
    row = conn.execute(sa.select(ai_runs).where(ai_runs.c.id == run_id)).mappings().first()
    return RunRecord.from_row(row) if row else None


def running_before(conn: Connection, started_before: float, limit: int = 100) -> list[RunRecord]:
    """Runs still marked running that started before `started_before`, oldest first."""
    rows = (
        conn.execute(
            sa.select(ai_runs)
            .where(
                ai_runs.c.outcome == Outcome.RUNNING.value, ai_runs.c.started_at < started_before
            )
            .order_by(ai_runs.c.started_at)
            .limit(limit)
        )
        .mappings()
        .all()
    )
    return [RunRecord.from_row(row) for row in rows]


def cache_hit_rates(
    conn: Connection, started_from: float, started_before: float | None = None
) -> dict[str, float]:
    """Each tier's prompt-cache hit rate, the cost KPI from §9.3: cached input tokens over all
    input tokens of the finished runs that started in the window. Tiers with no input are left
    out rather than shown as 0%."""
    window = [ai_runs.c.started_at >= started_from, ai_runs.c.outcome != Outcome.RUNNING.value]
    if started_before is not None:
        window.append(ai_runs.c.started_at < started_before)
    rows = conn.execute(
        sa.select(
            ai_runs.c.tier,
            sa.func.sum(ai_runs.c.cache_read_tokens),
            sa.func.sum(ai_runs.c.tokens_in),
        )
        .where(*window)
        .group_by(ai_runs.c.tier)
    ).all()
    return {tier: float(cached or 0) / float(total) for tier, cached, total in rows if total}


def conversation_runs(conn: Connection, workspace_id: str, conversation_id: str) -> list[RunRecord]:
    rows = (
        conn.execute(
            sa.select(ai_runs)
            .where(
                ai_runs.c.workspace_id == workspace_id, ai_runs.c.conversation_id == conversation_id
            )
            .order_by(ai_runs.c.started_at)
        )
        .mappings()
        .all()
    )
    return [RunRecord.from_row(row) for row in rows]
