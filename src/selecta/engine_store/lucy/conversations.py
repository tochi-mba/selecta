"""Lucy's conversations, messages, turns and runs through the store.

Each function is what `lucy.conversations` (or `lucy.agent` for a run) does on its old path, in
the same order, so ids and times come out the same; the caller decides the transaction.
"""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa

from selecta.engine_store.lucy import Tx
from selecta.engine_store.lucy import events as log
from selecta.engine_store.schema import (
    lucy_conversations,
    lucy_memory,
    lucy_messages,
    lucy_permissions,
    lucy_proposals,
    lucy_revisions,
    lucy_runs,
    lucy_turns,
)
from selecta.lucy import ids

TERMINAL = ("completed", "failed", "cancelled", "interrupted", "superseded")


def row(tx: Tx, conversation: str):
    return tx.row(lucy_conversations, id=conversation)


def last_user_text(tx: Tx, conversation: str) -> str | None:
    return tx.scalar(
        sa.select(lucy_messages.c.content)
        .where(tx.where(lucy_messages, conversation_id=conversation, role="user"))
        .order_by(lucy_messages.c.seq.desc())
        .limit(1)
    )


def create(tx: Tx, conversation: str, title: str, scope: dict | None) -> None:
    stamp = ids.now_iso()
    tx.insert(
        lucy_conversations,
        id=conversation,
        title=title,
        scope=json.dumps(scope or {}),
        created_at=stamp,
        updated_at=stamp,
    )


def listing(tx: Tx, query: str, archived: bool, limit: int) -> list[str]:
    c, m = lucy_conversations, lucy_messages
    where = [tx.where(c, archived=1 if archived else 0)]
    if query.strip():
        like = f"%{query.strip()}%"
        said = sa.exists().where(m.c.conversation_id == c.c.id, m.c.content.like(like),
                                 tx.store.mine(m))
        where.append(sa.or_(c.c.title.like(like), said))
    statement = sa.select(c.c.id).where(*where).order_by(c.c.updated_at.desc()).limit(limit)
    return [found for found in tx.connection.execute(statement).scalars()]


def update(tx: Tx, conversation: str, **values: Any) -> None:
    tx.update(lucy_conversations, {"id": conversation}, **values)


def delete(tx: Tx, conversation: str) -> None:
    """The chat and everything only it holds. The old path's foreign keys cascade the same rows;
    here each is named."""
    from selecta.engine_store.schema import lucy_events

    tx.delete(lucy_events, conversation_id=conversation)
    tx.delete(lucy_permissions, conversation_id=conversation)
    tx.delete(lucy_memory, conversation_id=conversation, kind="session")
    tx.delete(lucy_runs, conversation_id=conversation)
    tx.delete(lucy_turns, conversation_id=conversation)
    tx.delete(lucy_messages, conversation_id=conversation)
    proposals = sa.select(lucy_proposals.c.id).where(
        tx.where(lucy_proposals, conversation_id=conversation)
    )
    tx.delete(lucy_revisions, lucy_revisions.c.proposal_id.in_(proposals))
    tx.delete(lucy_proposals, conversation_id=conversation)
    tx.delete(lucy_conversations, id=conversation)


def next_seq(tx: Tx, conversation: str) -> int:
    seq = tx.scalar(
        sa.select(lucy_conversations.c.next_seq).where(tx.where(lucy_conversations,
                                                                id=conversation))
    )
    tx.update(lucy_conversations, {"id": conversation},
              next_seq=lucy_conversations.c.next_seq + 1)
    return int(seq)


def add_message(
    tx: Tx,
    conversation: str,
    role: str,
    content: str,
    *,
    status: str,
    turn: str | None,
    run: str | None,
    revision: str | None,
    meta: dict | None,
) -> str:
    """One message at the next number, the conversation touched (`conversations.add_message`)."""
    message = ids.new_id("message")
    seq = next_seq(tx, conversation)
    tx.insert(
        lucy_messages,
        id=message,
        conversation_id=conversation,
        seq=seq,
        role=role,
        turn_id=turn,
        run_id=run,
        content=content,
        status=status,
        revision_id=revision,
        meta=json.dumps(meta or {}),
        created_at=ids.now_iso(),
    )
    update(tx, conversation, updated_at=ids.now_iso())
    return message


def message(tx: Tx, message_id: str):
    return tx.row(lucy_messages, id=message_id)


def messages(tx: Tx, conversation: str, through: int | None = None) -> list:
    where = [tx.where(lucy_messages, conversation_id=conversation)]
    if through is not None:
        where.append(lucy_messages.c.seq <= through)
    return tx.all(sa.select(lucy_messages).where(*where).order_by(lucy_messages.c.seq))


def finish_message(tx: Tx, message_id: str, **values: Any) -> None:
    if "revision_id" in values:
        values["revision_id"] = sa.func.coalesce(values["revision_id"],
                                                 lucy_messages.c.revision_id)
    tx.update(lucy_messages, {"id": message_id}, **values)


def latest_revision_through(tx: Tx, conversation: str, seq: int) -> str | None:
    """The newest proposal revision a message up to `seq` was about (a branch's starting point)."""
    m = lucy_messages
    return tx.scalar(
        sa.select(m.c.revision_id)
        .where(tx.where(m, conversation_id=conversation), m.c.seq <= seq,
               m.c.revision_id.is_not(None))
        .order_by(m.c.seq.desc())
        .limit(1)
    )


# ---- turns


def turn(tx: Tx, turn_id: str):
    return tx.row(lucy_turns, id=turn_id)


def turn_by_client(tx: Tx, conversation: str, client_id: str):
    return tx.row(lucy_turns, conversation_id=conversation, client_id=client_id)


