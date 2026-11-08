"""Permission requests for work Lucy may not start on its own (LU-300-03, LU-331-03).

A request names the exact operation and arguments. Allowing it does exactly that and nothing
more, through Selecta's normal machinery and priorities: analysis requests only move those songs
to the front of the analysis queue, behind whatever is playing or rendering (LU-315-05).
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from selecta.lucy import events
from selecta.lucy.ids import new_id, now_iso

KNOWN = {"analysis.request"}


def _shape(row: sqlite3.Row) -> dict:
    arguments = json.loads(row["arguments"])
    return {
        "id": row["id"],
        "tier": row["tier"],
        "operation": row["operation"],
        "arguments": {key: value for key, value in arguments.items() if key != "text"},
        "text": arguments.get("text", ""),
        "status": row["status"],
        "run": row["run_id"],
    }


def request(ctx: Any, tier: str, operation: str, arguments: dict, text: str) -> dict:
    if operation not in KNOWN:
        raise PermissionError(f"{operation} can't be requested.")
    found = new_id("permission")
    ctx.conn.execute(
        "INSERT INTO lucy_permissions(id,conversation_id,run_id,tier,operation,arguments,status,"
        "created_at) VALUES(?,?,?,?,?,?,?,?)",
        (found, ctx.conversation, ctx.run, tier, operation,
         json.dumps({**arguments, "text": text}), "pending", now_iso()),
    )
    ctx.conn.commit()
    row = ctx.conn.execute("SELECT * FROM lucy_permissions WHERE id=?", (found,)).fetchone()
    shaped = _shape(row)
    ctx.permissions.append(found)
    ctx.emit("permission.requested", shaped)
    return shaped


def pending(conn: sqlite3.Connection, conversation: str) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM lucy_permissions WHERE conversation_id=? AND status='pending' "
        "ORDER BY created_at", (conversation,)).fetchall()
    return [_shape(row) for row in rows]


def decide(conn: sqlite3.Connection, permission: str, decision: str) -> dict:
    """The person's own answer. Only a pending request can be decided, once."""
    if decision not in {"allow", "deny"}:
        raise ValueError("Answer allow or deny.")
    row = conn.execute("SELECT * FROM lucy_permissions WHERE id=?", (permission,)).fetchone()
    if row is None:
        raise KeyError(permission)
    if row["status"] != "pending":
        return _shape(row)
    status = "allowed" if decision == "allow" else "denied"
    if status == "allowed" and row["operation"] == "analysis.request":
        ids = json.loads(row["arguments"]).get("song_ids", [])
        conn.executemany(
            "UPDATE songs SET processing_priority=100 WHERE id=? AND is_music=1",
            [(int(song_id),) for song_id in ids],
        )
    conn.execute(
        "UPDATE lucy_permissions SET status=?, decided_at=? WHERE id=?",
        (status, now_iso(), permission),
    )
    conn.commit()
    events.append(conn, row["conversation_id"], "permission.decided",
                  {"id": permission, "status": status}, run=row["run_id"])
    return _shape(conn.execute("SELECT * FROM lucy_permissions WHERE id=?",
                               (permission,)).fetchone())
