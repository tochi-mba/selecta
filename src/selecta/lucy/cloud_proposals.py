"""Lucy's proposals in browser-first Cloud (ADR-0476).

A proposal is the songs Lucy suggests, as catalogue song ids, for the account's current mix (a
change, made from one recipe revision) or for a new mix. Each one Lucy makes, and each edit the
person makes in the pane, is a numbered revision of the conversation's one proposal; one of them
is current. Answers come back in the local page's `Revision` shape, with nothing measured:
tempo, key and energy are null and there are no planned seams, because the browser works each
transition out as the mix plays.

Saving is the person's alone (approve, then commit). It writes the next revision of the target
recipe from the revision the proposal was made from, so a mix changed meanwhile is refused as
stale instead of overwritten; a new mix is created. "Save and play" also makes it the account's
current mix (ADR-0475 R8). A commit is keyed by the person's idempotency key: sending it again
returns the first answer, never a second save.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.local_media import current_mix, recipes, store
from selecta.lucy.cloud_schema import lucy_cloud_proposals as proposals
from selecta.persistence import db_now, new_id

APPROVAL_SECONDS = 300
NOT_MEASURED = (
    "Tempo, key and energy aren't measured in the browser, so each transition is worked out "
    "from the audio as the mix plays."
)


class ProposalError(Exception):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _iso(epoch: float) -> str:
    from selecta.lucy.cloud_store import iso

    return iso(epoch)


def _hash(song_ids: list[int], name: str) -> str:
    return hashlib.sha256(json.dumps([name, song_ids]).encode()).hexdigest()[:32]


def _rows(conn: Connection, workspace_id: str, conversation_id: str) -> list[Any]:
    return conn.execute(
        sa.select(proposals)
        .where(proposals.c.workspace_id == workspace_id)
        .where(proposals.c.conversation_id == conversation_id)
        .order_by(proposals.c.number)
    ).all()


def row_by_id(conn: Connection, workspace_id: str, revision_id: str):
    row = conn.execute(
        sa.select(proposals)
        .where(proposals.c.workspace_id == workspace_id)
        .where(proposals.c.id == revision_id)
    ).first()
    if row is None:
        raise ProposalError("revision_not_found", "That proposal isn't here any more.", 404)
    return row


def _make_current(conn: Connection, workspace_id: str, conversation_id: str, revision_id: str):
    conn.execute(
        proposals.update()
        .where(proposals.c.workspace_id == workspace_id)
        .where(proposals.c.conversation_id == conversation_id)
        .values(current=proposals.c.id == revision_id)
    )


def add_revision(
    conn: Connection, workspace_id: str, conversation_id: str, turn_id: str | None, *,
    mix_id: str | None, base_revision: str | None, name: str, song_ids: list[int],
    summary: str, kind: str = "plan",
) -> dict[str, Any]:
    from selecta.lucy.cloud_store import append_event

    number = len(_rows(conn, workspace_id, conversation_id)) + 1
    revision_id = new_id()
    conn.execute(
        proposals.insert().values(
            workspace_id=workspace_id, id=revision_id, conversation_id=conversation_id,
            number=number, turn_id=turn_id, mix_id=mix_id, base_revision=base_revision,
            name=name, song_ids=list(song_ids), summary=summary, current=False,
            created_at=db_now(conn),
        )
    )
    _make_current(conn, workspace_id, conversation_id, revision_id)
    append_event(
        conn, workspace_id, conversation_id, "proposal.revision",
        {"proposal": conversation_id, "revision": revision_id, "number": number,
         "kind": kind, "hash": _hash(list(song_ids), name), "summary": summary,
         "songs": len(song_ids), "title": name, "ready_only": False, "current": True,
         "branch": "main"},
        turn=turn_id,
    )
    return {"id": revision_id, "number": number}


def _songs_of(conn: Connection, workspace_id: str, song_ids: list[int]) -> list[dict[str, Any]]:
    out = []
    for position, song_id in enumerate(song_ids):
        song = store.get_song(conn, workspace_id, int(song_id))
        out.append({
            "occurrence": f"{position}:{song_id}",
            "song_id": int(song_id),
            "artist": song["artist"] if song else "",
            "title": song["title"] if song else "A song no longer in your library",
            "duration": float(song["duration_s"] or 0) if song else 0.0,
            "bpm": None, "key": None, "energy": None, "locked": False,
        })
    return out


def _base_ids(conn: Connection, workspace_id: str, row: Any) -> list[int] | None:
    """The songs of the mix the proposal changes, as they are now; None for a new mix."""
    if row.mix_id is None:
        return None
    try:
        mix = recipes.read(conn, workspace_id, row.mix_id)["mix"]
    except recipes.RecipeError:
        return []
    return [int(song["song_id"]) for song in mix["songs"]]


def diff_ids(before: list[int], after: list[int], titles: dict[int, str]) -> dict[str, Any]:
    kept_before = [song_id for song_id in before if song_id in set(after)]
    kept_after = [song_id for song_id in after if song_id in set(before)]
    moved = {a for a, b in zip(kept_before, kept_after, strict=False) if a != b}
    songs = []
    for position, song_id in enumerate(after):
        status = "added" if song_id not in before else "moved" if song_id in moved else "kept"
        songs.append({"occurrence": f"{position}:{song_id}", "song_id": song_id,
                      "status": status})
    removed = [{"occurrence": f"r:{song_id}", "song_id": song_id,
                "title": titles.get(song_id), "replaced": False}
               for song_id in before if song_id not in after]
    counts = {
        "added": sum(1 for s in songs if s["status"] == "added"),
        "removed": len(removed), "replaced": 0,
        "moved": sum(1 for s in songs if s["status"] == "moved"),
        "kept": sum(1 for s in songs if s["status"] == "kept"),
    }
    return {"songs": songs, "removed": removed, "counts": counts, "seams_changed": [],
            "rules_changed": []}


def revision_json(conn: Connection, workspace_id: str, row: Any) -> dict[str, Any]:
    ids = [int(song_id) for song_id in row.song_ids]
    songs = _songs_of(conn, workspace_id, ids)
    total = sum(song["duration"] for song in songs)
    base = _base_ids(conn, workspace_id, row)
    diff = None
    if base is not None:
        titles = {}
        for song_id in base:
            found = store.get_song(conn, workspace_id, song_id)
            titles[song_id] = found["title"] if found else None
        diff = diff_ids(base, ids, titles)
    # the pane says transitions are worked out as the mix plays; only real problems warn
    warnings = []
    if any(not song["artist"] and song["duration"] == 0 for song in songs):
        warnings.append("A song in this proposal is no longer in your library.")
    summary_hash = _hash(ids, row.name)
    return {
        "id": row.id, "proposal": row.conversation_id, "number": int(row.number),
        "parent": None, "branch": "main", "kind": "plan" if row.turn_id else "revise",
        "hash": summary_hash, "summary": row.summary, "turn": row.turn_id,
        "created_at": _iso(row.created_at),
        "snapshot": {
            "title": row.name, "ready_only": False, "variant": "",
            "songs": songs, "seams": [], "constraints": [],
            "evaluation": {
                "duration": {"source_seconds": total, "low": total, "high": total,
                             "exact": True},
                "energy": [None for _song in songs], "warnings": warnings, "objective": {},
            },
            "versions": {"target": "current mix" if row.mix_id else "new mix",
                         "saved": row.commit_key is not None, "played": bool(row.played)},
            "diff": diff, "revision": row.id, "number": int(row.number),
        },
        "ledger": readiness(len(songs)),
    }


def readiness(songs: int) -> dict[str, Any]:
    """Nothing is rendered ahead in the browser: every transition is worked out live, so a
    browser mix is playable as soon as its songs are."""
    return {"seams": [], "ready": 0, "needed": 0, "playable_now": songs >= 2,
            "checked_at": _iso(time.time())}


def history(conn: Connection, workspace_id: str, conversation_id: str) -> list[dict[str, Any]]:
    return [
        {"id": row.id, "number": int(row.number), "parent": None, "branch": "main",
         "kind": "plan" if row.turn_id else "revise",
         "hash": _hash([int(i) for i in row.song_ids], row.name), "summary": row.summary,
         "created_at": _iso(row.created_at), "songs": len(row.song_ids), "title": row.name,
         "ready_only": False, "current": bool(row.current)}
        for row in _rows(conn, workspace_id, conversation_id)
    ]


def snapshot(conn: Connection, workspace_id: str, conversation_id: str) -> dict[str, Any] | None:
    rows = _rows(conn, workspace_id, conversation_id)
    if not rows:
        return None
    current = next((row for row in rows if row.current), rows[-1])
    return {"id": conversation_id, "current": revision_json(conn, workspace_id, current),
            "history": history(conn, workspace_id, conversation_id)}


def edit(conn: Connection, workspace_id: str, row: Any, expected: str, op: dict) -> dict:
    """The person's own change in the pane: remove a song or move one. Locks need measured
    positions, which the browser has none of."""
    if not row.current or expected != row.id:
        raise ProposalError("stale_revision", "This proposal changed. Have a look again.", 409)
    kind = op.get("op")
    ids = [int(i) for i in row.song_ids]
    occurrence = str(op.get("occurrence") or "")
    try:
        index = int(occurrence.split(":")[0])
    except ValueError as error:
        raise ProposalError("invalid_edit", "That song isn't in this proposal.") from error
    if not 0 <= index < len(ids):
        raise ProposalError("invalid_edit", "That song isn't in this proposal.")
    if kind == "remove":
        if len(ids) <= 2:
            raise ProposalError("too_few_songs", "A mix needs at least two songs.")
        ids.pop(index)
    elif kind == "move" and isinstance(op.get("to"), int):
        song = ids.pop(index)
        ids.insert(max(0, min(len(ids), int(op["to"]))), song)
    else:
        raise ProposalError(
            "not_a_proposal_edit",
            "A proposal can drop or move songs. Lock songs once it is your mix, in the editor.",
        )
    made = add_revision(
        conn, workspace_id, row.conversation_id, None, mix_id=row.mix_id,
        base_revision=row.base_revision, name=row.name, song_ids=ids,
        summary="Your change", kind="revise",
    )
    return revision_json(conn, workspace_id, row_by_id(conn, workspace_id, made["id"]))


def make_current(conn: Connection, workspace_id: str, row: Any) -> dict[str, Any]:
    from selecta.lucy.cloud_store import append_event

    _make_current(conn, workspace_id, row.conversation_id, row.id)
    append_event(conn, workspace_id, row.conversation_id, "proposal.current",
                 {"proposal": row.conversation_id, "revision": row.id})
    return revision_json(conn, workspace_id, row_by_id(conn, workspace_id, row.id))


def approve(conn: Connection, workspace_id: str, row: Any, hash_: str, action: str) -> dict:
    if not row.current:
        raise ProposalError("stale_revision", "Make this the current revision to save it.", 409)
    ids = [int(i) for i in row.song_ids]
    if hash_ != _hash(ids, row.name):
        raise ProposalError("stale_revision", "This proposal changed. Have a look again.", 409)
    problems = []
    missing = [i for i in ids if store.get_song(conn, workspace_id, i) is None]
    if missing:
        problems.append("Some of these songs are no longer in your library.")
    if row.mix_id is not None:
        base = _base_ids(conn, workspace_id, row)
        try:
            latest = recipes.read(conn, workspace_id, row.mix_id)["mix"]["revision"]
        except recipes.RecipeError:
            latest = None
        if latest is None or base == []:
            problems.append("The mix this changes was deleted.")
        elif latest not in {row.base_revision, row.saved_revision}:
            problems.append("Your mix changed since Lucy made this. Ask Lucy again.")
    expires = time.time() + APPROVAL_SECONDS
    token = base64.urlsafe_b64encode(
        json.dumps({"r": row.id, "a": action, "e": expires}).encode()
    ).decode()
    seconds = sum(float((store.get_song(conn, workspace_id, i) or {}).get("duration_s") or 0)
                  for i in ids)
    return {
        "token": token, "expires_at": expires, "action": action,
        "preflight": {"ok": not problems, "problems": problems, "songs": len(ids), "ready": 0,
                      "needed": 0, "ready_only": False, "title": row.name,
                      "seconds": round(seconds), "plays_on": _speaker_name(conn, workspace_id)},
    }


def _speaker_name(conn: Connection, workspace_id: str) -> str | None:
    """The device playing now, which Save and play's mix starts on; None when nothing plays
    (the app then asks where the music should play)."""
    from selecta.playback import store as playback_store

    session = playback_store.load_session(conn, workspace_id)
    if session is None or not session.active_device_id:
        return None
    device = playback_store.load_device(conn, workspace_id, session.active_device_id)
    return device.name if device is not None else None


def read_token(token: str) -> dict[str, Any]:
    try:
        body = json.loads(base64.urlsafe_b64decode(token.encode()).decode())
        return {"revision": str(body["r"]), "action": str(body["a"]),
                "expires": float(body["e"])}
    except (ValueError, KeyError, TypeError) as error:
        raise ProposalError("bad_token", "That check isn't valid. Press Save again.") from error


def commit_answer(row: Any, mix_name: str | None) -> dict[str, Any]:
    return {"key": row.commit_key, "status": "committed", "draft_id": None,
            "name": mix_name or row.name, "played": bool(row.played), "repeat": False}


def commit(
    conn: Connection, workspace_id: str, user_id: str, token: str, key: str, confirm_play: bool
) -> dict[str, Any]:
    done = by_commit_key(conn, workspace_id, key)
    if done is not None:
        return {**commit_answer(done, None), "repeat": True}
    asked = read_token(token)
    if asked["expires"] < time.time():
        raise ProposalError("approval_expired", "This check has run out. Press Save again.", 409)
    row = row_by_id(conn, workspace_id, asked["revision"])
    if row.commit_key is not None:
        # saved already, from this device or another: never twice, and said plainly
        raise ProposalError("already_saved", "This was already saved, from this or another "
                            "device. Nothing changed.", 409)
    if not row.current:
        raise ProposalError("stale_revision", "Make this the current revision to save it.", 409)
    ids = [int(i) for i in row.song_ids]
    try:
        if row.mix_id is None:
            mix = recipes.create(conn, workspace_id, user_id, row.name, ids, key=f"lucy:{key}")
        else:
            mix = recipes.edit(conn, workspace_id, user_id, row.mix_id,
                               base_revision=row.base_revision or "", song_ids=ids)
    except recipes.RecipeError as error:
        raise ProposalError(error.code, error.message, error.status) from error
    played = False
    if asked["action"] == "draft_and_play" and confirm_play:
        now = current_mix.read(conn, workspace_id)
        try:
            current_mix.choose(conn, workspace_id, mix["mix_id"], now.get("mix_id"), None)
            played = True
        except current_mix.CurrentMixError:
            played = False
    conn.execute(
        proposals.update()
        .where(proposals.c.workspace_id == workspace_id)
        .where(proposals.c.id == row.id)
        .values(saved_mix_id=mix["mix_id"], saved_revision=mix["revision"], commit_key=key,
                played=played)
    )
    from selecta.lucy.cloud_store import append_event

    answer = {"key": key, "status": "committed", "draft_id": None, "name": mix["name"],
              "played": played, "repeat": False}
    append_event(conn, workspace_id, row.conversation_id, "commit.updated", answer)
    return answer


def by_commit_key(conn: Connection, workspace_id: str, key: str):
    return conn.execute(
        sa.select(proposals)
        .where(proposals.c.workspace_id == workspace_id)
        .where(proposals.c.commit_key == key)
    ).first()


__all__ = [
    "NOT_MEASURED",
    "ProposalError",
    "add_revision",
    "approve",
    "commit",
    "edit",
    "make_current",
    "revision_json",
    "snapshot",
]
