"""Exact approval and durable, idempotent commits (ADR-0326, LU-326-01..08, LU-334-03).

Approval is a host-issued token bound to one immutable revision, its hash and one action; only
the person's click in the app asks for it, and no tool can. Committing re-checks everything
under a write lock, builds a NEW draft from the revision's frozen order and seam settings (never
a fresh plan), and records the outcome under the client's idempotency key, so a retried click or
a lost answer gets the original result instead of a second draft. "Save and play" is a separate
action that also needs explicit confirmation; plain saving never touches what's playing.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from typing import Any

from selecta import mix
from selecta.lucy import catalog, events, planning, proposals, readiness
from selecta.lucy import settings as lucy_settings
from selecta.lucy.ids import now_iso
from selecta.lucy.intent import Constraint
from selecta.seam_kinds import request_from

APPROVAL_SECONDS = 600
ACTIONS = {"draft", "draft_and_play"}
RECONCILE_AFTER_SECONDS = 30


class CommitError(Exception):
    def __init__(self, message: str, code: str, status: int = 409) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def _conversation_of(conn: sqlite3.Connection, revision: dict) -> str | None:
    row = conn.execute(
        "SELECT conversation_id FROM lucy_proposals WHERE id=?", (revision["proposal"],)
    ).fetchone()
    return row["conversation_id"] if row else None


def preflight(conn: sqlite3.Connection, app: Any, revision: dict) -> dict:
    """Everything checked fresh: songs still mix-ready, hard rules still met, hash intact, and
    for ready-only, every clip still on disk and playable as approved (LU-326-03, LU-319-06)."""
    snap = revision["snapshot"]
    problems: list[str] = []
    if proposals.snapshot_hash(snap) != revision["hash"]:
        problems.append("This revision doesn't match its record, so it can't be approved.")
    lib = catalog.load(conn, app)
    rules = [Constraint.from_dict(rule) for rule in snap["constraints"]]
    fresh = {key: value for key, value in snap.items()}
    inv = readiness.inventory(conn, app.store, lib.songs, fresh=bool(snap.get("ready_only")))
    planning.evaluate(lib, fresh, app.store, inv)
    problems += planning.validate(lib, fresh, rules, app.store, inv)
    if snap.get("ready_only"):
        problems += readiness.revalidate(conn, app.store, snap, lib.songs)
    found = readiness.ledger(conn, app.store, snap, lib.songs)
    if not snap["songs"]:
        problems.append("There are no songs to save.")
    return {
        "ok": not problems,
        "problems": list(dict.fromkeys(problems)),
        "songs": len(snap["songs"]),
        "ready": found["ready"],
        "needed": found["needed"],
        "ready_only": bool(snap.get("ready_only")),
        "playable_now": found["playable_now"],
        "title": snap["title"],
    }


def issue(conn: sqlite3.Connection, app: Any, revision_id: str, digest: str, action: str) -> dict:
    config = lucy_settings.get(conn)
    if not config["enabled"]:
        raise CommitError("Lucy is turned off.", "lucy_off", 403)
    if not config["phases"]["commit"]:
        raise CommitError("Saving from Lucy is turned off in Lucy’s settings.", "phase_off", 403)
    if action not in ACTIONS:
        raise CommitError("Choose to save as a draft, or to save and play.", "bad_action", 400)
    revision = proposals.get_revision(conn, revision_id)
    current = conn.execute(
        "SELECT current_revision FROM lucy_proposals WHERE id=?", (revision["proposal"],)
    ).fetchone()
    if current is None or current["current_revision"] != revision_id:
        raise CommitError(
            "Only the current revision can be approved. Make this one current first.", "not_current"
        )
    if digest != revision["hash"]:
        raise CommitError("This revision changed since you looked at it.", "stale_revision")
    checked = preflight(conn, app, revision)
    token = secrets.token_urlsafe(24)
    expires = int(time.time()) + APPROVAL_SECONDS
    conn.execute(
        "INSERT INTO lucy_approvals(token,revision_id,hash,action,expires_at,created_at) "
        "VALUES(?,?,?,?,?,?)",
        (token, revision_id, digest, action, expires, now_iso()),
    )
    conn.commit()
    return {"token": token, "expires_at": expires, "action": action, "preflight": checked}


def _shape(row: sqlite3.Row, repeat: bool) -> dict:
    result = json.loads(row["result"])
    return {
        "key": row["idempotency_key"],
        "status": row["status"],
        "draft_id": row["draft_id"],
        "name": result.get("name"),
        "played": bool(result.get("played")),
        "current": bool(result.get("played")),
        "repeat": repeat,
        "problems": result.get("problems", []),
        "revision": row["revision_id"],
        "action": row["action"],
    }


def _items_of(snap: dict) -> list[tuple[int, str | None, int]]:
    """The draft's rows: each song with the seam that leads INTO it, exactly as reviewed."""
    items: list[tuple[int, str | None, int]] = []
    for index, song in enumerate(snap["songs"]):
        seam = None
        if index:
            settings = snap["seams"][index - 1].get("settings") or {}
            expected = snap["seams"][index - 1]["key"]
            if (
                request_from(snap["songs"][index - 1]["song_id"], song["song_id"], settings).key
                != expected
            ):
                raise CommitError(
                    "A transition's settings don't match what was reviewed.", "seam_mismatch"
                )
            seam = json.dumps(settings) if settings else None
        items.append((song["song_id"], seam, 1 if song.get("locked") else 0))
    return items


