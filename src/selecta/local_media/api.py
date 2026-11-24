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
from selecta.local_media import store, versions
from selecta.persistence import db_now, transaction
from selecta.playback import default_speaker
from selecta.playback.schema import devices as playback_devices

# A library of 20,000 songs is 20 pages: the Library is waiting on the whole list (staging
# walkthrough item 5, 30 s at 100 a page on staging). A row is a few hundred bytes.
_MAX_PAGE_SIZE = 1000
_MAX_AVAILABILITY_SNAPSHOT_IDS = 20_000
# ADR-0475: a device counts as online when it was seen this recently. A device with the app
# open reads its playback session every second or two, which keeps its last-seen time fresh.
ONLINE_WITHIN_SECONDS = 30.0


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


class NeverEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int = Field(gt=0)
    # the value the page was showing, so a change made elsewhere meanwhile refuses the whole batch
    expected: bool


class NeverRequest(BaseModel):
    """Set "Never play" on a batch of songs, all or none (the Library's batch and row actions)."""

    model_config = ConfigDict(extra="forbid")

    never: bool
    entries: list[NeverEntry] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def one_entry_per_song(self) -> NeverRequest:
        if len({entry.id for entry in self.entries}) != len(self.entries):
            raise ValueError("each song may appear once")
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
            # a re-registered file may carry new tags, which can change its song
            versions.regroup_versions(conn, workspace_id)
        return {"songs": answers}

    @app.post("/api/local-media/songs/never")
    def set_never(
        body: NeverRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Keep songs out of the mixes SelectaDJ builds, or let them back in, for the account."""
        workspace_id = workspace(request, claims, WorkspaceAction.LIBRARY_WRITE)
        entries = [(entry.id, entry.expected) for entry in body.entries]
        try:
            with transaction(engine, workspace_id) as conn:
                changed = store.set_never(conn, workspace_id, entries, body.never)
        except store.NeverConflict as conflict:
            if conflict.missing:
                raise HTTPException(
                    status_code=404,
                    detail={
                        "code": "song_not_found",
                        "message": "Some of these songs are no longer in your library. "
                        "Nothing was changed.",
                        "ids": conflict.missing,
                    },
                ) from conflict
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "library_changed",
                    "message": "Some of these songs changed on another screen. Nothing was "
                    "changed; look again and try once more.",
                    "ids": conflict.stale,
                },
            ) from conflict
        return {"never": body.never, "changed": changed}

    @app.get("/api/local-media/songs")
    def list_songs(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        after: int = Query(default=0, ge=0),
        limit: int = Query(default=50, ge=1, le=_MAX_PAGE_SIZE),
    ) -> dict[str, Any]:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(WorkspaceAction.LIBRARY_READ):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        workspace_id = principal.workspace.id
        with transaction(engine, workspace_id) as conn:
            if after == 0 and principal.can(WorkspaceAction.LIBRARY_WRITE):
                # once per workspace per grouping rule: existing songs and their versions are
                # put right on the first load after a deploy (ADR-0469 amendment 2); a viewer's
                # read never writes
                versions.ensure_regrouped(conn, workspace_id)
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
            # a removed song's other versions find their primary again
            if deleted:
                versions.regroup_versions(conn, workspace_id)
        return {"id": song_id, "deleted": True, "already_deleted": not deleted}

    @app.get("/api/local-media/holdings")
    def holdings(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        device_id: str | None = Query(default=None, max_length=64),
    ) -> dict[str, Any]:
        """ADR-0475: what each signed-in device of this person can open, as counts, and for one
        named device its catalogue ids. Ids only: no path, file name or folder name exists here.
        A device is online when it was seen in the last 30 seconds."""
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(WorkspaceAction.LIBRARY_READ):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        workspace_id = principal.workspace.id
        with transaction(engine, workspace_id) as conn:
            now = db_now(conn)
            mine = conn.execute(
                sa.select(playback_devices)
                .where(playback_devices.c.workspace_id == workspace_id)
                .where(playback_devices.c.user_id == principal.user.id)
                .where(playback_devices.c.signed_out_at.is_(None))
                .order_by(playback_devices.c.last_seen_at.desc(), playback_devices.c.id)
            ).mappings().all()
            counts = store.holding_counts(conn, workspace_id)
            answer: dict[str, Any] = {
                "devices": [
                    {
                        "device_id": row["id"],
                        "name": row["name"],
                        "last_seen_at": row["last_seen_at"],
                        "online": now - float(row["last_seen_at"]) <= ONLINE_WITHIN_SECONDS,
                        "songs": counts.get(row["id"], {}).get("songs", 0),
                        "reported_at": counts.get(row["id"], {}).get("reported_at"),
                    }
                    for row in mine
                ],
                "server_time": now,
                # ADR-0475: the device the person chose to make the sound when several could
                "default_speaker_id": default_speaker.read(conn, workspace_id),
            }
            if device_id is not None:
                if not any(row["id"] == device_id for row in mine):
                    raise HTTPException(status_code=404, detail={"code": "unknown_device"})
                answer["device_id"] = device_id
                answer["song_ids"] = store.device_holdings(conn, workspace_id, device_id)
        return answer

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
