"""Cloud routes for venue content controls (ADR-0450): rules, blocklist, overrides, song flags.

Installed by `selecta.business.controls_wiring.install`. Every route acts in the request's
organisation workspace (`X-Workspace-ID`; an organisation's id is its workspace id, as in BZ-1),
resolves the caller to a `BusinessActor` and checks one permission with `guard.require`:

- `business.rules.read` to read rules and the blocklist,
- `business.rules.edit` to save organisation or venue rules and change the blocklist,
- `business.rules.override` to let one song or artist through in a zone for up to 24 hours,
- `business.songs.flag` to mark a song explicit, clean or unknown.

The writes live in `editing`; each bumps the organisation's policy version and is audited. The
routes belong to the `business.content_controls` flag (default off), which the flag guard
enforces, and they also answer 404 `flag_off` while it is off.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta.business.access import BusinessActor, BusinessError, BusinessNotFound
from selecta.business.access.directory import Directory
from selecta.business.content import editing, store
from selecta.business.content.engine import SongFacts
from selecta.persistence import transaction

FLAG = "business.content_controls"
SongsFor = Callable[[Connection, str], "list[SongFacts] | None"]
"""(connection, organisation id) -> the library's song facts for pool checks, or None to skip."""


class FlagBody(BaseModel):
    explicit: str = Field(max_length=16)
    venue_id: str | None = Field(default=None, max_length=64)


def no_songs(_conn: Connection, _organisation_id: str) -> list[SongFacts] | None:
    return None


def _rule_json(row: dict) -> dict[str, Any]:
    keep = ("level", "level_id", "daypart_id", "daypart_label", "windows", *editing.clean_rule({}))
    return {name: row.get(name) for name in keep}


def _error(error: BusinessError) -> HTTPException:
    detail: dict[str, Any] = {"code": error.code, "message": str(error)}
    for name in ("refusals", "warnings", "blocks"):
        if hasattr(error, name):
            detail[name] = getattr(error, name)
    return HTTPException(status_code=error.status, detail=detail)


