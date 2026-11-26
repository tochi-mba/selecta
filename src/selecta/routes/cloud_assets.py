"""Tenant-scoped Cloud asset metadata and deletion routes."""

from __future__ import annotations

import base64
import binascii
import math
import re
from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import and_, or_, select
from sqlalchemy.engine import Connection, Engine

from selecta.authz.roles import WorkspaceAction
from selecta.business import crates
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction
from selecta.storage.deletion import DeletionKind, tombstone
from selecta.storage.ids import require_id
from selecta.storage.schema import assets, upload_sessions
from selecta.usage import quota
from selecta.work import outbox

_CURSOR_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_MAX_PAGE_SIZE = 100
# songs one removal may name, as the Library's selection holds at most 200
MAX_REMOVE = 200
REMOVED_TOPIC = "asset.removed"


class _QuotaRelease:
    """Adapt the usage package to the storage deletion port."""

    @staticmethod
    def release_committed(
        conn: Connection, workspace_id: str, size: int, ref: str
    ) -> None:
        quota.release_deleted(conn, workspace_id, size, ref=ref)


def _encode_cursor(created_at: float, asset_id: str) -> str:
    raw = f"{created_at:.17g}\n{asset_id}".encode("ascii")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _decode_cursor(cursor: str | None) -> tuple[float, str] | None:
    if cursor is None:
        return None
    if not cursor or len(cursor) > 256:
        raise HTTPException(status_code=400, detail={"code": "invalid_cursor"})
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode("ascii")
        timestamp_text, asset_id = raw.split("\n", 1)
        timestamp = float(timestamp_text)
    except (ValueError, UnicodeDecodeError, binascii.Error):
        raise HTTPException(status_code=400, detail={"code": "invalid_cursor"}) from None
    if not math.isfinite(timestamp) or not _CURSOR_ID.fullmatch(asset_id):
        raise HTTPException(status_code=400, detail={"code": "invalid_cursor"})
    return timestamp, asset_id


def _asset_json(row: Any) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.display_name or "Untitled",
        "size": int(row.size),
        "sha256": row.sha256,
        "format": row.format,
        "duration_seconds": row.duration_s,
        "sample_rate": row.sample_rate,
        "channels": row.channels,
        "created_at": row.created_at,
    }


