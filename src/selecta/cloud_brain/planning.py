"""What Cloud's planning routes decide, from song facts alone (ADR-0479, "one brain").

Each function takes `SongInfo`s built from stored facts and returns decisions as JSON-ready
data. Nothing is rendered or heard here: a studio renders the scripts, audits them and follows
the repair rule (docs/engineering/cloud-planning.md). The Desktop's own calls are the reference:

- `candidates` is `planner.choose.choose_transition`'s pool: `enumerate_candidates(a, b,
  move, exits=exits_after(a, leave_after))`, ranked, each as the rule's `Option`.
- `order` is the Desktop "make a mix" flow (`routes/mixes.play_vibe`): `build_vibe` over the
  songs the member hasn't ruled out, with their traits.
- `ideas` is the Desktop's idea cards (`GET /api/vibes`).

`order` learns from the workspace's own seams and the member's Good and Bad verdicts, as the
Desktop's mix build learns from its seam history (`SeamMemory`, built by the route from the seam
tables, docs/engineering/engine-store-seams.md). No word links are known (`phrases` is empty),
exactly as a Desktop library without them.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from typing import Any

from selecta.analysis.song import SongInfo
from selecta.planner_core.choose import (
    Candidate,
    enumerate_candidates,
    exits_after,
    fallback_candidate,
)
from selecta.planner_core.memory import SeamMemory
from selecta.planner_core.recipes import all_recipes
from selecta.planner_core.repair import MAX_REPAIRS, RULE_SCHEMA, Option
from selecta.planner_core.vibes import (
    MIN_SONGS,
    build_vibe,
    candidate_vibes,
    describe,
    eligible,
    resolve_vibe,
    traits_of,
)

MAX_OPTIONS = 300
"""Ranked options listed for one pair. Eight exits, ten entries and every move rarely give more,
and the rule only ever renders a handful of them."""

SCRIPTED = 8
"""Options sent with their script by default: the rule renders at most `MAX_REPAIRS` + 1 takes
(the first and four repairs) and steps over options whose recipe builds no script, so the first
eight cover a loop that walks in rank order with three to spare. The rule can jump down the list
(another move after a failure), so any other option's script is asked for by its index."""

MAX_SCRIPTED = 16
MAX_ORDER_SONGS = 60
"""The same bound as the hosted plan (`hosted_render.MAX_PLAN_SONGS`): each song's arrays are
read from storage for every request."""

MAX_COUNT = 100  # the Desktop build's own limit (`routes/mixes.play_vibe`)


