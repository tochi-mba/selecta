"""Device-local venue contracts. Never serialize local bindings to the cloud.

Cloud catalogue IDs are *not* a claim that a recording exists on this computer.
A zone is audible only after a local audio port confirms the physical output.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo


class VenueError(RuntimeError):
    """Fail closed rather than emitting unauthorised or unverifiable audio."""


@dataclass(frozen=True)
class Opening:
    weekday: int
    start: str
    end: str
    all_day: bool = False

    def __post_init__(self) -> None:
        if not 0 <= self.weekday <= 6:
            raise ValueError("weekday must be 0..6")
        for value in (self.start, self.end):
            time.fromisoformat(value)


@dataclass(frozen=True)
class Daypart:
    start: str
    end: str
    allow_explicit: bool = True
    blocked_artists: tuple[str, ...] = ()

    def covers(self, instant: datetime) -> bool:
        current, start, end = (
            instant.time().replace(tzinfo=None),
            time.fromisoformat(self.start),
            time.fromisoformat(self.end),
        )
        return start <= current < end if start < end else current >= start or current < end


@dataclass(frozen=True)
class Policy:
    allow_explicit: bool = False
    blocked_artists: tuple[str, ...] = ()
    allow_requests: bool = False
    repeat_after_seconds: int = 3600
    fallback_ids: tuple[str, ...] = ()
    rights_until: float | None = None
    plan_until: float | None = None
    rights_attested: bool = False
    dayparts: tuple[Daypart, ...] = ()

    def permits(
        self,
        track: Recording,
        now: float,
        last_played: float | None = None,
        *,
        request: bool = False,
        timezone: str = "UTC",
    ) -> bool:
        if (
            not self.rights_attested
            or (self.rights_until is not None and now >= self.rights_until)
            or (self.plan_until is not None and now >= self.plan_until)
        ):
            return False
        if request and not self.allow_requests:
            return False
        explicit = self.allow_explicit
        blocked = {s.casefold().strip() for s in self.blocked_artists}
        for daypart in self.dayparts:
            if daypart.covers(datetime.fromtimestamp(now, ZoneInfo(timezone))):
                explicit = explicit and daypart.allow_explicit
                blocked.update(s.casefold().strip() for s in daypart.blocked_artists)
        if track.explicit is None or (track.explicit and not explicit):
            return False
        if track.artist.casefold().strip() in blocked:
            return False
        return last_played is None or now - last_played >= self.repeat_after_seconds


@dataclass(frozen=True)
class Zone:
    id: str
    output_id: str
    channels: tuple[int, ...] = (0, 1)
    sample_rate: int = 48000
    latency_ms: int = 40
    cpu_cores: float = 0.5
    memory_mb: int = 256
    allowed_sources: tuple[str, ...] = ()
    enabled: bool = True


@dataclass(frozen=True)
class Venue:
    workspace_id: str
    venue_id: str
    engine_id: str
    timezone: str
    openings: tuple[Opening, ...]
    zones: tuple[Zone, ...]
    policy: Policy
    authorised_roots: tuple[str, ...]
    programme_id: str = ""

    def __post_init__(self) -> None:
        ZoneInfo(self.timezone)  # validate IANA timezone
        if not self.workspace_id or not self.venue_id or not self.engine_id:
            raise ValueError("workspace, venue and engine identity are required")
        if len({z.id for z in self.zones}) != len(self.zones):
            raise ValueError("zone IDs must be unique within a venue")

    def open_at(self, now: float) -> bool:
        """Local wall-clock openings, including overnight and DST folds, via UTC instants."""
        tz = ZoneInfo(self.timezone)
        instant = datetime.fromtimestamp(now, UTC)
        local_day = instant.astimezone(tz).date()
        for d in (local_day - timedelta(days=1), local_day):
            for period in self.openings:
                if period.weekday != d.weekday():
                    continue
                if period.all_day:
                    start = datetime.combine(d, time.min, tzinfo=tz).astimezone(UTC)
                    end = datetime.combine(d + timedelta(days=1), time.min, tzinfo=tz).astimezone(
                        UTC
                    )
                else:
                    start_t, end_t = (
                        time.fromisoformat(period.start),
                        time.fromisoformat(period.end),
                    )
                    end_d = d + timedelta(days=1) if end_t <= start_t else d
                    start = _resolve_wall(tz, d, start_t)
                    end = _resolve_wall(tz, end_d, end_t)
                if start <= instant < end:
                    return True
        return False


def _resolve_wall(tz: ZoneInfo, day: date, wall: time) -> datetime:
    """Fold=0 on autumn rollback; advance nonexistent spring times to first valid instant."""
    naive = datetime.combine(day, wall)
    first = naive.replace(tzinfo=tz, fold=0).astimezone(UTC)
    if first.astimezone(tz).replace(tzinfo=None) == naive:
        return first
    second = naive.replace(tzinfo=tz, fold=1).astimezone(UTC)
    low, high = sorted((int(first.timestamp()), int(second.timestamp())))
    while high - low > 1:
        mid = (low + high) // 2
        if datetime.fromtimestamp(mid, tz).replace(tzinfo=None) >= naive:
            high = mid
        else:
            low = mid
    return datetime.fromtimestamp(high, UTC)


@dataclass(frozen=True)
class Recording:
    track_id: str  # stable shared metadata ID, not a title/ISRC match
    local_path: str  # private to the device; NEVER journal or sync this field
    source_id: str
    artist: str
    explicit: bool | None
    duration_s: float
    revision: str  # exact, locally verified revision; no remaster guessing
    sha256: str = ""
    requested: bool = False


@dataclass(frozen=True)
class Prepared:
    track_id: str
    revision: str
    handle: str  # local DSP artifact/transition identifier, never cloud URL


@dataclass(frozen=True)
class OutputProbe:
    connected: bool
    active: bool
    signal_confirmed: bool  # measured physical output, not a lease/heartbeat
    latency_ms: int = 0
    error: str | None = None


class LocalAudioPort(Protocol):
    """Implemented by the *local* engine/Agent 08 playback adapter only."""

    def preflight(self, zone: Zone, recording: Recording) -> bool: ...
    def prepare(self, zone: Zone, recording: Recording, prior: Recording | None) -> str: ...
    def start(
        self, zone: Zone, recording: Recording, handle: str, generation: int, position_s: float
    ) -> bool: ...
    def stop(self, zone: Zone, generation: int) -> bool: ...
    def probe(self, zone: Zone) -> OutputProbe: ...


class EngineAuthorisation(Protocol):
    def authorised(self, workspace_id: str, venue_id: str, engine_id: str) -> bool: ...


@dataclass(frozen=True)
class Limits:
    cpu_cores: float
    memory_mb: int
    sample_rates: tuple[int, ...] = (44100, 48000)
    max_latency_ms: int = 250
    reserve_cpu_cores: float = 1.0
    reserve_memory_mb: int = 512


@dataclass(frozen=True)
class Diagnosis:
    state: str
    actual_output: str
    fallback_runway_s: float
    missing_sources: tuple[str, ...]
    reason: str | None
    committed: tuple[str, ...]
    prepared: tuple[str, ...]
    planned: tuple[str, ...]
    last_verified_at: float | None
    physical_hardware_gate: str = "outstanding"
