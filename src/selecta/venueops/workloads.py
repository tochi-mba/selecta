"""Realistic venue workloads for long-session and chaos runs (ADR-0437, AV-0437-01).

A muted UI test that plays three songs proves nothing about a Friday night. These workloads write
down what a real venue evening asks of SelectaDJ: how long the night is, how big the library is,
how long songs run, how often guests ask for songs, how many zones play at once, and how much
background work (analysis, discovery, exports) competes with playback while the room is full.

The numbers are planning assumptions taken from the venue scenarios in ADR-0424 to ADR-0433 (a
six-hour bar evening, a café day, a retail day, a request-heavy party). They are not measurements
of a real venue; the pilot plan (docs/autopilot/pilot-plan.md) is where real numbers come from.

The soak harness (`selecta.venueops.soak`) turns a workload into a timeline of plays, requests
and background jobs, deterministically from a seed, so two runs of one workload are comparable.
"""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass, field

FLAG = "venue.soak"


@dataclass(frozen=True)
class BackgroundLoad:
    """Work that competes with playback during the night, as jobs per hour."""

    analysis_per_hour: float = 0.0
    discovery_per_hour: float = 0.0
    export_per_hour: float = 0.0
    seam_renders_per_song: float = 1.0


@dataclass(frozen=True)
class Workload:
    """One kind of venue night, in numbers the soak harness can run."""

    id: str
    title: str
    hours: float
    library_songs: int
    zones: int
    mean_song_s: float
    song_spread_s: float
    blend_s: float
    requests_per_hour: float
    staff_steers_per_hour: float
    background: BackgroundLoad = field(default_factory=BackgroundLoad)
    notes: str = ""

    def __post_init__(self) -> None:
        if self.hours <= 0:
            raise ValueError(f"{self.id}: a night must last more than zero hours.")
        if self.zones < 1:
            raise ValueError(f"{self.id}: a venue has at least one zone.")
        if self.library_songs < 1:
            raise ValueError(f"{self.id}: the library needs at least one song.")
        if self.mean_song_s <= self.blend_s:
            raise ValueError(f"{self.id}: songs must be longer than the blend between them.")
        if self.requests_per_hour < 0 or self.staff_steers_per_hour < 0:
            raise ValueError(f"{self.id}: rates can't be negative.")

    @property
    def seconds(self) -> float:
        return self.hours * 3600.0

    def expected_songs_per_zone(self) -> int:
        """Roughly how many songs one zone plays across the night."""
        return int(self.seconds // (self.mean_song_s - self.blend_s)) + 1

    def as_dict(self) -> dict:
        data = asdict(self)
        data["expected_songs_per_zone"] = self.expected_songs_per_zone()
        return data


WORKLOADS: dict[str, Workload] = {
    w.id: w
    for w in (
        Workload(
            id="bar-evening-6h",
            title="Six-hour bar evening",
            hours=6.0,
            library_songs=2_500,
            zones=1,
            mean_song_s=225.0,
            song_spread_s=45.0,
            blend_s=8.0,
            requests_per_hour=6.0,
            staff_steers_per_hour=2.0,
            background=BackgroundLoad(analysis_per_hour=20.0, discovery_per_hour=1.0),
            notes="The ADR-0429 target night: one main room, a few requests, imports trickling in.",
        ),
        Workload(
            id="cafe-day-4h",
            title="Four-hour café session",
            hours=4.0,
            library_songs=800,
            zones=1,
            mean_song_s=240.0,
            song_spread_s=40.0,
            blend_s=6.0,
            requests_per_hour=0.5,
            staff_steers_per_hour=0.5,
            background=BackgroundLoad(analysis_per_hour=5.0),
            notes="Quiet background music, almost no requests, a small library that repeats risk.",
        ),
        Workload(
            id="retail-day-8h",
            title="Eight-hour retail day, two zones",
            hours=8.0,
            library_songs=5_000,
            zones=2,
            mean_song_s=210.0,
            song_spread_s=35.0,
            blend_s=6.0,
            requests_per_hour=0.0,
            staff_steers_per_hour=0.25,
            background=BackgroundLoad(
                analysis_per_hour=40.0, discovery_per_hour=2.0, export_per_hour=0.25
            ),
            notes="Long unattended day across shop floor and fitting rooms; heavy import load.",
        ),
        Workload(
            id="party-requests-5h",
            title="Five-hour request-heavy party",
            hours=5.0,
            library_songs=10_000,
            zones=1,
            mean_song_s=195.0,
            song_spread_s=50.0,
            blend_s=12.0,
            requests_per_hour=40.0,
            staff_steers_per_hour=6.0,
            background=BackgroundLoad(
                analysis_per_hour=10.0, discovery_per_hour=4.0, export_per_hour=0.5,
                seam_renders_per_song=1.5,
            ),
            notes="A busy Room with many guest requests and frequent re-planning of the next seam.",
        ),
        Workload(
            id="smoke-10m",
            title="Ten-minute smoke run",
            hours=10.0 / 60.0,
            library_songs=40,
            zones=1,
            mean_song_s=60.0,
            song_spread_s=10.0,
            blend_s=4.0,
            requests_per_hour=12.0,
            staff_steers_per_hour=6.0,
            background=BackgroundLoad(analysis_per_hour=30.0, discovery_per_hour=6.0),
            notes="For CI and quick checks only; it is not soak evidence.",
        ),
    )
}


def get(workload_id: str) -> Workload:
    try:
        return WORKLOADS[workload_id]
    except KeyError:
        known = ", ".join(sorted(WORKLOADS))
        raise KeyError(f"There's no workload {workload_id!r}. Known: {known}.") from None


@dataclass(frozen=True)
class Event:
    """One thing that happens during a simulated night, on the night clock in seconds."""

    at_s: float
    kind: str  # "song", "request", "steer", "analysis", "discovery", "export"
    zone_id: str = "main"
    song_id: str | None = None
    length_s: float = 0.0


def _poisson_times(rng: random.Random, per_hour: float, seconds: float) -> list[float]:
    times: list[float] = []
    if per_hour <= 0:
        return times
    rate = per_hour / 3600.0
    t = rng.expovariate(rate)
    while t < seconds:
        times.append(t)
        t += rng.expovariate(rate)
    return times


def zone_ids(workload: Workload) -> list[str]:
    return ["main"] + [f"zone-{n}" for n in range(2, workload.zones + 1)]


def schedule(workload: Workload, seed: int = 0, limit_s: float | None = None) -> list[Event]:
    """A deterministic timeline of songs, requests, steers and background jobs.

    Songs in each zone follow one another with the workload's planned blend and never repeat a
    song inside the last quarter of the library, which is how the planner keeps repeats away on
    a small library. `limit_s` cuts the night short (a ten-minute run of a six-hour workload).
    """
    rng = random.Random(seed)
    seconds = min(workload.seconds, limit_s) if limit_s else workload.seconds
    events: list[Event] = []
    recent_cap = max(1, workload.library_songs // 4)
    for zone in zone_ids(workload):
        t = 0.0
        recent: list[int] = []
        while t < seconds:
            length = max(
                workload.blend_s + 30.0, rng.gauss(workload.mean_song_s, workload.song_spread_s)
            )
            song = rng.randrange(workload.library_songs)
            tries = 0
            while song in recent and tries < 50:
                song = rng.randrange(workload.library_songs)
                tries += 1
            recent.append(song)
            if len(recent) > recent_cap:
                recent.pop(0)
            events.append(Event(t, "song", zone, f"song-{song:05d}", length))
            t += length - workload.blend_s
    bg = workload.background
    rates = (
        ("request", workload.requests_per_hour),
        ("steer", workload.staff_steers_per_hour),
        ("analysis", bg.analysis_per_hour),
        ("discovery", bg.discovery_per_hour),
        ("export", bg.export_per_hour),
    )
    for kind, per_hour in rates:
        events += [Event(at, kind) for at in _poisson_times(rng, per_hour, seconds)]
    events.sort(key=lambda e: (e.at_s, e.kind, e.zone_id))
    return events
