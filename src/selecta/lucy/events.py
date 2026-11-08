"""The durable, ordered event log behind every live Lucy view (ADR-0303, LU-303-01..07).

Every fact a client draws (text deltas, tool activity, proposal revisions, job changes, run
states) is appended here first, with a global ordered id, a schema version and the turn, run,
plan and step it belongs to. A client that reconnects asks for everything after its last id and
gets each event exactly once. A client that fell too far behind, or speaks another schema
version, is told so and rebuilds from the authoritative snapshot instead.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterable
from typing import Any

from selecta.lucy import EVENT_SCHEMA_VERSION
from selecta.lucy.ids import now_iso

EVENT_TYPES = frozenset(
    {
        "conversation.updated",
        "turn.accepted",
        "turn.superseded",
        "run.state",
        "run.limit",
        "run.usage",
        "message.started",
        "message.delta",
        "message.completed",
        "plan.started",
        "plan.completed",
        "step.queued",
        "step.started",
        "step.progress",
        "step.completed",
        "step.failed",
        "step.skipped",
        "step.cancelled",
        "step.retrying",
        "proposal.revision",
        "proposal.current",
        "permission.requested",
        "permission.decided",
        "commit.updated",
        "job.update",
        "error",
    }
)

RETAIN_EVENTS = 4000
"""Per conversation. Older text deltas are compacted away; completed messages keep their text."""


class _Latest:
    """The newest event id per conversation, held in memory so idle streams don't query SQLite."""

    def __init__(self) -> None:
        self._ids: dict[str, int] = {}
        self._lock = threading.Lock()
        self._changed = threading.Condition(self._lock)

    def bump(self, conversation: str, event_id: int) -> None:
        with self._changed:
            if event_id > self._ids.get(conversation, 0):
                self._ids[conversation] = event_id
            self._changed.notify_all()

    def get(self, conversation: str) -> int:
        with self._lock:
            return self._ids.get(conversation, 0)

    def wait(self, conversation: str, after: int, timeout: float) -> int:
        with self._changed:
            self._changed.wait_for(lambda: self._ids.get(conversation, 0) > after, timeout)
            return self._ids.get(conversation, 0)


LATEST = _Latest()


def append(
    conn: sqlite3.Connection,
    conversation: str,
    type: str,
    payload: dict[str, Any] | None = None,
    *,
    turn: str | None = None,
    run: str | None = None,
    plan: str | None = None,
    step: str | None = None,
    commit: bool = True,
) -> int:
    if type not in EVENT_TYPES:
        raise ValueError(f"Unknown Lucy event type {type!r}")
    cursor = conn.execute(
        "INSERT INTO lucy_events(conversation_id,v,type,turn_id,run_id,plan_id,step_id,payload,"
        "created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        (
            conversation,
            EVENT_SCHEMA_VERSION,
            type,
            turn,
            run,
            plan,
            step,
            json.dumps(payload or {}, ensure_ascii=False, default=str),
            now_iso(),
        ),
    )
    event_id = int(cursor.lastrowid)
    if commit:
        conn.commit()
        LATEST.bump(conversation, event_id)
    return event_id


def announce(conversation: str, event_id: int) -> None:
    """For callers that appended with commit=False and then committed a whole transaction."""
    LATEST.bump(conversation, event_id)


def _shape(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "v": row["v"],
        "type": row["type"],
        "conversation": row["conversation_id"],
        "turn": row["turn_id"],
        "run": row["run_id"],
        "plan": row["plan_id"],
        "step": row["step_id"],
        "payload": json.loads(row["payload"]),
        "at": row["created_at"],
    }


def since(
    conn: sqlite3.Connection, conversation: str, after: int, limit: int = 500
) -> dict[str, Any]:
    """Events after a cursor, in order, and whether the client must rebuild from a snapshot.

    A gap means events the client never saw were compacted away; replaying the rest would draw a
    wrong picture, so the client is told to take the snapshot and continue from its cursor.
    """
    row = conn.execute(
        "SELECT pruned_through FROM lucy_conversations WHERE id=?", (conversation,)
    ).fetchone()
    if row is None:
        return {"events": [], "gap": False, "missing": True, "cursor": after}
    gap = after < row["pruned_through"]
    rows = conn.execute(
        "SELECT * FROM lucy_events WHERE conversation_id=? AND id>? ORDER BY id LIMIT ?",
        (conversation, after, limit),
    ).fetchall()
    events = [_shape(item) for item in rows]
    cursor = events[-1]["id"] if events else after
    return {"events": events, "gap": gap, "missing": False, "cursor": cursor}


def latest_id(conn: sqlite3.Connection, conversation: str) -> int:
    known = LATEST.get(conversation)
    if known:
        return known
    row = conn.execute(
        "SELECT MAX(id) FROM lucy_events WHERE conversation_id=?", (conversation,)
    ).fetchone()
    found = int(row[0] or 0)
    if found:
        LATEST.bump(conversation, found)
    return found


def sse(events: Iterable[dict[str, Any]]) -> str:
    """Server-sent event frames. The id lets the browser resume with Last-Event-ID."""
    return "".join(
        f"id: {event['id']}\nevent: lucy\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
        for event in events
    )


def prune(conn: sqlite3.Connection, conversation: str, keep: int = RETAIN_EVENTS) -> int:
    """Compact old text deltas of finished messages. Nothing a snapshot needs is ever lost: the
    message rows keep their full text, and revisions and runs live in their own tables."""
    newest = latest_id(conn, conversation)
    floor = newest - keep
    if floor <= 0:
        return 0
    removed = conn.execute(
        "DELETE FROM lucy_events WHERE conversation_id=? AND id<=? AND type IN "
        "('message.delta','step.progress')",
        (conversation, floor),
    ).rowcount
    if removed:
        conn.execute(
            "UPDATE lucy_conversations SET pruned_through=max(pruned_through,?) WHERE id=?",
            (floor, conversation),
        )
        conn.commit()
    return removed
