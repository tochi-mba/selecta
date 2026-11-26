"""Where a Cloud account's waiting requests could join its mix, from song facts alone.

The Desktop's request look (`routes/song_requests.consider_requests`) plans with the same
planner (`request_planner.proposals`) and then waits for its own render worker to make and audit
each handover the placement needs. In Cloud nothing is rendered on the server: the studio that
plays the mix renders. So a placement here is planned from the stored facts, names the seams it
needs (pair and move), and is ready for a device once that device has reported passing seams for
every one of those pairs (`PUT /api/seams/{key}`, attested by its own device id). The device that
holds a clip is the only one that may play it, so readiness is always for one device.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from typing import Any

from selecta.engine_store import EngineStore
from selecta.engine_store import seams as stored
from selecta.seams import MOVES
from selecta.storage.artifacts import ArtifactStore

WINDOW = 40
"""Songs of the mix from the protected one on that are read and planned around. Each song's
arrays are read from storage on every look, so a long mix is planned in its next stretch."""
MOST_PLANNED = 20  # waiting requests planned in one look; the rest wait their turn


def ready_pairs(store: EngineStore, device_id: str | None) -> set[tuple[int, int]]:
    """The pairs this device has rendered and kept a passing (or nearly passing) seam for."""
    if not device_id:
        return set()
    pairs = set()
    for record, _attestation in stored.ready_records(store, [device_id]):
        if record.get("passed") is True or record.get("near_miss") is True:
            pairs.add(stored.songs_of(record))
    return pairs


def plan(
    store: EngineStore,
    artifacts: ArtifactStore,
    rows: list[dict],
    items: list[tuple],
    protected: int,
    device_id: str | None,
) -> list[dict]:
    """Each waiting request with its placement, as Desktop's look answers it, without render
    times: `transitions` and `seams_needed` name each handover, ready when this device has it."""
    from selecta.engine_store.songs import load_songs
    from selecta.planner_core.memory import SeamMemory
    from selecta.request_planner import PairBook, proposals

    rows = rows[:MOST_PLANNED]
    order = [item[0] for item in items]
    wanted = [*order[protected : protected + WINDOW], *(row["song_id"] for row in rows)]
    songs, _unmeasured = load_songs(store, artifacts, wanted)
    by_id = {song.id: song for song in songs}
    found = proposals(
        rows,
        items,
        songs,
        protected,
        SeamMemory.from_states(stored.records(store)),
        lambda _key: {"status": "none"},  # nothing is rendered ahead on the server
        "never",
        book=PairBook(),
        allowed=set(by_id),
    )
    have = ready_pairs(store, device_id)
    for row in found:
        _answer(row, items, by_id, have, device_id)
    return found


def _title(by_id: dict, song: int) -> str:
    return getattr(by_id.get(song), "title", None) or "Song"


def _label(move: str) -> str:
    return MOVES.get(move, (move, ""))[0]


def _answer(row: dict, items: list[tuple], by_id: dict, have: set, device_id: str | None) -> None:
    plan_ = row.get("plan")
    if plan_ is None:
        return
    choice = row.get("bridge_choice")
    if plan_["bridges"] and choice is False:
        # they said no to an extra song, so this keeps waiting for a direct spot
        row.update(plan=None, stage="searching", declined=True)
        return
    picked = row.get("picked")
    approved = (
        not plan_["bridges"]
        or (picked is not None and list(plan_["songs"]) == list(picked))
        or (picked is None and choice is True)
    )
    position = plan_["position"]
    chain = [
        items[position - 1][0],
        *plan_["songs"],
        *[item[0] for item in items[position : position + 1]],
    ]
    pairs = list(zip(chain, chain[1:], strict=False))
    ready = approved and bool(device_id) and all(pair in have for pair in pairs)
    row["seams_needed"] = [
        {"a": a, "b": b, "settings": settings}
        for (a, b), settings in zip(pairs, plan_["seams"], strict=False)
    ]
    row["transitions"] = [
        {
            "from": _title(by_id, a),
            "to": _title(by_id, b),
            "a": a,
            "b": b,
            "status": "ready" if (a, b) in have else "none",
            "label": _label((settings or {}).get("move", "auto")),
        }
        for (a, b), settings in zip(pairs, plan_["seams"], strict=False)
    ]
    if approved:
        row["stage"] = "ready" if ready else "preparing"
        row["reason"] = (
            "Ready to join the mix."
            if ready
            else "It joins once the device playing the mix has made both handovers."
        )
    else:
        row["stage"] = "approve"
    row["after_id"] = items[position - 1][0]
    row["after"] = _title(by_id, row["after_id"])
    row.update(
        offer=offer_of(items, row["id"], plan_),
        ready=ready,
        needs_approval=not approved,
        route=[
            {
                "id": song,
                "title": _title(by_id, song),
                "artist": getattr(by_id.get(song), "artist", None),
            }
            for song in plan_["songs"]
        ],
    )


def offer_of(items: Sequence[Sequence[Any]], request_id: int, plan_: dict) -> str:
    """The placement's name: the mix it was planned against, the request and the plan. The
    Desktop keeps offers in memory; here the same look is made again and must give this name."""
    return hashlib.sha256(
        json.dumps([[list(item) for item in items], request_id, plan_], sort_keys=True).encode()
    ).hexdigest()


__all__ = ["MOST_PLANNED", "WINDOW", "offer_of", "plan", "ready_pairs"]
