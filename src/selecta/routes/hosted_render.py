"""HTTP routes for hosted Cloud processing (`selecta.hosted_render`), Cloud app only.

Every route belongs to `cloud.hosted_render` (flags/cloud.json), which requires the
`cloud.hosted_media` grant, so a browser-first account never reaches them. Reading needs
`mixes.read`; asking for work needs `mixes.edit`. A mix is named by its songs in order (and
the planned move into each), so the same songs always mean the same rendered seams.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Request
from sqlalchemy.engine import Engine

from selecta import hosted_export as exports
from selecta import hosted_render
from selecta.admin.state import DbWorkControls
from selecta.authz.roles import WorkspaceAction
from selecta.business.weight import business_policy
from selecta.identity.tokens import Claims
from selecta.storage.artifacts import Buckets
from selecta.storage.objects import ObjectClient, R2Error
from selecta.work.cloud_ports import CloudJobEntitlements
from selecta.work.store import JobStore

_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
MAX_MIX_SONGS = 60


def _order(body: dict[str, Any]) -> list[dict[str, Any]]:
    raw = body.get("songs")
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_MIX_SONGS:
        raise HTTPException(400, detail={"code": "invalid_songs"})
    order = []
    for item in raw:
        if not isinstance(item, dict) or not _ID.fullmatch(str(item.get("asset_id", ""))):
            raise HTTPException(400, detail={"code": "invalid_songs"})
        move = item.get("move")
        if move is not None and (not isinstance(move, str) or not _ID.fullmatch(move)):
            raise HTTPException(400, detail={"code": "invalid_move"})
        order.append({"asset_id": item["asset_id"], "move": move})
    return order


def install_routes(
    app: FastAPI, *, engine: Engine, current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any], object_client_factory: Callable[[], ObjectClient],
    buckets: Buckets,
) -> None:
    work = hosted_render.Work(JobStore(
        engine, business_policy(), entitlements=CloudJobEntitlements(engine),
        controls=DbWorkControls(),
    ))

    def principal(request: Request, claims: Claims, action: WorkspaceAction):
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not found.can(action):
            raise HTTPException(403, detail={"code": "not_allowed"})
        return found

    def read_object(key: str, destination: Path) -> Path:
        client = object_client_factory()
        try:
            client.get_object(buckets.derived, key, destination)
        finally:
            getattr(client, "close", lambda: None)()
        return destination

    @app.get("/api/hosted/songs")
    def hosted_songs(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        found = principal(request, claims, WorkspaceAction.MIXES_READ)
        return hosted_render.songs_status(engine, found.workspace.id)

    @app.post("/api/hosted/songs/prepare")
    def hosted_prepare(request: Request, body: dict = Body(default={}),  # noqa: B008
                       claims: Claims = Depends(current_claims)):  # noqa: B008
        found = principal(request, claims, WorkspaceAction.MIXES_EDIT)
        made = hosted_render.prepare_songs(engine, work, found.workspace.id,
                                           retry=body.get("retry") is True,
                                           created_by=found.user.id)
        return {"made": made, **hosted_render.songs_status(engine, found.workspace.id)}

    @app.post("/api/hosted/songs/{asset_id}/retry")
    def hosted_retry_song(asset_id: str, request: Request,
                          claims: Claims = Depends(current_claims)):  # noqa: B008
        """Try again for one song: a fresh analysis job in place of a failed or stuck one (never
        a second live job). Only the caller's own workspace's songs: another account's song id
        answers exactly as a made-up one does. Answers `{"made", "song"}`, the song in the
        `GET /api/hosted/songs` entry shape."""
        if not _ID.fullmatch(asset_id):
            raise HTTPException(404, detail={"code": "song_not_found"})
        found = principal(request, claims, WorkspaceAction.MIXES_EDIT)
        if hosted_render.song_status(engine, found.workspace.id, asset_id) is None:
            raise HTTPException(404, detail={"code": "song_not_found"})
        made = hosted_render.prepare_songs(engine, work, found.workspace.id, [asset_id],
                                           retry=True, created_by=found.user.id)
        return {"made": made,
                "song": hosted_render.song_status(engine, found.workspace.id, asset_id)}

    @app.post("/api/hosted/mixes/plan")
    def hosted_plan(request: Request, body: dict = Body(default={}),  # noqa: B008
                    claims: Claims = Depends(current_claims)):  # noqa: B008
        found = principal(request, claims, WorkspaceAction.MIXES_EDIT)
        count = body.get("count", 12)
        if isinstance(count, bool) or not isinstance(count, int) or not 2 <= count <= 60:
            raise HTTPException(400, detail={"code": "invalid_count"})
        try:
            songs = hosted_render.plan_mix(engine, found.workspace.id, read_object, count=count)
        except R2Error as error:
            raise HTTPException(503, detail={"code": "storage_temporarily_unavailable"}) from error
        return {"songs": songs}

    @app.post("/api/hosted/mixes/render")
    def hosted_render_mix(request: Request, body: dict = Body(...),  # noqa: B008
                          claims: Claims = Depends(current_claims)):  # noqa: B008
        found = principal(request, claims, WorkspaceAction.MIXES_EDIT)
        client = object_client_factory()
        try:
            return hosted_render.mix_state(
                engine, work, found.workspace.id, _order(body), client=client, buckets=buckets,
                created_by=found.user.id, retry=body.get("retry") is True,
                read_object=read_object)
        except R2Error as error:
            raise HTTPException(503, detail={"code": "storage_temporarily_unavailable"}) from error
        finally:
            getattr(client, "close", lambda: None)()

    @app.post("/api/hosted/mixes/export", status_code=202)
    def hosted_export(request: Request, body: dict = Body(...),  # noqa: B008
                      claims: Claims = Depends(current_claims)):  # noqa: B008
        """One export of the mix exactly as it plays (`hosted_export`): the same order and
        moves as `/api/hosted/mixes/render`."""
        found = principal(request, claims, WorkspaceAction.MIXES_EDIT)
        order = _order(body)
        client = object_client_factory()
        try:
            return exports.request_export(
                engine, work, found.workspace.id, order, client=client, buckets=buckets,
                created_by=found.user.id, read_object=read_object)
        except R2Error as error:
            raise HTTPException(503, detail={"code": "storage_temporarily_unavailable"}) from error
        finally:
            getattr(client, "close", lambda: None)()

    @app.get("/api/hosted/exports/{job_id}")
    def hosted_export_status(job_id: str, request: Request,
                             claims: Claims = Depends(current_claims)):  # noqa: B008
        if not _ID.fullmatch(job_id):
            raise HTTPException(404, detail={"code": "export_not_found"})
        found = principal(request, claims, WorkspaceAction.MIXES_READ)
        client = object_client_factory()
        try:
            state = exports.export_status(engine, found.workspace.id, job_id,
                                          client=client, buckets=buckets)
        finally:
            getattr(client, "close", lambda: None)()
        if state is None:
            raise HTTPException(404, detail={"code": "export_not_found"})
        return state


__all__ = ["install_routes"]
