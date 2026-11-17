"""Cloud HTTP routes for devices and the one playback session per account (ADR-0415).

Every signed-in browser registers as a device and keeps the id it's given (in local storage, and
in an HttpOnly cookie as a fallback). Each call names its device, and the device must be one of
the caller's own in the caller's workspace: anyone else's looks exactly like a device that
doesn't exist.

The speaker heartbeats every 5 s; any device can take over ("Play here"); remotes send commands
with an idempotency key and the sequence they were based on. A stale command is refused as 409
`stale_command` with the current state, so the remote can redraw and try again.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from selecta.business import device_cookie
from selecta.flags import cloud_gate
from selecta.flags.rules import RulesCache
from selecta.identity.tokens import Claims
from selecta.persistence import transaction
from selecta.playback import devices, fencing, session
from selecta.playback import store as playback_store
from selecta.playback.model import (
    MAX_SIGNED_IN_DEVICES,
    Capabilities,
    CommandUnavailable,
    Device,
    DeviceKind,
    DeviceSignedOut,
    IdempotencyConflict,
    InvalidCommand,
    NotTheSpeaker,
    OwnershipChanged,
    PlaybackError,
    PlayState,
    Position,
    Session,
    UnknownCommand,
    UnknownDevice,
)
from selecta.playback.ports import PlaybackEvents
from selecta.playback.store import load_device, session_payload

# The legacy name; each workspace now has its own cookie (`business.device_cookie`, ADR-0442).
DEVICE_COOKIE = device_cookie.LEGACY_COOKIE
NOT_FOUND = {"code": "unknown_device", "message": "That device isn't signed in here."}


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


class TakeOverBody(DeviceBody):
    start_playing: bool = True
    require_observed_owner: bool = False
    observed_owner_id: str | None = Field(default=None, max_length=64)


class CommandBody(DeviceBody):
    command: str = Field(max_length=32)
    args: dict[str, Any] | None = None
    based_on_seq: int = Field(ge=0)
    idempotency_key: str | None = Field(default=None, max_length=128)
    # ADR-0461: the fence the press was issued under (None: checked by sequence alone, as
    # before), and how long it stays executable, from server time.
    fence: int | None = Field(default=None, ge=0)
    ttl_seconds: int | None = Field(default=None, ge=0, le=fencing.MAX_TTL_SECONDS)


class AckBody(DeviceBody):
    result: str = Field(max_length=32)  # "applied" or "unavailable_here"


# Refused presses the controller must hear about loudly, with the current state to redraw from.
# "no_speaker" stays a 200: the client answers it by offering "Play here".
COMMAND_REFUSALS = {
    session.CommandStatus.STALE: (
        "stale_command",
        "Something changed since you pressed that. Here's where it is now.",
    ),
    session.CommandStatus.SUPERSEDED: (
        "superseded_command",
        "Playback moved to another device since you pressed that. Here's where it is now.",
    ),
    session.CommandStatus.EXPIRED: (
        "expired_command",
        "That press waited too long, so it was dropped. Here's where it is now.",
    ),
}


def device_json(device: Device, *, this_device: str | None = None) -> dict[str, Any]:
    return {
        "id": device.id,
        "name": device.name,
        "kind": device.kind.value,
        "capabilities": device.capabilities.to_json(),
        "created_at": device.created_at,
        "last_seen_at": device.last_seen_at,
        "signed_in": device.signed_in,
        "this_device": device.id == this_device,
        "poor_speaker": devices.is_poor_speaker(device),
        "warnings": [
            {"code": warning.value, "text": devices.WARNING_TEXT[warning]}
            for warning in devices.speaker_warnings(device)
        ],
    }


def session_json(value: Session | None, now: float | None = None) -> dict[str, Any] | None:
    """Give `now` (server time) where the route has it, so `state_confidence` is judged
    against the moment of the answer rather than the session's last write."""
    return None if value is None else session_payload(value, now)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    rules: RulesCache,
    events: PlaybackEvents,
) -> None:
    def principal(request: Request, claims: Claims, flag_id: str = "devices"):
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        with transaction(engine, found.workspace.id) as conn:
            cloud_gate.require(conn, found, flag_id, rules)
        return found

    def cookie_device(found, request: Request, device_id: str | None = None) -> str | None:
        """The body's device id, else this workspace's own device cookie."""
        return device_cookie.read(
            request.cookies,
            found.workspace.id,
            personal=found.workspace.kind == "personal",
            body_device_id=device_id,
        )

    def mine(found, device_id: str | None, request: Request) -> str:
        """The caller's own device id, from the body or the cookie; anything else is 404."""
        device_id = cookie_device(found, request, device_id)
        if not device_id:
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        with transaction(engine, found.workspace.id) as conn:
            device = load_device(conn, found.workspace.id, device_id)
        if device is None or device.user_id != found.user.id:
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        return device_id

    def server_time() -> float:
        # through the store module, which holds playback's one reference to database time, so a
        # test clock pointed there moves every view of a lease at once
        with transaction(engine) as conn:
            return playback_store.db_now(conn)

    def refused(error: PlaybackError) -> HTTPException:
        if isinstance(error, UnknownDevice):
            return HTTPException(status_code=404, detail=NOT_FOUND)
        if isinstance(error, UnknownCommand):
            # Someone else's command id answers exactly like one that never existed.
            return HTTPException(
                status_code=404,
                detail={"code": error.code, "message": "No such command here."},
            )
        if isinstance(error, NotTheSpeaker):
            return HTTPException(
                status_code=403,
                detail={"code": error.code, "message": str(error)},
            )
        if isinstance(error, DeviceSignedOut):
            return HTTPException(
                status_code=403,
                detail={"code": error.code, "message": "This device was signed out."},
            )
        if isinstance(error, InvalidCommand):
            return HTTPException(
                status_code=422,
                detail={"code": error.code, "message": str(error)},
            )
        if isinstance(error, (CommandUnavailable, IdempotencyConflict, OwnershipChanged)):
            return HTTPException(
                status_code=409,
                detail={"code": error.code, "message": str(error)},
            )
        return HTTPException(status_code=404, detail=NOT_FOUND)

    @app.post("/api/devices", status_code=201)
    def register_device(
        body: RegisterBody,
        request: Request,
        response: Response,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims)
        result = devices.register(
            engine,
            found.workspace.id,
            found.user.id,
            name=body.name,
            kind=body.kind,
            capabilities=Capabilities(**body.capabilities.model_dump()),
            device_id=cookie_device(found, request, body.device_id),
            events=events,
        )
        response.set_cookie(
            device_cookie.cookie_name(found.workspace.id),
            result.device.id,
            max_age=400 * 86_400,
            path="/api",
            secure=True,
            httponly=True,
            samesite="lax",
        )
        notice = None
        if result.signed_out is not None:
            notice = (
                f"You can be signed in on {MAX_SIGNED_IN_DEVICES} devices, so "
                f"{result.signed_out.name} was signed out."
            )
        return {
            "device": device_json(result.device, this_device=result.device.id),
            "signed_out": None
            if result.signed_out is None
            else device_json(result.signed_out),
            "notice": notice,
            "limit": MAX_SIGNED_IN_DEVICES,
        }

    @app.get("/api/devices")
    def list_my_devices(
        request: Request,
        device_id: str | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims)
        here = cookie_device(found, request, device_id)
        listed = devices.list_devices(engine, found.workspace.id, user_id=found.user.id)
        return {
            "devices": [device_json(device, this_device=here) for device in listed],
            "limit": MAX_SIGNED_IN_DEVICES,
        }

    @app.patch("/api/devices/{device_id}")
    def rename_device(
        device_id: str,
        body: RenameBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims)
        mine(found, device_id, request)
        try:
            device = devices.rename(
                engine, found.workspace.id, device_id, body.name, user_id=found.user.id
            )
        except PlaybackError as error:
            raise refused(error) from error
        return {"device": device_json(device)}

    @app.post("/api/devices/{device_id}/sign-out")
    def sign_out_device(
        device_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims)
        mine(found, device_id, request)
        try:
            device = devices.sign_out(
                engine, found.workspace.id, device_id, user_id=found.user.id, events=events
            )
        except PlaybackError as error:
            raise refused(error) from error
        return {"device": device_json(device)}

    @app.get("/api/playback/session")
    def playback_session(
        request: Request,
        device_id: str | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims)
        here = mine(found, device_id, request)
        now = server_time()
        view = session.session_view(engine, found.workspace.id, here, now=now)
        position = view.position
        return {
            "session": session_json(view.session, now),
            "position": None
            if position is None
            else {"song_index": position.song_index, "offset_ms": position.offset_ms},
            "speaker": view.speaker.value,
            "speaker_device_id": view.speaker_device_id,
            "speaker_name": view.speaker_name,
            "ask_before_playing_here": view.ask_before_playing_here,
            "server_time": now,
        }

    @app.post("/api/playback/heartbeat")
    def playback_heartbeat(
        body: HeartbeatBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims)
        here = mine(found, body.device_id, request)
        position = Position(
            song_index=body.song_index,
            offset_ms=body.offset_ms,
            state=body.state,
            mix_revision_id=body.mix_revision_id,
            seq=body.seq,
        )
        try:
            result = session.heartbeat(
                engine, found.workspace.id, here, position, fence=body.fence, events=events
            )
        except PlaybackError as error:
            raise refused(error) from error
        now = server_time()
        return {
            "outcome": result.outcome.value,
            "position_accepted": result.position_accepted,
            "previous_device_id": result.previous_device_id,
            "session": session_json(result.session, now),
            "server_time": now,
        }

    @app.post("/api/playback/take-over")
    def playback_take_over(
        body: TakeOverBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims)
        here = mine(found, body.device_id, request)
        try:
            result = session.take_over(
                engine, found.workspace.id, here,
                start_playing=body.start_playing,
                require_observed_owner=body.require_observed_owner,
                observed_owner_id=body.observed_owner_id,
                events=events
            )
        except PlaybackError as error:
            raise refused(error) from error
        previous = result.previous_device
        now = server_time()
        return {
            "session": session_json(result.session, now),
            "previous_device": None
            if previous is None
            else {"id": previous.id, "name": previous.name},
            "message": result.message,
            "server_time": now,
        }

    @app.post("/api/playback/reconnect")
    def playback_reconnect(
        body: DeviceBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims)
        here = mine(found, body.device_id, request)
        result = session.on_reconnect(engine, found.workspace.id, here)
        return {
            "action": result.action.value,
            # Judged at the moment of answering: a device coming back to a speaker whose lease
            # has lapsed must see "uncertain", not the confidence of the session's last write.
            "session": session_json(result.session, server_time()),
            "moved_to_device_id": result.moved_to_device_id,
            "moved_to_name": result.moved_to_name,
            "reason": result.reason,
            "message": result.message,
        }

    @app.post("/api/playback/commands")
    def playback_command(
        body: CommandBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims, "devices.remote_control")
        here = mine(found, body.device_id, request)
        key = body.idempotency_key or request.headers.get("idempotency-key") or ""
        try:
            result = session.submit_command(
                engine,
                found.workspace.id,
                here,
                body.command,
                body.args,
                body.based_on_seq,
                key,
                fence=body.fence,
                ttl_seconds=body.ttl_seconds,
                events=events,
            )
        except PlaybackError as error:
            raise refused(error) from error
        answer = {
            "status": result.status.value,
            "session": session_json(result.session, server_time()),
            "applied_seq": result.applied_seq,
            "command_id": result.command_id,
            "replayed": result.replayed,
            "fence": result.fence,
            "expires_at": result.expires_at,
        }
        refusal = COMMAND_REFUSALS.get(result.status)
        if refusal is not None:
            code, message = refusal
            raise HTTPException(
                status_code=409, detail={"code": code, "message": message, **answer}
            )
        return answer

    @app.post("/api/playback/commands/{command_id}/ack")
    def playback_command_ack(
        command_id: str,
        body: AckBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Record delivery to local state, never an audibility claim (ADR-0461)."""
        found = principal(request, claims, "devices.remote_control")
        here = mine(found, body.device_id, request)
        try:
            result = fencing.ack_command(
                engine, found.workspace.id, here, command_id, body.result
            )
        except PlaybackError as error:
            raise refused(error) from error
        return {
            "command_id": result.command_id,
            "ack_result": result.ack_result,
            "acked_at": result.acked_at,
            "fence": result.fence,
            "replayed": result.replayed,
            "audible": False,
        }


__all__ = ["DEVICE_COOKIE", "device_json", "install_routes"]
