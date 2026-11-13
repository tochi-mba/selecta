"""Fault rehearsal: inject network, model and render faults and prove the night keeps playing.

ADR-0429 AV-0429-04. Behind `venue.fault_injection` (which needs `venue.continuity`), a venue
rehearsal can schedule faults on purpose:

- network: the next planned song can't be fetched,
- model: the planner can't choose the next song,
- render: the planned transition can't be rendered,
- speaker_drop: the playing speaker goes silent (crash, sleep, Wi-Fi) mid-song.

The schedule is deterministic from a seed, so a failing rehearsal can be replayed exactly.

`simulate_night` runs a whole venue night in simulated time against a schedule: a ready-made
fallback covers any song the plan can't deliver, a standby speaker takes the zone through a
fenced lease when the playing one drops, and the late commands of the dropped speaker are
refused. The played timeline is then checked against the continuity targets. Six simulated hours
take well under a second, so this runs in a unit test; a real named-hardware soak is a person
step (docs/autopilot/six-hour-soak-protocol.md).
"""

from __future__ import annotations

import math
import random
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum

from selecta import flags
from selecta.venueops.continuity import ContinuityReport, Play, evaluate
from selecta.venueops.fallback_cache import Candidate, FallbackCache
from selecta.venueops.leases import FencedSpeaker, LeaseTable

FLAG = "venue.fault_injection"


class FaultKind(StrEnum):
    NETWORK = "network"
    MODEL = "model"
    RENDER = "render"
    SPEAKER_DROP = "speaker_drop"


PREP_FAULTS = (FaultKind.NETWORK, FaultKind.MODEL, FaultKind.RENDER)


@dataclass(frozen=True)
class Fault:
    kind: FaultKind
    at_s: float
    duration_s: float

    @property
    def end_s(self) -> float:
        return self.at_s + self.duration_s

    def active(self, start_s: float, end_s: float) -> bool:
        """True when this fault overlaps the window [start_s, end_s]."""
        return self.at_s <= end_s and self.end_s >= start_s


@dataclass(frozen=True)
class FaultPlan:
    seed: int
    night_s: float
    faults: tuple[Fault, ...]

    def of(self, kind: FaultKind) -> list[Fault]:
        return [f for f in self.faults if f.kind is kind]


# Faults per hour and how long each lasts (min, max seconds) in a default rehearsal.
DEFAULT_RATES: dict[FaultKind, tuple[float, float, float]] = {
    FaultKind.NETWORK: (1.0, 20.0, 240.0),
    FaultKind.MODEL: (0.5, 10.0, 120.0),
    FaultKind.RENDER: (0.5, 5.0, 60.0),
    FaultKind.SPEAKER_DROP: (0.25, 30.0, 300.0),
}


def schedule(
    seed: int,
    night_s: float,
    rates: dict[FaultKind, tuple[float, float, float]] | None = None,
) -> FaultPlan:
    """A deterministic fault schedule: the same seed always gives the same faults."""
    flags.require(FLAG)
    rng = random.Random(seed)
    faults: list[Fault] = []
    for kind, (per_hour, shortest, longest) in (rates or DEFAULT_RATES).items():
        expected = per_hour * night_s / 3600.0
        count = int(expected) + (1 if rng.random() < expected - int(expected) else 0)
        for _ in range(count):
            at = rng.uniform(60.0, max(61.0, night_s - 60.0))
            faults.append(Fault(kind, round(at, 3), round(rng.uniform(shortest, longest), 3)))
    faults.sort(key=lambda f: (f.at_s, f.kind.value))
    return FaultPlan(seed, night_s, tuple(faults))