def commit(
    conn: sqlite3.Connection, app: Any, token: str, key: str, confirm_play: bool = False
) -> dict:
    if not key or len(key) > 100:
        raise CommitError("A commit needs an idempotency key.", "bad_key", 400)
    known = conn.execute("SELECT * FROM lucy_commits WHERE idempotency_key=?", (key,)).fetchone()
    if known is not None:
        return _shape(reconcile(conn, known), True)
    approval = conn.execute("SELECT * FROM lucy_approvals WHERE token=?", (token,)).fetchone()
    if approval is None:
        raise CommitError("That approval isn't valid. Approve again.", "bad_token", 403)
    if approval["used"]:
        raise CommitError("That approval was already used.", "used_token", 409)
    if approval["expires_at"] < time.time():
        raise CommitError("That approval expired. Approve again.", "expired_token", 409)
    if approval["action"] == "draft_and_play" and not confirm_play:
        raise CommitError("Playing needs your confirmation too.", "confirm_play", 409)
    revision = proposals.get_revision(conn, approval["revision_id"])
    stamp = now_iso()
    if conn.in_transaction:
        conn.commit()
    conn.execute("BEGIN IMMEDIATE")
    try:
        used = conn.execute(
            "UPDATE lucy_approvals SET used=1 WHERE token=? AND used=0", (token,)
        ).rowcount
        if not used:
            raise CommitError("That approval was already used.", "used_token", 409)
        conn.execute(
            "INSERT INTO lucy_commits(idempotency_key,revision_id,hash,action,status,result,"
            "created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            (
                key,
                revision["id"],
                approval["hash"],
                approval["action"],
                "pending",
                "{}",
                stamp,
                stamp,
            ),
        )
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    conversation = _conversation_of(conn, revision)
    snap = revision["snapshot"]
    checked = preflight(conn, app, revision)
    current = conn.execute(
        "SELECT current_revision FROM lucy_proposals WHERE id=?", (revision["proposal"],)
    ).fetchone()
    if current is None or current["current_revision"] != revision["id"]:
        checked["problems"].append("The proposal moved on to a newer revision.")
    if checked["problems"]:
        return _finish(conn, key, conversation, "failed", None, {"problems": checked["problems"]})
    try:
        items = _items_of(snap)
    except CommitError as problem:
        return _finish(conn, key, conversation, "failed", None, {"problems": [str(problem)]})
    draft = mix.create_draft(conn, snap["title"], items)
    conn.execute(
        "UPDATE drafts SET ready_only=? WHERE id=?", (1 if snap.get("ready_only") else 0, draft)
    )
    conn.commit()
    name = mix.mix_name(conn, draft)
    played = False
    if approval["action"] == "draft_and_play":
        problems = readiness.revalidate(conn, app.store, snap, catalog.load(conn, app).songs)
        if problems:
            return _finish(
                conn,
                key,
                conversation,
                "committed",
                draft,
                {
                    "name": name,
                    "played": False,
                    "problems": ["Saved, but not played: " + problems[0]],
                },
            )
        mix.play_draft(conn, draft)
        played = True
        if hasattr(app, "wake_the_worker"):
            app.wake_the_worker()
    return _finish(
        conn,
        key,
        conversation,
        "committed",
        draft,
        {"name": name, "played": played, "items": [list(i) for i in items]},
    )


def _finish(
    conn, key: str, conversation: str | None, status: str, draft: int | None, result: dict
) -> dict:
    conn.execute(
        "UPDATE lucy_commits SET status=?, draft_id=?, result=?, updated_at=? "
        "WHERE idempotency_key=?",
        (status, draft, json.dumps(result), now_iso(), key),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM lucy_commits WHERE idempotency_key=?", (key,)).fetchone()
    if conversation:
        events.append(
            conn,
            conversation,
            "commit.updated",
            {
                "key": key,
                "status": status,
                "draft_id": draft,
                "name": result.get("name"),
                "played": bool(result.get("played")),
            },
        )
    return _shape(row, False)


def reconcile(conn: sqlite3.Connection, row: sqlite3.Row) -> sqlite3.Row:
    """A commit left pending by a crash: find whether its draft was made before deciding, and
    never assume a failure meant no effect (LU-326-07, LU-334-03)."""
    if row["status"] != "pending":
        return row
    created = row["created_at"]
    from datetime import datetime

    age = time.time() - datetime.fromisoformat(created).timestamp()
    if age < RECONCILE_AFTER_SECONDS:
        return row
    revision = proposals.get_revision(conn, row["revision_id"])
    try:
        wanted = json.dumps([list(item) for item in _items_of(revision["snapshot"])])
    except CommitError:
        wanted = None
    found = (
        conn.execute(
            "SELECT id, name FROM drafts WHERE items=? ORDER BY id DESC LIMIT 1", (wanted,)
        ).fetchone()
        if wanted
        else None
    )
    if found is not None:
        _finish(
            conn,
            row["idempotency_key"],
            None,
            "committed",
            found["id"],
            {"name": found["name"], "played": False, "reconciled": True},
        )
    else:
        _finish(
            conn,
            row["idempotency_key"],
            None,
            "failed",
            None,
            {"problems": ["SelectaDJ stopped before saving; nothing was saved."]},
        )
    return conn.execute(
        "SELECT * FROM lucy_commits WHERE idempotency_key=?", (row["idempotency_key"],)
    ).fetchone()


def status_of(conn: sqlite3.Connection, key: str) -> dict | None:
    row = conn.execute("SELECT * FROM lucy_commits WHERE idempotency_key=?", (key,)).fetchone()
    return None if row is None else _shape(reconcile(conn, row), True)
