"""`/api/catalog/...` in the Cloud app (ADR-0478 FL-0478-03 and -04).

Every route belongs to the flag `library.art_lookup` (the admin route may instead belong to
`admin.console`; see `ROUTES`), so the build guard and the per-account gate refuse them while it
is off. Tenant routes are scoped to the signed-in person's workspace and check their role.

- `POST /api/catalog/art`: covers and details for a list of the workspace's songs; asks for
  lookups for songs that have none, when the person allows lookups.
- `GET /api/catalog/art/{art_id}/{size}`: the image bytes from our own storage, cached for a
  week by the browser only (`private`), so a hidden image stops being served by us at once. No
  sign-in is needed (an `<img>` sends none); a hidden or unknown image answers 404.
- `GET /api/catalog/songs/{song_id}/candidates` and `PUT /api/catalog/songs/{song_id}/choice`:
  "Wrong cover?".
- `GET` and `PUT /api/catalog/settings`: the person's "Look up covers and details on the web".
- `POST /api/admin/catalog/art/{art_id}/{command}`: staff hide or unhide a catalogue image with a
  reason, audited like a takedown (`legal.takedowns.manage`).

The routes are mounted only once every one of them has a flag owner in the registry, so the Cloud
app keeps starting (`assert_cloud_api_routes_owned`) until the flag file lists them.
FastAPI reads the route signatures at runtime, and `SignedIn` is local to `install_routes`, so this
module must not use postponed annotations (`from __future__ import annotations`): with them the
claims parameter becomes a required query field and every signed-in route answers 422, as in the
admin route modules.
"""

import logging
from collections.abc import Callable
from typing import Annotated, Any

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Path, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.engine import Engine

from selecta import flags
from selecta.authz.roles import WorkspaceAction
from selecta.catalog import service
from selecta.catalog.schema import catalog_art
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction

log = logging.getLogger(__name__)

ROUTES = (
    "POST /api/catalog/art",
    "GET /api/catalog/art/{art_id}/{size}",
    "GET /api/catalog/songs/{song_id}/candidates",
    "PUT /api/catalog/songs/{song_id}/choice",
    "GET /api/catalog/settings",
    "PUT /api/catalog/settings",
    "POST /api/admin/catalog/art/{art_id}/{command}",
)
# An hour, not a week and never immutable: a hidden (taken down) image stops being served at
# once, and a browser that already holds it asks again within the hour and is then refused.
CACHE_CONTROL = "private, max-age=3600"


class SongRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int = Field(ge=1)
    isrc: str | None = Field(default=None, max_length=32)


class ArtRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    songs: list[SongRef] = Field(max_length=service.MAX_SONGS_PER_ASK)


class Choice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    choice: str = Field(pattern="^(auto|release|generated)$")
    release_id: str | None = Field(default=None, min_length=36, max_length=36)


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lookups: bool


class HideRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    object_client_factory: Callable[[], Any] | None = None,
    bucket: Callable[[], str] | None = None,
) -> None:
    owners = flags.route_owners()
    missing = [route for route in ROUTES if route not in owners]
    if missing:
        log.warning("Catalogue routes not mounted: no flag owns %s", ", ".join(missing))
        return

    def objects():
        if object_client_factory is not None and bucket is not None:
            return object_client_factory(), bucket()
        return service._default_objects()


    def who(request: Request, claims: Claims, action: WorkspaceAction):
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(action):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        return principal.workspace.id, principal.user.id

    @app.post("/api/catalog/art")
    def catalog_art_for_songs(body: ArtRequest, request: Request,
            claims: Claims = Depends(current_claims)):  # noqa: B008
        workspace_id, user_id = who(request, claims, WorkspaceAction.LIBRARY_READ)
        ids = list(dict.fromkeys(song.id for song in body.songs))
        queued = service.enqueue_for_songs(
            engine, workspace_id, user_id, [(song.id, song.isrc) for song in body.songs]
        )
        with transaction(engine, workspace_id) as conn:
            return {"songs": service.art_for_songs(conn, workspace_id, ids), "queued": queued,
                    "lookups_allowed": service.allowed(conn, user_id)}

    @app.get("/api/catalog/art/{art_id}/{size}")
    def catalog_art_bytes(
        art_id: Annotated[str, Path(min_length=1, max_length=36, pattern="^[A-Za-z0-9-]+$")],
        size: Annotated[str, Path(pattern="^(250|500|1200)$")],
    ):
        with transaction(engine) as conn:
            found = service.read_art(conn, art_id, size)
        if found is None:
            raise HTTPException(status_code=404, detail={"code": "no_such_image"})
        key, content_type = found
        client, name = objects()
        try:
            data = service.art_bytes(client, name, key)
        except Exception as error:  # noqa: BLE001 - storage trouble reads as "no image"
            log.warning("Catalogue image %s unreadable: %s", art_id, type(error).__name__)
            raise HTTPException(status_code=404, detail={"code": "no_such_image"}) from error
        return Response(
            content=data,
            media_type=content_type,
            headers={"Cache-Control": CACHE_CONTROL, "X-Content-Type-Options": "nosniff"},
        )

    @app.get("/api/catalog/songs/{song_id}/candidates")
    def catalog_candidates(song_id: int, request: Request,
            claims: Claims = Depends(current_claims)):  # noqa: B008
        workspace_id, _ = who(request, claims, WorkspaceAction.LIBRARY_READ)
        with transaction(engine, workspace_id) as conn:
            try:
                return service.candidates_for_song(conn, workspace_id, song_id)
            except LookupError as error:
                raise HTTPException(
                    status_code=404, detail={"code": "no_lookup", "message": str(error)}
                ) from error

    @app.put("/api/catalog/songs/{song_id}/choice")
    def catalog_choice(song_id: int, body: Choice, request: Request,
            claims: Claims = Depends(current_claims)):  # noqa: B008
        workspace_id, user_id = who(request, claims, WorkspaceAction.LIBRARY_WRITE)
        with transaction(engine, workspace_id) as conn:
            try:
                fetch = service.set_choice(conn, workspace_id, song_id, user_id,
                                           choice=body.choice, release_id=body.release_id)
            except LookupError as error:
                raise HTTPException(
                    status_code=404, detail={"code": "no_lookup", "message": str(error)}
                ) from error
            except ValueError as error:
                raise HTTPException(
                    status_code=400, detail={"code": "invalid_choice", "message": str(error)}
                ) from error
        if fetch is not None:
            service.queue_cover_fetch(engine, workspace_id, user_id, fetch)
        with transaction(engine, workspace_id) as conn:
            return {"song": service.art_for_songs(conn, workspace_id, [song_id])[0],
                    "cover_pending": fetch is not None}

    @app.get("/api/catalog/settings")
    def catalog_settings(request: Request,
            claims: Claims = Depends(current_claims)):  # noqa: B008
        workspace_id, user_id = who(request, claims, WorkspaceAction.LIBRARY_READ)
        with transaction(engine, workspace_id) as conn:
            return {"lookups": service.allowed(conn, user_id)}

    @app.put("/api/catalog/settings")
    def catalog_save_settings(body: Settings, request: Request,
            claims: Claims = Depends(current_claims)):  # noqa: B008
        workspace_id, user_id = who(request, claims, WorkspaceAction.LIBRARY_READ)
        with transaction(engine, workspace_id) as conn:
            return {"lookups": service.set_allowed(conn, user_id, body.lookups)}

    @app.post("/api/admin/catalog/art/{art_id}/{command}")
    def admin_catalog_art(
        art_id: str, command: str, body: HideRequest, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        from selecta.admin import http
        from selecta.authz import audit
        from selecta.authz.check import authorize
        from selecta.authz.scopes import ResourceRef

        if command not in {"hide", "unhide"}:
            raise HTTPException(404, detail={"code": "unknown_command"})
        actor = http.staff_actor(engine, request, claims)
        hide = command == "hide"

        def change(conn) -> dict[str, Any]:
            authorize(conn, actor, "legal.takedowns.manage", ResourceRef("catalog_art", art_id))
            row = conn.execute(sa.select(catalog_art).where(catalog_art.c.id == art_id)).first()
            if row is None:
                raise LookupError("There's no such catalogue image.")
            now = db_now(conn)
            conn.execute(catalog_art.update().where(catalog_art.c.id == art_id).values(
                hidden=hide,
                hidden_reason=audit.scrub_text(body.reason.strip()) if hide else None,
                hidden_at=now if hide else None,
                hidden_by=actor.user_id if hide else None,
            ))
            audit.record(
                conn,
                actor_id=actor.user_id,
                action=f"legal.catalog_art.{'hidden' if hide else 'unhidden'}",
                result=audit.AuditResult.SUCCESS,
                resource_type="catalog_art",
                resource_id=art_id,
                workspace_id=None,
                reason=body.reason.strip(),
                request_id=actor.request_id,
                metadata={"release_id": row.release_id, "was_hidden": bool(row.hidden)},
            )
            return {"id": art_id, "hidden": hide}

        return http.run(engine, actor, change)


__all__ = ["CACHE_CONTROL", "ROUTES", "install_routes"]
