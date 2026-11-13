"""Lucy's monthly turn allowances (§3.1, ADR-0404 SC-0404-02).

People see turns, never tokens. Each tier has a few allowance buckets, and each request class
counts against one of them:

- Free: 40 everyday turns on Haiku; every kind of request counts there.
- Standard: 400 everyday turns (quick questions count here too) and 40 whole-mix planning turns
  (deep plans route down to planning).
- Premium: 150 everyday turns (planning counts here), 25 deep plans, and quick answers on Haiku
  under fair use: a high ceiling that only stops abuse.

A turn is counted when it starts, in one conditional update that takes the row's lock, so two
turns racing for the last slot can't both get it. Nothing is checked once a turn is running: when
the allowance runs out mid-conversation the current turn finishes and the next one is told why.
Tokens and dollars are added when the turn ends, for cost tracking. Months follow the account's
own time zone, as the plan pages promise.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.ai.registry import RequestClass, Tier
from selecta.ai.schema import ai_usage, insert_ignore
from selecta.persistence import db_now, new_id

Q, E, P, D = (RequestClass(name) for name in ("quick", "everyday", "planning", "deep_plan"))

FAIR_USE_QUICK = 1_000

ALLOWANCES: dict[Tier, dict[RequestClass, int]] = {
    Tier.FREE: {E: 40},
    Tier.STANDARD: {E: 400, P: 40},
    Tier.PREMIUM: {E: 150, D: 25, Q: FAIR_USE_QUICK},
}
FAIR_USE: dict[Tier, frozenset[RequestClass]] = {Tier.PREMIUM: frozenset({Q})}

BUCKETS: dict[Tier, dict[RequestClass, RequestClass]] = {
    Tier.FREE: {Q: E, E: E, P: E, D: E},
    Tier.STANDARD: {Q: E, E: E, P: P, D: P},
    Tier.PREMIUM: {Q: Q, E: E, P: E, D: D},
}

# When a class's allowance is used up, the turn may still run as the next smaller class.
STEP_DOWN: dict[RequestClass, RequestClass | None] = {D: P, P: E, E: Q, Q: None}


def bucket_for(tier: Tier | str, request_class: RequestClass | str) -> RequestClass:
    return BUCKETS[Tier(tier)][RequestClass(request_class)]


def classes_from(request_class: RequestClass | str) -> list[RequestClass]:
    """The class asked for, then each smaller one."""
    chain: list[RequestClass] = []
    step: RequestClass | None = RequestClass(request_class)
    while step is not None:
        chain.append(step)
        step = STEP_DOWN[step]
    return chain


def _zone(timezone: str | None) -> dt.tzinfo:
    try:
        return ZoneInfo(timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return dt.UTC


def month_key(epoch: float, timezone: str | None = "UTC") -> str:
    """ "2026-11": the calendar month at `epoch` in the account's time zone."""
    return dt.datetime.fromtimestamp(epoch, _zone(timezone)).strftime("%Y-%m")


def month_resets_at(month: str, timezone: str | None = "UTC") -> float:
    """Epoch seconds of local midnight on the first day of the month after `month`."""
    year, number = (int(part) for part in month.split("-"))
    year, number = (year + 1, 1) if number == 12 else (year, number + 1)
    return dt.datetime(year, number, 1, tzinfo=_zone(timezone)).timestamp()


@dataclass(frozen=True)
class TurnStart:
    admitted: bool
    bucket: RequestClass
    month: str
    used: int
    limit: int


@dataclass(frozen=True)
class BucketState:
    bucket: RequestClass
    limit: int
    used: int
    remaining: int
    fair_use: bool
    resets_at: float


def _where(workspace_id: str, month: str, bucket: RequestClass):
    return sa.and_(
        ai_usage.c.workspace_id == workspace_id,
        ai_usage.c.month == month,
        ai_usage.c.request_class == bucket.value,
    )


def _ensure_row(conn: Connection, workspace_id: str, month: str, bucket: RequestClass) -> None:
    insert_ignore(
        conn,
        ai_usage,
        {
            "id": new_id(),
            "workspace_id": workspace_id,
            "month": month,
            "request_class": bucket.value,
            "turns": 0,
            "tokens_in": 0,
            "tokens_out": 0,
            "cache_read_tokens": 0,
            "cost_usd": 0.0,
            "updated_at": db_now(conn),
        },
        ["workspace_id", "month", "request_class"],
    )


