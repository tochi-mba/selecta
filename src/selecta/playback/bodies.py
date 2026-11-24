"""The request bodies of the playback and device routes (`api.py`), kept apart so the routes
file stays readable. Every text and list field has a limit of its own (product audit, area H)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from selecta.playback import fencing
from selecta.playback.model import DeviceKind, PlayState


class CapabilitiesBody(BaseModel):
    can_play_audio: bool = True
    wake_lock: bool = False
    ios: bool = False
    ios_home_screen: bool = False


class RegisterBody(BaseModel):
    device_id: str | None = Field(default=None, max_length=64)
    name: str | None = Field(default=None, max_length=200)
    kind: DeviceKind = DeviceKind.LAPTOP
    capabilities: CapabilitiesBody = Field(default_factory=CapabilitiesBody)


class RenameBody(BaseModel):
    name: str = Field(max_length=200)


class DeviceBody(BaseModel):
    device_id: str | None = Field(default=None, max_length=64)


class HeartbeatBody(DeviceBody):
    song_index: int = Field(ge=0)
    offset_ms: int = Field(ge=0)
    state: PlayState | None = None
    mix_revision_id: str | None = Field(default=None, max_length=64)
    seq: int | None = Field(default=None, ge=0)
    # ADR-0461: the fence this device last saw. A device claiming a lapsed lease with an older
    # one is refused; None keeps the old behaviour for clients that don't send it.
    fence: int | None = Field(default=None, ge=0)
    # ADR-0457 BF-0457-03: what the speaker knows about its sound output, for controllers.
    # "playing" needs the time a person confirmed the check tone; without it, it is unverified.
    output_status: Literal["playing", "output_unverified", "uncertain", "interrupted"] | None = None
    output_verified_at: float | None = Field(default=None, ge=0)


class TakeOverBody(DeviceBody):
    start_playing: bool = True
    require_observed_owner: bool = False
    observed_owner_id: str | None = Field(default=None, max_length=64)


class ZoneTakeOverBody(DeviceBody):
    start_playing: bool = True
    confirm: bool = False


class ZoneCommandBody(DeviceBody):
    command: str = Field(max_length=32)
    args: dict[str, Any] | None = Field(default=None, max_length=16)
    based_on_seq: int = Field(ge=0)
    idempotency_key: str | None = Field(default=None, max_length=128)
    # Commands from a controller must be fenced; accepting omission would revive
    # sequence-only authorization for this route.
    fence: int = Field(ge=0)
    ttl_seconds: int | None = Field(default=None, ge=0, le=fencing.MAX_TTL_SECONDS)


class HandBackBody(DeviceBody):
    song_index: int = Field(ge=0)
    offset_ms: int = Field(ge=0)
    state: PlayState | None = None
    mix_revision_id: str | None = Field(default=None, max_length=64)
    seq: int | None = Field(default=None, ge=0)


class CommandBody(DeviceBody):
    command: str = Field(max_length=32)
    # a few named arguments at most; a programme's songs are capped by MAX_PROGRAMME
    args: dict[str, Any] | None = Field(default=None, max_length=16)
    based_on_seq: int = Field(ge=0)
    idempotency_key: str | None = Field(default=None, max_length=128)
    # ADR-0461: every press is issued under an explicit fence and expires from server time.
    fence: int = Field(ge=0)
    ttl_seconds: int | None = Field(default=None, ge=0, le=fencing.MAX_TTL_SECONDS)


class AckBody(DeviceBody):
    result: str = Field(max_length=32)  # "applied" or "unavailable_here"
    # BF-0461: the envelope signature the speaker verified, and for unavailable_here the
    # ADR-0458 song id it could not resolve (default: the session's current programme entry).
    signature: str | None = Field(default=None, max_length=64)
    song_id: int | None = Field(default=None, ge=0)


# Refused presses the controller must hear about loudly, with the current state to redraw from.
# "no_speaker" stays a 200: the client answers it by offering "Play here".


__all__ = [
    "CapabilitiesBody",
    "RegisterBody",
    "RenameBody",
    "DeviceBody",
    "HeartbeatBody",
    "TakeOverBody",
    "ZoneTakeOverBody",
    "ZoneCommandBody",
    "HandBackBody",
    "CommandBody",
    "AckBody",
]
