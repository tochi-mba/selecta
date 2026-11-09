"""Tenant-scoped Cloud asset metadata and deletion routes."""

from __future__ import annotations

import base64
import binascii
import math
import re
from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from sqlalchemy import and_, or_, select
from sqlalchemy.engine import Connection, Engine

from selecta.identity.tokens import Claims
from selecta.persistence import transaction
from selecta.storage.deletion import DeletionKind, tombstone
from selecta.storage.schema import assets, upload_sessions
from selecta.usage import quota

_CURSOR_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_MAX_PAGE_SIZE = 100


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
        return {
            "id": asset_id,
            "deleted": True,
            "already_deleted": not result.created,
            "bytes_released": result.bytes_to_release,
            "physical_delete_after": result.deletion.physical_after,
        }


__all__ = ["install_routes"]
