"""Lucy's run records and the few reads her routes make of runs, turns and events.

Each function keeps the very statement `agent.py` or `routes/lucy.py` ran before (the flag off,
or a connection holding writes of its own), and with `core.engine_store` on runs as one short
store transaction (docs/engineering/engine-store-lucy.md). A streaming reply writes one thing at
a time: its text so far, a state, its usage. Each lands on its own, so a reply cut off midway
leaves the conversation as the last write left it, which `recover` then closes truthfully.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from selecta.engine_store.lucy import conversations as stored
from selecta.engine_store.lucy import events as log
from selecta.lucy import backing, events
from selecta.lucy.ids import now_iso


def add(conn: sqlite3.Connection, run: str, turn: str, conversation: str, attempt: int,
        provider: str, limits: dict) -> None:
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            stored.add_run(tx, run, turn, conversation, attempt, provider, limits)
        return
    conn.execute(
        "INSERT INTO lucy_runs(id,turn_id,conversation_id,attempt,state,provider,limits,"
        "started_at) VALUES(?,?,?,?,?,?,?,?)",
        (run, turn, conversation, attempt, "queued", provider, json.dumps(limits), now_iso()),
    )
    conn.commit()


def recover(conn: sqlite3.Connection) -> int:
    """After a restart nothing is running: say so truthfully instead of spinning forever
    (LU-302-03). Partial replies keep the text they had."""
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            return stored.recover(tx)
    stuck = conn.execute(
        "SELECT id, conversation_id, turn_id FROM lucy_runs WHERE state NOT IN "
        "('completed','failed','cancelled','interrupted','superseded')"
    ).fetchall()
    for row in stuck:
        conn.execute(
            "UPDATE lucy_runs SET state='interrupted', ended_at=? WHERE id=?",
            (now_iso(), row["id"]),
        )
        conn.execute(
            "UPDATE lucy_messages SET status='interrupted' WHERE run_id=? AND status='streaming'",
            (row["id"],),
        )
        conn.execute(
            "UPDATE lucy_turns SET status='interrupted' WHERE id=? AND status IN "
            "('queued','running')",
            (row["turn_id"],),
        )
        events.append(
            conn,
            row["conversation_id"],
            "run.state",
            {
                "state": "interrupted",
                "cycles": 0,
                "steps": 0,
                "error": "SelectaDJ restarted while Lucy was working.",
            },
            turn=row["turn_id"],
            run=row["id"],
            commit=False,
        )
    conn.commit()
    return len(stuck)


def save_text(conn: sqlite3.Connection, message: str, content: str) -> None:
    """A streaming reply's text so far, so a cut-off reply keeps what it had."""
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            tx.update(stored.lucy_messages, {"id": message}, content=content)
        return
    conn.execute("UPDATE lucy_messages SET content=? WHERE id=?", (content, message))
    conn.commit()


def set_state(conn: sqlite3.Connection, run: str, state: str, cycles: int, steps: int,
              error: str | None, ended: str | None) -> None:
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            stored.set_run(tx, run, state=state, cycles=cycles, steps=steps, error=error,
                           ended_at=ended)
        return
    conn.execute(
        "UPDATE lucy_runs SET state=?, cycles=?, steps=?, error=coalesce(?,error), "
        "ended_at=coalesce(?,ended_at) WHERE id=?",
        (state, cycles, steps, error, ended, run),
    )
    conn.commit()


def set_usage(conn: sqlite3.Connection, run: str, usage: dict) -> None:
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            stored.set_run(tx, run, tokens_in=usage["tokens_in"], tokens_out=usage["tokens_out"],
                           usage=json.dumps(usage))
        return
    conn.execute(
        "UPDATE lucy_runs SET tokens_in=?, tokens_out=?, usage=? WHERE id=?",
        (usage["tokens_in"], usage["tokens_out"], json.dumps(usage), run),
    )
    conn.commit()


def current_revision(conn: sqlite3.Connection, conversation: str) -> str | None:
    """The revision this conversation's proposal points at now, if any."""
    if backing.store_of(conn) is not None:
        from selecta.lucy import conversations, proposals

        proposal = conversations.column(conn, conversation, "proposal_id")
        return proposals.current_id(conn, proposal) if proposal else None
    row = conn.execute(
        "SELECT p.current_revision FROM lucy_proposals p JOIN "
        "lucy_conversations c ON c.proposal_id=p.id WHERE c.id=?",
        (conversation,),
    ).fetchone()
    return row[0] if row else None