class PlanningRefused(ValueError):
    """A plan that can't be made from these songs, with a stable code and plain words."""

    def __init__(self, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.code, self.message, self.extra = code, message, extra

    def detail(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, **self.extra}


def moves() -> tuple[str, ...]:
    """The moves a pair may be asked for by name: the bar-cue recipes."""
    return tuple(all_recipes())


def pool(
    a: SongInfo, b: SongInfo, move: str | None = None, leave_after: float | None = None
) -> list[Candidate]:
    """The ranked candidates, as the Desktop's choose loop enumerates them, at most
    `MAX_OPTIONS`."""
    if move is not None and move not in all_recipes():
        raise PlanningRefused("unknown_move", "That isn't a move SelectaDJ can plan.")
    return enumerate_candidates(a, b, move, exits=exits_after(a, leave_after))[:MAX_OPTIONS]


def script_of(candidate: Candidate, a: SongInfo, b: SongInfo) -> dict | None:
    """The candidate's `TransitionScript` as JSON data, or None when its recipe builds none
    there (the rule steps over it, counting no render)."""
    from selecta.render.script_json import ScriptJsonError, to_dict

    script = candidate.recipe.make(a, b, candidate.exit_cue, candidate.entry_cue, candidate.bars)
    if script is None:
        return None
    try:
        return to_dict(script)
    except ScriptJsonError:
        # a part no studio could name; for the rule it is the same as no script
        return None


def fingerprint(options: Sequence[Option]) -> str:
    """Names one ranked list, so a later request for one option's script can tell the list it
    was counted in from a list made from changed facts."""
    text = json.dumps([option.to_json() for option in options], sort_keys=True)
    return hashlib.sha256(text.encode()).hexdigest()


def _entry(index: int, candidate: Candidate, a: SongInfo, b: SongInfo, scripted: bool) -> dict:
    entry: dict[str, Any] = {
        "index": index,
        "option": Option.of(candidate).to_json(),
        "score": candidate.score,
        "reasons": list(candidate.reasons),
    }
    if scripted:
        script = script_of(candidate, a, b)
        entry["script"] = script
        entry["has_script"] = script is not None
    return entry


def candidates(
    a: SongInfo,
    b: SongInfo,
    move: str | None = None,
    leave_after: float | None = None,
    scripts: int = SCRIPTED,
) -> dict[str, Any]:
    """Every ranked option for A into B with its score and reasons, the first `scripts` with
    their scripts, and the fallback cut with its own."""
    ranked = pool(a, b, move, leave_after)
    options = [Option.of(candidate) for candidate in ranked]
    safe = fallback_candidate(a, b)
    scripts = max(0, min(int(scripts), MAX_SCRIPTED))
    return {
        "schema": RULE_SCHEMA,
        "max_repairs": MAX_REPAIRS,
        "fingerprint": fingerprint(options),
        "scripted": min(scripts, len(ranked)),
        "options": [
            _entry(index, candidate, a, b, index < scripts)
            for index, candidate in enumerate(ranked)
        ],
        "fallback": _entry(-1, safe, a, b, True),
    }


def one_script(
    a: SongInfo,
    b: SongInfo,
    index: int,
    expected: str,
    move: str | None = None,
    leave_after: float | None = None,
) -> dict[str, Any]:
    """One option's script by its place in the list a `candidates` answer sent."""
    ranked = pool(a, b, move, leave_after)
    if fingerprint([Option.of(candidate) for candidate in ranked]) != expected:
        raise PlanningRefused(
            "plan_changed", "These songs' facts changed since the options were sent; ask again."
        )
    if not 0 <= index < len(ranked):
        raise PlanningRefused("no_such_option", "There's no option at that place in the list.")
    return _entry(index, ranked[index], a, b, True)


def _traits(songs: list[SongInfo]):
    # Cloud's catalogue keeps no release year
    return traits_of(songs, {})


def order(
    songs: list[SongInfo],
    idea: str = "pick",
    count: int = 12,
    start: int | None = None,
    end: int | None = None,
    language: str | None = None,
    stems: str = "sometimes",
    energy_arc: Sequence[float] | None = None,
    seed: int | None = None,
    memory: SeamMemory | None = None,
) -> dict[str, Any]:
    """The order of a mix from these songs, as the Desktop's idea build makes it, and the move
    planned into each song after the first. `memory` is what the workspace's seams taught."""
    vibe = resolve_vibe(idea)
    if vibe is None:
        raise PlanningRefused("unknown_idea", "There's no mix idea by that name.")
    traits = _traits(songs)
    fits = eligible(vibe, songs, traits)
    if len(fits) < MIN_SONGS:
        raise PlanningRefused(
            "too_few_measured",
            f"{vibe.name} needs at least {MIN_SONGS} measured songs that suit it; "
            f"{len(fits)} of these do.",
            needs=MIN_SONGS,
            suits=[song.id for song in fits],
        )
    try:
        planned, seams = build_vibe(
            vibe,
            songs,
            traits,
            {},
            min(int(count), MAX_COUNT),
            start,
            seed=seed,
            memory=(memory or SeamMemory()).read_taste(songs),
            mix_language=language if language != "balanced" else None,
            end_id=end,
            stems=stems,
            energy_arc=energy_arc,
        )
    except ValueError as problem:
        raise PlanningRefused("cannot_plan", str(problem)) from problem
    steps = [
        {
            "from": before.song.id,
            "to": item.song.id,
            "move": seams.get(item.song.id, {}).get("move"),
            "transition": item.transition,
            "reason": item.reason,
        }
        for before, item in zip(planned, planned[1:], strict=False)
    ]
    return {
        "idea": vibe.key,
        "name": vibe.name,
        "order": [item.song.id for item in planned],
        "steps": steps,
    }


def ideas(songs: list[SongInfo], language: str | None = None) -> list[dict[str, Any]]:
    """The idea cards these songs support, as the Desktop shows them."""
    traits = _traits(songs)
    chosen = language if language != "balanced" else None
    return [describe(vibe, songs, traits, chosen) for vibe in candidate_vibes(songs, traits)]


__all__ = [
    "MAX_OPTIONS",
    "MAX_ORDER_SONGS",
    "SCRIPTED",
    "PlanningRefused",
    "candidates",
    "fingerprint",
    "ideas",
    "moves",
    "one_script",
    "order",
    "pool",
    "script_of",
]
