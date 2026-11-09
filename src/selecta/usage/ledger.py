"""The usage ledger: an append-only record of everything a workspace uses (ADR-0402).

Every meter and every cost report comes from here. A row is written once and never changed: a
correction is another row. Amounts are in these units:

| Kind | Unit |
|---|---|
| `storage_bytes` | bytes, signed: + when an upload is accepted or an export kept, - when deleted |
| `compute_seconds` | seconds of worker compute |
| `ai_tokens` | tokens, input and output together (split them in `detail`) |
| `ai_cost` | US dollars |
| `export`, `analysis_song`, `lucy_turn` | one per thing done |

`rollup_day` sums a UTC day of the ledger into `usage_daily`, replacing what was there, so it can
run as often as you like and the rollups always match the ledger. Allowances people see (songs
analysed today, Lucy turns this month) reset at their local midnight and are counted in
`usage/allowances.py`; the ledger is the cost record behind them.
"""

from __future__ import annotations

import datetime as dt
import enum
import math
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import persistence
from selecta.usage.schema import upsert, usage_daily, usage_ledger


class Kind(enum.StrEnum):
    STORAGE_BYTES = "storage_bytes"
    COMPUTE_SECONDS = "compute_seconds"
    AI_TOKENS = "ai_tokens"
    AI_COST = "ai_cost"
    EXPORT = "export"
    ANALYSIS_SONG = "analysis_song"
    LUCY_TURN = "lucy_turn"


# Kinds that count whole things, so a fraction is a mistake.
WHOLE = frozenset(
    {Kind.STORAGE_BYTES, Kind.AI_TOKENS, Kind.EXPORT, Kind.ANALYSIS_SONG, Kind.LUCY_TURN}
)


@dataclass(frozen=True)
class DailyTotal:
    workspace_id: str
    day: dt.date
    kind: str
    total: float
    entries: int


def record(
    connection: Connection,
    workspace_id: str,
    kind: Kind | str,
    amount: float,
    *,
    ref: str | None = None,
    detail: Mapping[str, Any] | None = None,
    occurred_at: float | None = None,
) -> str:
    """Append one entry and return its id. Only storage can go down; everything else counts
    up, so a negative amount for it is refused."""
    kind = Kind(kind)
    if not isinstance(amount, int | float) or isinstance(amount, bool) or not math.isfinite(amount):
        raise ValueError(f"A {kind} amount must be a number, not {amount!r}.")
    if kind is not Kind.STORAGE_BYTES and amount < 0:
        raise ValueError(f"{kind} only counts up; record what was used, not a refund.")
    if kind in WHOLE and amount != int(amount):
        raise ValueError(f"{kind} counts whole things, not {amount}.")
    entry_id = persistence.new_id()
    connection.execute(
        sa.insert(usage_ledger).values(
            id=entry_id,
            workspace_id=workspace_id,
            kind=kind.value,
            amount=float(amount),
            occurred_at=persistence.db_now(connection) if occurred_at is None else occurred_at,
            ref=ref,
            detail=dict(detail) if detail is not None else None,
        )
    )
    return entry_id


def totals(
    connection: Connection,
    workspace_id: str,
    *,
    since: float | None = None,
    until: float | None = None,
    kinds: Collection[Kind | str] | None = None,
) -> dict[str, float]:
    """The ledger summed by kind for one workspace, between two epoch times (`until` excluded)."""
    query = (
        sa.select(usage_ledger.c.kind, sa.func.sum(usage_ledger.c.amount))
        .where(usage_ledger.c.workspace_id == workspace_id)
        .group_by(usage_ledger.c.kind)
    )
    if since is not None:
        query = query.where(usage_ledger.c.occurred_at >= since)
    if until is not None:
        query = query.where(usage_ledger.c.occurred_at < until)
    if kinds is not None:
        query = query.where(usage_ledger.c.kind.in_([Kind(kind).value for kind in kinds]))
    return {kind: float(total or 0) for kind, total in connection.execute(query)}


def day_bounds(day: dt.date) -> tuple[float, float]:
    """A UTC day as epoch seconds, from its first moment up to (not including) the next day's."""
    start = dt.datetime.combine(day, dt.time(0), tzinfo=dt.UTC).timestamp()
    return start, start + 86_400


def rollup_day(connection: Connection, day: dt.date, *, workspace_id: str | None = None) -> int:
    """Recompute `usage_daily` for one UTC day from the ledger, for one workspace or (with a
    role that sees every workspace) all of them. Returns how many rows it wrote."""
    start, end = day_bounds(day)
    query = (
        sa.select(
            usage_ledger.c.workspace_id,
            usage_ledger.c.kind,
            sa.func.sum(usage_ledger.c.amount),
            sa.func.count(),
        )
        .where(usage_ledger.c.occurred_at >= start)
        .where(usage_ledger.c.occurred_at < end)
        .group_by(usage_ledger.c.workspace_id, usage_ledger.c.kind)
    )
    if workspace_id is not None:
        query = query.where(usage_ledger.c.workspace_id == workspace_id)
    now = persistence.db_now(connection)
    rows = [
        {
            "workspace_id": workspace,
            "day": day,
            "kind": kind,
            "total": float(total or 0),
            "entries": int(entries),
            "updated_at": now,
        }
        for workspace, kind, total, entries in connection.execute(query)
    ]
    upsert(
        connection,
        usage_daily,
        rows,
        keys=("workspace_id", "day", "kind"),
        replace=("total", "entries", "updated_at"),
    )
    return len(rows)


def daily(
    connection: Connection, workspace_id: str, first: dt.date, last: dt.date
) -> list[DailyTotal]:
    """One workspace's rollups from `first` to `last` (both included), oldest first."""
    query = (
        sa.select(usage_daily)
        .where(usage_daily.c.workspace_id == workspace_id)
        .where(usage_daily.c.day >= first)
        .where(usage_daily.c.day <= last)
        .order_by(usage_daily.c.day, usage_daily.c.kind)
    )
    return [
        DailyTotal(row.workspace_id, row.day, row.kind, float(row.total), int(row.entries))
        for row in connection.execute(query)
    ]