@dataclass
class FaultInjector:
    """What the runtime asks before each step: is this operation failing right now?"""

    plan: FaultPlan
    fired: list[tuple[float, FaultKind]] = field(default_factory=list)

    def failing(self, kind: FaultKind, start_s: float, end_s: float | None = None) -> Fault | None:
        flags.require(FLAG)
        end = start_s if end_s is None else end_s
        for fault in self.plan.of(kind):
            if fault.active(start_s, end):
                self.fired.append((start_s, kind))
                return fault
        return None

    def prep_blocked(self, start_s: float, end_s: float) -> Fault | None:
        """The first network, model or render fault that stops the next song being ready."""
        hits = [f for k in PREP_FAULTS if (f := self.failing(k, start_s, end_s)) is not None]
        return min(hits, key=lambda f: f.end_s) if hits else None

    def next_drop(self, start_s: float, end_s: float) -> Fault | None:
        flags.require(FLAG)
        for fault in self.plan.of(FaultKind.SPEAKER_DROP):
            if start_s <= fault.at_s < end_s:
                return fault
        return None


@dataclass(frozen=True)
class Song:
    song_id: str
    duration_s: float


@dataclass(frozen=True)
class Recovery:
    fault: FaultKind
    at_s: float
    how: str  # "fallback", "silence", "failover", "reconnect"
    detail: str = ""


@dataclass
class NightResult:
    plays: list[Play]
    report: ContinuityReport
    plan: FaultPlan
    recoveries: list[Recovery]
    stale_refused: int
    lease_events: int

    @property
    def passed(self) -> bool:
        return self.report.passed

    def summary(self) -> dict:
        data = self.report.as_dict()
        data.update(
            seed=self.plan.seed,
            faults={k.value: len(self.plan.of(k)) for k in FaultKind},
            recoveries=[{"fault": r.fault.value, "at_s": round(r.at_s, 2), "how": r.how}
                        for r in self.recoveries],
            stale_refused=self.stale_refused,
        )
        return data


def _always_playable(_candidate: Candidate) -> str | None:
    return None