def accept_turn(
    tx: Tx,
    conversation: str,
    client_id: str,
    clean: str,
    title: str,
    expected_revision: str | None,
    selection: dict | None,
) -> tuple[str, bool]:
    """The turn, its user message, the older turns superseded, the title, and their events: one
    write (`conversations.accept_turn`). Returns the turn and whether the title changed."""
    waiting = lucy_turns.c.status.in_(("queued", "running"))
    older = [
        found
        for found in tx.connection.execute(
            sa.select(lucy_turns.c.id).where(tx.where(lucy_turns, conversation_id=conversation),
                                             waiting)
        ).scalars()
    ]
    for found in older:
        tx.update(lucy_turns, {"id": found}, status="superseded")
    turn_id = ids.new_id("turn")
    seq = next_seq(tx, conversation)
    tx.insert(
        lucy_turns,
        id=turn_id,
        conversation_id=conversation,
        client_id=client_id,
        seq=seq,
        text=clean,
        expected_revision=expected_revision,
        selection=json.dumps(selection or {}),
        status="queued",
        created_at=ids.now_iso(),
    )
    tx.insert(
        lucy_messages,
        id=ids.new_id("message"),
        conversation_id=conversation,
        seq=next_seq(tx, conversation),
        role="user",
        turn_id=turn_id,
        content=clean,
        status="complete",
        meta=json.dumps({"selection": selection or {}, "expected_revision": expected_revision}),
        created_at=ids.now_iso(),
    )
    retitled = row(tx, conversation)["title"] == "New conversation"
    if retitled:
        update(tx, conversation, title=title)
    update(tx, conversation, updated_at=ids.now_iso())
    if retitled:
        log.append(tx, conversation, "conversation.updated", {"title": title})
    for found in older:
        log.append(tx, conversation, "turn.superseded", {"by": turn_id}, turn=found)
    log.append(tx, conversation, "turn.accepted", {"text": clean, "seq": seq}, turn=turn_id)
    return turn_id, retitled


def set_turn_status(tx: Tx, turn_id: str, status: str) -> None:
    tx.run(
        sa.update(lucy_turns)
        .where(tx.where(lucy_turns, id=turn_id), lucy_turns.c.status.not_in(("superseded",)))
        .values(status=status)
    )


def latest_turn(tx: Tx, conversation: str) -> str | None:
    return tx.scalar(
        sa.select(lucy_turns.c.id)
        .where(tx.where(lucy_turns, conversation_id=conversation))
        .order_by(lucy_turns.c.seq.desc())
        .limit(1)
    )


# ---- runs


def latest_run(tx: Tx, **equals: Any):
    """The newest run of a conversation or a turn."""
    return tx.one(
        sa.select(lucy_runs).where(tx.where(lucy_runs, **equals))
        .order_by(lucy_runs.c.started_at.desc()).limit(1)
    )


def attempts(tx: Tx, turn_id: str) -> int:
    return int(tx.scalar(sa.select(sa.func.count()).where(tx.where(lucy_runs, turn_id=turn_id))))


def add_run(tx: Tx, run: str, turn_id: str, conversation: str, attempt: int, provider: str,
            limits: dict) -> None:
    tx.insert(
        lucy_runs,
        id=run,
        turn_id=turn_id,
        conversation_id=conversation,
        attempt=attempt,
        state="queued",
        provider=provider,
        limits=json.dumps(limits),
        started_at=ids.now_iso(),
    )


def set_run(tx: Tx, run: str, **values: Any) -> None:
    for name in ("error", "ended_at"):
        if name in values:
            values[name] = sa.func.coalesce(values[name], lucy_runs.c[name])
    tx.update(lucy_runs, {"id": run}, **values)


def recover(tx: Tx) -> int:
    """After a restart nothing is running: each unfinished run, its streaming reply and its
    turn say so, with the event, in one write (`agent.recover`)."""
    stuck = tx.all(
        sa.select(lucy_runs.c.id, lucy_runs.c.conversation_id, lucy_runs.c.turn_id).where(
            tx.store.mine(lucy_runs), lucy_runs.c.state.not_in(TERMINAL)
        )
    )
    for found in stuck:
        tx.update(lucy_runs, {"id": found["id"]}, state="interrupted", ended_at=ids.now_iso())
        tx.update(lucy_messages, {"run_id": found["id"], "status": "streaming"},
                  status="interrupted")
        tx.run(
            sa.update(lucy_turns)
            .where(tx.where(lucy_turns, id=found["turn_id"]),
                   lucy_turns.c.status.in_(("queued", "running")))
            .values(status="interrupted")
        )
        log.append(
            tx,
            found["conversation_id"],
            "run.state",
            {
                "state": "interrupted",
                "cycles": 0,
                "steps": 0,
                "error": "SelectaDJ restarted while Lucy was working.",
            },
            turn=found["turn_id"],
            run=found["id"],
        )
    return len(stuck)


def recent_runs(tx: Tx, limit: int) -> list:
    """Run traces for diagnostics: no message text."""
    r = lucy_runs.c
    columns = (r.id, r.conversation_id, r.state, r.provider, r.cycles, r.steps, r.tokens_in,
               r.tokens_out, r.usage, r.error, r.started_at, r.ended_at)
    return tx.all(sa.select(*columns).where(tx.store.mine(lucy_runs))
                  .order_by(r.started_at.desc()).limit(limit))


__all__ = [
    "accept_turn",
    "add_message",
    "add_run",
    "attempts",
    "create",
    "delete",
    "finish_message",
    "last_user_text",
    "latest_revision_through",
    "latest_run",
    "latest_turn",
    "listing",
    "message",
    "messages",
    "next_seq",
    "recent_runs",
    "recover",
    "row",
    "set_run",
    "set_turn_status",
    "turn",
    "turn_by_client",
    "update",
]
