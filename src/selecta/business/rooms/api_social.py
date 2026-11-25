"""Routes for what a standing room does together (ADR-0488, venue rooms).

Guest routes sit beside the ADR-0451 ones under `/api/venue-rooms/{code}` and use the same
cookie. Staff routes sit under `/api/zones/{zone_id}/room` and check one permission each, as
the rest of Rooms for Business does: `business.requests.moderate` to start or call off a vote
and to clear a dedication, `business.requests.settings` for the room's choices and its
screens, `business.venue.read` to read them.

Each feature has its own flag under `business.rooms`; with one off its routes answer 404
`flag_off` and the guest page is never offered it.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from selecta.rooms import limits
from selecta.rooms.api_common import check_origin
from selecta.roomsocial import dedications as lines
from selecta.roomsocial import rounds as round_rules


class TapBody(BaseModel):
    kind: Literal["love", "blend"]
    play_id: str = Field(min_length=1, max_length=36)


class VoteBody(BaseModel):
    position: int = Field(ge=0, le=round_rules.MAX_OPTIONS - 1)


class LineBody(BaseModel):
    line: str = Field(min_length=1, max_length=lines.MAX_ID_LENGTH)


class PairBody(BaseModel):
    pairing_code: str = Field(max_length=32)


def install_guest_routes(
    app: FastAPI,
    *,
    service: Callable[[], Any],
    flag_on: Callable[[str], bool],
    token: Callable[[Request], str],
    hit: Callable[[str, str, limits.Window], None],
    run: Callable[[Callable[[], Any]], Any],
    allowed_origins: tuple[str, ...] = (),
) -> None:
    def gate(name: str | None = None) -> None:
        for flag in ("business.rooms", *([f"business.rooms.{name}"] if name else [])):
            if not flag_on(flag):
                raise HTTPException(status_code=404, detail={
                    "code": "flag_off", "flag": flag, "message": "That isn't available here."})

    def tap(request: Request, name: str) -> str:
        gate(name)
        if allowed_origins:
            check_origin(request, allowed_origins)
        mine = token(request)
        hit("bz-tap", mine, limits.TAP_PER_GUEST)
        return mine

    @app.get("/api/venue-rooms/{code}/pulse")
    def pulse(code: str, request: Request) -> dict[str, Any]:
        gate()
        mine = token(request)
        hit("bz-guest-pulse", mine, limits.GUEST_PULSE_PER_GUEST)
        return run(lambda: service().guest_pulse(mine, code))

    @app.post("/api/venue-rooms/{code}/reactions")
    def react(code: str, body: TapBody, request: Request) -> dict[str, Any]:
        mine = tap(request, "reactions")
        return run(lambda: service().react(mine, body.kind, body.play_id, True, room_key=code))

    @app.delete("/api/venue-rooms/{code}/reactions")
    def unreact(code: str, body: TapBody, request: Request) -> dict[str, Any]:
        mine = tap(request, "reactions")
        return run(lambda: service().react(mine, body.kind, body.play_id, False, room_key=code))

    @app.post("/api/venue-rooms/{code}/rounds/{round_id}/vote")
    def vote(code: str, round_id: str, body: VoteBody, request: Request) -> dict[str, Any]:
        mine = tap(request, "rounds")
        return run(lambda: service().cast_round_vote(mine, round_id, body.position,
                                                     room_key=code))

    @app.put("/api/venue-rooms/{code}/requests/{request_id}/dedication")
    def dedicate(code: str, request_id: str, body: LineBody, request: Request) -> dict[str, Any]:
        mine = tap(request, "dedications")
        return run(lambda: service().set_dedication(mine, request_id, body.line, room_key=code))

    @app.delete("/api/venue-rooms/{code}/requests/{request_id}/dedication")
    def undedicate(code: str, request_id: str, request: Request) -> dict[str, Any]:
        mine = tap(request, "dedications")
        return run(lambda: service().set_dedication(mine, request_id, None, room_key=code))

    @app.get("/api/venue-rooms/{code}/recap")
    def recap(code: str, request: Request) -> dict[str, Any]:
        gate("recap")
        mine = token(request)
        hit("bz-guest-read", mine, limits.GUEST_READ_PER_GUEST)
        return run(lambda: service().guest_recap(mine, code))


def install_staff_routes(app: FastAPI, *, staff: Callable[..., Any]) -> None:
    moderate = ("business.requests.moderate",)
    configure = ("business.requests.settings",)

    @app.get("/api/zones/{zone_id}/room/social")
    def social(zone_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, ("business.venue.read",),
                     lambda s, c, a: s.social_view(c, a, zone_id))

    @app.patch("/api/zones/{zone_id}/room/social")
    def change_social(zone_id: str, body: dict[str, Any], request: Request) -> dict[str, Any]:
        return staff(request, zone_id, configure,
                     lambda s, c, a: s.update_social(c, a, zone_id, body))

    @app.post("/api/zones/{zone_id}/room/rounds", status_code=201)
    def start_round(zone_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, moderate, lambda s, c, a: s.start_round(c, a, zone_id),
                     flag="business.rooms.rounds")

    @app.post("/api/zones/{zone_id}/room/rounds/{round_id}/cancel")
    def cancel_round(zone_id: str, round_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, moderate,
                     lambda s, c, a: s.cancel_round(c, a, zone_id, round_id),
                     flag="business.rooms.rounds")

    @app.delete("/api/zones/{zone_id}/requests/{request_id}/dedication")
    def clear_dedication(zone_id: str, request_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, moderate,
                     lambda s, c, a: s.clear_dedication(c, a, zone_id, request_id),
                     flag="business.rooms.dedications")

    @app.get("/api/zones/{zone_id}/room/recap")
    def recap(zone_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, ("business.venue.read",),
                     lambda s, c, a: s.recap_view(c, a, zone_id), flag="business.rooms.recap")

    @app.post("/api/zones/{zone_id}/room/displays", status_code=201)
    def pair(zone_id: str, body: PairBody, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, configure,
                     lambda s, c, a: s.pair_screen(c, a, zone_id, body.pairing_code),
                     flag="business.rooms.display")

    @app.delete("/api/zones/{zone_id}/room/displays/{display_id}")
    def unpair(zone_id: str, display_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, configure,
                     lambda s, c, a: s.unpair_screen(c, a, zone_id, display_id),
                     flag="business.rooms.display")


__all__ = ["install_guest_routes", "install_staff_routes"]
