"""Venue music identity: versioned policies, hard constraints and timed overrides (ADR-0425).

A venue's policy says what SelectaDJ may play there: which licensed sources the music comes from,
whether explicit content is allowed, banned artists and genres, BPM and energy ceilings, a volume
cap, dayparts with stricter limits, and how the night closes. Every saved policy is an immutable
`VenuePolicy` version; changing anything publishes a new version with its own effective-from time,
so the history of what applied when is never rewritten.

Hard constraints are filters, never preferences: `enforce` drops any candidate that breaks one and
says why. A fact the candidate doesn't carry (unknown BPM under a BPM ceiling, unknown explicit
flag when explicit content is off) counts as breaking the rule, because a hard limit can't be met
by guessing. Operator `Override`s only tighten the policy for a bounded time, and stop applying at
exactly their `expires_at` (the clock is always passed in, so tests control it).

`select_candidates` never falls back to unlicensed music: when the licensed catalogue is empty, or
everything in it is filtered out, it says so with a distinct status instead of playing anything
else (AV-0425-05).

Storage: `PolicyStore` keeps versions and overrides in memory, per workspace and venue. It is the
reference model the routes use until a Cloud table exists; a restart forgets it (recorded as
remaining work on ADR-0425).
"""

from __future__ import annotations

import threading
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, time
from typing import Any

CLOSING_BEHAVIOURS = ("wind_down", "fade_out", "stop_at_close")
OVERRIDE_MAX_SECONDS = 12 * 60 * 60

# Statuses `select_candidates` can report, each with its own message.
READY = "ready"
NO_LICENSED_MUSIC = "no_licensed_music"
ALL_FILTERED = "all_filtered"


class PolicyError(ValueError):
    """A policy, override or candidate list that can't be accepted, said plainly."""


def _norm(value: str) -> str:
    return " ".join(str(value).casefold().split())


def _names(values: Iterable[str] | None) -> frozenset[str]:
    return frozenset(_norm(v) for v in (values or ()) if str(v).strip())


def _aware(moment: datetime, what: str) -> datetime:
    if moment.tzinfo is None or moment.utcoffset() is None:
        raise PolicyError(f"{what} needs a time zone")
    return moment


def _level(value: float | None, what: str) -> float | None:
    if value is None:
        return None
    number = float(value)
    if not 0.0 <= number <= 1.0:
        raise PolicyError(f"{what} must be between 0 and 1")
    return number


def _min(a: float | None, b: float | None) -> float | None:
    if a is None:
        return b
    if b is None:
        return a
    return min(a, b)


@dataclass(frozen=True)
class HardConstraints:
    """Limits no plan may break. Levels (energy, volume) run 0 to 1; BPM is beats per minute."""

    allow_explicit: bool = False
    banned_artists: frozenset[str] = frozenset()
    banned_genres: frozenset[str] = frozenset()
    bpm_max: float | None = None
    energy_max: float | None = None
    volume_cap: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "banned_artists", _names(self.banned_artists))
        object.__setattr__(self, "banned_genres", _names(self.banned_genres))
        if self.bpm_max is not None and not 40 <= float(self.bpm_max) <= 220:
            raise PolicyError("BPM ceiling must be between 40 and 220")
        _level(self.energy_max, "Energy ceiling")
        _level(self.volume_cap, "Volume cap")

    def tightened(self, other: HardConstraints) -> HardConstraints:
        """The stricter of both on every limit: never looser than either."""
        return HardConstraints(
            allow_explicit=self.allow_explicit and other.allow_explicit,
            banned_artists=self.banned_artists | other.banned_artists,
            banned_genres=self.banned_genres | other.banned_genres,
            bpm_max=_min(self.bpm_max, other.bpm_max),
            energy_max=_min(self.energy_max, other.energy_max),
            volume_cap=_min(self.volume_cap, other.volume_cap),
        )

    def cap_volume(self, requested: float) -> float:
        level = max(0.0, min(1.0, float(requested)))
        return level if self.volume_cap is None else min(level, self.volume_cap)

    def to_dict(self) -> dict[str, Any]:
        return {
            "allow_explicit": self.allow_explicit,
            "banned_artists": sorted(self.banned_artists),
            "banned_genres": sorted(self.banned_genres),
            "bpm_max": self.bpm_max,
            "energy_max": self.energy_max,
            "volume_cap": self.volume_cap,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any] | None) -> HardConstraints:
        data = dict(data or {})
        return cls(
            allow_explicit=bool(data.get("allow_explicit", False)),
            banned_artists=frozenset(data.get("banned_artists") or ()),
            banned_genres=frozenset(data.get("banned_genres") or ()),
            bpm_max=data.get("bpm_max"),
            energy_max=data.get("energy_max"),
            volume_cap=data.get("volume_cap"),
        )


