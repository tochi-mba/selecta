"""ADR-0475 "Default speaker" and the rule for which device plays when nothing is playing.

The person may mark one of their signed-in devices as the default speaker
(`PUT /api/devices/default-speaker`, under `devices.remote_control`). It is read with the devices
list and the holdings, cleared when that device is signed out, and used by `room_speaker` below:
the device whose songs a room offers its guests.

Which device makes the sound when one must be chosen (the revised R1):
1. the session's speaker, while its lease holds (playing or paused);
2. else the default speaker, when it is online and holds music now;
3. else the only online device that holds music now;
4. else, with two or more, nobody until the person chooses (`choosing`);
5. else, with none online, nobody (`none`).
A speaker whose lease lapsed a moment ago is `reconnecting`: nothing is offered in its place until
it is back or another device takes over.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction
from selecta.playback.default_speaker_schema import playback_default_speakers
from selecta.playback.schema import devices, playback_sessions
from selecta.work import outbox

# The same window the holdings route uses for "online" (local_media/api.py).
ONLINE_WITHIN_SECONDS = 30.0
# A speaker whose lease lapsed less than this long ago is reconnecting, not gone.
RECONNECTING_FOR_SECONDS = 300.0
# Published on the workspace event stream when the default changes.
TOPIC = "devices.default_speaker"


def read(conn: Connection, workspace_id: str) -> str | None:
    return conn.execute(
        sa.select(playback_default_speakers.c.device_id)
        .where(playback_default_speakers.c.workspace_id == workspace_id)
    ).scalar()


def choose(conn: Connection, workspace_id: str, device_id: str | None) -> str | None:
    conn.execute(
        playback_default_speakers.delete()
        .where(playback_default_speakers.c.workspace_id == workspace_id)
    )
    if device_id is not None:
        conn.execute(
            playback_default_speakers.insert().values(
                workspace_id=workspace_id, device_id=device_id, set_at=db_now(conn)
            )
        )
    return device_id


def forget(conn: Connection, workspace_id: str, device_ids: Iterable[str]) -> None:
    """Signed-out devices stop being the default."""
    ids = sorted(set(device_ids))
    if ids:
        conn.execute(
            playback_default_speakers.delete()
            .where(playback_default_speakers.c.workspace_id == workspace_id)
            .where(playback_default_speakers.c.device_id.in_(ids))
        )


@dataclass(frozen=True)
class RoomSpeaker:
    """`state`: ready (a device plays, `device_id`), choosing (two or more could and none is
    the default), reconnecting (the speaker's lease lapsed a moment ago), none (no device with
    music is open)."""

    state: str
    device_id: str | None


def room_speaker(
    conn: Connection,
    workspace_id: str,
    holds: Callable[[Connection, str, float], dict[str, int]],
    now: float | None = None,
) -> RoomSpeaker:
    """The device whose songs are offered now, by the rule in the module docstring. `holds`
    answers {device_id: songs held now} for the workspace."""
    now = db_now(conn) if now is None else now
    session = conn.execute(
        sa.select(playback_sessions.c.active_device_id, playback_sessions.c.lease_expires_at)
        .where(playback_sessions.c.workspace_id == workspace_id)
        .where(playback_sessions.c.zone_id.is_(None))
    ).first()
    if session is not None and session.active_device_id:
        lease = float(session.lease_expires_at or 0)
        if lease >= now:
            return RoomSpeaker("ready", session.active_device_id)
        if now - lease < RECONNECTING_FOR_SECONDS:
            return RoomSpeaker("reconnecting", None)
    online = set(
        conn.execute(
            sa.select(devices.c.id)
            .where(devices.c.workspace_id == workspace_id)
            .where(devices.c.signed_out_at.is_(None))
            .where(devices.c.last_seen_at >= now - ONLINE_WITHIN_SECONDS)
        ).scalars()
    )
    held = {device: count for device, count in holds(conn, workspace_id, now).items() if count}
    able = [device for device in online if device in held]
    default = read(conn, workspace_id)
    if default in able:
        return RoomSpeaker("ready", default)
    if len(able) == 1:
        return RoomSpeaker("ready", able[0])
    return RoomSpeaker("choosing" if able else "none", None)


class DefaultSpeakerBody(BaseModel):
    # null clears the default
    device_id: str | None = Field(default=None, max_length=64)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal: Callable[..., Any],
) -> None:
    @app.put("/api/devices/default-speaker")
    def set_default_speaker(
        body: DefaultSpeakerBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims, "devices.remote_control")
        with transaction(engine, found.workspace.id) as conn:
            if body.device_id is not None:
                owner = conn.execute(
                    sa.select(devices.c.user_id, devices.c.signed_out_at)
                    .where(devices.c.workspace_id == found.workspace.id)
                    .where(devices.c.id == body.device_id)
                ).first()
                if owner is not None and owner.user_id == found.user.id and owner.signed_out_at:
                    # the person's own device, signed out: a clear refusal, not "not found"
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": "device_signed_out",
                            "message": "That device is signed out. Sign in on it first.",
                        },
                    )
                if owner is None or owner.user_id != found.user.id:
                    raise HTTPException(
                        status_code=404,
                        detail={
                            "code": "unknown_device",
                            "message": "That device isn't signed in here.",
                        },
                    )
            before = read(conn, found.workspace.id)
            chosen = choose(conn, found.workspace.id, body.device_id)
            # every open device of the person hears the change (ADR-0475 C19)
            if before != chosen:
                outbox.emit(
                    conn, TOPIC, found.workspace.id, {"default_speaker_id": chosen}, db_now(conn)
                )
            return {"default_speaker_id": chosen}


__all__ = ["RoomSpeaker", "choose", "forget", "install_routes", "read", "room_speaker"]
