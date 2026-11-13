"""The organisation, venue, zone and crate routes of SelectaDJ for Business (ADR-0442).

Every `/api/business/...` route acts in the request's workspace (`X-Workspace-ID`). The workspace
must be a `business` one and the caller a member of it; anything else answers 404 exactly like a
missing organisation, so a personal account learns nothing about organisations. Flags:

- `business.orgs` owns these routes. Off in the build, the flag guard refuses them (403
  `flag_off`, the repository's stable flag contract; see `flags/guard.py`). Off for one account by
  a targeting rule, the account-flag middleware in `api_cloud.py` refuses them the same way.
- `POST /api/business/orgs` (self-serve sign-up) also needs `business.signups`; while selling is
  off, organisations come only from the staff pilot route (`business.admin_routes`).
- `GET /api/workspaces` is owned by `business.workspaces` and lists a business workspace only
  when `business.orgs` is on for that organisation.

Errors map once, in `_answer`: NotFound 404, InvalidTimezone 422, NameTaken and other Conflicts
409 (CrateInUse adds `uses`), a bad value 422.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any, Literal

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta.business import crates, hours_hook, orgs, venues, zones
from selecta.business.errors import (
    BusinessError,
    Conflict,
    CrateInUse,
    InvalidTimezone,
    NotFound,
)
from selecta.flags import cloud_gate
from selecta.flags.rules import RulesCache
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction
from selecta.storage.schema import assets

NOT_FOUND = {"code": "not_found"}
BUSINESS = "business"


class OrgBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    legal_name: str | None = Field(default=None, max_length=300)


class VenueBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    timezone: str = Field(min_length=1, max_length=64)
    country: str = Field(min_length=2, max_length=2)
    address: dict[str, Any] | None = None


class VenuePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    status: Literal["active", "paused"] | None = None


class ZoneBody(BaseModel):
    venue_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)


class ZonePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    status: Literal["active", "paused"] | None = None


class ArchiveBody(BaseModel):
    when: Literal["now", "closing"] = "now"
    closing_at: int | None = Field(default=None, ge=0)


class CrateBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    venue_id: str | None = Field(default=None, max_length=64)


class CrateSongs(BaseModel):
    song_ids: list[str] = Field(max_length=10_000)


def _answer(error: Exception) -> HTTPException:
    """The HTTP answer for a business error."""
    if isinstance(error, NotFound):
        return HTTPException(status_code=404, detail=dict(NOT_FOUND))
    if isinstance(error, InvalidTimezone):
        return HTTPException(
            status_code=422, detail={"code": error.code, "message": "Pick a valid time zone."}
        )
    if isinstance(error, CrateInUse):
        return HTTPException(
            status_code=409,
            detail={"code": error.code, "message": str(error), "uses": list(error.uses)},
        )
    if isinstance(error, Conflict):
        return HTTPException(status_code=409, detail={"code": error.code, "message": str(error)})
    if isinstance(error, BusinessError):
        return HTTPException(status_code=422, detail={"code": error.code, "message": str(error)})
    return HTTPException(status_code=422, detail={"code": "invalid", "message": str(error)})


def _closing_at(
    conn: Connection, workspace_id: str, venue_id: str, body: ArchiveBody, now: int
) -> int | None:
    """When "at closing time" means: the body's instant, else the venue's next close, else None
    (the caller then archives now)."""
    if body.when != "closing":
        return None
    if body.closing_at is not None and body.closing_at > now:
        return body.closing_at
    found = hours_hook.next_closing_at(conn, workspace_id, venue_id, now)
    return found if found is not None and found > now else None


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    rules: RulesCache,
) -> None:
    """Mount the Business routes."""

    def principal(request: Request, claims: Claims, workspace_id: str | None = None):
        chosen = workspace_id or request.headers.get("x-workspace-id")
        found = principal_for(engine, claims, chosen)
        if found.workspace.kind != BUSINESS:
            raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
        return found

    @contextmanager
    def org(request: Request, claims: Claims) -> Iterator[tuple[Connection, str, Any, int]]:
        """One transaction in the request's organisation, with business errors mapped."""
        found = principal(request, claims)
        workspace_id = found.workspace.id
        try:
            with transaction(engine, workspace_id) as conn:
                if not orgs.is_member(conn, workspace_id, found.user.id):
                    raise NotFound("not a member")
                yield conn, workspace_id, found, int(db_now(conn))
        except (BusinessError, ValueError) as error:
            raise _answer(error) from error

    def org_on(conn: Connection, found, workspace: dict) -> bool:
        """Whether `business.orgs` is on for this person in that organisation."""
        there = dataclasses.replace(
            found,
            workspace=dataclasses.replace(found.workspace, id=workspace["id"], kind=BUSINESS),
        )
        return cloud_gate.decide(conn, there, "business.orgs", rules).on

    # -- workspaces and organisations ------------------------------------------------------

    @app.get("/api/workspaces")
    def list_workspaces(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        with transaction(engine, found.workspace.id) as conn:
            items = orgs.list_for_user(conn, found.user.id)
            shown = [
                item
                for item in items
                if item["kind"] != BUSINESS or org_on(conn, found, item)
            ]
        return {"workspaces": shown, "current": found.workspace.id}

    @app.get("/api/business/orgs")
    def list_orgs(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        with transaction(engine, found.workspace.id) as conn:
            items = orgs.list_for_user(conn, found.user.id)
        return {"orgs": [item for item in items if item["kind"] == BUSINESS]}

    @app.post("/api/business/orgs", status_code=201)
    def create_org(
        body: OrgBody, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        found = principal_for(engine, claims, None)
        with transaction(engine, found.workspace.id) as conn:
            # Self-serve sign-up is selling; while it is off, pilots come from staff only.
            cloud_gate.require(conn, found, "business.signups", rules)
        try:
            with transaction(engine) as conn:
                created = orgs.create(
                    conn,
                    owner_user_id=found.user.id,
                    name=body.name,
                    legal_name=body.legal_name,
                    now=int(db_now(conn)),
                )
        except (BusinessError, ValueError) as error:
            raise _answer(error) from error
        return {"org": created}

    @app.get("/api/business/orgs/{org_id}")
    def get_org(
        org_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        found = principal(request, claims, org_id)
        try:
            with transaction(engine, found.workspace.id) as conn:
                answer = orgs.get(conn, found.workspace.id)
                answer["role"] = str(getattr(found.workspace_role, "value", found.workspace_role))
                answer["paid_zones"] = zones.paid_zone_count(conn, found.workspace.id)
        except BusinessError as error:
            raise _answer(error) from error
        return {"org": answer}

    # -- venues ----------------------------------------------------------------------------

    @app.get("/api/business/venues")
    def list_venues(
        request: Request,
        include_archived: bool = False,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with org(request, claims) as (conn, workspace_id, _found, _now):
            items = venues.list_venues(conn, workspace_id, include_archived=include_archived)
        return {"venues": items}

    @app.post("/api/business/venues", status_code=201)
    def create_venue(
        body: VenueBody, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        with org(request, claims) as (conn, workspace_id, _found, now):
            venue = venues.create(
                conn,
                workspace_id,
                name=body.name,
                timezone=body.timezone,
                country=body.country,
                address=body.address,
                now=now,
            )
        return {"venue": venue}

    @app.get("/api/business/venues/{venue_id}")
    def get_venue(
        venue_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        with org(request, claims) as (conn, workspace_id, _found, _now):
            venue = venues.get(conn, workspace_id, venue_id)
            venue["zones"] = zones.list_zones(conn, workspace_id, venue_id)
        return {"venue": venue}

    @app.patch("/api/business/venues/{venue_id}")
    def change_venue(
        venue_id: str,
        body: VenuePatch,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with org(request, claims) as (conn, workspace_id, _found, _now):
            venue = venues.get(conn, workspace_id, venue_id)
            if body.name is not None:
                venue = venues.rename(conn, workspace_id, venue_id, name=body.name)
            if body.timezone is not None:
                venue = venues.set_timezone(conn, workspace_id, venue_id, timezone=body.timezone)
            if body.status == "paused":
                venue = venues.pause(conn, workspace_id, venue_id)
            elif body.status == "active":
                venue = venues.resume(conn, workspace_id, venue_id)
        return {"venue": venue}

    @app.post("/api/business/venues/{venue_id}/archive")
    def archive_venue(
        venue_id: str,
        request: Request,
        body: ArchiveBody | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        body = body or ArchiveBody()
        with org(request, claims) as (conn, workspace_id, _found, now):
            venues.get(conn, workspace_id, venue_id)
            closing = _closing_at(conn, workspace_id, venue_id, body, now)
            if closing is None:
                for zone in zones.list_zones(conn, workspace_id, venue_id):
                    zones.archive(conn, workspace_id, zone["id"], when="now", now=now)
                return {"venue": venues.archive(conn, workspace_id, venue_id, now=now),
                        "archive_at": now}
            # At closing time: each zone stops at the close; the venue stays listed until then.
            for zone in zones.list_zones(conn, workspace_id, venue_id):
                zones.archive(
                    conn, workspace_id, zone["id"], when="closing", now=now, closing_at=closing
                )
            return {"venue": venues.get(conn, workspace_id, venue_id), "archive_at": closing}

    # -- zones -----------------------------------------------------------------------------

    @app.get("/api/business/zones")
    def list_zones(
        request: Request,
        venue_id: str | None = None,
        include_archived: bool = False,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with org(request, claims) as (conn, workspace_id, _found, _now):
            if venue_id is not None:
                venues.get(conn, workspace_id, venue_id)
            items = zones.list_zones(
                conn, workspace_id, venue_id, include_archived=include_archived
            )
        return {"zones": items}

    @app.post("/api/business/zones", status_code=201)
    def create_zone(
        body: ZoneBody, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        with org(request, claims) as (conn, workspace_id, _found, now):
            venue = venues.get(conn, workspace_id, body.venue_id)
            if venue["status"] == "archived":
                raise NotFound("venue not found")
            zone = zones.create(conn, workspace_id, body.venue_id, name=body.name, now=now)
        return {"zone": zone}

    @app.patch("/api/business/zones/{zone_id}")
    def change_zone(
        zone_id: str,
        body: ZonePatch,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with org(request, claims) as (conn, workspace_id, _found, _now):
            zone = zones.get(conn, workspace_id, zone_id)
            if body.name is not None:
                zone = zones.rename(conn, workspace_id, zone_id, name=body.name)
            if body.status == "paused":
                zone = zones.pause(conn, workspace_id, zone_id)
            elif body.status == "active":
                zone = zones.resume(conn, workspace_id, zone_id)
        return {"zone": zone}

    @app.post("/api/business/zones/{zone_id}/archive")
    def archive_zone(
        zone_id: str,
        request: Request,
        body: ArchiveBody | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        body = body or ArchiveBody()
        with org(request, claims) as (conn, workspace_id, _found, now):
            zone = zones.get(conn, workspace_id, zone_id)
            closing = _closing_at(conn, workspace_id, zone["venue_id"], body, now)
            if closing is None:
                zone = zones.archive(conn, workspace_id, zone_id, when="now", now=now)
            else:
                zone = zones.archive(
                    conn, workspace_id, zone_id, when="closing", now=now, closing_at=closing
                )
        return {"zone": zone, "archive_at": closing or now}

    # -- crates ----------------------------------------------------------------------------

    @app.get("/api/business/crates")
    def list_crates(
        request: Request,
        venue_id: str | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with org(request, claims) as (conn, workspace_id, _found, _now):
            if venue_id is None:
                items = crates.list_org(conn, workspace_id)
            else:
                items = crates.list_for_venue(conn, workspace_id, venue_id)
        return {"crates": items}

    @app.post("/api/business/crates", status_code=201)
    def create_crate(
        body: CrateBody, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        with org(request, claims) as (conn, workspace_id, found, now):
            crate = crates.create(
                conn,
                workspace_id,
                name=body.name,
                venue_id=body.venue_id,
                created_by=found.user.id,
                now=now,
            )
        return {"crate": crate}

    @app.get("/api/business/crates/{crate_id}")
    def get_crate(
        crate_id: str,
        request: Request,
        venue_id: str | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with org(request, claims) as (conn, workspace_id, _found, _now):
            if venue_id is not None:
                venues.get(conn, workspace_id, venue_id)
            crate = crates.get(conn, workspace_id, crate_id, venue_id=venue_id)
        return {"crate": crate}

    @app.put("/api/business/crates/{crate_id}/songs")
    def set_crate_songs(
        crate_id: str,
        body: CrateSongs,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with org(request, claims) as (conn, workspace_id, _found, _now):
            unknown = _not_in_library(conn, workspace_id, body.song_ids)
            if unknown:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "unknown_songs", "song_ids": unknown[:20]},
                )
            song_ids = crates.set_songs(conn, workspace_id, crate_id, body.song_ids)
        return {"crate_id": crate_id, "song_ids": song_ids}

    @app.delete("/api/business/crates/{crate_id}")
    def delete_crate(
        crate_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        with org(request, claims) as (conn, workspace_id, _found, _now):
            crates.delete(conn, workspace_id, crate_id)
        return {"deleted": crate_id}


def _not_in_library(conn: Connection, workspace_id: str, song_ids: list[str]) -> list[str]:
    """The ids that are not live songs (assets) of this organisation's library, in order."""
    wanted = list(dict.fromkeys(song_ids))
    if not wanted:
        return []
    known: set[str] = set()
    for start in range(0, len(wanted), 500):
        chunk = wanted[start : start + 500]
        known |= set(
            conn.execute(
                sa.select(assets.c.id).where(
                    assets.c.workspace_id == workspace_id,
                    assets.c.id.in_(chunk),
                    assets.c.deleted_at.is_(None),
                )
            ).scalars()
        )
    return [song_id for song_id in wanted if song_id not in known]


__all__ = ["install_routes"]
