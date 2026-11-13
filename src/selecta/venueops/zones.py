"""Scoped venue zones, transfer and reconnection (ADR-0433 AV-0433-02 and AV-0433-03).

A zone is a named area of one venue (the bar, the terrace) that plays one stream. Rules:

- A zone belongs to one venue and owns its speakers; a speaker is in at most one zone.
- A zone has exactly one lease (see `leases`), so at most one of its speakers plays at a time.
- How many zones a venue may have comes from its entitlement. Without a venue entitlement the
  answer is one, which keeps today's one-session-per-account behaviour unchanged.
- Transfer moves playback to another speaker in the same zone with a fresh lease; the old
  speaker is fenced out at once, and the new one resumes from the confirmed position.
- When a speaker drops, the zone remembers the last confirmed position. If the same speaker
  comes back before anyone else took over, it resumes there with a new token. If another speaker
  took over meanwhile, the returning one stays silent (its old token is refused).

Gated by `venue.speakers`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from selecta import flags
from selecta.venueops.leases import Lease, LeaseHeld, LeaseTable, NotASpeaker

FLAG = "venue.speakers"
_ZONE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
DEFAULT_ENTITLED_ZONES = 1


class ZoneError(ValueError):
    """A zone change that can't be made, said so staff can act on it."""


@dataclass(frozen=True)
class Speaker:
    speaker_id: str
    name: str
    can_play_audio: bool = True
    platform: str = "browser"


@dataclass
class Playhead:
    """Where the zone's music is, as last confirmed by its playing speaker."""

    song_id: str | None = None
    position_s: float = 0.0
    confirmed_at: float = 0.0

    def at(self, now: float, *, catch_up: bool) -> float:
        if catch_up and self.song_id is not None:
            return self.position_s + max(0.0, now - self.confirmed_at)
        return self.position_s


@dataclass
class Zone:
    zone_id: str
    venue_id: str
    name: str
    speakers: dict[str, Speaker] = field(default_factory=dict)
    playhead: Playhead = field(default_factory=Playhead)
    dropped: dict[str, float] = field(default_factory=dict)  # speaker_id -> when it dropped


@dataclass(frozen=True)
class Handover:
    zone_id: str
    from_speaker: str | None
    to_speaker: str
    token: int
    resume_song: str | None
    resume_at_s: float
    kind: str  # "start", "transfer", "reconnect", "failover"


