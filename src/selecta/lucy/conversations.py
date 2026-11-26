"""Durable conversations, messages and turns (ADR-0302, LU-302-01..08).

A conversation outlives route changes, reloads and server restarts. The server's sequence number,
not arrival order at the browser, decides message order; the same send arriving twice (a lost
answer, a double tap, a second tab) is recognised by its client id and answered once. Deleting a
conversation never touches a draft or a mix it produced.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from selecta.engine_store.lucy import conversations as stored
from selecta.lucy import backing, events
from selecta.lucy.ids import new_id, now_iso

TITLE_LIMIT = 80
TEXT_LIMIT = 4000
ROLES = {"user", "assistant", "notice"}
MESSAGE_STATES = {"streaming", "complete", "interrupted", "cancelled", "failed"}


class NotFound(KeyError):
    """That conversation, message or turn isn't there (any more)."""


def _clean_title(text: str) -> str:
    single = " ".join(text.split())
    return single[:TITLE_LIMIT].strip() or "New conversation"


def create(conn: sqlite3.Connection, title: str = "", scope: dict | None = None) -> dict:
    conversation = new_id("conversation")
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            stored.create(tx, conversation, _clean_title(title), scope)
        return get(conn, conversation)
    stamp = now_iso()
    conn.execute(
        "INSERT INTO lucy_conversations(id,title,scope,created_at,updated_at) VALUES(?,?,?,?,?)",
        (conversation, _clean_title(title), json.dumps(scope or {}), stamp, stamp),
    )
    conn.commit()
    return get(conn, conversation)


