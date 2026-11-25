"""Invalidate signed-in devices' Lucy meters after a committed usage change."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.ai.usage_schema import lucy_usage_ledger
from selecta.ai.usage_units import ENFORCED
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
