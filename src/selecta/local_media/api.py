"""Tenant-scoped routes for the metadata-only song catalogue (ADR-0458, `cloud.local_media`).

The browser registers track identities (content hash plus display metadata) and reports which
devices hold a playable copy; no audio and no raw path ever reaches these routes. Every request
model forbids unknown fields, so a path can never ride along, and the store refuses any key
containing "path" as a second line of defence.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.engine import Engine

from selecta.identity.tokens import Claims
from selecta.local_media import store
from selecta.persistence import transaction

_MAX_PAGE_SIZE = 100


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
    present: list[int] = Field(default_factory=list, max_length=5000)
    absent: list[int] = Field(default_factory=list, max_length=5000)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
) -> None:
    """Install the catalogue routes. Every query is scoped by workspace."""

    def workspace(request: Request, claims: Claims) -> str:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        return principal.workspace.id

    @app.post("/api/local-media/songs")
    def register_songs(
        body: RegisterSongsRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = workspace(request, claims)
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
        workspace_id = workspace(request, claims)
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
        workspace_id = workspace(request, claims)
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
        workspace_id = workspace(request, claims)
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
        workspace_id = workspace(request, claims)
        with transaction(engine, workspace_id) as conn:
            written = store.set_availability(
                conn, workspace_id, body.device_id, body.present, body.absent
            )
        return {"device_id": body.device_id, **written}


__all__ = ["install_routes"]
