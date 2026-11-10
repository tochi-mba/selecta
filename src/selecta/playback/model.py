"""What a device and the playback session look like in code, and the rules that need no database.

The session never stores a moving position. It stores an anchor: which song, how far in, and the
server time that was true. While it's playing, anyone can work out where it is now from the anchor
and the server clock, so a heartbeat every few seconds is enough and a remote's progress bar still
moves smoothly. While paused, the anchor is frozen, so a long pause doesn't drift.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass, fields, replace
from enum import StrEnum
from typing import Any

LEASE_SECONDS = 20.0  # how long the speaker stays the speaker without a heartbeat
HEARTBEAT_SECONDS = 5.0  # how often the speaker sends one
MAX_SIGNED_IN_DEVICES = 10
DEVICE_NAME_MAX = 60


class DeviceKind(StrEnum):
    LAPTOP = "laptop"
    DESKTOP = "desktop"
    PHONE = "phone"
    TABLET = "tablet"
    TV = "tv"


class PlayState(StrEnum):
    PLAYING = "playing"
    PAUSED = "paused"
    STOPPED = "stopped"


class PlaybackError(Exception):
    """Something a device asked for that can't be done. `code` is stable for the API to map."""

    code = "playback_error"


class UnknownDevice(PlaybackError):
    code = "unknown_device"


class DeviceSignedOut(PlaybackError):
    code = "device_signed_out"


class InvalidCommand(PlaybackError):
    code = "invalid_command"


class CommandUnavailable(PlaybackError):
    """The command is real, but nothing here can carry it out (no mix control was given)."""

    code = "command_unavailable"


class IdempotencyConflict(PlaybackError):
    """The same idempotency key came back with a different command."""

    code = "idempotency_conflict"


@dataclass(frozen=True)
class Capabilities:
    """What the browser says it can do. An iOS browser suspends audio when the screen locks."""

    can_play_audio: bool = True
    wake_lock: bool = False
    ios: bool = False
    ios_home_screen: bool = False

    def to_json(self) -> dict[str, bool]:
        return asdict(self)

    @classmethod
    def from_json(cls, raw: Mapping[str, Any] | None) -> Capabilities:
        raw = raw or {}
        return cls(**{f.name: bool(raw.get(f.name, f.default)) for f in fields(cls)})


@dataclass(frozen=True)
class Device:
    id: str
    workspace_id: str
    user_id: str
    name: str
    kind: DeviceKind
    capabilities: Capabilities
    created_at: float
    last_seen_at: float
    signed_out_at: float | None

    @property
    def signed_in(self) -> bool:
        return self.signed_out_at is None


@dataclass(frozen=True)
class Position:
    """Where a device says the music is. `seq` is the session sequence the device has applied, so
    a heartbeat sent before a remote's seek arrived can't put the old position back."""

    song_index: int
    offset_ms: int
    state: PlayState | None = None
    mix_revision_id: str | None = None
    seq: int | None = None


@dataclass(frozen=True)
class Session:
    workspace_id: str
    mix_revision_id: str | None
    song_index: int
    offset_ms: int
    anchor_at: float | None
    state: PlayState
    active_device_id: str | None
    lease_expires_at: float | None
    seq: int
    updated_at: float

    def lease_live(self, now: float) -> bool:
        """Is some device the speaker right now, with a lease that hasn't run out?"""
        return (
            self.active_device_id is not None
            and self.lease_expires_at is not None
            and self.lease_expires_at > now
        )


def position_at(session: Session, now: float) -> Position:
    """Where the music is at `now`: the anchor moved on by the time since, while playing.

    It stays inside the anchored song; the speaker reports when the next song starts.
    """
    offset = session.offset_ms
    if session.state is PlayState.PLAYING and session.anchor_at is not None:
        offset += max(0, round((now - session.anchor_at) * 1000))
    return Position(
        song_index=session.song_index,
        offset_ms=offset,
        state=session.state,
        mix_revision_id=session.mix_revision_id,
        seq=session.seq,
    )


def frozen(session: Session, now: float) -> Session:
    """The same session with its anchor moved to `now`, so a state change starts from here."""
    return replace(session, offset_ms=position_at(session, now).offset_ms, anchor_at=now)