@dataclass(frozen=True)
class Daypart:
    """A named stretch of the venue's day (local wall-clock time) with stricter limits.
    `end` before `start` means the daypart runs past midnight."""

    name: str
    start: time
    end: time
    limits: HardConstraints = field(default_factory=lambda: HardConstraints(allow_explicit=True))

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise PolicyError("Each daypart needs a name")
        if self.start == self.end:
            raise PolicyError(f"Daypart {self.name} starts and ends at the same time")

    def covers(self, at: time) -> bool:
        if self.start < self.end:
            return self.start <= at < self.end
        return at >= self.start or at < self.end

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "start": self.start.strftime("%H:%M"),
            "end": self.end.strftime("%H:%M"),
            "limits": self.limits.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Daypart:
        try:
            start = time.fromisoformat(str(data["start"]))
            end = time.fromisoformat(str(data["end"]))
        except (KeyError, ValueError) as error:
            raise PolicyError("A daypart needs start and end times like 18:00") from error
        limits = dict(data.get("limits") or {})
        limits.setdefault("allow_explicit", True)
        return cls(str(data.get("name", "")), start, end, HardConstraints.from_dict(limits))


@dataclass(frozen=True)
class PolicyDraft:
    """What a person filled in, before it becomes a numbered version."""

    name: str
    timezone: str = "UTC"
    licensed_sources: tuple[str, ...] = ()
    constraints: HardConstraints = HardConstraints()
    dayparts: tuple[Daypart, ...] = ()
    closing_behaviour: str = "wind_down"

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise PolicyError("The venue needs a name")
        if self.closing_behaviour not in CLOSING_BEHAVIOURS:
            raise PolicyError(f"Closing behaviour must be one of {', '.join(CLOSING_BEHAVIOURS)}")
        object.__setattr__(self, "licensed_sources", tuple(dict.fromkeys(
            s.strip() for s in self.licensed_sources if s.strip())))
        object.__setattr__(self, "dayparts", tuple(self.dayparts))


@dataclass(frozen=True)
class VenuePolicy:
    """One immutable, numbered version of a venue's policy."""

    venue_id: str
    version: int
    effective_from: datetime
    created_at: datetime
    created_by: str
    draft: PolicyDraft

    @property
    def constraints(self) -> HardConstraints:
        return self.draft.constraints

    def daypart_at(self, local: time) -> Daypart | None:
        return next((d for d in self.draft.dayparts if d.covers(local)), None)

    def to_dict(self) -> dict[str, Any]:
        d = self.draft
        return {
            "venue_id": self.venue_id,
            "version": self.version,
            "effective_from": self.effective_from.isoformat(),
            "created_at": self.created_at.isoformat(),
            "created_by": self.created_by,
            "name": d.name,
            "timezone": d.timezone,
            "licensed_sources": list(d.licensed_sources),
            "constraints": d.constraints.to_dict(),
            "dayparts": [p.to_dict() for p in d.dayparts],
            "closing_behaviour": d.closing_behaviour,
        }


@dataclass(frozen=True)
class Override:
    """A staff member's temporary tightening, live from `starts_at` until exactly `expires_at`."""

    id: str
    venue_id: str
    starts_at: datetime
    expires_at: datetime
    limits: HardConstraints
    reason: str = ""
    created_by: str = ""

    def __post_init__(self) -> None:
        _aware(self.starts_at, "Override start")
        _aware(self.expires_at, "Override expiry")
        if self.expires_at <= self.starts_at:
            raise PolicyError("An override has to expire after it starts")
        if (self.expires_at - self.starts_at).total_seconds() > OVERRIDE_MAX_SECONDS:
            raise PolicyError("An override can last at most 12 hours")

    def active(self, at: datetime) -> bool:
        return self.starts_at <= _aware(at, "Time") < self.expires_at

    def to_dict(self, at: datetime | None = None) -> dict[str, Any]:
        out = {
            "id": self.id,
            "venue_id": self.venue_id,
            "starts_at": self.starts_at.isoformat(),
            "expires_at": self.expires_at.isoformat(),
            "limits": self.limits.to_dict(),
            "reason": self.reason,
            "created_by": self.created_by,
        }
        if at is not None:
            out["active"] = self.active(at)
        return out


