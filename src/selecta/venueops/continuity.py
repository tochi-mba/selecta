"""Venue audio continuity: gap and duplicate targets, and an evaluator over what was played.

ADR-0429 asks a venue night to keep playing for six hours without dead air, without two
speakers playing over each other and without the same song coming back too soon. This module
writes those promises down as numbered targets (service level objectives) and checks a played
timeline against them.

The timeline is a plain log: one `Play` per song that actually reached a speaker, with its
start and end on the night's clock in seconds. A planned crossfade is not an overlap; the play
says how much it overlaps the one before on purpose (`blend_s`), and only the excess counts.

Nothing here touches audio or files. It is pure arithmetic over a log, so the same evaluator
checks a unit-test simulation, a rehearsal with injected faults and a real named-hardware soak.
The flag `venue.continuity` gates the runtime that uses these targets, not the arithmetic.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum

FLAG = "venue.continuity"

# A silence shorter than this is a tight cut, not a gap anyone in the room notices.
AUDIBLE_GAP_S = 0.25
# Planned blends longer than this are treated as a fault, whatever the play says.
MAX_BLEND_S = 32.0


class Comparator(StrEnum):
    AT_MOST = "at_most"
    AT_LEAST = "at_least"


@dataclass(frozen=True)
class Slo:
    """One continuity target with a number a test or a soak can check."""

    id: str
    title: str
    target: float
    unit: str
    comparator: Comparator = Comparator.AT_MOST
    why: str = ""

    def passes(self, measured: float) -> bool:
        if self.comparator is Comparator.AT_MOST:
            return measured <= self.target + 1e-9
        return measured >= self.target - 1e-9


# The targets. Numbers are deliberately strict: a venue notices dead air in seconds.
SLOS: tuple[Slo, ...] = (
    Slo(
        "gap.longest_s",
        "Longest single silence",
        2.0,
        "seconds",
        why="Even a fault must be covered by a fallback song within two seconds.",
    ),
    Slo(
        "gap.total_s_per_hour",
        "Total silence per hour",
        5.0,
        "seconds per hour",
        why="Audible gaps added together stay under five seconds in any hour on average.",
    ),
    Slo(
        "gap.count_per_hour",
        "Audible gaps per hour",
        1.0,
        "gaps per hour",
        why="At most one audible gap an hour on average across the night.",
    ),
    Slo(
        "overlap.unplanned_s",
        "Unplanned overlap",
        0.0,
        "seconds",
        why="Two speakers, or two songs outside a planned blend, never play at once.",
    ),
    Slo(
        "duplicate.within_window",
        "Repeats inside the no-repeat window",
        0.0,
        "plays",
        why="The same song does not come back within the no-repeat window.",
    ),
    Slo(
        "duplicate.back_to_back",
        "Back-to-back repeats",
        0.0,
        "plays",
        why="The same song never plays twice in a row, even from the fallback cache.",
    ),
    Slo(
        "coverage.ratio",
        "Share of the night with music",
        0.998,
        "fraction",
        Comparator.AT_LEAST,
        why="At least 99.8 percent of the booked night has music on a speaker.",
    ),
)

SLO_BY_ID = {slo.id: slo for slo in SLOS}

# The no-repeat window for the duplicate targets, in minutes of night clock.
NO_REPEAT_WINDOW_MIN = 60.0


@dataclass(frozen=True)
class Play:
    """One song that reached a speaker. Times are seconds on the night's clock."""

    song_id: str
    start_s: float
    end_s: float
    speaker_id: str = "main"
    zone_id: str = "main"
    blend_s: float = 0.0  # planned overlap with the previous play in the same zone
    source: str = "plan"  # "plan", "fallback" or "manual"

    def __post_init__(self) -> None:
        if self.end_s < self.start_s:
            raise ValueError(f"Play of {self.song_id!r} ends before it starts.")
        if self.blend_s < 0:
            raise ValueError("A planned blend can't be negative.")


