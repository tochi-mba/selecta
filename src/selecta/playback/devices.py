"""Devices: every signed-in browser registers once and shows up under Account, Devices.

A device's id is made here and kept by the browser (a cookie and local storage). If the browser
loses it, it registers as a new device and the old entry ages out. A person can have ten signed-in
devices; signing in an eleventh signs out the one they've used least recently, and that device is
returned so the site can say so.

Any device can be the speaker, but some are poor at it. An iPhone, and any iOS home-screen app,
suspends Web Audio when the screen locks, so Selecta says plainly to keep the screen on.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.persistence import new_id, transaction
from selecta.playback.model import (
    DEVICE_NAME_MAX,
    MAX_SIGNED_IN_DEVICES,
    Capabilities,
    Device,
    DeviceKind,
    PlaybackError,
)
from selecta.playback.ports import NO_EVENTS, PlaybackEvents
from selecta.playback.schema import devices
from selecta.playback.store import (
    device_from_row,
    load_device,
    require_device,
    require_signed_in,
    resolve_now,
    sign_out_devices,
    touch_device,
)


class SpeakerWarning(StrEnum):
    NO_AUDIO = "no_audio"
    IOS_KEEP_SCREEN_ON = "ios_keep_screen_on"
    NO_WAKE_LOCK = "no_wake_lock"


WARNING_TEXT = {
    SpeakerWarning.NO_AUDIO: "This device can't play audio, so it can only be a remote.",
    SpeakerWarning.IOS_KEEP_SCREEN_ON: (
        "On iPhone, keep Selecta open with the screen on while it plays."
    ),
    SpeakerWarning.NO_WAKE_LOCK: (
        "This browser can't keep the screen awake. If the screen sleeps, the music may stop."
    ),
}


@dataclass(frozen=True)
class RegisterResult:
    device: Device
    signed_out: Device | None  # the device signed out to stay within the limit, if any
    warnings: tuple[SpeakerWarning, ...]


_SPACES = re.compile(r"\s+")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def clean_name(name: str | None, kind: DeviceKind) -> str:
    """A tidy device name: no control characters, single spaces, at most 60 characters."""
    text = _SPACES.sub(" ", _CONTROL.sub("", name or "")).strip()[:DEVICE_NAME_MAX].strip()
    return text or kind.value.capitalize()


def speaker_warnings(device: Device) -> tuple[SpeakerWarning, ...]:
    """What to tell someone before this device becomes the speaker."""
    caps = device.capabilities
    if not caps.can_play_audio:
        return (SpeakerWarning.NO_AUDIO,)
    warnings: list[SpeakerWarning] = []
    if caps.ios or caps.ios_home_screen:
        warnings.append(SpeakerWarning.IOS_KEEP_SCREEN_ON)
    if not caps.wake_lock:
        warnings.append(SpeakerWarning.NO_WAKE_LOCK)
    return tuple(warnings)


def is_poor_speaker(device: Device) -> bool:
    """iPhones and iOS home-screen apps make good remotes and poor speakers."""
    caps = device.capabilities
    return (
        not caps.can_play_audio
        or caps.ios_home_screen
        or (caps.ios and device.kind is DeviceKind.PHONE)
    )


def register(
    engine: Engine,
    workspace_id: str,
    user_id: str,
    *,
    name: str | None,
    kind: DeviceKind | str,
    capabilities: Capabilities | None = None,
    device_id: str | None = None,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> RegisterResult:
    """Sign a browser in as a device. A `device_id` this person already has signs that device
    back in (keeping the name they gave it); any other id is ignored and a new one is made."""
    kind = DeviceKind(kind)
    capabilities = capabilities or Capabilities()
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        # Lock this person's devices so two sign-ins at once can't both slip under the limit.
        mine = (
            conn.execute(
                sa.select(devices)
                .where(devices.c.workspace_id == workspace_id, devices.c.user_id == user_id)
                .with_for_update()
            )
            .mappings()
            .all()
        )
        known = next((row for row in mine if device_id and row["id"] == device_id), None)
        if known is not None:
            conn.execute(
                sa.update(devices)
                .where(devices.c.id == known["id"])
                .values(
                    kind=kind.value,
                    capabilities=capabilities.to_json(),
                    last_seen_at=now,
                    signed_out_at=None,
                )
            )
            this_id = known["id"]
        else:
            this_id = new_id()
            conn.execute(
                sa.insert(devices).values(
                    id=this_id,
                    workspace_id=workspace_id,
                    user_id=user_id,
                    name=clean_name(name, kind),
                    kind=kind.value,
                    capabilities=capabilities.to_json(),
                    created_at=now,
                    last_seen_at=now,
                    signed_out_at=None,
                )
            )
        others = [
            row for row in mine if row["id"] != this_id and row["signed_out_at"] is None
        ]
        signed_out = None
        if len(others) + 1 > MAX_SIGNED_IN_DEVICES:
            oldest = min(others, key=lambda row: (row["last_seen_at"], row["created_at"]))
            sign_out_devices(conn, workspace_id, [oldest["id"]], now, "device_limit", events)
            signed_out = load_device(conn, workspace_id, oldest["id"])
        device = require_device(conn, workspace_id, this_id)
    return RegisterResult(device, signed_out, speaker_warnings(device))


def rename(
    engine: Engine, workspace_id: str, device_id: str, name: str, *, user_id: str | None = None
) -> Device:
    """Give a device a friendlier name, such as "Living-room laptop"."""
    with transaction(engine, workspace_id) as conn:
        device = require_device(conn, workspace_id, device_id)
        _check_owner(device, user_id)
        conn.execute(
            sa.update(devices)
            .where(devices.c.id == device_id)
            .values(name=clean_name(name, device.kind))
        )
        return require_device(conn, workspace_id, device_id)


def sign_out(
    engine: Engine,
    workspace_id: str,
    device_id: str,
    *,
    user_id: str | None = None,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> Device:
    """Sign one device out. If it's the speaker, playback stops gracefully where it was."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        device = require_device(conn, workspace_id, device_id)
        _check_owner(device, user_id)
        if device.signed_in:
            sign_out_devices(conn, workspace_id, [device_id], now, "signed_out", events)
        return require_device(conn, workspace_id, device_id)


def list_devices(
    engine: Engine,
    workspace_id: str,
    *,
    user_id: str | None = None,
    include_signed_out: bool = False,
) -> list[Device]:
    """Devices, most recently seen first: one person's, or everyone's in the workspace."""
    query = sa.select(devices).where(devices.c.workspace_id == workspace_id)
    if user_id is not None:
        query = query.where(devices.c.user_id == user_id)
    if not include_signed_out:
        query = query.where(devices.c.signed_out_at.is_(None))
    query = query.order_by(devices.c.last_seen_at.desc(), devices.c.id)
    with transaction(engine, workspace_id) as conn:
        return [device_from_row(row) for row in conn.execute(query).mappings()]


def touch(
    engine: Engine, workspace_id: str, device_id: str, *, now: float | None = None
) -> Device:
    """Note that a signed-in device was just seen."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        require_signed_in(conn, workspace_id, device_id)
        touch_device(conn, device_id, now)
        return require_device(conn, workspace_id, device_id)


def _check_owner(device: Device, user_id: str | None) -> None:
    if user_id is not None and device.user_id != user_id:
        raise PlaybackError("That device belongs to someone else")
