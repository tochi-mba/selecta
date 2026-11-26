"""Lucy's event log through the store: append, read after a cursor, and compact old deltas."""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa

from selecta.engine_store.lucy import Tx
from selecta.engine_store.schema import lucy_conversations, lucy_events
from selecta.lucy import EVENT_SCHEMA_VERSION, ids

COMPACTED = ("message.delta", "step.progress")


def append(
    tx: Tx,
    conversation: str,
    type: str,
    payload: dict[str, Any] | None = None,
    *,
    turn: str | None = None,
    run: str | None = None,
    plan: str | None = None,
    step: str | None = None,
) -> int:
    """One event, as `lucy.events.append` writes it; announced once `tx` commits."""
    event_id = tx.insert_id(
        lucy_events,
        conversation_id=conversation,
        v=EVENT_SCHEMA_VERSION,
        type=type,
        turn_id=turn,
        run_id=run,
        plan_id=plan,
        step_id=step,
        payload=json.dumps(payload or {}, ensure_ascii=False, default=str),
        created_at=ids.now_iso(),
    )
    tx.appended.append((conversation, event_id))
    return event_id


def pruned_through(tx: Tx, conversation: str) -> int | None:
    return tx.scalar(
        sa.select(lucy_conversations.c.pruned_through).where(
            tx.where(lucy_conversations, id=conversation)
        )
    )


def after(tx: Tx, conversation: str, cursor: int, limit: int) -> list:
    return tx.all(
        sa.select(lucy_events)
        .where(tx.where(lucy_events, conversation_id=conversation), lucy_events.c.id > cursor)
        .order_by(lucy_events.c.id)
        .limit(limit)
    )


def newest(tx: Tx, conversation: str) -> int:
    found = tx.scalar(
        sa.select(sa.func.max(lucy_events.c.id)).where(
            tx.where(lucy_events, conversation_id=conversation)
        )
    )
    return int(found or 0)


def prune(tx: Tx, conversation: str, floor: int) -> int:
    """Old text deltas and progress of one conversation, up to `floor`, and the mark that says
    so, in one write."""
    removed = tx.delete(
        lucy_events,
        sa.and_(lucy_events.c.id <= floor, lucy_events.c.type.in_(COMPACTED)),
        conversation_id=conversation,
    )
    if removed:
        mark = lucy_conversations.c.pruned_through
        tx.update(
            lucy_conversations,
            {"id": conversation},
            pruned_through=sa.case((mark < floor, floor), else_=mark),
        )
    return removed


def steps(tx: Tx, conversation: str) -> list:
    """Every step event of one conversation, in order, for the cards a snapshot folds."""
    return tx.all(
        sa.select(lucy_events)
        .where(
            tx.where(lucy_events, conversation_id=conversation),
            lucy_events.c.type.like("step.%"),
        )
        .order_by(lucy_events.c.id)
    )


def problem_counts(tx: Tx) -> list:
    """How many failed steps, errors and limits were logged, by type (diagnostics)."""
    kinds = ("step.failed", "error", "run.limit")
    return tx.all(
        sa.select(lucy_events.c.type, sa.func.count().label("n"))
        .where(tx.store.mine(lucy_events), lucy_events.c.type.in_(kinds))
        .group_by(lucy_events.c.type)
    )


__all__ = ["append", "after", "newest", "problem_counts", "prune", "pruned_through", "steps"]