@dataclass(frozen=True)
class Gap:
    zone_id: str
    start_s: float
    end_s: float
    after_song: str | None

    @property
    def length_s(self) -> float:
        return self.end_s - self.start_s


@dataclass(frozen=True)
class Overlap:
    zone_id: str
    start_s: float
    end_s: float
    songs: tuple[str, str]
    speakers: tuple[str, str]

    @property
    def length_s(self) -> float:
        return self.end_s - self.start_s


@dataclass(frozen=True)
class Duplicate:
    zone_id: str
    song_id: str
    first_start_s: float
    again_start_s: float
    back_to_back: bool


@dataclass(frozen=True)
class SloResult:
    slo: Slo
    measured: float
    passed: bool


@dataclass(frozen=True)
class ContinuityReport:
    night_start_s: float
    night_end_s: float
    gaps: tuple[Gap, ...]
    overlaps: tuple[Overlap, ...]
    duplicates: tuple[Duplicate, ...]
    results: tuple[SloResult, ...]
    plays: int = 0
    notes: tuple[str, ...] = field(default=())

    @property
    def passed(self) -> bool:
        return all(result.passed for result in self.results)

    def result(self, slo_id: str) -> SloResult:
        for result in self.results:
            if result.slo.id == slo_id:
                return result
        raise KeyError(slo_id)

    def failures(self) -> list[str]:
        return [r.slo.id for r in self.results if not r.passed]

    def as_dict(self) -> dict:
        return {
            "passed": self.passed,
            "plays": self.plays,
            "night_s": self.night_end_s - self.night_start_s,
            "gaps": [
                {"zone": g.zone_id, "start_s": g.start_s, "length_s": round(g.length_s, 3)}
                for g in self.gaps
            ],
            "overlaps": [
                {"zone": o.zone_id, "start_s": o.start_s, "length_s": round(o.length_s, 3),
                 "songs": list(o.songs), "speakers": list(o.speakers)}
                for o in self.overlaps
            ],
            "duplicates": [
                {"zone": d.zone_id, "song": d.song_id, "again_s": d.again_start_s,
                 "back_to_back": d.back_to_back}
                for d in self.duplicates
            ],
            "slos": [
                {"id": r.slo.id, "target": r.slo.target, "unit": r.slo.unit,
                 "measured": round(r.measured, 4), "passed": r.passed}
                for r in self.results
            ],
            "notes": list(self.notes),
        }


def _zone_plays(plays: Iterable[Play]) -> dict[str, list[Play]]:
    zones: dict[str, list[Play]] = {}
    for play in plays:
        zones.setdefault(play.zone_id, []).append(play)
    for items in zones.values():
        items.sort(key=lambda p: (p.start_s, p.end_s))
    return zones


def _clip(play: Play, start: float, end: float) -> tuple[float, float]:
    return max(play.start_s, start), min(play.end_s, end)


def find_gaps(
    plays: Sequence[Play], night_start_s: float, night_end_s: float, zone_id: str
) -> list[Gap]:
    """Audible silences in one zone, including before the first and after the last play."""
    gaps: list[Gap] = []
    cursor = night_start_s
    last_song: str | None = None
    for play in plays:
        start, end = _clip(play, night_start_s, night_end_s)
        if end <= start:
            continue
        if start - cursor > AUDIBLE_GAP_S:
            gaps.append(Gap(zone_id, cursor, start, last_song))
        if end > cursor:
            cursor = end
            last_song = play.song_id
    if night_end_s - cursor > AUDIBLE_GAP_S:
        gaps.append(Gap(zone_id, cursor, night_end_s, last_song))
    return gaps