def _row(conn: sqlite3.Connection, conversation: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM lucy_conversations WHERE id=?", (conversation,)).fetchone()
    if row is None:
        raise NotFound(conversation)
    return row


def _found(row: Any, conversation: str) -> Any:
    if row is None:
        raise NotFound(conversation)
    return row


def get(conn: sqlite3.Connection, conversation: str) -> dict:
    store = backing.store_of(conn)
    if store is not None:
        with backing.reading(store) as tx:
            row = _found(stored.row(tx, conversation), conversation)
            text = stored.last_user_text(tx, conversation)
        return _shaped(row, text)
    row = _row(conn, conversation)
    last = conn.execute(
        "SELECT content FROM lucy_messages WHERE conversation_id=? AND role='user' "
        "ORDER BY seq DESC LIMIT 1",
        (conversation,),
    ).fetchone()
    return _shaped(row, last["content"] if last else None)


COLUMNS = ("scope", "proposal_id")


def column(conn: sqlite3.Connection, conversation: str, name: str) -> Any:
    """One stored value of a conversation (`scope` as its JSON text), or None when the
    conversation isn't there."""
    if name not in COLUMNS:
        raise ValueError(name)
    store = backing.store_of(conn)
    if store is not None:
        with backing.reading(store) as tx:
            row = stored.row(tx, conversation)
        return None if row is None else row[name]
    row = conn.execute(
        f"SELECT {name} FROM lucy_conversations WHERE id=?", (conversation,)  # noqa: S608
    ).fetchone()
    return None if row is None else row[name]


def _shaped(row: Any, last: str | None) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "scope": json.loads(row["scope"]),
        "proposal_id": row["proposal_id"],
        "parent_id": row["parent_id"],
        "branched_from": row["branched_from"],
        "archived": bool(row["archived"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "last_user_text": (last[:140] if last is not None else None),
    }


def listing(
    conn: sqlite3.Connection, query: str = "", archived: bool = False, limit: int = 50
) -> list[dict]:
    """Searchable history by title and message text, newest first (LU-302-04)."""
    store = backing.store_of(conn)
    if store is not None:
        with backing.reading(store) as tx:
            found = stored.listing(tx, query, archived, max(1, min(limit, 200)))
        return [get(conn, conversation) for conversation in found]
    params: list[Any] = [1 if archived else 0]
    sql = "SELECT c.id FROM lucy_conversations c WHERE c.archived=?"
    if query.strip():
        like = f"%{query.strip()}%"
        sql += (
            " AND (c.title LIKE ? OR EXISTS (SELECT 1 FROM lucy_messages m WHERE "
            "m.conversation_id=c.id AND m.content LIKE ?))"
        )
        params += [like, like]
    sql += " ORDER BY c.updated_at DESC LIMIT ?"
    params.append(max(1, min(limit, 200)))
    return [get(conn, row["id"]) for row in conn.execute(sql, params)]


def rename(conn: sqlite3.Connection, conversation: str, title: str) -> dict:
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            _found(stored.row(tx, conversation), conversation)
            stored.update(tx, conversation, title=_clean_title(title), updated_at=now_iso())
            stored.log.append(tx, conversation, "conversation.updated",
                              {"title": _clean_title(title)})
        return get(conn, conversation)
    _row(conn, conversation)
    conn.execute(
        "UPDATE lucy_conversations SET title=?, updated_at=? WHERE id=?",
        (_clean_title(title), now_iso(), conversation),
    )
    conn.commit()
    events.append(conn, conversation, "conversation.updated", {"title": _clean_title(title)})
    return get(conn, conversation)


def set_archived(conn: sqlite3.Connection, conversation: str, archived: bool) -> dict:
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            _found(stored.row(tx, conversation), conversation)
            stored.update(tx, conversation, archived=1 if archived else 0, updated_at=now_iso())
        return get(conn, conversation)
    _row(conn, conversation)
    conn.execute(
        "UPDATE lucy_conversations SET archived=?, updated_at=? WHERE id=?",
        (1 if archived else 0, now_iso(), conversation),
    )
    conn.commit()
    return get(conn, conversation)


def delete(conn: sqlite3.Connection, conversation: str) -> dict:
    """The chat, its proposals and its events go. Drafts it built, and the mix, stay (LU-302-07).

    Commit records are kept: they're the receipt that a draft came from an approval, and they
    answer a retried approval truthfully even after the chat is gone.
    """
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            row = _found(stored.row(tx, conversation), conversation)
            stored.delete(tx, conversation)
        return {"deleted": row["id"], "drafts_kept": True}
    row = _row(conn, conversation)
    conn.execute("DELETE FROM lucy_events WHERE conversation_id=?", (conversation,))
    conn.execute("DELETE FROM lucy_permissions WHERE conversation_id=?", (conversation,))
    conn.execute(
        "DELETE FROM lucy_memory WHERE conversation_id=? AND kind='session'", (conversation,)
    )
    conn.execute("DELETE FROM lucy_conversations WHERE id=?", (conversation,))
    conn.commit()
    return {"deleted": row["id"], "drafts_kept": True}


def touch(conn: sqlite3.Connection, conversation: str) -> None:
    conn.execute(
        "UPDATE lucy_conversations SET updated_at=? WHERE id=?", (now_iso(), conversation)
    )


def _next_seq(conn: sqlite3.Connection, conversation: str) -> int:
    row = _row(conn, conversation)
    conn.execute(
        "UPDATE lucy_conversations SET next_seq=next_seq+1 WHERE id=?", (conversation,)
    )
    return int(row["next_seq"])


def add_message(
    conn: sqlite3.Connection,
    conversation: str,
    role: str,
    content: str = "",
    *,
    status: str = "complete",
    turn: str | None = None,
    run: str | None = None,
    revision: str | None = None,
    meta: dict | None = None,
) -> dict:
    if role not in ROLES or status not in MESSAGE_STATES:
        raise ValueError("Unknown message role or state.")
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            _found(stored.row(tx, conversation), conversation)
            message = stored.add_message(tx, conversation, role, content, status=status,
                                         turn=turn, run=run, revision=revision, meta=meta)
            return _message(stored.message(tx, message))
    message = new_id("message")
    seq = _next_seq(conn, conversation)
    conn.execute(
        "INSERT INTO lucy_messages(id,conversation_id,seq,role,turn_id,run_id,content,status,"
        "revision_id,meta,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (
            message,
            conversation,
            seq,
            role,
            turn,
            run,
            content,
            status,
            revision,
            json.dumps(meta or {}),
            now_iso(),
        ),
    )
    touch(conn, conversation)
    conn.commit()
    return message_by_id(conn, message)


def message_by_id(conn: sqlite3.Connection, message: str) -> dict:
    store = backing.store_of(conn)
    if store is not None:
        with backing.reading(store) as tx:
            return _message(_found(stored.message(tx, message), message))
    row = conn.execute("SELECT * FROM lucy_messages WHERE id=?", (message,)).fetchone()
    if row is None:
        raise NotFound(message)
    return _message(row)


def _message(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "seq": row["seq"],
        "role": row["role"],
        "turn": row["turn_id"],
        "run": row["run_id"],
        "content": row["content"],
        "status": row["status"],
        "revision": row["revision_id"],
        "meta": json.loads(row["meta"]),
        "created_at": row["created_at"],
    }


def finish_message(
    conn: sqlite3.Connection,
    message: str,
    content: str,
    status: str = "complete",
    meta: dict | None = None,
    revision: str | None = None,
) -> None:
    if status not in MESSAGE_STATES:
        raise ValueError(status)
    store = backing.store_of(conn)
    if store is not None:
        values = {"content": content, "status": status, "revision_id": revision}
        if meta is not None:
            values["meta"] = json.dumps(meta)
        with backing.writing(store) as tx:
            stored.finish_message(tx, message, **values)
        return
    if meta is None:
        conn.execute(
            "UPDATE lucy_messages SET content=?, status=?, revision_id=coalesce(?,revision_id) "
            "WHERE id=?",
            (content, status, revision, message),
        )
    else:
        conn.execute(
            "UPDATE lucy_messages SET content=?, status=?, meta=?, "
            "revision_id=coalesce(?,revision_id) WHERE id=?",
            (content, status, json.dumps(meta), revision, message),
        )
    conn.commit()


def messages(conn: sqlite3.Connection, conversation: str) -> list[dict]:
    store = backing.store_of(conn)
    if store is not None:
        with backing.reading(store) as tx:
            return [_message(row) for row in stored.messages(tx, conversation)]
    rows = conn.execute(
        "SELECT * FROM lucy_messages WHERE conversation_id=? ORDER BY seq", (conversation,)
    )
    return [_message(row) for row in rows]


def accept_turn(
    conn: sqlite3.Connection,
    conversation: str,
    client_id: str,
    text: str,
    expected_revision: str | None = None,
    selection: dict | None = None,
) -> tuple[dict, bool]:
    """Record what the person sent, once. Returns the turn and whether it is new.

    The order is the server's sequence. A newer turn supersedes any turn still queued or running
    in this conversation, so an older result can't publish over newer feedback (LU-302-02,
    LU-311-05).
    """
    clean = text.strip()
    if not clean:
        raise ValueError("Write something for Lucy first.")
    if len(clean) > TEXT_LIMIT:
        raise ValueError(f"Keep a message under {TEXT_LIMIT} characters.")
    if not client_id or len(client_id) > 80:
        raise ValueError("A send needs a client id so it can't be done twice.")
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            known = stored.turn_by_client(tx, conversation, client_id)
            if known is not None:
                return _turn(known), False
            _found(stored.row(tx, conversation), conversation)
            turn, _ = stored.accept_turn(tx, conversation, client_id, clean, _clean_title(clean),
                                         expected_revision, selection)
            return _turn(stored.turn(tx, turn)), True
    known = conn.execute(
        "SELECT * FROM lucy_turns WHERE conversation_id=? AND client_id=?",
        (conversation, client_id),
    ).fetchone()
    if known is not None:
        return _turn(known), False
    _row(conn, conversation)
    if conn.in_transaction:
        conn.commit()
    conn.execute("BEGIN IMMEDIATE")
    try:
        older = conn.execute(
            "SELECT id FROM lucy_turns WHERE conversation_id=? AND status IN ('queued','running')",
            (conversation,),
        ).fetchall()
        for row in older:
            conn.execute("UPDATE lucy_turns SET status='superseded' WHERE id=?", (row["id"],))
        turn = new_id("turn")
        seq = _next_seq(conn, conversation)
        conn.execute(
            "INSERT INTO lucy_turns(id,conversation_id,client_id,seq,text,expected_revision,"
            "selection,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (
                turn,
                conversation,
                client_id,
                seq,
                clean,
                expected_revision,
                json.dumps(selection or {}),
                "queued",
                now_iso(),
            ),
        )
        conn.execute(
            "INSERT INTO lucy_messages(id,conversation_id,seq,role,turn_id,content,status,meta,"
            "created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (
                new_id("message"),
                conversation,
                _next_seq(conn, conversation),
                "user",
                turn,
                clean,
                "complete",
                json.dumps({"selection": selection or {}, "expected_revision": expected_revision}),
                now_iso(),
            ),
        )
        title = _row(conn, conversation)["title"]
        retitled = title == "New conversation"
        if retitled:
            conn.execute(
                "UPDATE lucy_conversations SET title=? WHERE id=?",
                (_clean_title(clean), conversation),
            )
        touch(conn, conversation)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    if retitled:
        events.append(conn, conversation, "conversation.updated", {"title": _clean_title(clean)})
    for row in older:
        events.append(conn, conversation, "turn.superseded", {"by": turn}, turn=row["id"])
    found = conn.execute("SELECT * FROM lucy_turns WHERE id=?", (turn,)).fetchone()
    shaped = _turn(found)
    events.append(
        conn, conversation, "turn.accepted", {"text": clean, "seq": shaped["seq"]}, turn=turn
    )
    return shaped, True


