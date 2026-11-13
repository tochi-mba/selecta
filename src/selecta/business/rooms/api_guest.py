"""Guest routes for standing rooms, reached from a table card's `/r/{code}` page (ADR-0451).

`{code}` in the path is the code from the card. After joining, the same routes also accept the
room id (returned by join) or an older code of the guest's own room, so a guest who is already
in keeps working when a manager rotates the code. The guest's token travels in an HttpOnly,
SameSite=Strict cookie scoped to `/api/venue-rooms`; a wrong code may hand out a visitor cookie,
which is what code-guessing lockouts hold on a venue's Wi-Fi (see `network`).

With `business.rooms` off every route answers 404 `flag_off` with "Requests aren't available
here", which is what the card's page then shows.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from selecta.business.access import BusinessError
from selecta.business.rooms import settings
from selecta.rooms import codes, limits
from selecta.rooms.api_common import check_origin, client_ip, too_many

GUEST_COOKIE = "selecta_venue_guest"
VISITOR_COOKIE = "selecta_venue_visitor"
COOKIE_PATH = "/api/venue-rooms"
GUEST_COOKIE_S = 30 * 86400
VISITOR_COOKIE_S = 86400


class RequestBody(BaseModel):
    song_id: str = Field(max_length=64)
    screen_code: str | None = Field(default=None, max_length=16)


def _cookie(response: Response, name: str, value: str, seconds: int) -> None:
    response.set_cookie(name, value, max_age=seconds, path=COOKIE_PATH, secure=True,
                        httponly=True, samesite="strict")


def install_guest_routes(app: FastAPI, *, service: Callable[[], Any],
                         flag_on: Callable[[str], bool],
                         allowed_origins: tuple[str, ...] = ()) -> None:
    from selecta.business.rooms.api import http_error

    limiter = limits.Limiter()

    def gate() -> None:
        if not flag_on("business.rooms"):
            raise HTTPException(status_code=404, detail={
                "code": "flag_off", "flag": "business.rooms",
                "message": settings.TEXT_UNAVAILABLE})

    def token(request: Request) -> str:
        found = request.cookies.get(GUEST_COOKIE, "")
        if not found:
            raise HTTPException(status_code=401, detail={
                "code": "not_a_guest", "message": "Scan the code again to join this room."})
        return found

    def hit(name: str, key: str, window: limits.Window) -> None:
        try:
            limiter.hit(name, codes.token_hash(key), window)
        except limits.Limited as error:
            raise too_many(error) from error

    def run(work: Callable[[], Any]) -> Any:
        try:
            return work()
        except BusinessError as error:
            raise http_error(error) from error

    @app.post("/api/venue-rooms/{code}/join", status_code=201)
    def join(code: str, request: Request, response: Response) -> dict[str, Any]:
        gate()
        if allowed_origins:
            check_origin(request, allowed_origins)
        rooms = service()
        try:
            joined = rooms.join(code, client_ip(request),
                                visitor=request.cookies.get(VISITOR_COOKIE),
                                existing_token=request.cookies.get(GUEST_COOKIE))
        except BusinessError as error:
            failure = http_error(error)
            if getattr(error, "visitor", None):
                # An HTTPException can't carry Set-Cookie through `response`; put it on headers.
                visitor = Response()
                _cookie(visitor, VISITOR_COOKIE, error.visitor, VISITOR_COOKIE_S)
                failure.headers = {**(failure.headers or {}),
                                   "set-cookie": visitor.headers["set-cookie"]}
            raise failure from error
        _cookie(response, GUEST_COOKIE, joined.token, GUEST_COOKIE_S)
        return {"room_id": joined.room_id, "nickname": joined.nickname}

    @app.get("/api/venue-rooms/{code}/state")
    def state(code: str, request: Request) -> dict[str, Any]:
        gate()
        mine = token(request)
        hit("bz-guest-read", mine, limits.GUEST_READ_PER_GUEST)
        return run(lambda: service().guest_state(mine, code))

    @app.get("/api/venue-rooms/{code}/search")
    def search(code: str, request: Request, q: str = "") -> dict[str, Any]:
        gate()
        mine = token(request)
        hit("bz-guest-search", mine, limits.GUEST_SEARCH_PER_GUEST)
        return {"songs": run(lambda: service().search(mine, q, room_key=code))}

    @app.post("/api/venue-rooms/{code}/requests", status_code=201)
    def place(code: str, body: RequestBody, request: Request) -> dict[str, Any]:
        gate()
        if allowed_origins:
            check_origin(request, allowed_origins)
        mine = token(request)
        hit("bz-guest-write", mine, limits.GUEST_WRITE_PER_GUEST)
        return run(lambda: service().place(mine, body.song_id, room_key=code,
                                           typed_screen_code=body.screen_code))

    @app.post("/api/venue-rooms/{code}/requests/{request_id}/vote")
    def vote(code: str, request_id: str, request: Request) -> dict[str, Any]:
        gate()
        if allowed_origins:
            check_origin(request, allowed_origins)
        mine = token(request)
        hit("bz-guest-write", mine, limits.GUEST_WRITE_PER_GUEST)
        return run(lambda: service().vote(mine, request_id, room_key=code))


__all__ = ["COOKIE_PATH", "GUEST_COOKIE", "VISITOR_COOKIE", "install_guest_routes"]
