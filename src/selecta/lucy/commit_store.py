"""Lucy's approvals and commits through the engine store (docs/engineering/engine-store-lucy.md).

`lucy.commit` holds every rule; this is its path with `core.engine_store` on. Saving a revision
is ONE store write: the approval used, the draft made from the frozen order (through `StoreMixes`
on the same transaction, so playing it writes the mix and its Undo there too), its ready-only
mark, the commit record and its event. What only reads (the fresh preflight, the clips a play
needs) is checked before that write, so the write is short and lands whole or not at all: a
failure part way leaves the approval unused, no draft and no record, and a retry starts clean.
The old path records `pending` first and reconciles after a crash; here nothing is half done.
"""

from __future__ import annotations

import json
import time
from typing import Any

from selecta import mix
from selecta.engine_store import EngineStore
from selecta.engine_store.lucy import events as log
from selecta.engine_store.lucy import proposals as stored
from selecta.engine_store.mixes import StoreMixes
from selecta.lucy import backing, catalog, proposals, readiness
from selecta.lucy.ids import now_iso


def conversation_of(conn: Any, revision: dict) -> str | None:
    try:
        return proposals.conversation_of(conn, revision["proposal"])
    except proposals.NotFound:
        return None


def _event(tx: Any, conversation: str | None, key: str, status: str, draft: int | None,
           result: dict) -> None:
    if conversation:
        log.append(
            tx,
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


def commit(conn: Any, store: EngineStore, app: Any, token: str, key: str,
           confirm_play: bool) -> dict:
    from selecta.lucy.commit import CommitError, _items_of, _shape, preflight

    with backing.reading(store) as tx:
        known = stored.commit_row(tx, key)
        approval = stored.approval(tx, token)
    if known is not None:
        return _shape(reconcile(conn, store, known), True)
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
    conversation = conversation_of(conn, revision)
    snap = revision["snapshot"]
    checked = preflight(conn, app, revision)
    if proposals.current_id(conn, revision["proposal"]) != revision["id"]:
        checked["problems"].append("The proposal moved on to a newer revision.")
    problems = list(checked["problems"])
    items: list = []
    if not problems:
        try:
            items = _items_of(snap)
        except CommitError as problem:
            problems = [str(problem)]
    play = approval["action"] == "draft_and_play" and not problems
    not_played = (
        readiness.revalidate(conn, app.store, snap, catalog.load(conn, app).songs) if play else []
    )
    with backing.writing(store) as tx:
        if stored.commit_row(tx, key) is not None:
            raise CommitError("That approval was already used.", "used_token", 409)
        if not stored.claim(tx, token):
            raise CommitError("That approval was already used.", "used_token", 409)
        draft, status = None, "failed"
        result: dict[str, Any] = {"problems": problems}
        if not problems:
            mixes = StoreMixes(tx.connection, store)
            draft, status = mix.create_draft(mixes, snap["title"], items), "committed"
            stored.set_ready_only(tx, draft, bool(snap.get("ready_only")))
            name = mix.mix_name(mixes, draft)
            if not_played:
                result = {"name": name, "played": False,
                          "problems": ["Saved, but not played: " + not_played[0]]}
            else:
                if play:
                    mix.play_draft(mixes, draft)
                result = {"name": name, "played": play, "items": [list(i) for i in items]}
        stored.add_commit(tx, key, revision["id"], approval["hash"], approval["action"], stamp,
                          status, draft, json.dumps(result))
        row = stored.commit_row(tx, key)
        _event(tx, conversation, key, status, draft, result)
    if play and not not_played and hasattr(app, "wake_the_worker"):
        app.wake_the_worker()
    return _shape(row, False)


def reconcile(conn: Any, store: EngineStore, row: Any) -> Any:
    """`commit.reconcile` on a record the old path left pending: was its draft made?"""
    from datetime import datetime

    from selecta.lucy.commit import RECONCILE_AFTER_SECONDS, CommitError, _items_of

    if row["status"] != "pending":
        return row
    age = time.time() - datetime.fromisoformat(row["created_at"]).timestamp()
    if age < RECONCILE_AFTER_SECONDS:
        return row
    revision = proposals.get_revision(conn, row["revision_id"])
    try:
        wanted = json.dumps([list(item) for item in _items_of(revision["snapshot"])])
    except CommitError:
        wanted = None
    key = row["idempotency_key"]
    with backing.writing(store) as tx:
        found = stored.draft_with(tx, wanted) if wanted else None
        if found is not None:
            stored.finish_commit(tx, key, "committed", found["id"], json.dumps(
                {"name": found["name"], "played": False, "reconciled": True}))
        else:
            problems = ["SelectaDJ stopped before saving; nothing was saved."]
            stored.finish_commit(tx, key, "failed", None, json.dumps({"problems": problems}))
        return stored.commit_row(tx, key)


def status_of(conn: Any, store: EngineStore, key: str) -> dict | None:
    from selecta.lucy.commit import _shape

    with backing.reading(store) as tx:
        row = stored.commit_row(tx, key)
    return None if row is None else _shape(reconcile(conn, store, row), True)


def issue(store: EngineStore, token: str, revision_id: str, digest: str, action: str,
          expires: int) -> None:
    with backing.writing(store) as tx:
        stored.add_approval(tx, token, revision_id, digest, action, expires)


__all__ = ["commit", "conversation_of", "issue", "reconcile", "status_of"]
