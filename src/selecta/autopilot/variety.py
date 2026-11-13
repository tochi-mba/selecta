"""Measure a whole evening's variety (ADR-0426, AV-0426-04).

`simulate_evening` plays a synthetic six-hour night through the same `ranking.plan_window` the
horizon uses, one horizon window at a time, so what is measured is what Autopilot would choose.
`measure` reads any played sequence (simulated or a real night's log) and reports:

- repeats: how many songs came back, and the shortest gap between two plays of one song, in
  songs and in minutes;
- artist spacing: the shortest and mean gap between two songs by the same artist;
- energy arc: the mean and worst distance from the arc target, and the biggest step between two
  neighbouring songs (an abrupt shift is what a room notices);
- unique share: distinct songs over songs played.

`VarietyThresholds` holds the numbers a night must meet; `VarietyReport.failures` lists each one
it misses in plain words. These are proxies a machine can check. Whether the night tells a good
story is a listening question (AV-0426-05) and stays with people.
"""

from __future__ import annotations

import random
from collections.abc import Sequence
from dataclasses import asdict, dataclass

from selecta.autopilot.ranking import Candidate, Context, plan_window
from selecta.autopilot.venue_policy import HardConstraints, TrackFacts
from selecta.planner.arc import target_energy

GENRES = ("house", "disco", "soul", "funk", "afrobeat", "nu jazz", "garage", "boogie")
KEYS = tuple(f"{n}{m}" for n in range(1, 13) for m in "AB")


@dataclass(frozen=True)
class Played:
    track_id: str
    artist: str
    energy: float
    start: float
    duration: float


@dataclass(frozen=True)
class VarietyThresholds:
    min_repeat_songs: int = 30
    min_repeat_minutes: float = 120.0
    min_artist_gap: int = 3
    max_energy_step: float = 0.25
    max_mean_arc_error: float = 0.12
    min_unique_share: float = 0.6
    min_hours: float = 6.0


@dataclass(frozen=True)
class VarietyReport:
    songs: int
    hours: float
    repeats: int
    min_repeat_songs: int | None
    min_repeat_minutes: float | None
    min_artist_gap: int | None
    mean_artist_gap: float | None
    max_energy_step: float
    mean_arc_error: float
    max_arc_error: float
    unique_share: float

    def failures(self, limits: VarietyThresholds | None = None) -> list[str]:
        limits = limits or VarietyThresholds()
        found: list[str] = []
        if self.hours < limits.min_hours:
            found.append(f"only {self.hours:.2f} hours were planned")
        if self.min_repeat_songs is not None and self.min_repeat_songs < limits.min_repeat_songs:
            found.append(f"a song came back after {self.min_repeat_songs} songs")
        if (
            self.min_repeat_minutes is not None
            and self.min_repeat_minutes < limits.min_repeat_minutes
        ):
            found.append(f"a song came back after {self.min_repeat_minutes:.0f} minutes")
        if self.min_artist_gap is not None and self.min_artist_gap < limits.min_artist_gap:
            found.append(f"an artist came back after {self.min_artist_gap} songs")
        if self.max_energy_step > limits.max_energy_step:
            found.append(f"energy jumped by {self.max_energy_step:.2f} between two songs")
        if self.mean_arc_error > limits.max_mean_arc_error:
            found.append(f"energy sat {self.mean_arc_error:.2f} off the arc on average")
        if self.unique_share < limits.min_unique_share:
            found.append(f"only {self.unique_share:.0%} of songs were distinct")
        return found

    def to_dict(self) -> dict:
        return asdict(self)


def synthetic_catalogue(size: int = 400, artists: int = 120, seed: int = 7) -> list[Candidate]:
    """A made-up, licensed catalogue with spread-out energy, tempo, key and genre."""
    rng = random.Random(seed)
    pool: list[Candidate] = []
    for i in range(size):
        energy = min(1.0, max(0.05, rng.gauss(0.6, 0.2)))
        facts = TrackFacts(
            id=f"t{i:04d}",
            artist=f"Artist {rng.randrange(artists):03d}",
            genres=(rng.choice(GENRES),),
            bpm=round(96 + energy * 34 + rng.uniform(-4, 4), 1),
            energy=round(energy, 3),
            explicit=rng.random() < 0.1,
            source="synthetic",
            licensed=True,
        )
        pool.append(Candidate(facts, key=rng.choice(KEYS), duration=rng.uniform(170, 330)))
    return pool


def simulate_evening(
    pool: Sequence[Candidate],
    hours: float = 6.0,
    seed: int | str = 0,
    arc: str = "slow_burn",
    limits: HardConstraints | None = None,
    window: int = 8,
) -> list[Played]:
    """Plan a whole night window by window; the first song of each window plays, as the
    horizon would advance, and the rest is replanned next time round."""
    total = hours * 3600.0
    by_id = {c.id: c for c in pool}
    played: list[Played] = []
    clock = 0.0
    while clock < total:
        context = Context(
            played=tuple(p.track_id for p in played),
            played_artists=tuple(p.artist for p in played),
            progress=clock / total,
            arc=arc,
            current_bpm=by_id[played[-1].track_id].facts.bpm if played else None,
            current_key=by_id[played[-1].track_id].key if played else None,
            current_energy=played[-1].energy if played else None,
        )
        picks = plan_window(pool, context, limits, seed=seed, length=window,
                            evening_seconds=total)
        if not picks:
            break
        pick = picks[0]
        played.append(
            Played(pick.id, pick.facts.artist, pick.facts.energy or 0.5, clock, pick.duration)
        )
        clock += pick.duration
    return played


def measure(night: Sequence[Played], arc: str = "slow_burn") -> VarietyReport:
    if not night:
        return VarietyReport(0, 0.0, 0, None, None, None, None, 0.0, 0.0, 0.0, 0.0)
    end = night[-1].start + night[-1].duration
    last_seen: dict[str, int] = {}
    repeat_songs: list[int] = []
    repeat_minutes: list[float] = []
    artist_seen: dict[str, int] = {}
    artist_gaps: list[int] = []
    for index, song in enumerate(night):
        if song.track_id in last_seen:
            before = last_seen[song.track_id]
            repeat_songs.append(index - before)
            repeat_minutes.append((song.start - night[before].start) / 60.0)
        last_seen[song.track_id] = index
        if song.artist:
            if song.artist in artist_seen:
                artist_gaps.append(index - artist_seen[song.artist])
            artist_seen[song.artist] = index
    steps = [abs(b.energy - a.energy) for a, b in zip(night, night[1:], strict=False)]
    errors = [abs(s.energy - target_energy(s.start / end, arc)) for s in night]
    return VarietyReport(
        songs=len(night),
        hours=round(end / 3600.0, 3),
        repeats=len(repeat_songs),
        min_repeat_songs=min(repeat_songs) if repeat_songs else None,
        min_repeat_minutes=round(min(repeat_minutes), 2) if repeat_minutes else None,
        min_artist_gap=min(artist_gaps) if artist_gaps else None,
        mean_artist_gap=round(sum(artist_gaps) / len(artist_gaps), 2) if artist_gaps else None,
        max_energy_step=round(max(steps, default=0.0), 4),
        mean_arc_error=round(sum(errors) / len(errors), 4),
        max_arc_error=round(max(errors), 4),
        unique_share=round(len(last_seen) / len(night), 4),
    )


__all__ = [
    "Played",
    "VarietyReport",
    "VarietyThresholds",
    "measure",
    "simulate_evening",
    "synthetic_catalogue",
]
