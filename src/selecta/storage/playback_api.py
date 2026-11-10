"""Authenticated, short-lived Cloud GET URLs for workspace-owned audio objects."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import contextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.engine import Engine

from selecta.identity.tokens import Claims
from selecta.persistence import transaction
from selecta.storage.artifacts import DEFAULT_BUCKETS, MAX_URL_TTL, Buckets
from selecta.storage.ids import require_id
from selecta.storage.keys import Bucket, UnsafeKey, original_key, validate_key, workspace_of
from selecta.storage.objects import ObjectClient, R2Error, R2NotFound
from selecta.storage.schema import assets, upload_sessions

ASSET_NOT_FOUND = {"code": "asset_not_found"}
ARTIFACT_NOT_FOUND = {"code": "artifact_not_found"}


class DerivedUrlRequest(BaseModel):
    # Checked by the route, so a malformed key gets the same 404 as another account's key.
    key: str
    ttl: int = Field(default=300, ge=1, le=MAX_URL_TTL)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    object_client_factory: Callable[[], ObjectClient],
    buckets: Buckets = DEFAULT_BUCKETS,
) -> None:
    """Add signed delivery routes; the Cloud app supplies its configured R2 client factory.

    The API never accepts an arbitrary original key. It resolves an asset id in the caller's
    workspace and reconstructs the canonical key. Derived keys are accepted only when they are
    valid derived-layout keys in that same workspace.
    """

    @contextmanager
    def client_context():
        client = object_client_factory()
        try:
            yield client
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()

    def workspace(request: Request, claims: Claims) -> str:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        return principal.workspace.id

    def storage_error(error: R2Error) -> HTTPException:
        if isinstance(error, R2NotFound):
            return HTTPException(status_code=404, detail={"code": "storage_object_not_found"})
        return HTTPException(
            status_code=503, detail={"code": "storage_temporarily_unavailable"}
        )

    @app.get("/api/assets/{asset_id}/playback-url")
    def original_playback_url(
        asset_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        ttl: int = Query(default=300, ge=1, le=MAX_URL_TTL),
        download: bool = False,
    ) -> dict[str, Any]:
        require_id(asset_id, ASSET_NOT_FOUND)
        workspace_id = workspace(request, claims)
        query = (
            select(
                assets.c.id,
                assets.c.workspace_id,
                assets.c.original_key,
                assets.c.size,
                assets.c.sha256,
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
            asset = conn.execute(query).mappings().first()
        if asset is None:
            raise HTTPException(status_code=404, detail={"code": "asset_not_found"})

        # Never sign the database value blindly: reconstruct the only key this asset may own.
        try:
            canonical_key = original_key(workspace_id, asset_id)
            bucket = validate_key(canonical_key)
        except UnsafeKey:
            raise HTTPException(status_code=404, detail={"code": "asset_not_found"}) from None
        if (
            bucket is not Bucket.ORIGINALS
            or workspace_of(canonical_key) != workspace_id
            or asset.original_key != canonical_key
        ):
            raise HTTPException(status_code=404, detail={"code": "asset_not_found"})

        try:
            with client_context() as client:
                head = client.head_object(buckets.name(bucket), canonical_key)
                metadata = {name.lower(): value for name, value in head.metadata.items()}
                if (
                    head.size != int(asset.size)
                    or metadata.get("sha256", "").lower() != str(asset.sha256).lower()
                ):
                    raise HTTPException(
                        status_code=503, detail={"code": "asset_integrity_unavailable"}
                    )
                name = asset.display_name or "audio"
                url = client.presign_get(
                    buckets.name(bucket),
                    canonical_key,
                    ttl,
                    name if download else None,
                )
        except R2Error as error:
            raise storage_error(error) from error
        return {
            "url": url,
            "expires_in": ttl,
            "disposition": "attachment" if download else "inline",
        }

    @app.post("/api/storage/derived-playback-url")
    def derived_playback_url(
        body: DerivedUrlRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        try:
            bucket = validate_key(body.key)
        except UnsafeKey:
            # A malformed key looks exactly like a key that isn't the caller's.
            raise HTTPException(status_code=404, detail=ARTIFACT_NOT_FOUND) from None
        workspace_id = workspace(request, claims)
        if bucket is not Bucket.DERIVED or workspace_of(body.key) != workspace_id:
            # Don't reveal whether another tenant's key exists.
            raise HTTPException(status_code=404, detail=ARTIFACT_NOT_FOUND)
        try:
            with client_context() as client:
                client.head_object(buckets.name(bucket), body.key)
                url = client.presign_get(buckets.name(bucket), body.key, body.ttl)
        except R2Error as error:
            raise storage_error(error) from error
        return {"url": url, "expires_in": body.ttl, "disposition": "inline"}


__all__ = ["DerivedUrlRequest", "install_routes"]