class RemoveRequest(BaseModel):
    """Catalogue song ids, not upload ids: a song's copies are found on the server (its own hash
    and its older ones), so a second copy or one under an older hash is never left behind."""

    model_config = ConfigDict(extra="forbid")

    song_ids: list[int] = Field(min_length=1, max_length=MAX_REMOVE)

    @model_validator(mode="after")
    def once_each(self) -> RemoveRequest:
        if len(set(self.song_ids)) != len(self.song_ids):
            raise ValueError("each song may appear once")
        if any(song_id <= 0 for song_id in self.song_ids):
            raise ValueError("song ids are positive")
        return self


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
) -> None:
    """Install account-owned library metadata routes. Every query is scoped by workspace."""

    def workspace(request: Request, claims: Claims) -> str:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        return principal.workspace.id

    @app.get("/api/assets")
    def list_assets(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        limit: int = Query(default=50, ge=1, le=_MAX_PAGE_SIZE),
        cursor: str | None = Query(default=None, max_length=256),
    ) -> dict[str, Any]:
        workspace_id = workspace(request, claims)
        position = _decode_cursor(cursor)
        query = (
            select(
                assets.c.id,
                assets.c.workspace_id,
                assets.c.size,
                assets.c.sha256,
                assets.c.format,
                assets.c.duration_s,
                assets.c.sample_rate,
                assets.c.channels,
                assets.c.created_at,
                upload_sessions.c.display_name,
            )
            .select_from(
                assets.outerjoin(
                    upload_sessions,
                    and_(
                        upload_sessions.c.id == assets.c.id,
                        upload_sessions.c.workspace_id == assets.c.workspace_id,
                    ),
                )
            )
            .where(assets.c.workspace_id == workspace_id, assets.c.deleted_at.is_(None))
            .order_by(assets.c.created_at.desc(), assets.c.id.desc())
            .limit(limit + 1)
        )
        if position is not None:
            created_at, asset_id = position
            query = query.where(
                or_(
                    assets.c.created_at < created_at,
                    and_(assets.c.created_at == created_at, assets.c.id < asset_id),
                )
            )
        with transaction(engine, workspace_id) as conn:
            rows = conn.execute(query).mappings().all()
        has_more = len(rows) > limit
        visible = rows[:limit]
        next_cursor = (
            _encode_cursor(visible[-1]["created_at"], visible[-1]["id"])
            if has_more and visible
            else None
        )
        return {"assets": [_asset_json(row) for row in visible], "next_cursor": next_cursor}

    @app.get("/api/assets/{asset_id}")
    def get_asset(
        asset_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        require_id(asset_id, {"code": "asset_not_found"})
        workspace_id = workspace(request, claims)
        query = (
            select(
                assets.c.id,
                assets.c.workspace_id,
                assets.c.size,
                assets.c.sha256,
                assets.c.format,
                assets.c.duration_s,
                assets.c.sample_rate,
                assets.c.channels,
                assets.c.created_at,
                upload_sessions.c.display_name,
            )
            .select_from(
                assets.outerjoin(
                    upload_sessions,
                    and_(
                        upload_sessions.c.id == assets.c.id,
                        upload_sessions.c.workspace_id == assets.c.workspace_id,
                    ),
                )
            )
            .where(
                assets.c.id == asset_id,
                assets.c.workspace_id == workspace_id,
                assets.c.deleted_at.is_(None),
            )
        )
        with transaction(engine, workspace_id) as conn:
            row = conn.execute(query).mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail={"code": "asset_not_found"})
        return {"asset": _asset_json(row)}

    @app.delete("/api/assets/{asset_id}")
    def delete_asset(
        asset_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        require_id(asset_id, {"code": "asset_not_found"})
        workspace_id = workspace(request, claims)
        with transaction(engine, workspace_id) as conn:
            try:
                result = tombstone(
                    conn,
                    workspace_id,
                    DeletionKind.SONG,
                    asset_id,
                    quota=_QuotaRelease(),
                )
            except LookupError:
                raise HTTPException(status_code=404, detail={"code": "asset_not_found"}) from None
            if result.created:
                # A deleted song leaves every crate of an organisation at once (BZ-0442-06).
                crates.tombstone_song(conn, workspace_id, asset_id, now=int(db_now(conn)))
        return {
            "id": asset_id,
            "deleted": True,
            "already_deleted": not result.created,
            "bytes_released": result.bytes_to_release,
            "physical_delete_after": result.deletion.physical_after,
        }

    @app.post("/api/assets/remove")
    def remove_from_cloud(
        body: RemoveRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Remove songs from the cloud library (`library.places`): every upload that is a cloud
        copy of each song goes, by the same delete as `DELETE /api/assets/{id}`, with the bytes
        given back in one go. Files on the member's devices are never touched. Says for each song
        how many copies went and whether it is now kept nowhere at all."""
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(WorkspaceAction.LIBRARY_WRITE):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        workspace_id = principal.workspace.id
        with transaction(engine, workspace_id) as conn:
            return remove_songs(conn, workspace_id, body.song_ids)


def remove_songs(conn: Connection, workspace_id: str, song_ids: list[int]) -> dict[str, Any]:
    """Tombstone every cloud copy of these songs and give their bytes back with one quota
    recount. A song that is not this workspace's answers `found: false`, as a missing one."""
    from selecta.local_media import places

    live = places.live_songs(conn, workspace_id, song_ids)
    copies = places.copy_ids(conn, workspace_id, live)
    released = 0
    first: str | None = None
    removed: dict[int, int] = {}
    now = int(db_now(conn))
    for song_id, asset_ids in copies.items():
        for asset_id in asset_ids:
            result = tombstone(conn, workspace_id, DeletionKind.SONG, asset_id)
            if not result.created:
                continue
            released += result.bytes_to_release
            first = first or result.deletion.id
            removed[song_id] = removed.get(song_id, 0) + 1
            # a deleted song leaves every crate of an organisation at once (BZ-0442-06)
            crates.tombstone_song(conn, workspace_id, asset_id, now=now)
    if released:
        quota.release_deleted(conn, workspace_id, released, ref=f"deletions:{len(removed)}:{first}")
    if removed:
        # every open page of the account reads its storage and its library again
        outbox.emit(conn, REMOVED_TOPIC, workspace_id, {"songs": len(removed)}, db_now(conn))
    nowhere = places.left_nowhere(conn, workspace_id, live)
    return {
        "songs": [
            {"id": song_id, "found": False} if song_id not in live else {
                "id": song_id, "found": True, "removed": removed.get(song_id, 0),
                "left_nowhere": song_id in nowhere,
            }
            for song_id in song_ids
        ],
        "bytes_released": released,
    }


__all__ = ["MAX_REMOVE", "REMOVED_TOPIC", "install_routes", "remove_songs"]
