"""Aggregate ADR-0487 shadow measurement without exposing workspace or run IDs.

The cohort is the workspaces with settled plan traffic admitted inside the requested window.
Zero-charge turns still count as turns. Allowance comparisons use the current catalogue's
proposed sizes. Only active weeks and sessions whose full duration could lie inside the
window contribute to window statistics. The week bound of eight days allows clock changes.
Costs for invoice reconciliation reflect platform spend, including refunded turns and retries.
Percentiles use nearest ranks. Results from fewer than 30 turns or with no complete week
are labelled insufficient data; the caller must also confirm the shadow coverage.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from statistics import mean
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.ai.schema import ai_runs
from selecta.ai.usage_schema import lucy_usage_ledger as ledger
from selecta.ai.usage_units import targets
from selecta.billing.plans import lucy_usage

MIN_TURNS = 30
SECONDS_PER_DAY = 86_400


def _distribution(values: list[int | float]) -> dict[str, int | float | None]:
    ordered = sorted(values)
    return {
        "count": len(ordered),
        "mean": mean(ordered) if ordered else None,
        **{
            f"p{percent}": ordered[math.ceil(percent * len(ordered) / 100) - 1]
            if ordered else None
            for percent in (50, 90, 99)
        },
    }


def measure(conn: Connection, since: float, until: float) -> dict[str, Any]:
    if not since < until:
        raise ValueError("The measurement end must follow the start.")
    costs = defaultdict(list)
    week_units = defaultdict(Counter)
    week_costs = defaultdict(Counter)
    session_units = defaultdict(Counter)
    session_turns = defaultdict(Counter)
    weekly_sessions = defaultdict(lambda: defaultdict(set))
    rows = conn.execute(
        sa.select(
            ledger.c.tier, ledger.c.workspace_id, ledger.c.week_seq, ledger.c.session_seq,
            ledger.c.week_ends_at, ledger.c.session_ends_at, ledger.c.charged_units,
            ai_runs.c.cost_usd,
        )
        .select_from(ledger.join(ai_runs, sa.and_(
            ledger.c.run_id == ai_runs.c.id, ledger.c.workspace_id == ai_runs.c.workspace_id,
        )))
        .where(
            ledger.c.mode == "shadow", ledger.c.pool == "plan",
            ledger.c.created_at >= since, ledger.c.created_at < until,
            ledger.c.settled_at < until, ledger.c.charged_units.is_not(None),
        )
    )
    for tier, workspace, week, session, week_end, session_end, charged, cost in rows:
        cost = float(cost)
        costs[tier].append(cost)
        week_key = (workspace, week)
        if since + 8 * SECONDS_PER_DAY <= week_end <= until:
            week_units[tier][week_key] += charged
            week_costs[tier][week_key] += cost
            if session is not None:
                weekly_sessions[tier][week_key].add(session)
        whole = session_end is not None and since + 18_000 <= session_end <= until
        if session is not None and whole:
            key = (workspace, session)
            session_units[tier][key] += charged
            session_turns[tier][key] += 1

    catalogue = lucy_usage()
    result = {}
    for tier in sorted(set(catalogue.plans) | costs.keys()):
        limits = targets(tier, catalogue_version=catalogue.version)
        result[tier] = {
            "status": ("measured" if len(costs[tier]) >= MIN_TURNS and week_units[tier]
                       else "insufficient_data"),
            "cost_per_turn_usd": _distribution(costs[tier]),
            "turns_per_session": _distribution(list(session_turns[tier].values())),
            "sessions_per_active_week": _distribution([
                len(weekly_sessions[tier][key]) for key in week_units[tier]
            ]),
            "weekly_account_cost_usd": _distribution(list(week_costs[tier].values())),
            "accounts_reaching_session_share": _reached(session_units[tier], limits.session_limit),
            "accounts_reaching_week_share": _reached(week_units[tier], limits.week_limit),
            "platform_cost_usd": round(math.fsum(costs[tier]), 8),
        }
    return {"since": since, "until": until, "catalogue_version": catalogue.version, "plans": result}


def _reached(windows: Counter, limit: int | None) -> float | None:
    accounts = {workspace for workspace, _ in windows}
    if not accounts or limit is None:
        return None
    reached = {workspace for (workspace, seq), used in windows.items() if used >= limit}
    return len(reached) / len(accounts)
