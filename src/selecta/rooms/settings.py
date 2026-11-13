"""A room's settings, with the defaults from the proposal (11A.2).

Anyone with the code can join, requests are accepted automatically from all mix-ready songs, each
guest has one request waiting and three an hour, a song that played can't be asked for again for
an hour, at most twenty wait in the room, votes are on, nicknames are seen by the host only, there
is no big screen, and the room ends after twelve hours or an hour with no speaker online.

The plan's limits (guests, hours, request renders an hour) are copied into the settings when the
room opens, so a host who downgrades mid-party keeps the room they opened until it ends.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import asdict, dataclass, fields, replace
from enum import StrEnum
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from selecta.rooms.ports import RoomEntitlement

MAX_CRATE_SONGS = 20_000


class JoinMode(StrEnum):
    ANYONE = "anyone"
    APPROVE = "approve"  # the host lets each new guest in
    LOCKED = "locked"  # no new guests


class RequestMode(StrEnum):
    AUTO = "auto"
    APPROVE = "approve"  # the host approves each request
    OFF = "off"  # a watch-only room


# The range each number may take, whatever the host asks for.
BOUNDS: dict[str, tuple[float, float]] = {
    "pending_per_guest": (1, 5),
    "requests_per_guest_per_hour": (1, 30),
    "replay_cooldown_minutes": (0, 24 * 60),
    "pending_per_room": (1, 100),
    "max_hours": (0.5, 12),
    "no_speaker_minutes": (5, 12 * 60),
    "renders_per_hour": (1, 600),
    "max_guests": (1, 1000),
}


@dataclass(frozen=True)
class RoomSettings:
    join_mode: JoinMode = JoinMode.ANYONE
    request_mode: RequestMode = RequestMode.AUTO
    crate_song_ids: tuple[int, ...] | None = None  # None: every mix-ready song
    pending_per_guest: int = 1
    requests_per_guest_per_hour: int = 3
    replay_cooldown_minutes: int = 60
    pending_per_room: int = 20
    votes: bool = True
    names_shown: bool = False  # nicknames seen by the host only
    display: bool = False
    max_hours: float = 12.0
    no_speaker_minutes: int = 60
    renders_per_hour: int = 60
    max_guests: int = 100
    zone_id: str = "main"  # immutable room-to-speaker zone binding in local-first mode
    clean_only: bool = False  # no explicit recordings in this room

    @property
    def crate(self) -> frozenset[int] | None:
        return None if self.crate_song_ids is None else frozenset(self.crate_song_ids)

    def to_json(self) -> dict[str, Any]:
        raw = asdict(self)
        raw["join_mode"] = self.join_mode.value
        raw["request_mode"] = self.request_mode.value
        raw["crate_song_ids"] = None if self.crate_song_ids is None else list(self.crate_song_ids)
        return raw

    @classmethod
    def from_json(cls, raw: Mapping[str, Any] | None) -> RoomSettings:
        """Settings from stored or submitted JSON. Unknown keys are ignored and missing ones take
        the default; a value of the wrong kind raises `ValueError`."""
        raw = dict(raw or {})
        values: dict[str, Any] = {}
        for field in fields(cls):
            if field.name not in raw:
                continue
            value = raw[field.name]
            if field.name == "join_mode":
                values[field.name] = JoinMode(value)
            elif field.name == "request_mode":
                values[field.name] = RequestMode(value)
            elif field.name == "crate_song_ids":
                values[field.name] = _crate(value)
            elif field.name == "zone_id":
                if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value):
                    raise ValueError("zone_id must be a zone identifier")
                values[field.name] = value
            elif field.name in ("votes", "names_shown", "display", "clean_only"):
                if not isinstance(value, bool):
                    raise ValueError(f"{field.name} must be true or false")
                values[field.name] = value
            else:
                values[field.name] = _number(field.name, value, float_ok=field.name == "max_hours")
        return cls(**values).checked()

    def checked(self) -> RoomSettings:
        """The same settings with every number pulled inside its allowed range."""
        if (not isinstance(self.zone_id, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", self.zone_id)):
            raise ValueError("zone_id must be a zone identifier")
        if not isinstance(self.clean_only, bool):
            raise ValueError("clean_only must be true or false")
        changes: dict[str, Any] = {}
        for name, (low, high) in BOUNDS.items():
            value = getattr(self, name)
            clamped = min(max(value, low), high)
            if clamped != value:
                changes[name] = type(value)(clamped)
        return replace(self, **changes) if changes else self

    def within(self, entitlement: RoomEntitlement) -> RoomSettings:
        """The same settings held to what the host's plan allows."""
        return replace(
            self,
            max_guests=min(self.max_guests, entitlement.max_guests),
            max_hours=min(self.max_hours, entitlement.max_hours),
            renders_per_hour=min(self.renders_per_hour, entitlement.renders_per_hour),
        ).checked()

    def keeping_limits_of(self, current: RoomSettings) -> RoomSettings:
        """New settings for an open room: the host can lower the plan limits copied in at
        opening, never raise them."""
        return replace(
            self,
            max_guests=min(self.max_guests, current.max_guests),
            max_hours=min(self.max_hours, current.max_hours),
            renders_per_hour=min(self.renders_per_hour, current.renders_per_hour),
        ).checked()


def _number(name: str, value: Any, *, float_ok: bool) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number")
    if float_ok:
        return float(value)
    if isinstance(value, float) and not value.is_integer():
        raise ValueError(f"{name} must be a whole number")
    return int(value)


def _crate(value: Any) -> tuple[int, ...] | None:
    if value is None:
        return None
    if not isinstance(value, (list, tuple)):
        raise ValueError("crate_song_ids must be a list of song ids")
    ids: list[int] = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, int):
            raise ValueError("crate_song_ids must be a list of song ids")
        ids.append(item)
    unique = tuple(dict.fromkeys(ids))
    if len(unique) > MAX_CRATE_SONGS:
        raise ValueError(f"A crate can hold at most {MAX_CRATE_SONGS} songs")
    return unique