@dataclass(frozen=True)
class TrackFacts:
    """What enforcement needs to know about one candidate song."""

    id: str
    artist: str = ""
    genres: tuple[str, ...] = ()
    bpm: float | None = None
    energy: float | None = None
    explicit: bool | None = None
    source: str = ""
    licensed: bool = False

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> TrackFacts:
        if not str(data.get("id", "")).strip():
            raise PolicyError("Every candidate needs an id")
        explicit = data.get("explicit")
        return cls(
            id=str(data["id"]),
            artist=str(data.get("artist") or ""),
            genres=tuple(str(g) for g in data.get("genres") or ()),
            bpm=None if data.get("bpm") is None else float(data["bpm"]),
            energy=None if data.get("energy") is None else float(data["energy"]),
            explicit=None if explicit is None else bool(explicit),
            source=str(data.get("source") or ""),
            licensed=data.get("licensed") is True,
        )


@dataclass(frozen=True)
class Enforcement:
    allowed: tuple[TrackFacts, ...]
    rejected: tuple[tuple[str, tuple[str, ...]], ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": [t.id for t in self.allowed],
            "rejected": [{"id": i, "reasons": list(r)} for i, r in self.rejected],
        }


def breaches(track: TrackFacts, limits: HardConstraints) -> tuple[str, ...]:
    """Every hard constraint `track` breaks; empty when it may play."""
    found: list[str] = []
    if not limits.allow_explicit and track.explicit is not False:
        found.append("explicit" if track.explicit else "explicit_unknown")
    if track.artist and _norm(track.artist) in limits.banned_artists:
        found.append("banned_artist")
    if _names(track.genres) & limits.banned_genres:
        found.append("banned_genre")
    if limits.bpm_max is not None:
        if track.bpm is None:
            found.append("bpm_unknown")
        elif track.bpm > limits.bpm_max:
            found.append("bpm_over_ceiling")
    if limits.energy_max is not None:
        if track.energy is None:
            found.append("energy_unknown")
        elif track.energy > limits.energy_max:
            found.append("energy_over_ceiling")
    return tuple(found)


def enforce(candidates: Sequence[TrackFacts], limits: HardConstraints) -> Enforcement:
    """Split `candidates` into those that may play and those that can't, keeping order."""
    allowed: list[TrackFacts] = []
    rejected: list[tuple[str, tuple[str, ...]]] = []
    for track in candidates:
        reasons = breaches(track, limits)
        if reasons:
            rejected.append((track.id, reasons))
        else:
            allowed.append(track)
    return Enforcement(tuple(allowed), tuple(rejected))


def local_time(policy: VenuePolicy, at: datetime) -> time:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        zone = ZoneInfo(policy.draft.timezone)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise PolicyError(f"Unknown time zone {policy.draft.timezone!r}") from error
    return _aware(at, "Time").astimezone(zone).time()


def limits_at(
    policy: VenuePolicy, overrides: Iterable[Override], at: datetime
) -> HardConstraints:
    """The policy's limits, tightened by the daypart in effect and every live override."""
    limits = policy.constraints
    part = policy.daypart_at(local_time(policy, at))
    if part is not None:
        limits = limits.tightened(part.limits)
    for override in overrides:
        if override.venue_id == policy.venue_id and override.active(at):
            limits = limits.tightened(override.limits)
    return limits


@dataclass(frozen=True)
class Selection:
    status: str
    message: str
    enforcement: Enforcement
    limits: HardConstraints
    unlicensed: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "message": self.message,
            "limits": self.limits.to_dict(),
            "unlicensed": list(self.unlicensed),
            **self.enforcement.to_dict(),
        }


