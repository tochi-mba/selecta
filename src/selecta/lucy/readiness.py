"""What is truly playable now, as opposed to what once worked (ADR-0317, ADR-0318, ADR-0328).

A ready edge is a directed A->B clip on disk under its exact request key, decodable, from current
sources and analysis, with a passed audit, whose cues the mix engine would leave exactly as they
are. Seam memory (what was liked or clean before) is history; it never makes an edge ready.

The inventory is one scan of the cache folder, cached briefly under a snapshot version, and every
use that matters (approval, commit, play) rechecks it, because clips can be evicted any time.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from typing import Any

from selecta.lucy.ids import content_hash, now_iso
from selecta.planner.ready import (
    ReadyEdge,
    current_recordings,
    plan_ready_path,
    ready_inventory,
    validate_path,
)
from selecta.seam_kinds import MOVES, request_from

INVENTORY_SECONDS = 30.0
PIN_DRAFTS = 10
PROPOSAL_LEASE_SECONDS = 24 * 3600


class Inventory:
    def __init__(self, adjacency: dict[int, list[ReadyEdge]], counts: dict, songs: dict[int, Any]):
        self.adjacency = adjacency
        self.counts = counts
        self.songs = songs
        self.at = time.monotonic()
        self.checked_at = now_iso()
        self.version = content_hash(
            sorted(edge.key for edges in adjacency.values() for edge in edges)
        )[:16]

    def edges(self) -> list[ReadyEdge]:
        return [edge for edges in self.adjacency.values() for edge in edges]

    def by_key(self) -> dict[str, ReadyEdge]:
        return {edge.key: edge for edge in self.edges()}

    def edge(self, a: int, b: int, key: str | None = None) -> ReadyEdge | None:
        return next(
            (e for e in self.adjacency.get(a, ()) if e.b == b and (key is None or e.key == key)),
            None,
        )


_cache: dict[str, Inventory] = {}
_lock = threading.Lock()


def inventory(
    conn: sqlite3.Connection, store: Any, songs: list[Any], fresh: bool = False
) -> Inventory:
    """Verified ready edges among the given eligible songs. Bounded: one cache scan, no pairs."""
    valid = current_recordings(conn, songs)
    stamp = f"{store.root}|{content_hash(sorted(valid))}"
    with _lock:
        known = _cache.get(stamp)
        if known is not None and not fresh and time.monotonic() - known.at < INVENTORY_SECONDS:
            return known
    adjacency, counts = ready_inventory(store, valid)
    found = Inventory(adjacency, counts, valid)
    with _lock:
        _cache.clear()
        _cache[stamp] = found
    return found


def forget_cache() -> None:
    with _lock:
        _cache.clear()


def move_label(move: str | None) -> str | None:
    if not move:
        return None
    return MOVES.get(move, (move.replace("_", " ").capitalize(), ""))[0]


def plan_path(
    found: Inventory,
    count: int,
    start: int | None,
    end: int | None,
    allowed: set[int] | None = None,
    max_steps: int = 50000,
) -> dict:
    """A strict ready-only route, or the honest limits of what exists (LU-318-03, LU-318-08)."""
    songs = found.songs if allowed is None else {
        song_id: song for song_id, song in found.songs.items() if song_id in allowed
    }
    adjacency = {
        a: [edge for edge in edges if edge.b in songs]
        for a, edges in found.adjacency.items()
        if a in songs
    }
    ids, edges, best, limited = plan_ready_path(adjacency, songs, count, start, end, max_steps)
    return {
        "ids": ids,
        "edges": edges,
        "longest": best,
        "search_limited": limited,
        "ready_edges": sum(map(len, adjacency.values())),
        "songs_with_ready_exit": sum(1 for edges in adjacency.values() if edges),
    }


def seam_ready(seam: dict, state: dict, verified: bool) -> dict:
    status = state.get("status", "none")
    rendered = state.get("style") if status == "ready" else None
    return {
        "status": "already_rendered" if verified else status,
        "rendered": rendered,
        "rendered_label": move_label(rendered),
        "verified": verified,
    }


def ledger(conn: sqlite3.Connection, store: Any, snapshot: dict, songs: list[Any]) -> dict:
    """The exact state of every adjacent seam in a revision, checked now (LU-319-03, LU-328-03).

    N songs need max(0, N-1) transitions; the first song has none to wait for.
    """
    found = inventory(conn, store, songs)
    verified_keys = found.by_key()
    rows = []
    for seam in snapshot.get("seams", []):
        key = request_from(seam["a"], seam["b"], seam.get("settings") or {}).key
        state = store.status(key)
        verified = key in verified_keys and key == seam.get("key")
        historical = bool(seam.get("ready", {}).get("verified")) and not verified
        proof = (
            "Checked on disk just now: the clip is there and plays."
            if verified
            else "It was ready when proposed, but the clip is gone now."
            if historical
            else {
                "ready": "Rendered, but not checked as playable for this exact order.",
                "queued": "Waiting to be rendered.",
                "rendering": "Being rendered now.",
                "failed": "The last attempt to render it failed.",
            }.get(state.get("status", "none"), "Not rendered yet.")
        )
        rows.append(
            {
                "a_occ": seam["a_occ"],
                "b_occ": seam["b_occ"],
                "key": key,
                "status": "already_rendered" if verified else
                ("gone" if historical else state.get("status", "none")),
                "requested": (seam.get("settings") or {}).get("move") or "auto",
                "rendered": state.get("style") if state.get("status") == "ready" else None,
                "verified": verified,
                "proof": proof,
            }
        )
    needed = max(0, len(snapshot.get("songs", [])) - 1)
    ready = sum(1 for row in rows if row["verified"] or row["status"] == "ready")
    playable = needed == 0 or (
        all(row["verified"] for row in rows)
        and chain_is_stable(snapshot, store, songs={s.id: s for s in songs})
    )
    return {
        "seams": rows,
        "ready": ready,
        "needed": needed,
        "playable_now": bool(playable) and len(rows) == needed,
        "checked_at": found.checked_at,
        "inventory_version": found.version,
    }


def chain_is_stable(snapshot: dict, store: Any, songs: dict[int, Any]) -> bool:
    """Would the mix engine leave every seam exactly as asked? If it would push one later, the
    request key changes and the clip on disk isn't what would play."""
    from selecta.mix import chain_with_room

    chain = [song["song_id"] for song in snapshot.get("songs", [])]
    seams = [dict(seam.get("settings") or {}) for seam in snapshot.get("seams", [])]
    durations = {song_id: getattr(songs.get(song_id), "duration", None) for song_id in chain}
    settled = chain_with_room(chain, seams, None, durations.get, store.status)
    return all(before == after for before, after in zip(seams, settled, strict=True))