# ---- what the routes read


def latest_of_conversation(conn: sqlite3.Connection, conversation: str) -> Any:
    store = backing.store_of(conn)
    if store is not None:
        with backing.reading(store) as tx:
            return stored.latest_run(tx, conversation_id=conversation)
    return conn.execute("SELECT * FROM lucy_runs WHERE conversation_id=? ORDER BY started_at "
                        "DESC LIMIT 1", (conversation,)).fetchone()


def latest_of_turn(conn: sqlite3.Connection, turn: str) -> str | None:
    store = backing.store_of(conn)
    if store is not None:
        with backing.reading(store) as tx:
            row = stored.latest_run(tx, turn_id=turn)
    else:
        row = conn.execute("SELECT id FROM lucy_runs WHERE turn_id=? ORDER BY "
                           "started_at DESC LIMIT 1", (turn,)).fetchone()
    return row["id"] if row else None


def latest_turn(conn: sqlite3.Connection, conversation: str) -> str | None:
    store = backing.store_of(conn)
    if store is not None:
        with backing.reading(store) as tx:
            return stored.latest_turn(tx, conversation)
    latest = conn.execute("SELECT id FROM lucy_turns WHERE conversation_id=? ORDER BY "
                          "seq DESC LIMIT 1", (conversation,)).fetchone()
    return latest["id"] if latest else None


def requeue(conn: sqlite3.Connection, turn: str) -> int:
    """A stuck turn queued again for a retry; returns how many runs it had."""
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            attempts = stored.attempts(tx, turn)
            tx.update(stored.lucy_turns, {"id": turn}, status="queued")
            return attempts
    attempts = conn.execute("SELECT COUNT(*) FROM lucy_runs WHERE turn_id=?",
                            (turn,)).fetchone()[0]
    conn.execute("UPDATE lucy_turns SET status='queued' WHERE id=?", (turn,))
    conn.commit()
    return attempts


def step_events(conn: sqlite3.Connection, conversation: str) -> list:
    store = backing.store_of(conn)
    if store is not None:
        with backing.reading(store) as tx:
            return log.steps(tx, conversation)
    return conn.execute(
        "SELECT * FROM lucy_events WHERE conversation_id=? AND type LIKE 'step.%' "
        "ORDER BY id", (conversation,)).fetchall()


def revision_before(conn: sqlite3.Connection, conversation: str, seq: int) -> str | None:
    store = backing.store_of(conn)
    if store is not None:
        with backing.reading(store) as tx:
            return stored.latest_revision_through(tx, conversation, seq)
    row = conn.execute(
        "SELECT revision_id FROM lucy_messages WHERE conversation_id=? AND seq<=? AND "
        "revision_id IS NOT NULL ORDER BY seq DESC LIMIT 1",
        (conversation, seq)).fetchone()
    return row["revision_id"] if row else None


def diagnostics(conn: sqlite3.Connection, limit: int) -> tuple[list, list]:
    """Run traces and problem counts, without message text, lyrics, paths or keys."""
    store = backing.store_of(conn)
    if store is not None:
        with backing.reading(store) as tx:
            return stored.recent_runs(tx, limit), log.problem_counts(tx)
    rows = conn.execute(
        "SELECT id,conversation_id,state,provider,cycles,steps,tokens_in,tokens_out,"
        "usage,error,started_at,ended_at FROM lucy_runs ORDER BY started_at DESC "
        "LIMIT ?", (limit,)).fetchall()
    failures = conn.execute(
        "SELECT type, COUNT(*) n FROM lucy_events WHERE type IN ('step.failed','error',"
        "'run.limit') GROUP BY type").fetchall()
    return rows, failures


__all__ = [
    "add",
    "current_revision",
    "diagnostics",
    "latest_of_conversation",
    "latest_of_turn",
    "latest_turn",
    "recover",
    "requeue",
    "revision_before",
    "save_text",
    "set_state",
    "set_usage",
    "step_events",
]
