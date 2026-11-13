"""Cloud HTTP routes for the host's room panel (ADR-0416).

The host is a signed-in account acting in its own workspace. Opening a room is Premium: it's
checked with the same targeting decision the site's feature list uses (`flags.cloud_gate`).
Everything after that acts on a room the host already has, which carries the plan limits copied
in when it opened, so a host who downgrades mid-party keeps the room until it ends while new
rooms are refused. Another account's room id gets exactly the answer a made-up one gets.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from selecta import flags
from selecta.flags import cloud_gate
from selecta.flags.rules import RulesCache
from selecta.identity.tokens import Claims
from selecta.persistence import transaction
from selecta.rooms import limits
from selecta.rooms.api_common import item_json, join_path, refusal, too_many
from selecta.rooms.errors import RoomError
from selecta.rooms.service import Rooms
from selecta.rooms.settings import RoomSettings
from selecta.rooms.store import Guest, Room, RoomRequest
from selecta.rooms.views import HostView


class OpenBody(BaseModel):
    name: str = Field(max_length=200)
    settings: dict[str, Any] | None = None


class RotateBody(BaseModel):
    remove_everyone: bool = False


class PairBody(BaseModel):
    pairing_code: str = Field(max_length=32)


def settings_json(settings: RoomSettings) -> dict[str, Any]:
    raw = settings.to_json()
    if not flags.on("rooms.votes"):
        raw["votes"] = False
    return raw


def room_json(room: Room) -> dict[str, Any]:
    return {
        "id": room.id,
        "name": room.name,
        "status": room.status.value,
        "settings": settings_json(room.settings),
        "created_at": room.created_at,
        "ends_at": room.ends_at,
        "ended_at": room.ended_at,
        "end_reason": room.end_reason,
    }


def guest_json(guest: Guest) -> dict[str, Any]:
    return {"id": guest.id, "nickname": guest.nickname, "status": guest.status.value}


def request_json(request: RoomRequest) -> dict[str, Any]:
    return {
        "request_id": request.id,
        "song_id": request.song_id,
        "status": request.status.value,
        "votes": request.votes,
    }


def host_json(view: HostView) -> dict[str, Any]:
    return {
        "room": room_json(view.room),
        "code": view.code,
        "join_path": join_path(view.code),
        "guests": [
            {
                "id": guest.guest_id,
                "nickname": guest.nickname,
                "status": guest.status.value,
                "joined_at": guest.joined_at,
                "last_seen_at": guest.last_seen_at,
                "online": guest.online,
            }
            for guest in view.guests
        ],
        "inbox": [item_json(item) for item in view.inbox],
        "coming_up": [item_json(item) for item in view.coming_up],
        "unfit": [item_json(item) for item in view.unfit],
        "renders_left": view.renders_left,
        "music_paused": view.music_paused,
        "displays": view.displays,
        "screens": [
            {
                "id": screen.display_id,
                "label": screen.label,
                "paired_at": screen.paired_at,
                "last_seen_at": screen.last_seen_at,
                "online": screen.online,
            }
            for screen in view.screens
        ],
        "now": view.now,
    }


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    rules: RulesCache,
    rooms: Callable[[], Rooms],
    limiter: limits.Limiter | None = None,
) -> None:
    limiter = limiter or limits.Limiter()

    def workspace(request: Request, claims: Claims, gate: str | None = None) -> str:
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if gate is not None:
            with transaction(engine, found.workspace.id) as conn:
                cloud_gate.require(conn, found, gate, rules)
        return found.workspace.id

    def view(workspace_id: str, room_id: str) -> dict[str, Any]:
        try:
            return host_json(rooms().host_view(workspace_id, room_id))
        except RoomError as error:
            raise refusal(error) from error

    @app.post("/api/rooms", status_code=201)
    def open_room(
        body: OpenBody, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = workspace(request, claims, "rooms")
        try:
            opened = rooms().open_room(workspace_id, body.name, body.settings or {})
        except ValueError as error:
            raise HTTPException(
                status_code=422, detail={"code": "invalid_settings", "message": str(error)}
            ) from error
        except RoomError as error:
            raise refusal(error) from error
        return view(workspace_id, opened.room.id)

    @app.get("/api/rooms/current")
    def current_room(
        request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = workspace(request, claims)
        room = rooms().current_room(workspace_id)
        return {"room": None if room is None else view(workspace_id, room.id)}

    @app.get("/api/rooms/{room_id}")
    def room_panel(
        room_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        return view(workspace(request, claims), room_id)

    @app.patch("/api/rooms/{room_id}/settings")
    def room_settings(
        room_id: str,
        body: dict[str, Any],
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = workspace(request, claims)
        service = rooms()
        try:
            current = service.host_view(workspace_id, room_id).settings
            merged = RoomSettings.from_json({**current.to_json(), **body})
            service.update_settings(workspace_id, room_id, merged)
        except ValueError as error:
            raise HTTPException(
                status_code=422, detail={"code": "invalid_settings", "message": str(error)}
            ) from error
        except RoomError as error:
            raise refusal(error) from error
        return view(workspace_id, room_id)

    def act(request: Request, claims: Claims, room_id: str, action: Callable[[Rooms, str], Any]):
        workspace_id = workspace(request, claims)
        try:
            action(rooms(), workspace_id)
        except RoomError as error:
            raise refusal(error) from error
        return view(workspace_id, room_id)

    @app.post("/api/rooms/{room_id}/lock")
    def lock_room(room_id: str, request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        return act(request, claims, room_id, lambda r, ws: r.lock(ws, room_id))

    @app.post("/api/rooms/{room_id}/unlock")
    def unlock_room(room_id: str, request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        return act(request, claims, room_id, lambda r, ws: r.unlock(ws, room_id))

    @app.post("/api/rooms/{room_id}/code")
    def new_code(
        room_id: str,
        body: RotateBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        return act(
            request,
            claims,
            room_id,
            lambda r, ws: r.rotate_code(ws, room_id, remove_everyone=body.remove_everyone),
        )

    @app.post("/api/rooms/{room_id}/end")
    def end_room(room_id: str, request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        return act(request, claims, room_id, lambda r, ws: r.end_room(ws, room_id))

    @app.post("/api/rooms/{room_id}/requests/{request_id}/approve")
    def approve_request(
        room_id: str,
        request_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        return act(request, claims, room_id, lambda r, ws: r.approve(ws, room_id, request_id))

    @app.post("/api/rooms/{room_id}/requests/{request_id}/pass")
    def pass_request(
        room_id: str,
        request_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        return act(request, claims, room_id, lambda r, ws: r.pass_request(ws, room_id, request_id))

    @app.post("/api/rooms/{room_id}/guests/{guest_id}/approve")
    def approve_guest(
        room_id: str,
        guest_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        return act(request, claims, room_id, lambda r, ws: r.approve_guest(ws, room_id, guest_id))

    @app.post("/api/rooms/{room_id}/guests/{guest_id}/remove")
    def remove_guest(
        room_id: str,
        guest_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        return act(request, claims, room_id, lambda r, ws: r.remove_guest(ws, room_id, guest_id))

    @app.post("/api/rooms/{room_id}/guests/{guest_id}/ban")
    def ban_guest(
        room_id: str,
        guest_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        return act(request, claims, room_id, lambda r, ws: r.ban_guest(ws, room_id, guest_id))

    @app.post("/api/rooms/{room_id}/displays")
    def pair_display(
        room_id: str,
        body: PairBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        workspace_id = workspace(request, claims, "rooms.display")
        try:
            limiter.hit("display-confirm", workspace_id, limits.DISPLAY_CONFIRM_PER_WORKSPACE)
        except limits.Limited as error:
            raise too_many(error) from error
        try:
            rooms().confirm_pairing(workspace_id, room_id, body.pairing_code)
        except RoomError as error:
            raise refusal(error) from error
        return view(workspace_id, room_id)

    @app.delete("/api/rooms/{room_id}/displays")
    def unpair_displays(
        room_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        return act(request, claims, room_id, lambda r, ws: r.unpair_displays(ws, room_id))

    @app.delete("/api/rooms/{room_id}/displays/{display_id}")
    def unpair_display(
        room_id: str,
        display_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        return act(
            request,
            claims,
            room_id,
            lambda r, ws: r.unpair_displays(ws, room_id, display_id=display_id),
        )


__all__ = ["host_json", "install_routes", "room_json"]
