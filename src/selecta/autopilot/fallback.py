"""The fallback ladder: what Autopilot plays when the planned transition can't (ADR-0427,
AV-0427-02).

`climb(planned, facts)` walks down, stopping at the first rung whose preconditions all pass:

1. the planned technique;
2. a simpler beat-matched blend (`filter_sweep`, then `bass_swap_blend`), never a stem, word or
   effect trick, since ADR-0427 prefers an acceptable fade over an unreliable stunt;
3. `short_crossfade`, four bars, which needs no beat grid or key;
4. `clean_cut`, which needs only B's audio;
5. the next safe song: if B's audio isn't playable, the first alternate whose audio is, with a
   clean cut into it;
6. `extend_current`: if nothing at all is playable, A keeps playing (its outro loops) while the
   horizon replans. That is the last rung, and it is still music: the ladder never returns
   silence.

A manual seam (`transitions.user_edited`) is never climbed past silently: the person's technique
is tried first, and if it can't play the decision carries `overrode_manual` so the technique
report says so. The person's saved seam itself is never rewritten (`transitions.protect`).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from selecta.autopilot.transitions import (
    CLEAN_CUT,
    SHORT_CROSSFADE,
    TransitionFacts,
    explain,
    preconditions,
)

SIMPLER_BLENDS = ("filter_sweep", "bass_swap_blend")
EXTEND_CURRENT = "extend_current"
NEXT_SAFE_SONG = "next_safe_song"


@dataclass(frozen=True)
class Step:
    technique: str
    failed: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {"technique": self.technique, "failed": list(self.failed),
                "why": explain(self.failed)}


@dataclass(frozen=True)
class Decision:
    planned: str
    technique: str
    rung: int
    target: str | None
    steps: tuple[Step, ...] = field(default=())
    overrode_manual: bool = False

    @property
    def fell_back(self) -> bool:
        return self.technique != self.planned

    @property
    def silent(self) -> bool:
        return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "planned": self.planned,
            "technique": self.technique,
            "rung": self.rung,
            "target": self.target,
            "fell_back": self.fell_back,
            "overrode_manual": self.overrode_manual,
            "steps": [step.to_dict() for step in self.steps],
        }


def rungs(planned: str) -> list[str]:
    order = [planned, *SIMPLER_BLENDS, SHORT_CROSSFADE, CLEAN_CUT]
    seen: list[str] = []
    for technique in order:
        if technique not in seen:
            seen.append(technique)
    return seen


def climb(
    planned: str,
    facts: TransitionFacts,
    *,
    target: str | None = None,
    alternates: Sequence[tuple[str, bool]] = (),
    manual: bool = False,
) -> Decision:
    """Choose what plays. `alternates` are (track id, audio ready) for the songs after B."""
    steps: list[Step] = []
    for index, technique in enumerate(rungs(planned)):
        failed = tuple(preconditions(technique, facts))
        steps.append(Step(technique, failed))
        if not failed:
            return Decision(planned, technique, index, target, tuple(steps),
                            overrode_manual=manual and technique != planned)
    for track_id, ready in alternates:
        if ready:
            cut = tuple(preconditions(CLEAN_CUT, replace(facts, b_audio_ready=True)))
            steps.append(Step(f"{NEXT_SAFE_SONG}:{track_id}", cut))
            if not cut:
                return Decision(planned, CLEAN_CUT, len(steps) - 1, track_id, tuple(steps),
                                overrode_manual=manual)
        else:
            steps.append(Step(f"{NEXT_SAFE_SONG}:{track_id}", ("b_audio_missing",)))
    steps.append(Step(EXTEND_CURRENT, ()))
    return Decision(planned, EXTEND_CURRENT, len(steps) - 1, None, tuple(steps),
                    overrode_manual=manual)


def climb_from_mapping(body: Mapping[str, Any]) -> Decision:
    facts = TransitionFacts.from_mapping(body.get("facts") or {})
    alternates = [
        (str(item.get("track_id")), item.get("audio_ready") is True)
        for item in body.get("alternates") or ()
        if isinstance(item, Mapping) and item.get("track_id")
    ]
    return climb(
        str(body.get("planned") or "auto"),
        facts,
        target=body.get("target"),
        alternates=alternates,
        manual=body.get("manual") is True,
    )


__all__ = ["EXTEND_CURRENT", "NEXT_SAFE_SONG", "Decision", "Step", "climb", "rungs"]
