"""Deterministic ranking of the songs Autopilot may play next (ADR-0426, AV-0426-02).

`rank` takes the candidate pool, what has played, where the evening's energy arc wants to be and
the venue's `HardConstraints`, and returns every candidate either ranked or rejected with its
reasons. It is a pure function: the same inputs and seed always give the same order, whatever
order the pool arrived in. Ties break on a seeded hash and then on the track id, so no two runs
ever disagree.

Eligibility first, preference second:

- Hard constraints (venue policy, licensing) come from `venue_policy.breaches`; a breach rejects.
  Unlicensed music is never eligible, so nothing can rank its way past the rights check.
- A song played within `repeat_gap` songs, or one the director has asked to avoid, is rejected.
- Everything else is scored on energy fit to the arc target, tempo step, Camelot key distance,
  artist spacing and a genre lean, each a small, inspectable term.

The energy arc is `planner.arc.target_energy`, the same curve the local planner uses for a set.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from selecta.analysis.key import camelot_distance
from selecta.autopilot.venue_policy import HardConstraints, TrackFacts, breaches
from selecta.planner.arc import target_energy

REPEAT_GAP = 30
ARTIST_GAP = 4
TEMPO_FREE = 0.04
JITTER = 0.02

WEIGHTS = {
    "energy": 2.0, "flow": 1.5, "tempo": 1.0, "key": 0.35, "artist": 0.8, "genre": 0.5,
}
FLOW_FREE = 0.08


@dataclass(frozen=True)
class Candidate:
    """A song in the pool, with the musical facts ranking reads."""

    facts: TrackFacts
    key: str | None = None
    duration: float = 210.0

    @property
    def id(self) -> str:
        return self.facts.id

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> Candidate:
        key = data.get("key")
        return cls(
            facts=TrackFacts.from_mapping(data),
            key=str(key) if key else None,
            duration=float(data.get("duration") or 210.0),
        )


@dataclass(frozen=True)
class Context:
    """Where the evening is. `played` is oldest first and includes the song playing now."""

    played: tuple[str, ...] = ()
    played_artists: tuple[str, ...] = ()
    progress: float = 0.0
    arc: str = "slow_burn"
    energy_bias: float = 0.0
    current_bpm: float | None = None
    current_key: str | None = None
    current_energy: float | None = None
    genre_lean: Mapping[str, float] = field(default_factory=dict)
    avoid_artists: frozenset[str] = frozenset()
    avoid_tracks: frozenset[str] = frozenset()
    repeat_gap: int = REPEAT_GAP
    artist_gap: int = ARTIST_GAP

    @property
    def target(self) -> float:
        return max(0.0, min(1.0, target_energy(self.progress, self.arc) + self.energy_bias))


@dataclass(frozen=True)
class Ranked:
    id: str
    score: float
    terms: dict[str, float]

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "score": round(self.score, 6), "terms": self.terms}


@dataclass(frozen=True)
class Ranking:
    ranked: tuple[Ranked, ...]
    rejected: tuple[tuple[str, tuple[str, ...]], ...]

    @property
    def order(self) -> list[str]:
        return [item.id for item in self.ranked]

    def to_dict(self) -> dict[str, Any]:
        return {
            "ranked": [item.to_dict() for item in self.ranked],
            "rejected": [{"id": i, "reasons": list(r)} for i, r in self.rejected],
        }


def _norm(text: str) -> str:
    return " ".join(text.casefold().split())


def _jitter(seed: int | str, track_id: str) -> float:
    digest = hashlib.sha256(f"{seed}\x1f{track_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def eligibility(candidate: Candidate, context: Context, limits: HardConstraints) -> list[str]:
    """Every reason `candidate` may not play next; empty when it may."""
    reasons = list(breaches(candidate.facts, limits))
    if not candidate.facts.licensed:
        reasons.append("unlicensed")
    recent = context.played[-context.repeat_gap :] if context.repeat_gap > 0 else ()
    if candidate.id in recent:
        reasons.append("played_recently")
    if candidate.id in context.avoid_tracks:
        reasons.append("skipped")
    if candidate.facts.artist and _norm(candidate.facts.artist) in {
        _norm(a) for a in context.avoid_artists
    }:
        reasons.append("artist_avoided")
    return reasons


def terms(candidate: Candidate, context: Context) -> dict[str, float]:
    """The score's parts; higher is better, and every term sits between -1 and 0 or so."""
    facts = candidate.facts
    energy = facts.energy if facts.energy is not None else 0.5
    out = {"energy": -abs(energy - context.target)}
    if context.current_energy is not None:
        out["flow"] = -max(0.0, abs(energy - context.current_energy) - FLOW_FREE)
    else:
        out["flow"] = 0.0
    if context.current_bpm and facts.bpm:
        ratio = abs(facts.bpm / context.current_bpm - 1.0)
        folded = min(ratio, abs(facts.bpm * 2 / context.current_bpm - 1.0),
                     abs(facts.bpm / 2 / context.current_bpm - 1.0))
        out["tempo"] = -max(0.0, folded - TEMPO_FREE) * 5.0
    else:
        out["tempo"] = -0.1
    if context.current_key and candidate.key:
        try:
            out["key"] = -min(camelot_distance(context.current_key, candidate.key), 6) / 6.0
        except (ValueError, IndexError):
            out["key"] = -0.5
    else:
        out["key"] = -0.25
    artist = _norm(facts.artist) if facts.artist else ""
    recent_artists = [_norm(a) for a in context.played_artists[-context.artist_gap :]]
    if artist and artist in recent_artists:
        distance = len(recent_artists) - max(
            i for i, name in enumerate(recent_artists) if name == artist
        )
        out["artist"] = -1.0 / distance
    else:
        out["artist"] = 0.0
    lean = 0.0
    for genre in facts.genres:
        lean = max(lean, float(context.genre_lean.get(_norm(genre), 0.0)))
    out["genre"] = lean
    return out