def select_candidates(
    policy: VenuePolicy,
    catalogue: Sequence[TrackFacts],
    at: datetime,
    overrides: Iterable[Override] = (),
) -> Selection:
    """Licensed songs that meet every limit. Unlicensed songs are never offered as a fallback."""
    sources = set(policy.draft.licensed_sources)
    licensed = [t for t in catalogue if t.licensed and t.source in sources]
    unlicensed = tuple(t.id for t in catalogue if not (t.licensed and t.source in sources))
    limits = limits_at(policy, overrides, at)
    if not licensed:
        return Selection(
            NO_LICENSED_MUSIC,
            "No licensed music is available for this venue, so SelectaDJ won't play anything. "
            "Add a licensed source or songs to continue.",
            Enforcement((), tuple((i, ("unlicensed",)) for i in unlicensed)),
            limits,
            unlicensed,
        )
    result = enforce(licensed, limits)
    result = Enforcement(
        result.allowed, result.rejected + tuple((i, ("unlicensed",)) for i in unlicensed)
    )
    if not result.allowed:
        return Selection(
            ALL_FILTERED,
            "Every licensed song breaks one of this venue's limits right now, so SelectaDJ "
            "won't play anything. Loosen a limit or add songs that fit.",
            result,
            limits,
            unlicensed,
        )
    return Selection(READY, f"{len(result.allowed)} songs fit this venue's limits.", result,
                     limits, unlicensed)


class PolicyStore:
    """Versions and overrides per (workspace, venue), in memory. Versions are append-only."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._versions: dict[tuple[str, str], list[VenuePolicy]] = {}
        self._overrides: dict[tuple[str, str], list[Override]] = {}

    def publish(
        self,
        workspace: str,
        venue_id: str,
        draft: PolicyDraft,
        *,
        effective_from: datetime,
        now: datetime,
        created_by: str = "",
    ) -> VenuePolicy:
        _aware(effective_from, "Effective-from")
        _aware(now, "Now")
        with self._lock:
            versions = self._versions.setdefault((workspace, venue_id), [])
            policy = VenuePolicy(venue_id, len(versions) + 1, effective_from, now, created_by,
                                 draft)
            versions.append(policy)
            return policy

    def history(self, workspace: str, venue_id: str) -> tuple[VenuePolicy, ...]:
        with self._lock:
            return tuple(self._versions.get((workspace, venue_id), ()))

    def effective(self, workspace: str, venue_id: str, at: datetime) -> VenuePolicy | None:
        """The version in force at `at`: latest effective-from not after `at`, newest version
        winning a tie."""
        _aware(at, "Time")
        live = [p for p in self.history(workspace, venue_id) if p.effective_from <= at]
        return max(live, key=lambda p: (p.effective_from, p.version), default=None)

    def add_override(self, workspace: str, override: Override) -> Override:
        with self._lock:
            self._overrides.setdefault((workspace, override.venue_id), []).append(override)
            return override

    def overrides(self, workspace: str, venue_id: str) -> tuple[Override, ...]:
        with self._lock:
            return tuple(self._overrides.get((workspace, venue_id), ()))

    def active_overrides(self, workspace: str, venue_id: str, at: datetime) -> tuple[Override, ...]:
        return tuple(o for o in self.overrides(workspace, venue_id) if o.active(at))

    def end_override(self, workspace: str, venue_id: str, override_id: str,
                     at: datetime) -> Override:
        """End an override early: it is replaced by one expiring at `at`."""
        with self._lock:
            items = self._overrides.get((workspace, venue_id), [])
            for index, item in enumerate(items):
                if item.id == override_id:
                    if at <= item.starts_at:
                        items.pop(index)
                        return item
                    ended = replace(item, expires_at=min(item.expires_at, at))
                    items[index] = ended
                    return ended
        raise PolicyError("There's no override with that id")


__all__ = [
    "ALL_FILTERED",
    "CLOSING_BEHAVIOURS",
    "NO_LICENSED_MUSIC",
    "READY",
    "Daypart",
    "Enforcement",
    "HardConstraints",
    "Override",
    "PolicyDraft",
    "PolicyError",
    "PolicyStore",
    "Selection",
    "TrackFacts",
    "VenuePolicy",
    "breaches",
    "enforce",
    "limits_at",
    "local_time",
    "select_candidates",
]