def simulate_night(
    plan_songs: Sequence[Song],
    fallback_songs: Sequence[Song],
    *,
    hours: float = 6.0,
    seed: int = 429,
    faults: FaultPlan | None = None,
    use_fallbacks: bool = True,
    blend_s: float = 8.0,
    lead_s: float = 60.0,
    heartbeat_s: float = 0.5,
    lease_ttl_s: float = 1.0,
    zone_id: str = "main",
) -> NightResult:
    """Run a venue night in simulated time against faults and check the continuity targets."""
    flags.require(FLAG)
    night_s = hours * 3600.0
    plan = faults if faults is not None else schedule(seed, night_s)
    injector = FaultInjector(plan)
    table = LeaseTable(ttl_s=lease_ttl_s)
    speakers = {sid: FencedSpeaker(sid, table) for sid in ("speaker-a", "speaker-b")}
    down_until: dict[str, float] = {sid: -1.0 for sid in speakers}
    active = speakers["speaker-a"]
    active.hold(table.acquire(zone_id, active.speaker_id, 0.0))

    cache = FallbackCache(checker=_always_playable)
    pool = [Candidate(s.song_id, path=_NO_PATH, sha256="", rights_cleared=True, rendered=True,
                      analysed=True, duration_s=s.duration_s) for s in fallback_songs]
    if use_fallbacks:
        cache.prefetch(pool, now_s=0.0)

    plays: list[Play] = []
    recoveries: list[Recovery] = []
    stale_refused = 0
    next_plan = 0
    t = 0.0
    previous_planned = False

    def heartbeat_through(start: float, end: float) -> None:
        tick = math.ceil(start / heartbeat_s) * heartbeat_s
        while tick < end:
            active.heartbeat(tick)
            tick += heartbeat_s

    while t < night_s - 0.25:
        blocked = injector.prep_blocked(t - lead_s, t) if t > 0 else None
        song: Song
        source = "plan"
        if blocked is not None:
            chosen = cache.take(now_s=t) if use_fallbacks else None
            if chosen is None:
                recoveries.append(Recovery(blocked.kind, t, "silence"))
                # Nothing ready: wait out the fault, keeping the lease alive.
                heartbeat_through(t, blocked.end_s)
                t = blocked.end_s + heartbeat_s
                previous_planned = False
                continue
            recoveries.append(Recovery(blocked.kind, t, "fallback", chosen.song_id))
            song, source = Song(chosen.song_id, chosen.duration_s), "fallback"
        else:
            song = plan_songs[next_plan % len(plan_songs)]
            next_plan += 1
        blend = blend_s if (source == "plan" and previous_planned and plays) else 0.0
        start = max(0.0, t - blend)
        end = min(start + song.duration_s, night_s)
        if not active.play(song.song_id, start):
            raise RuntimeError("The active speaker lost its lease without a drop.")
        drop = injector.next_drop(start, end)
        if drop is None:
            heartbeat_through(start, end)
            plays.append(Play(song.song_id, start, end, active.speaker_id, zone_id, blend, source))
            t = end
            previous_planned = source == "plan"
        else:
            heartbeat_through(start, drop.at_s)
            plays.append(Play(song.song_id, start, drop.at_s, active.speaker_id, zone_id, blend,
                              source))
            dropped = active
            down_until[dropped.speaker_id] = drop.end_s
            lease = table.current(zone_id, drop.at_s)
            expires = lease.expires_at if lease is not None else drop.at_s
            standby_id = next(s for s in speakers if s != dropped.speaker_id)
            ready_at = max(expires, down_until[standby_id])
            takeover_at = math.ceil(ready_at / heartbeat_s) * heartbeat_s
            if table.current(zone_id, takeover_at) is not None:
                raise RuntimeError("Lease outlived its holder.")
            if down_until[standby_id] > expires:
                # Both speakers are down: the first one back reconnects and resumes.
                if down_until[standby_id] > drop.end_s:
                    standby_id = dropped.speaker_id
                    takeover_at = math.ceil(drop.end_s / heartbeat_s) * heartbeat_s
                how = "reconnect"
            else:
                how = "failover"
            active = speakers[standby_id]
            active.hold(table.takeover(zone_id, active.speaker_id, takeover_at, reason=how))
            recoveries.append(Recovery(FaultKind.SPEAKER_DROP, drop.at_s, how, standby_id))
            if dropped is not active:
                # The dropped speaker wakes and tries to carry on with its old token: refused.
                if not dropped.play(song.song_id, max(drop.end_s, takeover_at)):
                    stale_refused += 1
            remaining = song.duration_s - (drop.at_s - start)
            resume_end = min(takeover_at + remaining, night_s)
            if not active.play(song.song_id, takeover_at):
                raise RuntimeError("The new holder was fenced out.")
            heartbeat_through(takeover_at, resume_end)
            if resume_end > takeover_at:
                plays.append(Play(song.song_id, takeover_at, resume_end, active.speaker_id,
                                  zone_id, 0.0, source))
            t = resume_end
            previous_planned = False
        if use_fallbacks:
            recent = [p.song_id for p in plays[-20:]]
            cache.prefetch(pool, now_s=t, avoid=recent)

    report = evaluate(plays, 0.0, night_s, zones=[zone_id])
    return NightResult(plays, report, plan, recoveries, stale_refused, len(table.events))


class _NoPath:
    """A placeholder path for simulated songs; the simulator's checker never opens it."""

    def __fspath__(self) -> str:  # pragma: no cover - never opened
        raise OSError("simulated song has no file")


_NO_PATH = _NoPath()  # type: ignore[assignment]


def demo_library(count: int, prefix: str, *, seed: int = 7) -> list[Song]:
    """Made-up songs of 3 to 5 minutes for rehearsals and tests."""
    rng = random.Random(seed)
    return [Song(f"{prefix}-{i:03d}", round(rng.uniform(180.0, 300.0), 1)) for i in range(count)]
