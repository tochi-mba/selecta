"""A record of what happened in venues during a business test or stress run (ADR-0454).

Several business invariants (B1 silence, B3 one speaker, B6 stop only at close, B9 volume cap)
are about moments in time, which the database alone cannot show. Tests, the simulated kiosk
client (`tests/load/business_kiosk_sim.py`) and the stress scenarios append what they observe to
a `BusinessTrace`, and `selecta.audit.business_invariants.check_trace` judges it.

All times are aware UTC datetimes. Ids are opaque strings. Nothing here touches the database.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

StopReason = Literal["close", "billing", "pilot_end", "licence", "manual", "rules", "other"]


@dataclass(frozen=True)
class OpenWindow:
    """One opening of one venue: music is expected from `opens` until `closes` (exclusive)."""

    venue_id: str
    opens: datetime
    closes: datetime | None
    """None for a venue open 24 hours (no close, no stop)."""


@dataclass(frozen=True)
class AudioSpan:
    """A zone was audibly playing on `device_id` from `start` to `end`."""

    zone_id: str
    device_id: str
    start: datetime
    end: datetime


@dataclass(frozen=True)
class HorizonReport:
    """At `at`, the zone's kiosk had `seconds_ahead` of playable saved music."""

    zone_id: str
    device_id: str
    at: datetime
    seconds_ahead: float


@dataclass(frozen=True)
class LeaseSpan:
    """`device_id` held (or acted on) the zone's speaker lease from `start` to `end`."""

    zone_id: str
    device_id: str
    start: datetime
    end: datetime


@dataclass(frozen=True)
class Play:
    """One song played in a zone, as the kiosk saw it."""

    play_id: str
    zone_id: str
    venue_id: str
    song_id: str
    started: datetime
    snapshot_id: str
    """The content-rules snapshot (ADR-0450) the song was checked against."""
    offline: bool = False


@dataclass(frozen=True)
class PlayLogRow:
    """One row of the server's play log (ADR-0449), keyed by the kiosk's play id."""

    play_id: str
    venue_id: str
    song_id: str
    started: datetime


@dataclass(frozen=True)
class Payload:
    """A JSON payload sent to a customer-facing surface (kiosk, guest page, display)."""

    surface: Literal["kiosk", "guest", "display"]
    body: Any
    at: datetime | None = None


@dataclass(frozen=True)
class AccessAttempt:
    """Someone (a person, kiosk or tablet) tried to reach a resource."""

    actor_kind: Literal["person", "kiosk", "tablet"]
    actor_id: str
    actor_org: str
    resource_org: str
    in_scope: bool
    """Whether the actor's role and venue scope allowed it (ADR-0452)."""
    succeeded: bool
    at: datetime | None = None


@dataclass(frozen=True)
class Stop:
    """Playback in a venue stopped (or was blocked from starting) for `reason` at `at`."""

    venue_id: str
    at: datetime
    reason: StopReason
    mid_song: bool = False


@dataclass(frozen=True)
class Warning:
    """A billing or pilot-end warning (`kind` "72h" or "24h") was sent for an organisation."""

    org_id: str
    kind: Literal["72h", "24h"]
    at: datetime
    cause: Literal["billing", "pilot_end"] = "billing"


@dataclass(frozen=True)
class Offboarding:
    """A person was removed at `removed_at`; `last_success` is their last working access."""

    person_id: str
    removed_at: datetime
    last_success: datetime | None


@dataclass(frozen=True)
class VolumeReport:
    """A kiosk reported its output level and the cap in force at `at` (both 0.0 to 1.0)."""

    zone_id: str
    device_id: str
    at: datetime
    level: float
    cap: float


@dataclass
class BusinessTrace:
    """Everything a run observed. Append to the lists; `check_trace` reads them."""

    venue_orgs: dict[str, str] = field(default_factory=dict)
    """venue id -> organisation id."""
    zone_venues: dict[str, str] = field(default_factory=dict)
    """zone id -> venue id."""
    windows: list[OpenWindow] = field(default_factory=list)
    audio: list[AudioSpan] = field(default_factory=list)
    horizons: list[HorizonReport] = field(default_factory=list)
    leases: list[LeaseSpan] = field(default_factory=list)
    plays: list[Play] = field(default_factory=list)
    play_log: list[PlayLogRow] = field(default_factory=list)
    snapshot_allows: dict[str, frozenset[str]] = field(default_factory=dict)
    """snapshot id -> the song ids it allowed. A play under an unknown snapshot is a violation."""
    payloads: list[Payload] = field(default_factory=list)
    access: list[AccessAttempt] = field(default_factory=list)
    stops: list[Stop] = field(default_factory=list)
    warnings: list[Warning] = field(default_factory=list)
    grace_ends: dict[str, datetime] = field(default_factory=dict)
    """organisation id -> when its billing grace or pilot ended (only orgs that ended)."""
    offboardings: list[Offboarding] = field(default_factory=list)
    volumes: list[VolumeReport] = field(default_factory=list)
    observed_until: datetime | None = None
    """The end of the run; open windows and spans are judged up to here."""
