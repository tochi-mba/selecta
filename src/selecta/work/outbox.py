"""The outbox: one event per job state change, written in the same transaction as the change.

Readers take events by increasing `seq`, the commit order stamped as each transaction commits
(see migration 7c1e9a4b2f30): ids are handed out at insert, so walking ids could skip an event
whose transaction committed after a later id's. A missed notification is caught up on the next
read, and consumers dedupe by id (delivery is at least once). On PostgreSQL each event also calls
`pg_notify` inside the transaction; Postgres delivers notifications only on commit, so a listener
never hears of a change that rolled back. Rows are kept for seven days.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import is_postgres
from selecta.work.schema import outbox_events

CHANNEL = "selecta_outbox"
KEEP_S = 7 * 24 * 3600.0


@dataclass(frozen=True)
class OutboxEvent:
    id: int
    topic: str
    workspace_id: str | None
    payload: Any
    created_at: float
    seq: int | None = None


def emit(
    connection: Connection, topic: str, workspace_id: str | None, payload: dict, now: float
) -> int:
    """Write one event; on PostgreSQL, notify listeners of its id when the transaction commits."""
    result = connection.execute(
        outbox_events.insert().values(
            topic=topic, workspace_id=workspace_id, payload=payload, created_at=now
        )
    )
    event_id = int(result.inserted_primary_key[0])
    if is_postgres(connection):
        connection.execute(
            sa.text("SELECT pg_notify(:channel, :id)"), {"channel": CHANNEL, "id": str(event_id)}
        )
    return event_id


def read_after(connection: Connection, after_seq: int, limit: int = 500) -> list[OutboxEvent]:
    """Committed events after `after_seq`, in commit order. Pass the last event's `seq` back."""
    rows = connection.execute(
        sa.select(outbox_events)
        .where(outbox_events.c.seq > after_seq)
        .order_by(outbox_events.c.seq)
        .limit(limit)
    )
    return [OutboxEvent(**row._mapping) for row in rows]


def prune(connection: Connection, now: float, keep_s: float = KEEP_S) -> int:
    """Drop events older than the retention window. Returns how many went."""
    result = connection.execute(
        outbox_events.delete().where(outbox_events.c.created_at < now - keep_s)
    )
    return result.rowcount or 0