def _turn(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "conversation": row["conversation_id"],
        "client_id": row["client_id"],
        "seq": row["seq"],
        "text": row["text"],
        "expected_revision": row["expected_revision"],
        "selection": json.loads(row["selection"]),
        "status": row["status"],
    }


def turn_by_id(conn: sqlite3.Connection, turn: str) -> dict:
    store = backing.store_of(conn)
    if store is not None:
        with backing.reading(store) as tx:
            return _turn(_found(stored.turn(tx, turn), turn))
    row = conn.execute("SELECT * FROM lucy_turns WHERE id=?", (turn,)).fetchone()
    if row is None:
        raise NotFound(turn)
    return _turn(row)


def set_turn_status(conn: sqlite3.Connection, turn: str, status: str) -> None:
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            stored.set_turn_status(tx, turn, status)
        return
    conn.execute(
        "UPDATE lucy_turns SET status=? WHERE id=? AND status NOT IN ('superseded')",
        (status, turn),
    )
    conn.commit()


def is_superseded(conn: sqlite3.Connection, turn: str) -> bool:
    store = backing.store_of(conn)
    if store is not None:
        with backing.reading(store) as tx:
            row = stored.turn(tx, turn)
        return row is None or row["status"] in {"superseded", "cancelled"}
    row = conn.execute("SELECT status FROM lucy_turns WHERE id=?", (turn,)).fetchone()
    return row is None or row["status"] in {"superseded", "cancelled"}