@dataclass
class ZoneDirectory:
    venue_id: str
    leases: LeaseTable
    entitled_zones: int = DEFAULT_ENTITLED_ZONES
    zones: dict[str, Zone] = field(default_factory=dict)
    history: list[Handover] = field(default_factory=list)

    # ---- definition -------------------------------------------------------------------------

    def define(self, zone_id: str, name: str) -> Zone:
        flags.require(FLAG)
        if not _ZONE_ID.match(zone_id):
            raise ZoneError("A zone id is lower-case letters, digits, '-' or '_', up to 40.")
        if zone_id in self.zones:
            raise ZoneError(f"Zone {zone_id!r} already exists.")
        if len(self.zones) >= self.entitled_zones:
            raise ZoneError(
                f"This venue may have {self.entitled_zones} zone(s); "
                "more need a venue plan that includes them."
            )
        zone = Zone(zone_id, self.venue_id, name.strip() or zone_id)
        self.zones[zone_id] = zone
        return zone

    def zone(self, zone_id: str) -> Zone:
        try:
            return self.zones[zone_id]
        except KeyError:
            raise ZoneError(f"There's no zone {zone_id!r} in this venue.") from None

    def zone_of(self, speaker_id: str) -> Zone | None:
        for zone in self.zones.values():
            if speaker_id in zone.speakers:
                return zone
        return None

    def assign(self, zone_id: str, speaker: Speaker) -> None:
        flags.require(FLAG)
        zone = self.zone(zone_id)
        other = self.zone_of(speaker.speaker_id)
        if other is not None and other.zone_id != zone_id:
            raise ZoneError(
                f"{speaker.name} is already in {other.name}; remove it there first."
            )
        zone.speakers[speaker.speaker_id] = speaker

    def unassign(self, zone_id: str, speaker_id: str, now: float) -> None:
        zone = self.zone(zone_id)
        lease = self.leases.current(zone_id, now)
        if lease is not None and lease.holder == speaker_id:
            raise ZoneError("Move the music to another speaker before removing this one.")
        zone.speakers.pop(speaker_id, None)

    def _speaker(self, zone: Zone, speaker_id: str) -> Speaker:
        speaker = zone.speakers.get(speaker_id)
        if speaker is None:
            raise ZoneError(f"That speaker isn't part of {zone.name}.")
        if not speaker.can_play_audio:
            raise NotASpeaker(speaker_id)
        return speaker

    # ---- playback ---------------------------------------------------------------------------

    def start(self, zone_id: str, speaker_id: str, now: float) -> Handover:
        flags.require(FLAG)
        zone = self.zone(zone_id)
        speaker = self._speaker(zone, speaker_id)
        lease = self.leases.acquire(zone_id, speaker_id, now,
                                    can_play_audio=speaker.can_play_audio)
        return self._record(zone, None, lease, "start", now, catch_up=False)

    def confirm(self, zone_id: str, token: int, song_id: str, position_s: float,
                now: float) -> None:
        """The playing speaker reports where it is. A fenced speaker's report is refused."""
        lease = self.leases.check(zone_id, token, now)
        zone = self.zone(zone_id)
        self.leases.renew(zone_id, lease.token, now)
        zone.playhead = Playhead(song_id, max(0.0, position_s), now)

    def transfer(self, zone_id: str, to_speaker: str, now: float) -> Handover:
        """Move the zone's music to another of its speakers, without overlap."""
        flags.require(FLAG)
        zone = self.zone(zone_id)
        speaker = self._speaker(zone, to_speaker)
        old = self.leases.current(zone_id, now)
        if old is not None and old.holder == to_speaker:
            raise ZoneError(f"{speaker.name} is already playing {zone.name}.")
        lease = self.leases.takeover(zone_id, to_speaker, now, reason="transfer",
                                     can_play_audio=speaker.can_play_audio)
        return self._record(zone, old.holder if old else None, lease, "transfer", now,
                            catch_up=True)

    def drop(self, speaker_id: str, now: float) -> None:
        """A speaker went quiet (network, sleep, crash). Its lease simply stops being renewed."""
        zone = self.zone_of(speaker_id)
        if zone is not None:
            zone.dropped[speaker_id] = now

    def reconnect(self, speaker_id: str, now: float) -> Handover | None:
        """A dropped speaker is back. It resumes only if nobody else took the zone meanwhile."""
        flags.require(FLAG)
        zone = self.zone_of(speaker_id)
        if zone is None:
            raise ZoneError("That speaker isn't part of any zone.")
        zone.dropped.pop(speaker_id, None)
        current = self.leases.current(zone.zone_id, now)
        if current is not None and current.holder != speaker_id:
            return None  # someone else is playing; stay silent
        speaker = self._speaker(zone, speaker_id)
        lease = self.leases.takeover(zone.zone_id, speaker_id, now, reason="reconnect",
                                     can_play_audio=speaker.can_play_audio)
        return self._record(zone, speaker_id, lease, "reconnect", now, catch_up=False)

    def failover(self, zone_id: str, now: float) -> Handover | None:
        """Move a zone whose speaker dropped to another live speaker in it, if there is one."""
        flags.require(FLAG)
        zone = self.zone(zone_id)
        current = self.leases.current(zone_id, now)
        if current is not None and current.holder not in zone.dropped:
            return None  # the holder is fine
        for speaker in zone.speakers.values():
            if speaker.can_play_audio and speaker.speaker_id not in zone.dropped:
                if current is not None and speaker.speaker_id == current.holder:
                    continue
                lease = self.leases.takeover(zone_id, speaker.speaker_id, now,
                                             reason="failover")
                previous = current.holder if current else None
                return self._record(zone, previous, lease, "failover", now, catch_up=False)
        return None

    def _record(self, zone: Zone, previous: str | None, lease: Lease, kind: str, now: float,
                *, catch_up: bool) -> Handover:
        resume_at = zone.playhead.at(now, catch_up=catch_up)
        handover = Handover(zone.zone_id, previous, lease.holder, lease.token,
                            zone.playhead.song_id, resume_at, kind)
        if zone.playhead.song_id is not None:
            zone.playhead = Playhead(zone.playhead.song_id, resume_at, now)
        self.history.append(handover)
        return handover

    def playing(self, now: float) -> dict[str, str]:
        """Which speaker holds each zone right now."""
        return {zone_id: holder for zone_id, holder in self.leases.holders(now).items()
                if zone_id in self.zones}


__all__ = [
    "Handover",
    "LeaseHeld",
    "Playhead",
    "Speaker",
    "Zone",
    "ZoneDirectory",
    "ZoneError",
]