def _default_authorize(conn, actor, permission, *, venue_id=None, zone_id=None, directory):
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
    songs_for: SongsFor = no_songs,
    authorize: Callable[..., None] = _default_authorize,
    actor_resolver: Callable[..., BusinessActor] | None = None,
    flag_on: Callable[[str], bool] | None = None,
) -> None:
    def enabled() -> bool:
        if flag_on is not None:
            return flag_on(FLAG)
        from selecta.business.rooms.service import default_flag_on

        return default_flag_on(FLAG)

    def workspace_of(request: Request) -> str:
        chosen = request.headers.get("x-workspace-id")
        if principal_for is None or actor_resolver is not None:
            if not chosen:
                raise HTTPException(status_code=404, detail={"code": "not_found"})
            return chosen
        found = principal_for(engine, current_claims(request), chosen)
        if found.workspace.kind != "business":
            raise HTTPException(status_code=404, detail={"code": "not_found"})
        return found.workspace.id

    def resolve(request: Request, conn: Connection, workspace_id: str) -> BusinessActor:
        if actor_resolver is not None:
            return actor_resolver(request, conn, organisation_id=workspace_id,
                                  workspace_id=workspace_id)
        from selecta.business.access import guard
        from selecta.business.content.claims import user_id_for

        claims = current_claims(request)
        return guard.actor_for(conn, user_id=user_id_for(conn, claims),
                               organisation_id=workspace_id, workspace_id=workspace_id)

    def run(request: Request, permission: str, work: Callable[..., Any], *,
            venue_id: str | None = None, zone_id: str | None = None) -> Any:
        if not enabled():
            raise HTTPException(status_code=404, detail={
                "code": "flag_off", "flag": FLAG, "message": "That isn't available here."})
        workspace_id = workspace_of(request)
        try:
            with transaction(engine, workspace_id) as conn:
                actor = resolve(request, conn, workspace_id)
                authorize(conn, actor, permission, venue_id=venue_id, zone_id=zone_id,
                          directory=directory)
                return work(conn, actor)
        except BusinessError as error:
            raise _error(error) from error

    def venue_in_org(conn: Connection, actor: BusinessActor, venue_id: str):
        venue = directory.venue(conn, venue_id)
        if venue is None or venue.organisation_id != actor.organisation_id:
            raise BusinessNotFound()
        return venue

    def zone_in_org(conn: Connection, actor: BusinessActor, zone_id: str):
        zone = directory.zone(conn, zone_id)
        if zone is None or zone.organisation_id != actor.organisation_id:
            raise BusinessNotFound()
        return zone

    # -- organisation rules ------------------------------------------------------------------

    @app.get("/api/business/content/rules")
    def org_rules(request: Request) -> dict[str, Any]:
        def work(conn, actor):
            org = actor.organisation_id
            rows = store.rule_rows(conn, org, "organisation", org)
            return {"rules": _rule_json(rows[0]) if rows else None,
                    "version": store.version(conn, org)}
        return run(request, "business.rules.read", work)

    @app.put("/api/business/content/rules")
    def save_org_rules(body: dict[str, Any], request: Request) -> dict[str, Any]:
        def work(conn, actor):
            version = editing.save_org_rules(
                conn, actor, organisation_id=actor.organisation_id,
                workspace_id=actor.workspace_id, values=body)
            return {"version": version}
        return run(request, "business.rules.edit", work)

    # -- venue rules (venue, zone, daypart and volume) ---------------------------------------

    @app.get("/api/business/venues/{venue_id}/content/rules")
    def venue_rules(venue_id: str, request: Request) -> dict[str, Any]:
        def work(conn, actor):
            venue = venue_in_org(conn, actor, venue_id)
            org = actor.organisation_id
            venue_rows = store.rule_rows(conn, org, "venue", venue.id)
            zones = {}
            for zone in directory.zones_of(conn, venue.id):
                own = store.rule_rows(conn, org, "zone", zone.id)
                parts = store.rule_rows(conn, org, "daypart", zone.id)
                zones[zone.id] = {"rules": _rule_json(own[0]) if own else None,
                                  "dayparts": [_rule_json(row) for row in parts]}
            volume = {row["zone_id"]: {"cap": row["cap"], "quiet_hours": row["quiet_hours"]}
                      for row in store.volume_rows(conn, org, venue.id)}
            return {"venue": _rule_json(venue_rows[0]) if venue_rows else None, "zones": zones,
                    "volume": volume, "version": store.version(conn, org)}
        return run(request, "business.rules.read", work, venue_id=venue_id)

    @app.put("/api/business/venues/{venue_id}/content/rules")
    def save_venue_rules(venue_id: str, body: dict[str, Any], request: Request,
                         confirm: bool = False) -> dict[str, Any]:
        def work(conn, actor):
            venue = venue_in_org(conn, actor, venue_id)
            return editing.save_venue_rules(
                conn, actor, venue, body, directory=directory,
                songs=songs_for(conn, actor.organisation_id), confirm=confirm)
        return run(request, "business.rules.edit", work, venue_id=venue_id)

    # -- blocklist ---------------------------------------------------------------------------

    @app.get("/api/business/content/blocklist")
    def blocklist(request: Request) -> dict[str, Any]:
        return run(request, "business.rules.read",
                   lambda conn, actor: {"entries": store.list_entries(conn,
                                                                      actor.organisation_id)})

    @app.post("/api/business/content/blocklist", status_code=201)
    def add_block(body: dict[str, Any], request: Request) -> dict[str, Any]:
        def work(conn, actor):
            return editing.add_block(conn, actor, organisation_id=actor.organisation_id,
                                     workspace_id=actor.workspace_id, body=body,
                                     directory=directory)
        return run(request, "business.rules.edit", work)

    @app.delete("/api/business/content/blocklist/{entry_id}")
    def remove_block(entry_id: str, request: Request) -> dict[str, Any]:
        def work(conn, actor):
            version = editing.remove_block(conn, actor, organisation_id=actor.organisation_id,
                                           workspace_id=actor.workspace_id, entry_id=entry_id)
            return {"removed": entry_id, "version": version}
        return run(request, "business.rules.edit", work)

    # -- overrides ---------------------------------------------------------------------------

    @app.post("/api/business/zones/{zone_id}/content/overrides", status_code=201)
    def create_override(zone_id: str, body: dict[str, Any], request: Request) -> dict[str, Any]:
        return run(request, "business.rules.override",
                   lambda conn, actor: editing.create_override(
                       conn, actor, zone_in_org(conn, actor, zone_id), body),
                   zone_id=zone_id)

    @app.delete("/api/business/zones/{zone_id}/content/overrides/{override_id}")
    def end_override(zone_id: str, override_id: str, request: Request) -> dict[str, Any]:
        def work(conn, actor):
            version = editing.end_override(conn, actor, zone_in_org(conn, actor, zone_id),
                                           override_id)
            return {"ended": override_id, "version": version}
        return run(request, "business.rules.override", work, zone_id=zone_id)

    # -- song flags --------------------------------------------------------------------------

    @app.put("/api/business/content/songs/{song_id}/explicit")
    def flag_song(song_id: str, body: FlagBody, request: Request) -> dict[str, Any]:
        def work(conn, actor):
            if body.venue_id is not None:
                venue_in_org(conn, actor, body.venue_id)
            version = editing.set_song_flag(
                conn, actor, organisation_id=actor.organisation_id,
                workspace_id=actor.workspace_id, song_id=song_id, explicit=body.explicit,
                venue_id=body.venue_id)
            return {"song_id": song_id, "explicit": body.explicit, "version": version}
        return run(request, "business.songs.flag", work, venue_id=body.venue_id)


__all__ = ["FLAG", "install_routes", "no_songs"]