def find_overlaps(plays: Sequence[Play], zone_id: str) -> list[Overlap]:
    """Time two plays in one zone sound together beyond what the later one planned to blend."""
    overlaps: list[Overlap] = []
    for index, later in enumerate(plays):
        for earlier in plays[:index]:
            shared_start = max(earlier.start_s, later.start_s)
            shared_end = min(earlier.end_s, later.end_s)
            if shared_end <= shared_start:
                continue
            allowed = 0.0
            # A blend is allowed only between the previous play and this one, on one speaker.
            if earlier is plays[index - 1] and earlier.speaker_id == later.speaker_id:
                allowed = min(later.blend_s, MAX_BLEND_S)
            excess = (shared_end - shared_start) - allowed
            if excess > 1e-6:
                overlaps.append(
                    Overlap(
                        zone_id,
                        shared_end - excess,
                        shared_end,
                        (earlier.song_id, later.song_id),
                        (earlier.speaker_id, later.speaker_id),
                    )
                )
    return overlaps


def find_duplicates(
    plays: Sequence[Play], zone_id: str, window_min: float = NO_REPEAT_WINDOW_MIN
) -> list[Duplicate]:
    duplicates: list[Duplicate] = []
    last_start: dict[str, float] = {}
    previous: str | None = None
    for play in plays:
        seen = last_start.get(play.song_id)
        back_to_back = previous == play.song_id
        if back_to_back or (seen is not None and play.start_s - seen < window_min * 60.0):
            duplicates.append(
                Duplicate(zone_id, play.song_id, seen if seen is not None else play.start_s,
                          play.start_s, back_to_back)
            )
        last_start[play.song_id] = play.start_s
        previous = play.song_id
    return duplicates


def evaluate(
    plays: Iterable[Play],
    night_start_s: float,
    night_end_s: float,
    *,
    zones: Iterable[str] | None = None,
    window_min: float = NO_REPEAT_WINDOW_MIN,
) -> ContinuityReport:
    """Check a played timeline against every continuity target.

    `zones` lists the zones that were booked to play; a booked zone with no plays at all is one
    long gap. Without it, the zones that appear in the log are the booked ones.
    """
    if night_end_s <= night_start_s:
        raise ValueError("The night must end after it starts.")
    plays = list(plays)
    by_zone = _zone_plays(plays)
    booked = list(zones) if zones is not None else sorted(by_zone) or ["main"]
    gaps: list[Gap] = []
    overlaps: list[Overlap] = []
    duplicates: list[Duplicate] = []
    notes: list[str] = []
    for zone in booked:
        zone_plays = by_zone.get(zone, [])
        if not zone_plays:
            notes.append(f"Zone {zone!r} was booked but nothing played there.")
        gaps += find_gaps(zone_plays, night_start_s, night_end_s, zone)
        overlaps += find_overlaps(zone_plays, zone)
        duplicates += find_duplicates(zone_plays, zone, window_min)
    for zone in sorted(set(by_zone) - set(booked)):
        notes.append(f"Zone {zone!r} played but was not booked.")

    hours = (night_end_s - night_start_s) / 3600.0
    zone_count = max(1, len(booked))
    total_gap = sum(g.length_s for g in gaps)
    measured = {
        "gap.longest_s": max((g.length_s for g in gaps), default=0.0),
        "gap.total_s_per_hour": total_gap / (hours * zone_count),
        "gap.count_per_hour": len(gaps) / (hours * zone_count),
        "overlap.unplanned_s": sum(o.length_s for o in overlaps),
        "duplicate.within_window": float(sum(1 for d in duplicates if not d.back_to_back)),
        "duplicate.back_to_back": float(sum(1 for d in duplicates if d.back_to_back)),
        "coverage.ratio": 1.0 - total_gap / ((night_end_s - night_start_s) * zone_count),
    }
    results = tuple(SloResult(slo, measured[slo.id], slo.passes(measured[slo.id])) for slo in SLOS)
    return ContinuityReport(
        night_start_s,
        night_end_s,
        tuple(gaps),
        tuple(overlaps),
        tuple(duplicates),
        results,
        plays=len(plays),
        notes=tuple(notes),
    )


def slo_table() -> list[dict]:
    """The targets as rows, for docs, the soak protocol and a staff screen."""
    return [
        {"id": s.id, "title": s.title, "target": s.target, "unit": s.unit,
         "comparator": s.comparator.value, "why": s.why}
        for s in SLOS
    ]