def _turns(conn: Connection, workspace_id: str, month: str, bucket: RequestClass) -> int:
    used = conn.execute(
        sa.select(ai_usage.c.turns).where(_where(workspace_id, month, bucket))
    ).scalar()
    return int(used or 0)


def try_start_turn(
    conn: Connection,
    workspace_id: str,
    tier: Tier | str,
    request_class: RequestClass | str,
    month: str,
) -> TurnStart:
    """Count one turn against the class's bucket if there is room. Call inside a transaction.

    The update's own row lock is the "row lock" here: `lock_rows` skips locked rows, which for
    a counter would refuse a turn just because another turn was being counted at that moment.
    """
    tier = Tier(tier)
    bucket = bucket_for(tier, request_class)
    limit = ALLOWANCES[tier].get(bucket, 0)
    if limit <= 0:
        return TurnStart(False, bucket, month, 0, 0)
    _ensure_row(conn, workspace_id, month, bucket)
    # Whether a row changed is read from RETURNING, not `rowcount`, which psycopg can report as
    # -1 (as `ai.schema.insert_ignore` found).
    admitted = (
        conn.execute(
            sa.update(ai_usage)
            .where(_where(workspace_id, month, bucket), ai_usage.c.turns < limit)
            .values(turns=ai_usage.c.turns + 1, updated_at=db_now(conn))
            .returning(ai_usage.c.turns)
        ).first()
        is not None
    )
    used = _turns(conn, workspace_id, month, bucket)
    return TurnStart(admitted, bucket, month, used, limit)


def refund_turn(
    conn: Connection, workspace_id: str, month: str, bucket: RequestClass | str
) -> bool:
    """Give back a turn that never reached the person (refused later, or the provider failed)."""
    bucket = RequestClass(bucket)
    return (
        conn.execute(
            sa.update(ai_usage)
            .where(_where(workspace_id, month, bucket), ai_usage.c.turns > 0)
            .values(turns=ai_usage.c.turns - 1, updated_at=db_now(conn))
            .returning(ai_usage.c.turns)
        ).first()
        is not None
    )


def record_usage(
    conn: Connection,
    workspace_id: str,
    month: str,
    bucket: RequestClass | str,
    *,
    tokens_in: int,
    tokens_out: int,
    cost_usd: float,
    cache_read_tokens: int = 0,
) -> None:
    """Add a finished turn's tokens and dollars. Never blocks or ends anything."""
    bucket = RequestClass(bucket)
    _ensure_row(conn, workspace_id, month, bucket)
    conn.execute(
        sa.update(ai_usage)
        .where(_where(workspace_id, month, bucket))
        .values(
            tokens_in=ai_usage.c.tokens_in + max(0, int(tokens_in)),
            tokens_out=ai_usage.c.tokens_out + max(0, int(tokens_out)),
            cache_read_tokens=ai_usage.c.cache_read_tokens + max(0, int(cache_read_tokens)),
            cost_usd=ai_usage.c.cost_usd + max(0.0, float(cost_usd)),
            updated_at=db_now(conn),
        )
    )


def month_cost(conn: Connection, workspace_id: str, month: str) -> float:
    """Dollars this workspace's Lucy turns cost this month, across every bucket."""
    total = conn.execute(
        sa.select(sa.func.coalesce(sa.func.sum(ai_usage.c.cost_usd), 0.0)).where(
            ai_usage.c.workspace_id == workspace_id, ai_usage.c.month == month
        )
    ).scalar()
    return float(total or 0.0)


def remaining(
    conn: Connection,
    workspace_id: str,
    tier: Tier | str,
    month: str,
    timezone: str | None = "UTC",
) -> list[BucketState]:
    """What the usage meter shows: each bucket's limit, turns used and turns left."""
    tier = Tier(tier)
    rows = dict(
        conn.execute(
            sa.select(ai_usage.c.request_class, ai_usage.c.turns).where(
                ai_usage.c.workspace_id == workspace_id, ai_usage.c.month == month
            )
        ).all()
    )
    resets_at = month_resets_at(month, timezone)
    states = []
    for bucket, limit in ALLOWANCES[tier].items():
        used = int(rows.get(bucket.value, 0))
        states.append(
            BucketState(
                bucket=bucket,
                limit=limit,
                used=used,
                remaining=max(0, limit - used),
                fair_use=bucket in FAIR_USE.get(tier, frozenset()),
                resets_at=resets_at,
            )
        )
    return states
