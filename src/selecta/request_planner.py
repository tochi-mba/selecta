"""Musical proposals for waiting requests, using the same cue and taste data as mixes."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict

from selecta.analysis.song import SongInfo
from selecta.planner.beam import _Cues, _Riders, handoff_quality
from selecta.planner.choose import enumerate_candidates
from selecta.planner.memory import SeamMemory
from selecta.requests import find_slot
from selecta.seams import request_from


def proposals(
    rows: list[dict],
    items: list[tuple[int, str | None, int]],
    songs: list[SongInfo],
    protected_through: int,
    memory: SeamMemory,
    state_of: Callable[[str], dict],
) -> list[dict]:
    """No queue mutations. Unfitting requests remain visible while later ones are considered.

    Requests do not earn a forced cut just because they were requested. Only compatible
    handovers with real cues are proposed, and actual rendered audits remain the final gate.
    """
    import json

    library = {song.id: song for song in songs}
    order = [item[0] for item in items]
    riders, cues = _Riders(), _Cues()
    edges: dict[tuple[int, int], dict | None] = {}

    def edge(a_id: int, b_id: int) -> dict | None:
        key = (a_id, b_id)
        if key in edges:
            return edges[key]
        edges[key] = None
        a, b = library.get(a_id), library.get(b_id)
        if a is None or b is None or handoff_quality(a, b, riders) < 0.5:
            return None
        candidates = enumerate_candidates(a, b, exits=cues.exits(a), entries=cues.entries(b))
        for candidate in candidates:
            move = candidate.recipe.name
            if move not in {"bass_swap_blend", "filter_sweep", "tempo_ramp"}:
                continue
            if memory.move_factor(a_id, b_id, move) <= 0:
                continue
            settings = dict(
                move=move,
                bars=candidate.bars,
                exit_bar=candidate.exit_cue.bar,
                entry_bar=candidate.entry_cue.bar,
            )
            request = request_from(a_id, b_id, settings)
            state = state_of(request.key)
            if state.get("status") == "failed":
                continue
            edges[key] = settings
            break
        return edges[key]

    locked = [i for i, item in enumerate(items) if item[2]]
    custom = [
        i
        for i, item in enumerate(items)
        if item[1] and json.loads(item[1]) not in ({}, {"move": "auto"})
    ]
    results = []
    for row in rows:
        song_id = row["song_id"]
        result = {**row, "plan": None}
        if not row.get("available", 1):
            result["reason"] = "This song is no longer available."
        elif song_id in order:
            result["reason"] = "This song is already in the mix."
        elif song_id not in library:
            result["reason"] = "Waiting for song analysis and usable cues."
        elif not items:
            result["reason"] = "Start a mix to find a place for this request."
        else:
            slot = find_slot(
                order,
                song_id,
                protected_through,
                lambda a, b: edge(a, b) is not None,
                locked=locked,
                custom_seams=custom,
            )
            if slot is None:
                # A bridge shortlist bounds interactive work; future reconsideration can find
                # a direct fit after the set changes. This is not an exhaustive path search.
                bridges = sorted(
                    (song for song in songs if song.id not in order and song.id != song_id),
                    key=lambda song: abs(song.bpm / library[song_id].bpm - 1),
                )[:30]
                slot = find_slot(
                    order,
                    song_id,
                    protected_through,
                    lambda a, b: edge(a, b) is not None,
                    locked=locked,
                    custom_seams=custom,
                    bridge_songs=[song.id for song in bridges],
                )
            if slot is None:
                result["reason"] = "Waiting for a suitable place. Other requests can still fit."
            else:
                chain = [
                    order[slot.position - 1],
                    *slot.songs,
                    *order[slot.position : slot.position + 1],
                ]
                result["plan"] = {
                    **asdict(slot),
                    "seams": [edge(a, b) for a, b in zip(chain, chain[1:], strict=False)],
                }
                result["reason"] = (
                    "A bridge song could make this fit. Your approval is needed."
                    if slot.bridges
                    else "Found a place ahead of playback."
                )
        results.append(result)
    return results
