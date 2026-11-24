"""Reads and writes for Lucy's Cloud conversations (ADR-0476).

Every function takes the workspace and, where a conversation is read, the person: a conversation
that is not theirs reads exactly like one that does not exist. Answers come back in the shapes
the local page reads (`web/src/lucy/types.ts`), so the page needs no Cloud branch.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.lucy.cloud_schema import (
    lucy_cloud_conversations as conversations,
)
from selecta.lucy.cloud_schema import (
    lucy_cloud_events as events,
)
from selecta.lucy.cloud_schema import (
    lucy_cloud_messages as messages,
)
from selecta.lucy.cloud_schema import (
    lucy_cloud_proposals as proposals,
)
from selecta.lucy.cloud_schema import (
    lucy_cloud_turns as turns,
)
from selecta.persistence import db_now, new_id

EVENT_SCHEMA = 1
EVENTS_PAGE = 200
TITLE_CHARS = 60
ACTIVE_TURN = ("queued", "running", "stopping")


class NotFound(LookupError):
    """No such conversation (or not this person's): always the same answer."""


def iso(epoch: float) -> str:
    return dt.datetime.fromtimestamp(float(epoch), dt.UTC).isoformat()


def _conversation_json(row: Any, proposal_id: str | None = None) -> dict[str, Any]:
    return {
        "id": row.id,
        "title": row.title,
        "scope": row.scope or {},
        "proposal_id": proposal_id,
        "parent_id": None,
        "branched_from": None,
        "archived": bool(row.archived),
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
        "last_user_text": row.last_user_text,
    }


def _where_mine(workspace_id: str, user_id: str, conversation_id: str):
    return sa.and_(
        conversations.c.workspace_id == workspace_id,
        conversations.c.user_id == user_id,
        conversations.c.id == conversation_id,
    )


def conversation_row(conn: Connection, workspace_id: str, user_id: str, conversation_id: str):
    row = conn.execute(
        sa.select(conversations).where(_where_mine(workspace_id, user_id, conversation_id))
    ).first()
    if row is None:
        raise NotFound(conversation_id)
    return row


def create_conversation(
    conn: Connection, workspace_id: str, user_id: str, title: str, scope: dict | None
) -> dict[str, Any]:
    now = db_now(conn)
    conversation_id = new_id()
    conn.execute(
        conversations.insert().values(
            workspace_id=workspace_id, id=conversation_id, user_id=user_id,
            title=(title or "").strip()[:200], scope=scope or {}, archived=False,
            created_at=now, updated_at=now,
        )
    )
    return get_conversation(conn, workspace_id, user_id, conversation_id)


def get_conversation(
    conn: Connection, workspace_id: str, user_id: str, conversation_id: str
) -> dict[str, Any]:
    row = conversation_row(conn, workspace_id, user_id, conversation_id)
    return _conversation_json(row, proposal_of(conn, workspace_id, conversation_id))


def list_conversations(
    conn: Connection, workspace_id: str, user_id: str, query: str = "", archived: bool = False
) -> list[dict[str, Any]]:
    statement = (
        sa.select(conversations)
        .where(conversations.c.workspace_id == workspace_id)
        .where(conversations.c.user_id == user_id)
        .where(conversations.c.archived.is_(archived))
        .order_by(conversations.c.updated_at.desc())
        .limit(200)
    )
    rows = conn.execute(statement).all()
    words = query.strip().casefold()
    found = []
    for row in rows:
        haystack = f"{row.title} {row.last_user_text or ''}".casefold()
        if words and words not in haystack:
            continue
        found.append(_conversation_json(row, proposal_of(conn, workspace_id, row.id)))
    return found


def update_conversation(
    conn: Connection, workspace_id: str, user_id: str, conversation_id: str,
    title: str | None = None, archived: bool | None = None,
) -> dict[str, Any]:
    conversation_row(conn, workspace_id, user_id, conversation_id)
    values: dict[str, Any] = {"updated_at": db_now(conn)}
    if title is not None:
        values["title"] = title.strip()[:200]
    if archived is not None:
        values["archived"] = archived
    conn.execute(
        conversations.update()
        .where(_where_mine(workspace_id, user_id, conversation_id))
        .values(**values)
    )
    if title is not None:
        append_event(conn, workspace_id, conversation_id, "conversation.updated",
                     {"title": values["title"]})
    return get_conversation(conn, workspace_id, user_id, conversation_id)


def delete_conversation(
    conn: Connection, workspace_id: str, user_id: str, conversation_id: str
) -> None:
    """Delete the conversation and everything said in it. Mixes saved from it stay."""
    conversation_row(conn, workspace_id, user_id, conversation_id)
    for table in (events, messages, turns, proposals):
        conn.execute(
            table.delete()
            .where(table.c.workspace_id == workspace_id)
            .where(table.c.conversation_id == conversation_id)
        )
    conn.execute(conversations.delete().where(_where_mine(workspace_id, user_id, conversation_id)))


def touch(conn: Connection, workspace_id: str, conversation_id: str, **values: Any) -> None:
    conn.execute(
        conversations.update()
        .where(conversations.c.workspace_id == workspace_id)
        .where(conversations.c.id == conversation_id)
        .values(updated_at=db_now(conn), **values)
    )


# Events ------------------------------------------------------------------------------------


def append_event(
    conn: Connection, workspace_id: str, conversation_id: str, kind: str, payload: dict,
    *, turn: str | None = None, run: str | None = None, plan: str | None = None,
    step: str | None = None,
) -> None:
    conn.execute(
        events.insert().values(
            workspace_id=workspace_id, conversation_id=conversation_id, type=kind,
            turn_id=turn, run_id=run, plan_id=plan, step_id=step, payload=payload,
            created_at=db_now(conn),
        )
    )


def _event_json(row: Any) -> dict[str, Any]:
    return {
        "id": int(row.id), "v": EVENT_SCHEMA, "type": row.type, "conversation": row.conversation_id,
        "turn": row.turn_id, "run": row.run_id, "plan": row.plan_id, "step": row.step_id,
        "payload": row.payload or {}, "at": iso(row.created_at),
    }


def events_after(
    conn: Connection, workspace_id: str, conversation_id: str, after: int
) -> dict[str, Any]:
    rows = conn.execute(
        sa.select(events)
        .where(events.c.workspace_id == workspace_id)
        .where(events.c.conversation_id == conversation_id)
        .where(events.c.id > after)
        .order_by(events.c.id)
        .limit(EVENTS_PAGE)
    ).all()
    found = [_event_json(row) for row in rows]
    return {"events": found, "gap": False, "cursor": found[-1]["id"] if found else after}


def cursor_of(conn: Connection, workspace_id: str, conversation_id: str) -> int:
    value = conn.execute(
        sa.select(sa.func.max(events.c.id))
        .where(events.c.workspace_id == workspace_id)
        .where(events.c.conversation_id == conversation_id)
    ).scalar()
    return int(value or 0)


def prune_deltas(conn: Connection, workspace_id: str, conversation_id: str, run: str) -> None:
    """A finished reply's text deltas: its `message.completed` carries the whole text."""
    conn.execute(
        events.delete()
        .where(events.c.workspace_id == workspace_id)
        .where(events.c.conversation_id == conversation_id)
        .where(events.c.run_id == run)
        .where(events.c.type == "message.delta")
    )


# Turns and messages ------------------------------------------------------------------------


def _next_seq(conn: Connection, workspace_id: str, conversation_id: str) -> int:
    value = conn.execute(
        sa.select(sa.func.max(messages.c.seq))
        .where(messages.c.workspace_id == workspace_id)
        .where(messages.c.conversation_id == conversation_id)
    ).scalar()
    return int(value or 0) + 1


def turn_by_client(conn: Connection, workspace_id: str, conversation_id: str, client_id: str):
    return conn.execute(
        sa.select(turns)
        .where(turns.c.workspace_id == workspace_id)
        .where(turns.c.conversation_id == conversation_id)
        .where(turns.c.client_id == client_id)
    ).first()


def turn_row(conn: Connection, workspace_id: str, turn_id: str):
    return conn.execute(
        sa.select(turns).where(turns.c.workspace_id == workspace_id).where(turns.c.id == turn_id)
    ).first()


def active_turn(conn: Connection, workspace_id: str, conversation_id: str):
    return conn.execute(
        sa.select(turns)
        .where(turns.c.workspace_id == workspace_id)
        .where(turns.c.conversation_id == conversation_id)
        .where(turns.c.status.in_(ACTIVE_TURN))
        .order_by(turns.c.seq.desc())
    ).first()


def add_turn(
    conn: Connection, workspace_id: str, conversation_id: str, client_id: str, text: str
) -> dict[str, Any]:
    seq = _next_seq(conn, workspace_id, conversation_id)
    turn_id = new_id()
    now = db_now(conn)
    conn.execute(
        turns.insert().values(
            workspace_id=workspace_id, id=turn_id, conversation_id=conversation_id,
            client_id=client_id, seq=seq, text=text, status="queued", created_at=now,
        )
    )
    message_id = new_id()
    conn.execute(
        messages.insert().values(
            workspace_id=workspace_id, id=message_id, conversation_id=conversation_id, seq=seq,
            role="user", turn_id=turn_id, content=text, status="complete", meta={},
            created_at=now,
        )
    )
    row = conn.execute(
        sa.select(conversations.c.title)
        .where(conversations.c.workspace_id == workspace_id)
        .where(conversations.c.id == conversation_id)
    ).first()
    values: dict[str, Any] = {"last_user_text": text[:400]}
    if row is not None and not row.title:
        values["title"] = _title_from(text)
    touch(conn, workspace_id, conversation_id, **values)
    append_event(conn, workspace_id, conversation_id, "turn.accepted", {"seq": seq, "text": text},
                 turn=turn_id)
    append_event(conn, workspace_id, conversation_id, "message.started",
                 {"message": message_id, "role": "user", "seq": seq}, turn=turn_id)
    if "title" in values:
        append_event(conn, workspace_id, conversation_id, "conversation.updated",
                     {"title": values["title"]})
    return {"id": turn_id, "seq": seq, "status": "queued"}


def _title_from(text: str) -> str:
    words = " ".join(text.split())
    if len(words) <= TITLE_CHARS:
        return words
    cut = words[:TITLE_CHARS]
    return cut[: cut.rfind(" ")] if " " in cut else cut


def set_turn(conn: Connection, workspace_id: str, turn_id: str, **values: Any) -> None:
    conn.execute(
        turns.update().where(turns.c.workspace_id == workspace_id).where(turns.c.id == turn_id)
        .values(**values)
    )


def add_assistant_message(
    conn: Connection, workspace_id: str, conversation_id: str, turn_id: str, run_id: str
) -> dict[str, Any]:
    seq = _next_seq(conn, workspace_id, conversation_id)
    message_id = new_id()
    conn.execute(
        messages.insert().values(
            workspace_id=workspace_id, id=message_id, conversation_id=conversation_id, seq=seq,
            role="assistant", turn_id=turn_id, run_id=run_id, content="", status="streaming",
            meta={}, created_at=db_now(conn),
        )
    )
    return {"id": message_id, "seq": seq}


def finish_message(
    conn: Connection, workspace_id: str, message_id: str, content: str, status: str,
    revision: str | None, meta: dict,
) -> None:
    conn.execute(
        messages.update()
        .where(messages.c.workspace_id == workspace_id)
        .where(messages.c.id == message_id)
        .values(content=content, status=status, revision=revision, meta=meta)
    )


def history(
    conn: Connection, workspace_id: str, conversation_id: str, before_seq: int, limit: int = 20
) -> list[dict[str, Any]]:
    """The conversation so far for the model: the newest `limit` messages, oldest first, each
    with the short note of tool work its answer kept (so "add two more" knows what "more" is)."""
    rows = conn.execute(
        sa.select(messages)
        .where(messages.c.workspace_id == workspace_id)
        .where(messages.c.conversation_id == conversation_id)
        .where(messages.c.seq < before_seq)
        .where(messages.c.role.in_(("user", "assistant")))
        .order_by(messages.c.seq.desc())
        .limit(limit)
    ).all()
    return [
        {"role": row.role, "content": row.content, "meta": row.meta or {}}
        for row in reversed(rows)
    ]


def snapshot_messages(
    conn: Connection, workspace_id: str, conversation_id: str
) -> list[dict[str, Any]]:
    rows = conn.execute(
        sa.select(messages)
        .where(messages.c.workspace_id == workspace_id)
        .where(messages.c.conversation_id == conversation_id)
        .order_by(messages.c.seq)
    ).all()
    return [
        {
            "id": row.id, "seq": int(row.seq), "role": row.role, "turn": row.turn_id,
            "run": row.run_id, "content": row.content, "status": row.status,
            "revision": row.revision, "meta": {}, "created_at": iso(row.created_at),
        }
        for row in rows
    ]


def last_run(conn: Connection, workspace_id: str, conversation_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        sa.select(turns)
        .where(turns.c.workspace_id == workspace_id)
        .where(turns.c.conversation_id == conversation_id)
        .where(turns.c.run_id.is_not(None))
        .order_by(turns.c.seq.desc())
    ).first()
    if row is None:
        return None
    state = {
        "queued": "interpreting", "running": "streaming", "stopping": "streaming",
    }.get(row.status, row.status)
    return {"id": row.run_id, "turn": row.id, "state": state, "cycles": 0, "steps": 0,
            "limits": {}, "usage": {}, "error": None}


# Proposals ---------------------------------------------------------------------------------


def proposal_of(conn: Connection, workspace_id: str, conversation_id: str) -> str | None:
    """A conversation has one proposal, named by the conversation itself, once Lucy made one."""
    found = conn.execute(
        sa.select(proposals.c.id)
        .where(proposals.c.workspace_id == workspace_id)
        .where(proposals.c.conversation_id == conversation_id)
        .limit(1)
    ).first()
    return conversation_id if found is not None else None


__all__ = [
    "EVENT_SCHEMA",
    "NotFound",
    "add_assistant_message",
    "add_turn",
    "append_event",
    "conversation_row",
    "create_conversation",
    "delete_conversation",
    "events_after",
    "finish_message",
    "get_conversation",
    "history",
    "list_conversations",
    "snapshot_messages",
    "update_conversation",
]
