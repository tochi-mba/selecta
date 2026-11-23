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

import uuid

from collections.abc import Callable
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from selecta.business import device_cookie, entitlement_gates
from selecta.flags import cloud_gate
from selecta.flags.rules import RulesCache
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction
from selecta.playback import devices, envelope, fencing, session, zone_session
from selecta.playback import store as playback_store
from selecta.playback.model import (
    MAX_SIGNED_IN_DEVICES,
    BadSignature,
    Capabilities,
    CommandUnavailable,
    Device,
    DeviceInOtherZone,
    DeviceKind,
    DeviceSignedOut,
    HoldingZoneLease,
    IdempotencyConflict,
    InvalidCommand,
    NotTheSpeaker,
    OutputReport,
    OwnershipChanged,
    PersonSpeakerOff,
    PlaybackError,
    PlayState,
    Position,
    Session,
    UnknownCommand,
    UnknownDevice,
    UnknownZone,
    ZonePaused,
)
from selecta.playback.ports import START_ANSWER, START_ASK, PlaybackEvents
from selecta.playback.store import load_device, session_payload, touch_device
from selecta.playback.zones import ZoneDirectory

# The legacy name; each workspace now has its own cookie (`business.device_cookie`, ADR-0442).
DEVICE_COOKIE = device_cookie.LEGACY_COOKIE
# ADR-0475 R2: how long an ask to start on another device stands, how recently that device must
# have been seen to be asked, and what it may answer.
START_ASK_SECONDS = 10.0
TARGET_ONLINE_SECONDS = 30.0
START_ANSWERS = frozenset({"starting", "needs_music", "needs_gesture", "no_mix", "declined"})
# ADR-0475: how often a device seen through its own playback reads has that written down.
SEEN_EVERY_SECONDS = 10.0
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
    args: dict[str, Any] | None = None
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
    args: dict[str, Any] | None = None
    based_on_seq: int = Field(ge=0)
    idempotency_key: str | None = Field(default=None, max_length=128)
    # ADR-0461: every press is issued under an explicit fence and expires from server time.
    fence: int = Field(ge=0)
    ttl_seconds: int | None = Field(default=None, ge=0, le=fencing.MAX_TTL_SECONDS)


class StartAskBody(DeviceBody):
    """ADR-0475 R2: ask another of my devices to become the speaker and start playing."""

    target_device_id: str = Field(min_length=1, max_length=64)
    # the saved mix to play; left out, the target plays the mix it already has
    mix_id: str | None = Field(default=None, max_length=64)


class StartAnswerBody(DeviceBody):
    """What the asked device said. It performs any take-over itself (ADR-0461)."""

    asker_device_id: str = Field(min_length=1, max_length=64)
    result: str = Field(max_length=32)