def branch(conn: sqlite3.Connection, conversation: str, at_message: str) -> dict:
    """A new conversation holding copies of the messages up to one point. The original, its
    messages and its proposal snapshots are untouched (LU-302-06)."""
    store = backing.store_of(conn)
    if store is not None:
        with backing.writing(store) as tx:
            created = _branched(tx, conversation, at_message)
        return get(conn, created)
    source = _row(conn, conversation)
    cut = conn.execute(
        "SELECT seq FROM lucy_messages WHERE id=? AND conversation_id=?",
        (at_message, conversation),
    ).fetchone()
    if cut is None:
        raise NotFound(at_message)
    created = create(conn, f"{source['title']} (branch)", json.loads(source["scope"]))
    conn.execute(
        "UPDATE lucy_conversations SET parent_id=?, branched_from=? WHERE id=?",
        (conversation, at_message, created["id"]),
    )
    rows = conn.execute(
        "SELECT * FROM lucy_messages WHERE conversation_id=? AND seq<=? ORDER BY seq",
        (conversation, cut["seq"]),
    ).fetchall()
    for row in rows:
        add_message(
            conn,
            created["id"],
            row["role"],
            row["content"],
            status=row["status"] if row["status"] != "streaming" else "interrupted",
            revision=row["revision_id"],
            meta={**json.loads(row["meta"]), "copied_from": row["id"]},
        )
    conn.commit()
    return get(conn, created["id"])


def _branched(tx: Any, conversation: str, at_message: str) -> str:
    """`branch` as one store write, in the old path's order."""
    source = _found(stored.row(tx, conversation), conversation)
    cut = stored.message(tx, at_message)
    if cut is None or cut["conversation_id"] != conversation:
        raise NotFound(at_message)
    created = new_id("conversation")
    stored.create(tx, created, _clean_title(f"{source['title']} (branch)"),
                  json.loads(source["scope"]))
    stored.update(tx, created, parent_id=conversation, branched_from=at_message)
    for row in stored.messages(tx, conversation, through=cut["seq"]):
        stored.add_message(
            tx,
            created,
            row["role"],
            row["content"],
            status=row["status"] if row["status"] != "streaming" else "interrupted",
            turn=None,
            run=None,
            revision=row["revision_id"],
            meta={**json.loads(row["meta"]), "copied_from": row["id"]},
        )
    return created
