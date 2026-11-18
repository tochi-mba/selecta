"""Tenant-scoped routes for the metadata-only song catalogue (ADR-0458, `cloud.local_media`).

The browser registers track identities (content hash plus display metadata) and reports which
devices hold a playable copy; no audio and no raw path ever reaches these routes. Every request
model forbids unknown fields, so a path can never ride along, and the store refuses any key
containing "path" as a second line of defence.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.engine import Engine

from selecta.authz.roles import WorkspaceAction
from selecta.identity.tokens import Claims
from selecta.local_media import store
from selecta.persistence import transaction
from selecta.playback.schema import devices as playback_devices

_MAX_PAGE_SIZE = 100
_MAX_AVAILABILITY_SNAPSHOT_IDS = 20_000


class SongRegistration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_sha256: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-fA-F]{64}$")
    title: str = Field(min_length=1, max_length=512)
    artist: str = Field(min_length=1, max_length=512)
    album: str | None = Field(default=None, max_length=512)
    duration_s: float | None = Field(default=None, gt=0)
    codec: str | None = Field(default=None, max_length=32)
    sample_rate: int | None = Field(default=None, gt=0)


class RegisterSongsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    songs: list[SongRegistration] = Field(min_length=1, max_length=500)


class AvailabilityReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_id: str = Field(min_length=1, max_length=36)
    present: list[int] = Field(default_factory=list, max_length=_MAX_AVAILABILITY_SNAPSHOT_IDS)
    absent: list[int] = Field(default_factory=list, max_length=_MAX_AVAILABILITY_SNAPSHOT_IDS)
    snapshot: bool = False

    @model_validator(mode="after")
    def limit_report_size(self) -> AvailabilityReport:
        if len(self.present) + len(self.absent) > _MAX_AVAILABILITY_SNAPSHOT_IDS:
            raise ValueError(
                f"availability reports are limited to {_MAX_AVAILABILITY_SNAPSHOT_IDS} ids"
            )
        return self


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
) -> None:
    """Install the catalogue routes. Every query is scoped by workspace, and every route checks
    the member's role: reads need `library.read`, registration, deletion and availability
    reports need `library.write` (a viewer can browse the catalogue but not change it)."""

    def workspace(request: Request, claims: Claims, action: WorkspaceAction) -> str:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(action):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        return principal.workspace.id

    @app.post("/api/local-media/songs")
    def register_songs(
        body: RegisterSongsRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = workspace(request, claims, WorkspaceAction.LIBRARY_WRITE)
        with transaction(engine, workspace_id) as conn:
            answers = store.register_songs(
                conn, workspace_id, [song.model_dump() for song in body.songs]
            )
        return {"songs": answers}

    @app.get("/api/local-media/songs")
    def list_songs(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        after: int = Query(default=0, ge=0),
        limit: int = Query(default=50, ge=1, le=_MAX_PAGE_SIZE),
    ) -> dict[str, Any]:
        workspace_id = workspace(request, claims, WorkspaceAction.LIBRARY_READ)
        with transaction(engine, workspace_id) as conn:
            songs, next_after = store.list_songs(conn, workspace_id, after=after, limit=limit)
            counts = store.availability_counts(conn, workspace_id, [s["id"] for s in songs])
        for song in songs:
            song["available_on"] = counts.get(song["id"], 0)
        answer: dict[str, Any] = {"songs": songs}
        if next_after is not None:
            answer["next"] = next_after
        return answer

    @app.get("/api/local-media/songs/{song_id}")
    def get_song(
        song_id: int,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = workspace(request, claims, WorkspaceAction.LIBRARY_READ)
        with transaction(engine, workspace_id) as conn:
            song = store.get_song(conn, workspace_id, song_id)
            if song is None:
                raise HTTPException(status_code=404, detail={"code": "song_not_found"})
            counts = store.availability_counts(conn, workspace_id, [song_id])
        song["available_on"] = counts.get(song_id, 0)
        return {"song": song}

    @app.delete("/api/local-media/songs/{song_id}")
    def delete_song(
        song_id: int,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = workspace(request, claims, WorkspaceAction.LIBRARY_WRITE)
        with transaction(engine, workspace_id) as conn:
            if not store.exists(conn, workspace_id, song_id):
                raise HTTPException(status_code=404, detail={"code": "song_not_found"})
            deleted = store.soft_delete(conn, workspace_id, song_id)
        return {"id": song_id, "deleted": True, "already_deleted": not deleted}

    @app.post("/api/local-media/availability")
    def report_availability(
        body: AvailabilityReport,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(WorkspaceAction.LIBRARY_WRITE):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        workspace_id = principal.workspace.id
        with transaction(engine, workspace_id) as conn:
            # Lock the authenticated device row so concurrent snapshots for this device serialize
            # before replacing availability. SQLite write transactions already serialize writers.
            device = conn.execute(
                sa.select(playback_devices)
                .where(playback_devices.c.workspace_id == workspace_id)
                .where(playback_devices.c.id == body.device_id)
                .with_for_update()
            ).mappings().first()
            if (
                device is None
                or device["user_id"] != principal.user.id
                or device["signed_out_at"] is not None
            ):
                # Match playback's own-device contract: a caller cannot report for another
                # member's device, a signed-out device or an unregistered id.
                raise HTTPException(status_code=404, detail={"code": "unknown_device"})
            report = (
                store.replace_device_availability
                if body.snapshot
                else store.set_availability
            )
            written = report(
                conn, workspace_id, body.device_id, body.present, body.absent
            )
        return {"device_id": body.device_id, **written}


__all__ = ["install_routes"]