class AckBody(DeviceBody):
    result: str = Field(max_length=32)  # "applied" or "unavailable_here"
    # BF-0461: the envelope signature the speaker verified, and for unavailable_here the
    # ADR-0458 song id it could not resolve (default: the session's current programme entry).
    signature: str | None = Field(default=None, max_length=64)
    song_id: int | None = Field(default=None, ge=0)


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
DEFERRED_MESSAGE = (
    "The speaker is offline. This reaches it if it is back before the press expires; "
    "otherwise it is dropped and shown as missed."
)


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
    zones: ZoneDirectory,
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
            # ADR-0475: other devices need to know this one is here. Every playback read or
            # press comes through this check, so it notes the device as seen, at most once
            # every few seconds (never a write per poll).
            if (
                device is not None
                and device.user_id == found.user.id
                and device.signed_in
            ):
                seen = db_now(conn)
                if seen - device.last_seen_at >= SEEN_EVERY_SECONDS:
                    touch_device(conn, device_id, seen)
        if device is None or device.user_id != found.user.id:
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        return device_id

    def org_devices(found, request: Request) -> list[tuple[str, str]]:
        """This person's own devices in their organisation workspaces, from this browser's
        per-workspace device cookies, as `(workspace_id, device_id)` pairs. Personal only:
        an organisation workspace has no other workspace's lease to check."""
        if found.workspace.kind != "personal":
            return []
        from selecta.business import orgs

        with transaction(engine, found.workspace.id) as conn:
            others = [
                item["id"]
                for item in orgs.list_for_user(conn, found.user.id)
                if item["kind"] != "personal"
            ]
        pairs: list[tuple[str, str]] = []
        for workspace_id in others:
            device_id = request.cookies.get(device_cookie.cookie_name(workspace_id))
            if not device_id:
                continue
            with transaction(engine, workspace_id) as conn:
                device = load_device(conn, workspace_id, device_id)
            if device is not None and device.user_id == found.user.id:
                pairs.append((workspace_id, device_id))
        return pairs

    def server_time() -> float:
        # through the store module, which holds playback's one reference to database time, so a
        # test clock pointed there moves every view of a lease at once
        with transaction(engine) as conn:
            return playback_store.db_now(conn)

    def zone_device(found, request: Request, device_id: str | None, zone_id: str) -> str:
        """The caller's own browser, or the kiosk paired to this zone; never another
        member's device. Zone scope is checked by the zone-session operation itself."""
        device_id = cookie_device(found, request, device_id)
        if not device_id:
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        with transaction(engine, found.workspace.id) as conn:
            device = load_device(conn, found.workspace.id, device_id)
        if (
            device is None
            or not device.signed_in
            or (
                device.user_id != found.user.id
                and not (device.is_kiosk and device.zone_id == zone_id)
            )
        ):
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        return device_id

    def zone_refused(error: PlaybackError) -> HTTPException:
        if isinstance(error, UnknownZone):
            return HTTPException(
                status_code=404,
                detail={"code": "zone_not_found", "message": "That zone isn't here."},
            )
        if isinstance(error, ZonePaused):
            return HTTPException(
                status_code=409, detail={"code": error.code, "message": str(error)}
            )
        if isinstance(error, DeviceInOtherZone):
            return HTTPException(
                status_code=409,
                detail={"code": error.code, "message": str(error), "zone_id": error.zone_id},
            )
        if isinstance(error, PersonSpeakerOff):
            return HTTPException(
                status_code=409, detail={"code": error.code, "message": str(error)}
            )
        if isinstance(error, zone_session.ConfirmNeeded):
            return HTTPException(
                status_code=409, detail={"code": error.code, "message": str(error)}
            )
        if isinstance(error, zone_session.LicenceMissing):
            return HTTPException(
                status_code=409, detail={"code": error.code, "message": str(error)}
            )
        if isinstance(error, zone_session.BillingStopped):
            return HTTPException(
                status_code=409, detail={"code": error.code, "message": str(error)}
            )
        if isinstance(error, zone_session.SpeakerOffline):
            return HTTPException(
                status_code=409, detail={"code": error.code, "message": str(error)}
            )
        if isinstance(error, zone_session.ZoneFull):
            return HTTPException(
                status_code=409, detail={"code": "zone_full", "message": str(error)}
            )
        return refused(error)

    def zone_holder(found, request: Request, device_id: str | None, zone_id: str) -> str:
        """Resolve a zone speaker/remote to the caller's device or this zone's kiosk."""
        return zone_device(found, request, device_id, zone_id)

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
        if isinstance(error, (InvalidCommand, BadSignature)):
            return HTTPException(
                status_code=422,
                detail={"code": error.code, "message": str(error)},
            )
        if isinstance(error, HoldingZoneLease):
            return HTTPException(
                status_code=409,
                detail={"code": error.code, "message": str(error), "zone_id": error.zone_id},
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
            "notices": view.notices,
            "envelope_key": view.envelope_key,
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
            output=None
            if body.output_status is None
            else OutputReport(body.output_status, body.output_verified_at),
        )
        try:
            result = session.heartbeat(
                engine, found.workspace.id, here, position, fence=body.fence, events=events
            )
        except PlaybackError as error:
            raise refused(error) from error
        now = server_time()
        holder = result.outcome is not session.HeartbeatOutcome.REFUSED
        return {
            "outcome": result.outcome.value,
            "position_accepted": result.position_accepted,
            "previous_device_id": result.previous_device_id,
            "session": session_json(result.session, now),
            "envelope_key": envelope.speaker_key(result.session) if holder else None,
            "delivered": list(result.delivered),
            "missed": list(result.missed),
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
            # A browser that is a zone's speaker hands the zone back before playing personal
            # music here (ADR-0443): one browser plays one session at a time.
            zone_session.refuse_personal_while_holding(
                engine, zones, org_devices(found, request), now=server_time()
            )
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
            "envelope_key": envelope.speaker_key(result.session),
            "missed": list(result.missed),
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
        result = session.on_reconnect(engine, found.workspace.id, here, events=events)
        carry_on = result.action is session.ReconnectAction.CONTINUE
        return {
            "action": result.action.value,
            # Judged at the moment of answering: a device coming back to a speaker whose lease
            # has lapsed must see "uncertain", not the confidence of the session's last write.
            "session": session_json(result.session, server_time()),
            "moved_to_device_id": result.moved_to_device_id,
            "moved_to_name": result.moved_to_name,
            "reason": result.reason,
            "message": result.message,
            "envelope_key": envelope.speaker_key(result.session)
            if carry_on and result.session is not None
            else None,
            "delivered": list(result.delivered),
            "missed": list(result.missed),
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
        if result.status is session.CommandStatus.DEFERRED:
            answer["message"] = DEFERRED_MESSAGE
        refusal = COMMAND_REFUSALS.get(result.status)
        if refusal is not None:
            code, message = refusal
            raise HTTPException(
                status_code=409, detail={"code": code, "message": message, **answer}
            )
        return answer

    @app.post("/api/playback/start-asks", status_code=201)
    def playback_start_ask(
        body: StartAskBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """ADR-0475 R2. Not a remote take-over: the ask reaches the target on the workspace's
        event stream, and the target decides and takes over by its own action. Nothing is
        stored; an ask nobody answers simply runs out on the asker after `START_ASK_SECONDS`."""
        found = principal(request, claims, "devices.remote_control")
        here = mine(found, body.device_id, request)
        if body.target_device_id == here:
            raise HTTPException(status_code=400, detail={"code": "same_device"})
        with transaction(engine, found.workspace.id) as conn:
            target = load_device(conn, found.workspace.id, body.target_device_id)
            asker = load_device(conn, found.workspace.id, here)
            if target is None or target.user_id != found.user.id or not target.signed_in:
                raise HTTPException(status_code=404, detail=NOT_FOUND)
            now = db_now(conn)
            if now - target.last_seen_at > TARGET_ONLINE_SECONDS:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "target_offline",
                        "message": f"{target.name} isn't open right now.",
                    },
                )
            ask = {
                "ask_id": uuid.uuid4().hex,
                "target_device_id": target.id,
                "target_name": target.name,
                "asker_device_id": here,
                "asker_name": asker.name if asker else "Another device",
                "mix_id": body.mix_id,
                "expires_at": now + START_ASK_SECONDS,
            }
            events.publish(conn, found.workspace.id, START_ASK, ask)
        return {**ask, "server_time": now}

    @app.post("/api/playback/start-asks/{ask_id}/answer")
    def playback_start_answer(
        ask_id: str,
        body: StartAnswerBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims, "devices.remote_control")
        here = mine(found, body.device_id, request)
        if body.result not in START_ANSWERS:
            raise HTTPException(status_code=422, detail={"code": "unknown_answer"})
        with transaction(engine, found.workspace.id) as conn:
            asker = load_device(conn, found.workspace.id, body.asker_device_id)
            target = load_device(conn, found.workspace.id, here)
            if asker is None or asker.user_id != found.user.id:
                raise HTTPException(status_code=404, detail=NOT_FOUND)
            answer = {
                "ask_id": ask_id[:64],
                "asker_device_id": asker.id,
                "target_device_id": here,
                "target_name": target.name if target else "That device",
                "result": body.result,
            }
            events.publish(conn, found.workspace.id, START_ANSWER, answer)
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
                engine, found.workspace.id, here, command_id, body.result,
                signature=body.signature, song_id=body.song_id, events=events,
            )
        except PlaybackError as error:
            raise refused(error) from error
        return {
            "command_id": result.command_id,
            "ack_result": result.ack_result,
            "acked_at": result.acked_at,
            "fence": result.fence,
            "replayed": result.replayed,
            "song_id": result.song_id,
            "alternatives": list(result.alternatives),
            "audible": False,
        }

    # Zone sessions use the same signed, fenced command protocol as personal playback.
    @app.get("/api/zones/playback")
    def list_zone_playback(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims, "devices")
        now = server_time()
        summaries = zone_session.zones_overview(
            engine, zones, found.workspace.id, user_id=found.user.id
        )
        return {
            "zones": [
                {
                    "zone_id": item.zone.id,
                    "zone_name": item.zone.name,
                    "venue_id": item.zone.venue_id,
                    "venue_name": item.zone.venue_name,
                    "status": item.zone.status,
                    "session": session_json(item.session, now),
                    "speaker_name": item.speaker_name,
                    "speaker_is_person": item.speaker_is_person,
                }
                for item in summaries
            ],
            "server_time": now,
        }

    @app.get("/api/zones/holding")
    def zone_held_by_device(
        request: Request,
        device_id: str | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims, "devices")
        here = cookie_device(found, request, device_id)
        if not here:
            return {"zone_id": None}
        with transaction(engine, found.workspace.id) as conn:
            device = load_device(conn, found.workspace.id, here)
        if (
            device is None
            or not device.signed_in
            or (
                device.user_id != found.user.id
                and not (device.is_kiosk and device.zone_id is not None)
            )
        ):
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        zone_id = zone_session.holding_zone(
            engine, found.workspace.id, here, now=server_time()
        )
        if zone_id is not None:
            with transaction(engine, found.workspace.id) as conn:
                zone = zones.zone(conn, found.workspace.id, zone_id)
                if zone is None or not zones.in_scope(
                    conn, found.workspace.id, found.user.id, zone
                ):
                    zone_id = None
        return {"zone_id": zone_id}

    @app.get("/api/zones/{zone_id}/playback/session")
    def zone_playback_session(
        zone_id: str,
        request: Request,
        device_id: str | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims, "devices")
        here = zone_holder(found, request, device_id, zone_id)
        now = server_time()
        try:
            view = zone_session.zone_view(
                engine, zones, found.workspace.id, zone_id, here,
                user_id=found.user.id, now=now,
            )
        except PlaybackError as error:
            raise zone_refused(error) from error
        return {
            "session": session_json(view.session, now),
            "position": None
            if view.position is None
            else {"song_index": view.position.song_index, "offset_ms": view.position.offset_ms},
            "speaker": view.speaker.value,
            "speaker_device_id": view.speaker_device_id,
            "speaker_name": view.speaker_name,
            "ask_before_playing_here": view.ask_before_playing_here,
            "notices": view.notices,
            "envelope_key": view.envelope_key,
            "server_time": now,
        }

    @app.post("/api/zones/{zone_id}/playback/heartbeat")
    def zone_playback_heartbeat(
        zone_id: str,
        body: HeartbeatBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims, "devices")
        here = zone_holder(found, request, body.device_id, zone_id)
        position = Position(
            song_index=body.song_index,
            offset_ms=body.offset_ms,
            state=body.state,
            mix_revision_id=body.mix_revision_id,
            seq=body.seq,
            output=None
            if body.output_status is None
            else OutputReport(body.output_status, body.output_verified_at),
        )
        try:
            result = zone_session.zone_heartbeat(
                engine, zones, found.workspace.id, zone_id, here, position,
                fence=body.fence, user_id=found.user.id, events=events,
            )
        except PlaybackError as error:
            raise zone_refused(error) from error
        now = server_time()
        holder = (
            result.outcome is not session.HeartbeatOutcome.REFUSED
            and result.session.active_device_id == here
        )
        return {
            "outcome": result.outcome.value,
            "position_accepted": result.position_accepted,
            "previous_device_id": result.previous_device_id,
            "hand_back_to_device_id": result.hand_back_to_device_id,
            "playing_zone_id": result.playing_zone_id,
            "playing_zone_name": result.playing_zone_name,
            "session": session_json(result.session, now),
            "envelope_key": envelope.speaker_key(result.session) if holder else None,
            "delivered": list(result.delivered),
            "missed": list(result.missed),
            "server_time": now,
        }

    @app.post("/api/zones/{zone_id}/playback/take-over")
    def zone_playback_take_over(
        zone_id: str,
        body: ZoneTakeOverBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims, "devices")
        here = zone_holder(found, request, body.device_id, zone_id)
        started_at = server_time()  # read first: one transaction at a time on SQLite
        with transaction(engine, found.workspace.id) as conn:  # ADR-0448 paid zones
            refused = entitlement_gates.zone_start_refusal(
                conn, found.workspace.id, zone_id, started_at)
        if refused is not None:
            raise HTTPException(status_code=403, detail={"code": "zone_not_paid",
                                                         "message": refused})
        try:
            result = zone_session.zone_take_over(
                engine, zones, found.workspace.id, zone_id, here,
                user_id=found.user.id, start_playing=body.start_playing,
                confirm=body.confirm, events=events,
            )
        except PlaybackError as error:
            raise zone_refused(error) from error
        now = server_time()
        previous = result.previous_device
        return {
            "session": session_json(result.session, now),
            "previous_device": (
                None if previous is None else {"id": previous.id, "name": previous.name}
            ),
            "message": result.message,
            "envelope_key": envelope.speaker_key(result.session),
            "missed": list(result.missed),
            "server_time": now,
        }

    @app.post("/api/zones/{zone_id}/playback/reconnect")
    def zone_playback_reconnect(
        zone_id: str,
        body: DeviceBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims, "devices")
        here = zone_holder(found, request, body.device_id, zone_id)
        try:
            result = zone_session.zone_reconnect(
                engine, zones, found.workspace.id, zone_id, here,
                user_id=found.user.id, events=events,
            )
        except PlaybackError as error:
            raise zone_refused(error) from error
        carry_on = result.action is session.ReconnectAction.CONTINUE
        now = server_time()
        return {
            "action": result.action.value,
            "session": session_json(result.session, now),
            "moved_to_device_id": result.moved_to_device_id,
            "moved_to_name": result.moved_to_name,
            "reason": result.reason,
            "message": result.message,
            "envelope_key": envelope.speaker_key(result.session)
            if carry_on and result.session is not None
            else None,
            "delivered": list(result.delivered),
            "missed": list(result.missed),
            "server_time": now,
        }

    @app.post("/api/zones/{zone_id}/playback/commands")
    def zone_playback_command(
        zone_id: str,
        body: ZoneCommandBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims, "devices.remote_control")
        here = zone_holder(found, request, body.device_id, zone_id)
        key = body.idempotency_key or request.headers.get("idempotency-key") or ""
        try:
            result = zone_session.zone_submit_command(
                engine, zones, found.workspace.id, zone_id, here,
                body.command, body.args, body.based_on_seq, key,
                fence=body.fence, ttl_seconds=body.ttl_seconds,
                user_id=found.user.id, events=events,
            )
        except PlaybackError as error:
            raise zone_refused(error) from error
        answer = {
            "status": result.status.value,
            "session": session_json(result.session, server_time()),
            "applied_seq": result.applied_seq,
            "command_id": result.command_id,
            "replayed": result.replayed,
            "fence": result.fence,
            "expires_at": result.expires_at,
        }
        if result.status is session.CommandStatus.DEFERRED:
            answer["message"] = DEFERRED_MESSAGE
        refusal = COMMAND_REFUSALS.get(result.status)
        if refusal is not None:
            code, message = refusal
            raise HTTPException(
                status_code=409, detail={"code": code, "message": message, **answer}
            )
        return answer

    @app.post("/api/zones/{zone_id}/playback/commands/{command_id}/ack")
    def zone_playback_command_ack(
        zone_id: str,
        command_id: str,
        body: AckBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Record an ACK from a zone kiosk or staff speaker; it still means delivery only."""
        found = principal(request, claims, "devices.remote_control")
        here = zone_holder(found, request, body.device_id, zone_id)

        def authorize_zone_scope(conn, command_zone_id: str) -> None:
            # Run this inside the ACK transaction so access cannot be revoked between the
            # membership check and the acknowledgement write.
            zone_session.require_zone(
                conn,
                zones,
                found.workspace.id,
                command_zone_id,
                user_id=found.user.id,
                allow_paused=True,
            )

        try:
            result = fencing.ack_command(
                engine, found.workspace.id, here, command_id, body.result,
                signature=body.signature, song_id=body.song_id,
                expected_zone_id=zone_id,
                authorize_zone=authorize_zone_scope,
                events=events,
            )
        except PlaybackError as error:
            raise zone_refused(error) from error
        return {
            "command_id": result.command_id,
            "ack_result": result.ack_result,
            "acked_at": result.acked_at,
            "fence": result.fence,
            "replayed": result.replayed,
            "song_id": result.song_id,
            "alternatives": list(result.alternatives),
            "audible": False,
        }

    @app.post("/api/zones/{zone_id}/playback/hand-back")
    def zone_playback_hand_back(
        zone_id: str,
        body: HandBackBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims, "devices.remote_control")
        here = zone_holder(found, request, body.device_id, zone_id)
        position = Position(
            song_index=body.song_index,
            offset_ms=body.offset_ms,
            state=body.state,
            mix_revision_id=body.mix_revision_id,
            seq=body.seq,
        )
        try:
            value = zone_session.hand_back(
                engine, zones, found.workspace.id, zone_id, here, position,
                user_id=found.user.id, events=events,
            )
        except PlaybackError as error:
            raise zone_refused(error) from error
        now = server_time()
        return {"session": session_json(value, now), "server_time": now}


__all__ = ["DEVICE_COOKIE", "device_json", "install_routes"]
