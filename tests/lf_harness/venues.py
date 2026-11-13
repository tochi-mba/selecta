"""Deterministic local-time venue schedule, zone and outage fixtures."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class OpeningHours:
    start: time
    end: time
    closed_weekdays: frozenset[int] = frozenset()
    all_day: bool = False

    def is_open(self, local: datetime) -> bool:
        if self.all_day:
            return local.weekday() not in self.closed_weekdays
        current = local.timetz().replace(tzinfo=None)
        if self.start == self.end:
            return False
        if self.start < self.end:
            return local.weekday() not in self.closed_weekdays and self.start <= current < self.end
        # Overnight service belongs to the day it started, including after midnight.
        return ((current >= self.start and local.weekday() not in self.closed_weekdays) or
                (current < self.end and (local.weekday() - 1) % 7 not in self.closed_weekdays))


@dataclass
class VenueClock:
    utc: datetime
    timezone_name: str = "Europe/London"

    def __post_init__(self) -> None:
        if self.utc.tzinfo is None:
            raise ValueError("venue clock must use aware UTC datetime")
        self.utc = self.utc.astimezone(timezone.utc)
        ZoneInfo(self.timezone_name)  # Fail early for unavailable/invalid IANA zone.

    @property
    def local(self) -> datetime:
        return self.utc.astimezone(ZoneInfo(self.timezone_name))

    def advance(self, duration: timedelta) -> None:
        if duration.total_seconds() < 0:
            raise ValueError("venue clock cannot rewind")
        self.utc += duration


@dataclass
class VenueZone:
    zone_id: str
    output_id: str
    ready: bool = True
    rights_ok: bool = True
    policy_ok: bool = True
    checkpoint: str | None = None


@dataclass
class VenueSimulation:
    clock: VenueClock
    opening: OpeningHours
    zones: dict[str, VenueZone] = field(default_factory=dict)
    connected_to_cloud: bool = True
    outage_seconds: int = 0
    local_event_journal: dict[str, dict] = field(default_factory=dict)

    def add_zone(self, zone_id: str, output_id: str) -> None:
        if zone_id in self.zones:
            raise ValueError("duplicate zone")
        if output_id in {z.output_id for z in self.zones.values()}:
            raise ValueError("exclusive physical output already mapped to a zone")
        self.zones[zone_id] = VenueZone(zone_id, output_id)

    def offline(self, duration: timedelta) -> None:
        self.connected_to_cloud = False
        self.clock.advance(duration)
        self.outage_seconds += int(duration.total_seconds())

    def reconnect(self) -> None:
        self.connected_to_cloud = True

    def record_local_event(self, event_id: str, *, zone_id: str, kind: str) -> None:
        if zone_id not in self.zones:
            raise ValueError("unknown zone")
        if event_id not in self.local_event_journal:
            self.local_event_journal[event_id] = {
                "event_id": event_id, "zone_id": zone_id, "kind": kind,
                "occurred_at": self.clock.utc.isoformat(),
            }

    def can_restore_after_power(self, zone_id: str) -> bool:
        zone = self.zones[zone_id]
        return self.opening.is_open(self.clock.local) and all((
            zone.ready, zone.rights_ok, zone.policy_ok, zone.checkpoint is not None,
        ))

    def local_schedule_samples(self, every: timedelta, count: int) -> list[tuple[str, bool]]:
        if every.total_seconds() <= 0 or count < 0:
            raise ValueError("invalid sampling interval/count")
        samples = []
        for _ in range(count):
            samples.append((self.clock.local.isoformat(), self.opening.is_open(self.clock.local)))
            self.clock.advance(every)
        return samples
