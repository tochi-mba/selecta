"""Cloud routes for Rooms for Business: staff and manager routes here, guest routes in
`api_guest` (ADR-0451). `install_routes` installs both.

Staff routes resolve the caller to a `BusinessActor` (a signed-in member through
`guard.actor_for`, or a kiosk or shared tablet through `guard.device_actor` from the
`X-Device-Token` header) and check one permission with `guard.require` at the zone:
`business.requests.moderate` for the queue, approvals and abuse tools,
`business.requests.settings` for modes, limits, codes, branding and print, and
`business.venue.read` to view a room's settings. The screen code is for the zone's display
(`business.kiosk.play`) or staff. Every route answers 404 `flag_off` while its flag is off.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from selecta.business.access import BusinessActor, BusinessError
from selecta.business.access.directory import Directory
from selecta.business.rooms import api_guest
from selecta.business.rooms.service import ZoneRooms, default_flag_on
from selecta.persistence import transaction
from selecta.rooms.api_common import client_ip

DEVICE_HEADER = "x-device-token"


class BanBody(BaseModel):
    length: str = Field(default="day", max_length=8)  # day | week


def http_error(error: BusinessError) -> HTTPException:
    detail: dict[str, Any] = {"code": error.code, "message": getattr(error, "message", None)
                              or str(error)}
    headers = None
    retry = getattr(error, "retry_after_s", None)
    if retry is not None:
        detail["retry_after_s"] = max(1, round(retry))
        headers = {"Retry-After": str(detail["retry_after_s"])}
    return HTTPException(status_code=error.status, detail=detail, headers=headers)


def flag_off(flag_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"code": "flag_off", "flag": flag_id,
                                                  "message": "That isn't available here."})


def default_authorize(conn, actor, permission, *, venue_id=None, zone_id=None, directory):
    from selecta.business.access import guard

    guard.require(conn, actor, permission, venue_id=venue_id, zone_id=zone_id,
                  directory=directory)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Any],
    principal_for: Callable[..., Any] | None = None,
    directory: Directory,
    zone_rooms: Callable[[], ZoneRooms] | None = None,
    pepper: bytes | None = None,
    songs=None,
    authorize: Callable[..., None] = default_authorize,
    actor_resolver: Callable[..., BusinessActor] | None = None,
    allowed_origins: tuple[str, ...] = (),
    flag_on: Callable[[str], bool] = default_flag_on,
) -> None:
    built: list[ZoneRooms] = []

    def service() -> ZoneRooms:
        if zone_rooms is not None:
            return zone_rooms()
        if not built:
            from selecta.rooms.wiring import pepper_from_environment

            try:
                built.append(ZoneRooms(engine, pepper or pepper_from_environment(),
                                       directory=directory, songs=songs, flag_on=flag_on))
            except ValueError as error:
                raise HTTPException(status_code=503, detail={
                    "code": "rooms_unavailable",
                    "message": "Rooms aren't available right now."}) from error
        return built[0]

    def resolve_actor(request: Request, conn, organisation_id: str, workspace_id: str):
        if actor_resolver is not None:
            return actor_resolver(request, conn, organisation_id=organisation_id,
                                  workspace_id=workspace_id)
        from selecta.business.access import guard

        token = request.headers.get(DEVICE_HEADER)
        if token:
            return guard.device_actor(conn, token=token)
        claims = current_claims(request)
        return guard.actor_for(conn, user_id=claims.subject, organisation_id=organisation_id,
                               workspace_id=workspace_id)

    def staff(request: Request, zone_id: str | None, permissions: tuple[str, ...],
              work: Callable[[ZoneRooms, Any, BusinessActor], Any], *,
              flag: str = "business.rooms", venue_id: str | None = None) -> Any:
        for needed in {"business.rooms", flag}:
            if not flag_on(needed):
                raise flag_off(needed)
        rooms = service()
        try:
            with transaction(engine) as conn:
                where = (directory.zone(conn, zone_id) if zone_id
                         else directory.venue(conn, venue_id))
                if where is None:
                    raise HTTPException(status_code=404, detail={
                        "code": "not_found", "message": "There's no such zone or venue."})
                actor = resolve_actor(request, conn, where.organisation_id, where.workspace_id)
                last: BusinessError | None = None
                for permission in permissions:
                    try:
                        authorize(conn, actor, permission, venue_id=venue_id, zone_id=zone_id,
                                  directory=directory)
                        last = None
                        break
                    except BusinessError as error:
                        last = error
                if last is not None:
                    raise last
                return work(rooms, conn, actor)
        except BusinessError as error:
            raise http_error(error) from error

    moderate = ("business.requests.moderate",)
    configure = ("business.requests.settings",)

    @app.get("/api/zones/{zone_id}/requests")
    def zone_requests(zone_id: str, request: Request) -> list[dict[str, Any]]:
        return staff(request, zone_id, moderate, lambda s, c, a: s.queue(c, a, zone_id))

    @app.post("/api/zones/{zone_id}/requests/{request_id}/approve")
    def approve(zone_id: str, request_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, moderate,
                     lambda s, c, a: s.decide(c, a, zone_id, request_id, "approve"))

    @app.post("/api/zones/{zone_id}/requests/{request_id}/pass")
    def pass_request(zone_id: str, request_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, moderate,
                     lambda s, c, a: s.decide(c, a, zone_id, request_id, "pass"))

    @app.get("/api/zones/{zone_id}/room")
    def room_settings(zone_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, ("business.venue.read",),
                     lambda s, c, a: s.settings_view(c, a, zone_id))

    @app.patch("/api/zones/{zone_id}/room")
    def change_settings(zone_id: str, body: dict[str, Any], request: Request) -> dict[str, Any]:
        return staff(request, zone_id, configure,
                     lambda s, c, a: s.update_settings(c, a, zone_id, body))

    @app.post("/api/zones/{zone_id}/room/rotate")
    def rotate(zone_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, configure, lambda s, c, a: s.rotate(c, a, zone_id))

    @app.get("/api/venues/{venue_id}/room-print")
    def print_sheet(venue_id: str, request: Request) -> dict[str, Any]:
        return staff(request, None, configure, lambda s, c, a: s.print_data(c, a, venue_id),
                     flag="business.rooms.print", venue_id=venue_id)

    @app.get("/api/zones/{zone_id}/room/screen-code")
    def screen(zone_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, ("business.kiosk.play", "business.requests.moderate"),
                     lambda s, c, a: s.screen_code(c, a, zone_id),
                     flag="business.rooms.screen_code")

    @app.post("/api/zones/{zone_id}/room/guests/{guest_id}/remove")
    def remove(zone_id: str, guest_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, moderate,
                     lambda s, c, a: s.remove_guest(c, a, zone_id, guest_id))

    @app.post("/api/zones/{zone_id}/room/guests/{guest_id}/ban")
    def ban(zone_id: str, guest_id: str, body: BanBody, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, moderate,
                     lambda s, c, a: s.ban_guest(c, a, zone_id, guest_id, body.length))

    @app.post("/api/zones/{zone_id}/room/pause")
    def pause(zone_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, moderate, lambda s, c, a: s.set_paused(c, a, zone_id, True))

    @app.post("/api/zones/{zone_id}/room/resume")
    def resume(zone_id: str, request: Request) -> dict[str, Any]:
        return staff(request, zone_id, moderate,
                     lambda s, c, a: s.set_paused(c, a, zone_id, False))

    @app.post("/api/zones/{zone_id}/venue-network", status_code=204)
    def venue_network(zone_id: str, request: Request) -> None:
        address = client_ip(request)
        staff(request, zone_id, ("business.kiosk.play",),
              lambda s, c, a: s.record_kiosk_address(c, zone_id, address))

    api_guest.install_guest_routes(app, service=service, flag_on=flag_on,
                                   allowed_origins=allowed_origins)


__all__ = ["DEVICE_HEADER", "http_error", "install_routes"]
