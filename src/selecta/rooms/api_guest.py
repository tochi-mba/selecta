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
from typing import Any

import sqlalchemy as sa
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from selecta import flags
from selecta.flags.rules import RulesCache
from selecta.persistence import transaction
from selecta.rooms import api_social, guessing, limits
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
from selecta.rooms.host_features import HostFeatures
from selecta.rooms.requesting import BATCH_MAX
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


class BatchBody(BaseModel):
    song_ids: list[int] = Field(min_length=1, max_length=BATCH_MAX)


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
        # ADR-0488: a paired big screen is showing now; the page never needs one
        "screen": view.screen,
        # how many more songs this guest can ask for now; at 0, `limit_text` says which limit
        # and when it frees up
        "requests_left": view.requests_left,
        "per_guest": view.per_guest,
        "limit_text": view.limit_text,
        "limit_retry_s": None if view.limit_retry_s is None else round(view.limit_retry_s),
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
    # ADR-0488: what the host's account has on, decided together and remembered for 5 s, and
    # the room's once-a-second pulse
    features = HostFeatures(lambda: rooms().engine, rules)
    social = api_social.Social(rooms, features)
    app.state.rooms_social = social

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
        """Whether the host's account has `flag_id` on now, as the host's own site decides it
        (`host_features`: every guest-facing flag decided together, remembered for 5 s)."""
        return features.on(ref.workspace_id, flag_id)

    def voting(ref: GuestRef) -> None:
        if not host_allows(ref, "rooms.votes"):
            raise HTTPException(status_code=403, detail={
                "code": "flag_off", "flag": "rooms.votes",
                "message": "Voting isn't available in this room.",
            })

    def view(token: str, ref: GuestRef) -> dict[str, Any]:
        try:
            seen = rooms().guest_view(token)
            answer = guest_json(seen, guest_status(ref),
                                host_allows(ref, "rooms.votes"),
                                host_allows(ref, "rooms.nickname_confirm"))
        except RoomError as error:
            raise refusal(error) from error
        # ADR-0488: which of the five the room offers, and this guest's own taps and vote. A
        # screen only counts while the host's account may pair one.
        answer["screen"] = seen.screen and host_allows(ref, "rooms.display")
        answer.update(social.mine(ref))
        # ADR-0475: a browser-first room offers only the speaker's songs, so the guest page says
        # when there is no speaker yet, or it is reconnecting
        music = getattr(rooms().catalog, "music_state", None)
        if callable(music):
            answer["music"] = music(ref.workspace_id)
        return answer

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

    @app.post("/api/guest/rooms/{room_id}/requests/batch", status_code=201)
    def guest_request_many(room_id: str, body: BatchBody, request: Request) -> dict[str, Any]:
        """Several songs sent together. The limits are held for the whole batch; each song has
        its own answer, so the page can say which were added and why any were not."""
        token, ref = write(request, room_id)
        try:
            items = rooms().request_many(token, body.song_ids)
        except RoomError as error:
            raise refusal(error) from error
        results: list[dict[str, Any]] = []
        for item in items:
            if item.outcome is not None:
                results.append({
                    "song_id": item.song_id,
                    "added": True,
                    "request_id": item.outcome.request.id,
                    "status": item.outcome.request.status.value,
                    "became_vote": item.outcome.became_vote,
                    "already_queued": item.outcome.already_queued,
                })
            elif item.error is not None:
                wait = item.error.retry_after_s
                results.append({
                    "song_id": item.song_id,
                    "added": False,
                    "code": item.error.code,
                    "message": item.error.message,
                    "retry_after_s": None if wait is None else round(wait),
                })
        return {"results": results, "room": view(token, ref)}

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
            venue = getattr(app.state, "zone_rooms", None)  # ADR-0488: a venue zone's screen
            if venue is None or not venue().unpair_self(token):
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
            # ADR-0488: a screen staff paired to a venue zone reads that zone's room
            venue = getattr(app.state, "zone_rooms", None)
            seen = venue().screen_view(token) if venue is not None else None
            if seen is not None:
                return seen
            raise refusal(error) from error
        answer = {
            "state": shown.state.value,
            "room_name": shown.room_name,
            "code": shown.code,
            "join_path": join_path(shown.code),
            "now_playing": song_json(shown.now_playing),
            "up_next": [song_json(song) for song in shown.up_next],
            "upcoming": [item_json(item) for item in shown.upcoming],
            "music_paused": shown.music_paused,
            "music": shown.music,
        }
        # ADR-0488: the same pulse the phones read, and the recap once the room has ended
        answer.update(social.for_screen(shown))
        return answer

    api_social.install_guest_routes(
        app, social=social, guest=guest, hit=hit, ip_hash=ip_hash, origins=origins
    )


def unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={"code": "rooms_unavailable", "message": "Rooms aren't available right now."},
    )


__all__ = ["DISPLAY_COOKIE", "GUEST_COOKIE", "guest_json", "install_routes", "unavailable"]