def revalidate(
    conn: sqlite3.Connection, store: Any, snapshot: dict, songs: list[Any]
) -> list[str]:
    """Problems that stop a ready-only revision being built as approved, checked fresh."""
    if not snapshot.get("ready_only"):
        return []
    found = inventory(conn, store, songs, fresh=True)
    ids = [song["song_id"] for song in snapshot.get("songs", [])]
    keys = [seam.get("key") for seam in snapshot.get("seams", [])]
    try:
        validate_path(ids, keys, found.adjacency, found.songs)
    except ValueError as problem:
        return [str(problem)]
    if not chain_is_stable(snapshot, store, found.songs):
        return ["A transition would have to be re-rendered to fit, so it isn't ready now."]
    return []


def pinned_keys(conn: sqlite3.Connection) -> set[str]:
    """Clips a ready-only promise depends on, held back from cache pruning for a bounded time:
    the newest ready-only drafts, and ready-only proposals touched in the last day (LU-318-07)."""
    import json

    keys: set[str] = set()
    try:
        rows = conn.execute(
            "SELECT items FROM drafts WHERE ready_only=1 ORDER BY updated_at DESC LIMIT ?",
            (PIN_DRAFTS,),
        ).fetchall()
    except sqlite3.OperationalError:
        return keys
    for row in rows:
        items = json.loads(row["items"])
        for before, item in zip(items, items[1:], strict=False):
            settings = json.loads(item[1]) if item[1] else {}
            keys.add(request_from(before[0], item[0], settings).key)
    try:
        cutoff = time.time() - PROPOSAL_LEASE_SECONDS
        recent = conn.execute(
            "SELECT r.snapshot, p.updated_at FROM lucy_proposals p JOIN lucy_revisions r "
            "ON r.id=p.current_revision"
        ).fetchall()
    except sqlite3.OperationalError:
        return keys
    from datetime import datetime

    for row in recent:
        try:
            touched = datetime.fromisoformat(row["updated_at"]).timestamp()
        except ValueError:
            continue
        if touched < cutoff:
            continue
        snapshot = json.loads(row["snapshot"])
        if snapshot.get("ready_only"):
            keys |= {seam["key"] for seam in snapshot.get("seams", []) if seam.get("key")}
    return keys
