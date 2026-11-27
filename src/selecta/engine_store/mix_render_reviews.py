"""Verified render fingerprints for the current arrangement of each Cloud mix."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from hashlib import sha256
import json
import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from selecta.engine_store.mixes import StoreMixes

PREFERENCE = "mix_render_reviews"
MAX_TRACKED_MIXES = 64
_DIGEST = re.compile(r"[0-9a-f]{64}")


def revision(items: Sequence[Mapping[str, Any]]) -> str:
    """Identity of the arrangement, independent of readiness, titles and playback state."""
    arrangement = [
        (item["song_id"], (item.get("seam") or {}).get("settings"))
        for item in items
    ]
    data = json.dumps(arrangement, sort_keys=True, separators=(",", ":"))
    return sha256(data.encode()).hexdigest()


def _scope(draft: int | None) -> str:
    return "current" if draft is None else str(draft)


def record_accepted(
    mixes: StoreMixes, draft: int | None, items: Sequence[Mapping[str, Any]], *,
    expected_revision: str, position: int, verified_digest: str,
) -> bool:
    """Record a server-verified accepted clip within the caller's mix write transaction.

    The caller resolves the accepted artifact and computes its digest server-side. The
    position identifies the incoming song. Returns False for a stale or invalid position.
    """
    current = revision(items)
    if current != expected_revision or not 0 < position < len(items) or not _DIGEST.fullmatch(verified_digest):
        return False
    saved = mixes.preference(PREFERENCE, {})
    scope = _scope(draft)
    state = saved.pop(scope, {})
    if state.get("revision") != current:
        state = {"revision": current, "clips": {}, "changed": []}
    clips = state["clips"]
    key = str(position)
    previous = clips.get(key)
    if previous is not None and previous != verified_digest and position not in state["changed"]:
        state["changed"].append(position)
    clips[key] = verified_digest
    saved[scope] = state
    while len(saved) > MAX_TRACKED_MIXES:
        del saved[next(iter(saved))]
    mixes.set_preference(PREFERENCE, saved)
    return True


def review(
    mixes: StoreMixes, draft: int | None, items: Sequence[Mapping[str, Any]],
) -> dict[str, list[int]] | None:
    state = mixes.preference(PREFERENCE, {}).get(_scope(draft))
    if state and state["changed"] and state["revision"] == revision(items):
        return {"transitions": sorted(state["changed"])}
    return None