def rank(
    pool: Iterable[Candidate],
    context: Context,
    limits: HardConstraints | None = None,
    seed: int | str = 0,
) -> Ranking:
    limits = limits if limits is not None else HardConstraints(allow_explicit=True)
    seen: set[str] = set()
    ranked: list[Ranked] = []
    rejected: list[tuple[str, tuple[str, ...]]] = []
    for candidate in sorted(pool, key=lambda c: c.id):
        if candidate.id in seen:
            continue
        seen.add(candidate.id)
        reasons = eligibility(candidate, context, limits)
        if reasons:
            rejected.append((candidate.id, tuple(reasons)))
            continue
        parts = terms(candidate, context)
        jitter = _jitter(seed, candidate.id)
        score = sum(WEIGHTS[name] * value for name, value in parts.items()) + JITTER * jitter
        ranked.append(Ranked(candidate.id, score, {k: round(v, 6) for k, v in parts.items()}))
    ranked.sort(key=lambda item: (-round(item.score, 9), item.id))
    return Ranking(tuple(ranked), tuple(rejected))


def plan_window(
    pool: Sequence[Candidate],
    context: Context,
    limits: HardConstraints | None = None,
    seed: int | str = 0,
    length: int = 8,
    seconds_left: float | None = None,
    evening_seconds: float = 6 * 3600.0,
) -> list[Candidate]:
    """A tentative window of `length` songs, chosen greedily one at a time with the context
    moved on after each pick (so the window itself respects repeat and artist spacing)."""
    by_id = {c.id: c for c in pool}
    picks: list[Candidate] = []
    played = list(context.played)
    artists = list(context.played_artists)
    progress = context.progress
    bpm, key, level = context.current_bpm, context.current_key, context.current_energy
    for _ in range(length):
        step = replace(
            context, played=tuple(played), played_artists=tuple(artists), progress=progress,
            current_bpm=bpm, current_key=key, current_energy=level,
        )
        ranking = rank(pool, step, limits, seed=f"{seed}:{len(played)}")
        gap = step.repeat_gap
        while not ranking.ranked and gap > 1:
            # A small licensed pool can't keep the full repeat gap all night. Shrink it rather
            # than go silent; hard constraints and avoids never relax.
            gap //= 2
            step = replace(step, repeat_gap=gap)
            ranking = rank(pool, step, limits, seed=f"{seed}:{len(played)}")
        if not ranking.ranked:
            break
        choice = by_id[ranking.ranked[0].id]
        picks.append(choice)
        played.append(choice.id)
        artists.append(choice.facts.artist)
        bpm, key = choice.facts.bpm or bpm, choice.key or key
        level = choice.facts.energy if choice.facts.energy is not None else level
        progress = min(1.0, progress + choice.duration / evening_seconds)
        if seconds_left is not None:
            seconds_left -= choice.duration
            if seconds_left <= 0:
                break
    return picks


__all__ = [
    "ARTIST_GAP",
    "REPEAT_GAP",
    "Candidate",
    "Context",
    "Ranked",
    "Ranking",
    "eligibility",
    "plan_window",
    "rank",
    "terms",
]
