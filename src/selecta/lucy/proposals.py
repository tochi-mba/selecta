"""Immutable proposals: versioned song orders that are not built (ADR-0323, ADR-0325).

A proposal is a pointer to its current revision. A revision is a frozen snapshot: exact song
occurrences with their own ids (so two plays of one song are never confused), the directed seam
intended between each neighbouring pair, the rules it was made under, its evaluation evidence and
the versions of everything that produced it. Its canonical hash is what an approval binds to.

Revisions are only ever added. A new one names the revision it expects to replace, and a stale
expectation (another tab, a newer turn, an older generation finishing late) is refused rather
than written over (LU-323-06, LU-334-04).
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from selecta.lucy import events
from selecta.lucy.ids import content_hash, new_id, now_iso

REVISION_KINDS = {"plan", "revise", "restore", "branch", "variant"}


class StaleRevision(Exception):
    """The proposal moved on since this change was based on it."""

    def __init__(self, expected: str | None, current: str | None) -> None:
        super().__init__("This proposal changed since that was asked, so nothing was written.")
        self.expected = expected
        self.current = current


class NotFound(KeyError):
    pass


def snapshot_hash(snapshot: dict) -> str:
    """What approval binds to: the exact songs, their order and locks, the seam asked for between
    each pair, the hard and soft rules in force, the ready-only flag and the title."""
    identity = {
        "title": snapshot.get("title", ""),
        "ready_only": bool(snapshot.get("ready_only")),
        "songs": [
            [song["occurrence"], song["song_id"], bool(song.get("locked"))]
            for song in snapshot.get("songs", [])
        ],
        "seams": [
            [seam["a_occ"], seam["b_occ"], seam.get("key"), seam.get("settings", {})]
            for seam in snapshot.get("seams", [])
        ],
        "rules": sorted(
            [rule["kind"], rule["target"], rule["value"], rule["strength"]]
            for rule in snapshot.get("constraints", [])
            if rule.get("status") == "active"
        ),
    }
    return content_hash(identity)


def ensure_proposal(conn: sqlite3.Connection, conversation: str) -> str:
    row = conn.execute(
        "SELECT proposal_id FROM lucy_conversations WHERE id=?", (conversation,)
    ).fetchone()
    if row is None:
        raise NotFound(conversation)
    if row["proposal_id"]:
        return row["proposal_id"]
    proposal = new_id("proposal")
    stamp = now_iso()
    conn.execute(
        "INSERT INTO lucy_proposals(id,conversation_id,created_at,updated_at) VALUES(?,?,?,?)",
        (proposal, conversation, stamp, stamp),
    )
    conn.execute(
        "UPDATE lucy_conversations SET proposal_id=? WHERE id=?", (proposal, conversation)
    )
    conn.commit()
    return proposal


def _proposal(conn: sqlite3.Connection, proposal: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM lucy_proposals WHERE id=?", (proposal,)).fetchone()
    if row is None:
        raise NotFound(proposal)
    return row


def add_revision(
    conn: sqlite3.Connection,
    proposal: str,
    snapshot: dict,
    *,
    kind: str,
    expected_current: str | None,
    turn: str | None = None,
    summary: str = "",
    branch: str = "main",
    parent: str | None = None,
    make_current: bool = True,
) -> dict:
    """Write one new immutable revision, atomically, only if the proposal is still where the
    caller saw it. Nothing partial is ever visible (LU-324-07)."""
    if kind not in REVISION_KINDS:
        raise ValueError(kind)
    if conn.in_transaction:
        conn.commit()
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = _proposal(conn, proposal)
        if make_current and row["current_revision"] != expected_current:
            raise StaleRevision(expected_current, row["current_revision"])
        number = conn.execute(
            "SELECT coalesce(max(number),0)+1 FROM lucy_revisions WHERE proposal_id=?",
            (proposal,),
        ).fetchone()[0]
        revision = new_id("revision")
        frozen = {**snapshot, "revision": revision, "number": number}
        digest = snapshot_hash(frozen)
        conn.execute(
            "INSERT INTO lucy_revisions(id,proposal_id,number,parent_id,branch,kind,hash,snapshot,"
            "turn_id,summary,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                revision,
                proposal,
                number,
                parent if parent is not None else row["current_revision"],
                branch,
                kind,
                digest,
                json.dumps(frozen, ensure_ascii=False),
                turn,
                summary,
                now_iso(),
            ),
        )
        if make_current:
            conn.execute(
                "UPDATE lucy_proposals SET current_revision=?, updated_at=? WHERE id=?",
                (revision, now_iso(), proposal),
            )
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    found = get_revision(conn, revision)
    events.append(
        conn,
        row["conversation_id"],
        "proposal.revision",
        {
            "proposal": proposal,
            "revision": revision,
            "number": number,
            "kind": kind,
            "branch": branch,
            "hash": digest,
            "current": make_current,
            "summary": summary,
            "songs": len(snapshot.get("songs", [])),
        },
        turn=turn,
    )
    return found


def get_revision(conn: sqlite3.Connection, revision: str) -> dict:
    row = conn.execute("SELECT * FROM lucy_revisions WHERE id=?", (revision,)).fetchone()
    if row is None:
        raise NotFound(revision)
    return _shape(row)


def _shape(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "proposal": row["proposal_id"],
        "number": row["number"],
        "parent": row["parent_id"],
        "branch": row["branch"],
        "kind": row["kind"],
        "hash": row["hash"],
        "summary": row["summary"],
        "turn": row["turn_id"],
        "created_at": row["created_at"],
        "snapshot": json.loads(row["snapshot"]),
    }


def current(conn: sqlite3.Connection, proposal: str | None) -> dict | None:
    if not proposal:
        return None
    row = _proposal(conn, proposal)
    return get_revision(conn, row["current_revision"]) if row["current_revision"] else None


def history(conn: sqlite3.Connection, proposal: str) -> list[dict]:
    """Every revision, newest first, without their full snapshots."""
    current_id = _proposal(conn, proposal)["current_revision"]
    rows = conn.execute(
        "SELECT * FROM lucy_revisions WHERE proposal_id=? ORDER BY number DESC", (proposal,)
    ).fetchall()
    listed = []
    for row in rows:
        shaped = _shape(row)
        snapshot = shaped.pop("snapshot")
        shaped["songs"] = len(snapshot.get("songs", []))
        shaped["title"] = snapshot.get("title", "")
        shaped["ready_only"] = bool(snapshot.get("ready_only"))
        shaped["current"] = row["id"] == current_id
        listed.append(shaped)
    return listed


def set_current(
    conn: sqlite3.Connection, proposal: str, revision: str, expected_current: str | None
) -> dict:
    """The person explicitly chose another revision (a variant, a branch head). Nothing is
    rewritten; only the pointer moves, and only from where they saw it."""
    found = get_revision(conn, revision)
    if found["proposal"] != proposal:
        raise NotFound(revision)
    if conn.in_transaction:
        conn.commit()
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = _proposal(conn, proposal)
        if row["current_revision"] != expected_current:
            raise StaleRevision(expected_current, row["current_revision"])
        conn.execute(
            "UPDATE lucy_proposals SET current_revision=?, updated_at=? WHERE id=?",
            (revision, now_iso(), proposal),
        )
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    events.append(
        conn,
        row["conversation_id"],
        "proposal.current",
        {"proposal": proposal, "revision": revision, "number": found["number"]},
    )
    return found


def _lis(sequence: list[int]) -> set[int]:
    """Indices of one longest increasing subsequence: the songs that stayed in order."""
    if not sequence:
        return set()
    tails: list[int] = []
    tails_at: list[int] = []
    previous = [-1] * len(sequence)
    import bisect

    for index, value in enumerate(sequence):
        at = bisect.bisect_left(tails, value)
        if at == len(tails):
            tails.append(value)
            tails_at.append(index)
        else:
            tails[at] = value
            tails_at[at] = index
        previous[index] = tails_at[at - 1] if at else -1
    kept: set[int] = set()
    index = tails_at[-1]
    while index != -1:
        kept.add(index)
        index = previous[index]
    return kept


def diff(before: dict | None, after: dict) -> dict:
    """Exactly what changed, by occurrence id and directed pair, never by title or position
    guesses (LU-325-01, LU-305-06)."""
    old_songs = (before or {}).get("songs", [])
    new_songs = after.get("songs", [])
    old_index = {song["occurrence"]: index for index, song in enumerate(old_songs)}
    new_index = {song["occurrence"]: index for index, song in enumerate(new_songs)}
    shared = [song["occurrence"] for song in new_songs if song["occurrence"] in old_index]
    in_order = _lis([old_index[occ] for occ in shared])
    moved = {occ for position, occ in enumerate(shared) if position not in in_order}
    added = [occ for occ in new_index if occ not in old_index]
    removed = [occ for occ in old_index if occ not in new_index]
    replaced = []
    for occ in list(added):
        spot = new_index[occ]
        swap = next(
            (gone for gone in removed if old_index[gone] == spot and gone not in
             {pair["old"] for pair in replaced}),
            None,
        )
        if swap is not None:
            replaced.append({"old": swap, "new": occ, "position": spot})
    replaced_new = {pair["new"] for pair in replaced}
    replaced_old = {pair["old"] for pair in replaced}
    statuses = []
    for song in new_songs:
        occ = song["occurrence"]
        if occ in replaced_new:
            status = "replaced"
        elif occ not in old_index:
            status = "added"
        elif occ in moved:
            status = "moved"
        else:
            status = "kept"
        statuses.append({"occurrence": occ, "song_id": song["song_id"], "status": status})
    old_pairs = {
        (seam["a_occ"], seam["b_occ"]): seam for seam in (before or {}).get("seams", [])
    }
    seams_changed = []
    for seam in after.get("seams", []):
        pair = (seam["a_occ"], seam["b_occ"])
        old = old_pairs.get(pair)
        if old is None or old.get("key") != seam.get("key"):
            seams_changed.append({"a_occ": pair[0], "b_occ": pair[1], "status": "new"})
    old_rules = {rule["id"]: rule for rule in (before or {}).get("constraints", [])}
    rules_changed = []
    for rule in after.get("constraints", []):
        old = old_rules.get(rule["id"])
        if old is None and rule.get("status") == "active":
            rules_changed.append({"id": rule["id"], "status": "added"})
        elif old is not None and old.get("status") != rule.get("status"):
            rules_changed.append({"id": rule["id"], "status": rule.get("status")})
    old_ready = {pair for pair, seam in old_pairs.items() if _verified_ready(seam)}
    new_ready = {
        (seam["a_occ"], seam["b_occ"]) for seam in after.get("seams", []) if _verified_ready(seam)
    }
    return {
        "songs": statuses,
        "removed": [
            {"occurrence": occ, "song_id": old_songs[old_index[occ]]["song_id"],
             "title": old_songs[old_index[occ]].get("title"),
             "replaced": occ in replaced_old}
            for occ in removed
        ],
        "counts": {
            "added": len(added) - len(replaced),
            "removed": len(removed) - len(replaced),
            "replaced": len(replaced),
            "moved": len(moved),
            "kept": len(shared) - len(moved),
        },
        "seams_changed": seams_changed,
        "rules_changed": rules_changed,
        # LX-0361-03: what the change does to verified transitions, by directed occurrence pair,
        # as each revision recorded it. A pair only counts when its clip was verified ready.
        "readiness": {
            "before": {"ready": len(old_ready), "needed": max(0, len(old_songs) - 1)},
            "after": {"ready": len(new_ready), "needed": max(0, len(new_songs) - 1)},
            "kept": len(old_ready & new_ready),
            "lost": len(old_ready - new_ready),
            "gained": len(new_ready - old_ready),
        },
    }


def _verified_ready(seam: dict) -> bool:
    ready = seam.get("ready") or {}
    return bool(ready.get("verified")) and ready.get("status") in ("ready", "already_rendered")


def summary_text(change: dict) -> str:
    counts = change["counts"]
    parts = [
        f"{counts[name]} {label}"
        for name, label in (
            ("replaced", "replaced"),
            ("added", "added"),
            ("removed", "removed"),
            ("moved", "moved"),
        )
        if counts[name]
    ]
    parts.append(f"{counts['kept']} kept")
    return ", ".join(parts)


def snapshot_of(conn: sqlite3.Connection, revision: str) -> dict[str, Any]:
    return get_revision(conn, revision)["snapshot"]
