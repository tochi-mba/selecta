"""Invalidate signed-in devices' Lucy meters after a committed usage change."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.ai import usage_mode, usage_units
from selecta.ai.usage_schema import lucy_usage_ledger, lucy_usage_state
from selecta.ai.usage_units import ENFORCED
from selecta.billing.stripe_sync import effective_entitlement
from selecta.flags.rules import load_snapshot
from selecta.persistence import db_now
from selecta.work import outbox


def emit_usage_for_enforced_run(
    conn: Connection, workspace_id: str, run_id: str, *, now: float,
) -> None:
    """Publish an invalidation without including anyone's usage data in the stream."""
    enforced = conn.scalar(
        sa.select(lucy_usage_ledger.c.run_id).where(
            lucy_usage_ledger.c.workspace_id == workspace_id,
            lucy_usage_ledger.c.run_id == run_id,
            lucy_usage_ledger.c.mode == ENFORCED,
        )
    )
    if enforced is not None:
        outbox.emit(conn, "lucy.usage", workspace_id, {}, now)


def publish_due_resets(conn: Connection, *, limit: int = 200) -> int:
    """Roll expired windows and publish each enforced reset in the same transaction."""
    now = db_now(conn)
    state = lucy_usage_state.c
    due = conn.scalars(
        sa.select(state.workspace_id)
        .where(
            state.cutover_at <= now,
            sa.or_(state.week_ends_at <= now, state.session_ends_at <= now),
        )
        .order_by(state.workspace_id)
        .limit(limit)
    ).all()
    if not due:
        return 0
    rules = load_snapshot(conn)
    published = 0
    for workspace_id in due:
        mode = usage_mode.mode_for(conn, workspace_id, rules, now)
        entitlement = effective_entitlement(conn, workspace_id, now)
        reset = usage_units.roll(conn, workspace_id, plan_id=entitlement.plan_id, now=now)
        if reset and mode == usage_mode.ENFORCED:
            outbox.emit(conn, "lucy.usage", workspace_id, {}, now)
            published += 1
    return published
