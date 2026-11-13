"""Cloud HTTP routes for room guests and big-screen displays, who have no account (ADR-0416).

A guest joins with the room code and gets an anonymous token in an HttpOnly cookie whose path is
that room's own routes (`/api/guest/rooms/{room_id}`), so the browser never sends it anywhere
else. Every guest route also checks the token belongs to the room in its path: a token for one
room is "not a guest" in every other room. The room id is not a secret and says nothing about
the host; it stays the same when the host makes a new code, so a guest who's in stays in.

A display gets a read-only token in a cookie scoped to `/api/display`. It can show its pairing
code until the host confirms it, then the room's display view, and nothing else.

Guests and displays see the room's name and songs, never the host. Codes and tokens are never
logged, put in an error or a URL. Joins and actions are rate-limited per IP, guest and room
(`rooms.limits`) in front of the room's own request limits, and an address that keeps missing
codes is locked out of joining (`rooms.guessing`).

Features the room offers guests follow the host's own flag decision, not just the build's: votes
are shown and accepted only while `rooms.votes` is on for the host's account (plan, staff rules
and opt-outs, as `flags.cloud_gate` decides it for the host's site).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from types import SimpleNamespace
from typing import Any

import sqlalchemy as sa
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from selecta import flags
from selecta.flags import cloud_gate
from selecta.flags.rules import RulesCache
from selecta.identity.accounts import get_user
from selecta.identity.schema import workspaces
from selecta.persistence import transaction
from selecta.rooms import guessing, limits
from selecta.rooms.api_common import (
    check_origin,
    client_ip,
    item_json,
    join_path,
    mine_json,
    refusal,
    song_json,
    too_many,
)
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.schema import room_guests
from selecta.rooms.service import Rooms
from selecta.rooms.store import GuestRef, resolve_guest
from selecta.rooms.views import GuestView

GUEST_COOKIE = "selecta_guest"
DISPLAY_COOKIE = "selecta_display"
GUEST_COOKIE_SECONDS = 13 * 3600  # a room lasts at most 12 hours
DISPLAY_COOKIE_SECONDS = 13 * 3600


class JoinBody(BaseModel):
    code: str = Field(max_length=32)


class RequestBody(BaseModel):
    song_id: int


class NicknameBody(BaseModel):
    nickname: str = Field(max_length=40)


def guest_json(
    view: GuestView, status: str, votes_allowed: bool | None = None,
    nickname_confirm: bool = False,
) -> dict[str, Any]:
    allowed = flags.on("rooms.votes") if votes_allowed is None else votes_allowed
    # ADR-0422 (rooms.nickname_confirm): the page shows saving / saved / not saved and drops
    # reads that overlapped a nickname save. Only said when the flag is on, so the page is
    # exactly as before with it off.
    extra = {"nickname_confirm": True} if nickname_confirm else {}
    return {
        **extra,
        "room_name": view.room_name,
        "room_status": view.room_status.value,
        "guest_status": status,
        "nickname": view.nickname,
        "names_shown": view.names_shown,
        "votes_on": view.votes_on and allowed,
        "requests_open": view.requests_open,
        "music_paused": view.music_paused,
        "local_first": view.local_first,
        "now_playing": song_json(view.now_playing),
        "up_next": [song_json(song) for song in view.up_next],
        "coming_up": [item_json(item) for item in view.coming_up],
        "waiting": [item_json(item) for item in view.waiting],
        "my_requests": [mine_json(item) for item in view.my_requests],
    }


def install_routes(
    app: FastAPI,
    *,
    rooms: Callable[[], Rooms],
    allowed_origins: Iterable[str],
    limiter: limits.Limiter,
    rules: RulesCache | None = None,
) -> None:
    origins = tuple(allowed_origins)
    guard = guessing.JoinGuard(limiter, lambda: rooms().engine)
    app.state.rooms_join_guard = guard

    def hit(name: str, key: str, window: limits.Window) -> None:
        try:
            limiter.hit(name, key, window)
        except limits.Limited as error:
            raise too_many(error) from error

    def ip_hash(request: Request) -> str:
        return rooms().hash_ip(client_ip(request))

    def stranger(address: str) -> None:
        """A request with no valid guest token for its room. Enough of them from one address
        and it is turned away before the database for a while, so a flood of made-up tokens
        costs one lookup each only up to the limit."""
        if limiter.count("stranger", address, limits.STRANGERS_PER_IP) >= (
            limits.STRANGERS_PER_IP.limit
        ):
            limiter.lock("stranger", address, limits.STRANGERS_PER_IP.seconds)

    def guest(request: Request, room_id: str) -> tuple[str, GuestRef]:
        """The guest token for this room, checked to belong to it."""
        token = request.cookies.get(GUEST_COOKIE, "")
        address = ip_hash(request)
        try:
            limiter.check_lock("stranger", address)
        except limits.Limited as error:
            raise too_many(error) from error
        try:
            ref = resolve_guest(rooms(), token)
        except RoomError as error:
            if error.refusal is Refusal.NOT_A_GUEST:
                stranger(address)
            raise refusal(error) from error
        if ref.room_id != room_id:
            stranger(address)
            raise refusal(RoomError(Refusal.NOT_A_GUEST))
        return token, ref

    def write(request: Request, room_id: str) -> tuple[str, GuestRef]:
        check_origin(request, origins)
        token, ref = guest(request, room_id)
        hit("guest-write", ref.guest_id, limits.GUEST_WRITE_PER_GUEST)
        hit("guest-write-ip", ip_hash(request), limits.GUEST_WRITE_PER_IP)
        hit("guest-write-room", ref.room_id, limits.GUEST_WRITE_PER_ROOM)
        return token, ref

    def guest_status(ref: GuestRef) -> str:
        with transaction(rooms().engine, ref.workspace_id) as conn:
            return conn.execute(
                sa.select(room_guests.c.status).where(room_guests.c.id == ref.guest_id)
            ).scalar_one()

    def host_allows(ref: GuestRef, flag_id: str) -> bool:
        """Whether the host's account has `flag_id` on now, as the host's own site decides it."""
        if rules is None:
            return flags.on(flag_id)
        with transaction(rooms().engine, ref.workspace_id) as conn:
            owner = conn.execute(
                sa.select(workspaces.c.owner_user_id).where(workspaces.c.id == ref.workspace_id)
            ).scalar()
            user = get_user(conn, owner) if owner else None
            if user is None:
                return False
            host = SimpleNamespace(workspace=SimpleNamespace(id=ref.workspace_id), user=user,
                                   staff_roles=frozenset())
            return cloud_gate.decide(conn, host, flag_id, rules).on

    def voting(ref: GuestRef) -> None:
        if not host_allows(ref, "rooms.votes"):
            raise HTTPException(status_code=403, detail={
                "code": "flag_off", "flag": "rooms.votes",
                "message": "Voting isn't available in this room.",
            })

    def view(token: str, ref: GuestRef) -> dict[str, Any]:
        try:
            return guest_json(rooms().guest_view(token), guest_status(ref),
                              host_allows(ref, "rooms.votes"),
                              host_allows(ref, "rooms.nickname_confirm"))
        except RoomError as error:
            raise refusal(error) from error

    def cookie_path(room_id: str) -> str:
        return f"/api/guest/rooms/{room_id}"

    @app.post("/api/guest/join", status_code=201)
    def join_room(body: JoinBody, request: Request, response: Response) -> dict[str, Any]:
        check_origin(request, origins)
        address = ip_hash(request)
        try:
            guard.admit(address)
        except limits.Limited as error:
            raise too_many(error) from error
        try:
            joined = rooms().join(body.code, address)
        except RoomError as error:
            if error.refusal in guessing.MISSES:
                guard.missed(address)
            raise refusal(error) from error
        response.set_cookie(
            GUEST_COOKIE,
            joined.guest_token,
            max_age=GUEST_COOKIE_SECONDS,
            path=cookie_path(joined.room_id),
            secure=True,
            httponly=True,
            samesite="strict",
        )
        return {
            "room_id": joined.room_id,
            "nickname": joined.nickname,
            "guest_status": joined.status.value,
        }

    @app.get("/api/guest/rooms/{room_id}")
    def guest_room(room_id: str, request: Request) -> dict[str, Any]:
        token, ref = guest(request, room_id)
        hit("guest-read", ref.guest_id, limits.GUEST_READ_PER_GUEST)
        return view(token, ref)

    @app.get("/api/guest/rooms/{room_id}/search")
    def guest_search(room_id: str, request: Request, q: str = "") -> dict[str, Any]:
        token, ref = guest(request, room_id)
        hit("guest-search", ref.guest_id, limits.GUEST_SEARCH_PER_GUEST)
        try:
            songs = rooms().search(token, q[:100], 20)
        except RoomError as error:
            raise refusal(error) from error
        return {"songs": [song_json(song) for song in songs]}

    @app.post("/api/guest/rooms/{room_id}/requests", status_code=201)
    def guest_request(room_id: str, body: RequestBody, request: Request) -> dict[str, Any]:
        token, ref = write(request, room_id)
        try:
            outcome = rooms().request(token, body.song_id)
        except RoomError as error:
            raise refusal(error) from error
        return {
            "request_id": outcome.request.id,
            "status": outcome.request.status.value,
            "became_vote": outcome.became_vote,
            "already_queued": outcome.already_queued,
            "room": view(token, ref),
        }

    @app.delete("/api/guest/rooms/{room_id}/requests/{request_id}")
    def guest_withdraw(room_id: str, request_id: str, request: Request) -> dict[str, Any]:
        token, ref = write(request, room_id)
        try:
            rooms().withdraw(token, request_id)
        except RoomError as error:
            raise refusal(error) from error
        return view(token, ref)

    @app.post("/api/guest/rooms/{room_id}/requests/{request_id}/vote")
    def guest_vote(room_id: str, request_id: str, request: Request) -> dict[str, Any]:
        token, ref = write(request, room_id)
        voting(ref)
        try:
            rooms().vote(token, request_id)
        except RoomError as error:
            raise refusal(error) from error
        return view(token, ref)

    @app.delete("/api/guest/rooms/{room_id}/requests/{request_id}/vote")
    def guest_unvote(room_id: str, request_id: str, request: Request) -> dict[str, Any]:
        token, ref = write(request, room_id)
        voting(ref)
        try:
            rooms().unvote(token, request_id)
        except RoomError as error:
            raise refusal(error) from error
        return view(token, ref)

    @app.get("/api/guest/rooms/{room_id}/nicknames")
    def guest_nicknames(room_id: str, request: Request) -> dict[str, Any]:
        token, ref = guest(request, room_id)
        hit("guest-read", ref.guest_id, limits.GUEST_READ_PER_GUEST)
        try:
            return {"nicknames": rooms().nickname_choices(token)}
        except RoomError as error:
            raise refusal(error) from error

    @app.put("/api/guest/rooms/{room_id}/nickname")
    def guest_nickname(room_id: str, body: NicknameBody, request: Request) -> dict[str, Any]:
        token, ref = write(request, room_id)
        try:
            rooms().set_nickname(token, body.nickname)
        except RoomError as error:
            raise refusal(error) from error
        return view(token, ref)

    @app.post("/api/guest/rooms/{room_id}/leave")
    def guest_leave(room_id: str, request: Request, response: Response) -> dict[str, Any]:
        token, _ref = write(request, room_id)
        try:
            rooms().leave(token)
        except RoomError as error:
            raise refusal(error) from error
        response.delete_cookie(
            GUEST_COOKIE, path=cookie_path(room_id), secure=True, httponly=True, samesite="strict"
        )
        return {"left": True}

    @app.post("/api/display/pairings", status_code=201)
    def display_pairing(request: Request, response: Response) -> dict[str, Any]:
        check_origin(request, origins)
        hit("display-pair", ip_hash(request), limits.DISPLAY_PAIRING_PER_IP)
        started = rooms().start_pairing()
        response.set_cookie(
            DISPLAY_COOKIE,
            started.display_token,
            max_age=DISPLAY_COOKIE_SECONDS,
            path="/api/display",
            secure=True,
            httponly=True,
            samesite="strict",
        )
        return {"pairing_code": started.pairing_code, "expires_at": started.expires_at}

    @app.delete("/api/display/pairing")
    def display_disconnect(request: Request, response: Response) -> dict[str, Any]:
        """"Disconnect this screen": the screen deletes its own pairing with its own token."""
        check_origin(request, origins)
        hit("display-pair", ip_hash(request), limits.DISPLAY_PAIRING_PER_IP)
        token = request.cookies.get(DISPLAY_COOKIE, "")
        try:
            rooms().disconnect_display(token)
        except RoomError as error:
            raise refusal(error) from error
        response.delete_cookie(
            DISPLAY_COOKIE, path="/api/display", secure=True, httponly=True, samesite="strict"
        )
        return {"disconnected": True}

    @app.get("/api/display/view")
    def display_view(request: Request) -> dict[str, Any]:
        hit("display-read", ip_hash(request), limits.DISPLAY_READ_PER_IP)
        token = request.cookies.get(DISPLAY_COOKIE, "")
        try:
            shown = rooms().display_view(token)
        except RoomError as error:
            raise refusal(error) from error
        return {
            "state": shown.state.value,
            "room_name": shown.room_name,
            "code": shown.code,
            "join_path": join_path(shown.code),
            "now_playing": song_json(shown.now_playing),
            "up_next": [song_json(song) for song in shown.up_next],
            "upcoming": [item_json(item) for item in shown.upcoming],
            "music_paused": shown.music_paused,
        }


def unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={"code": "rooms_unavailable", "message": "Rooms aren't available right now."},
    )


__all__ = ["DISPLAY_COOKIE", "GUEST_COOKIE", "guest_json", "install_routes", "unavailable"]
