"""Retired Cloud media signing routes.

Both original and derived media retrieval return an authenticated 410. Legacy
URLs already issued externally expire separately; no new URL is signed here.
"""
from __future__ import annotations
from collections.abc import Callable
from typing import Any
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine
from selecta.identity.tokens import Claims
from selecta.storage.artifacts import DEFAULT_BUCKETS, MAX_URL_TTL, Buckets
from selecta.storage.objects import ObjectClient


class DerivedUrlRequest(BaseModel):
    key: str
    ttl: int = Field(default=300, ge=1, le=MAX_URL_TTL)


def install_routes(
    app: FastAPI, *, engine: Engine, current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any], object_client_factory: Callable[[], ObjectClient],
    buckets: Buckets = DEFAULT_BUCKETS,
) -> None:
    def retired(request: Request, claims: Claims) -> None:
        principal_for(engine, claims, request.headers.get("x-workspace-id"))
        raise HTTPException(status_code=410, detail={"code": "cloud_audio_retrieval_retired"})

    @app.get("/api/assets/{asset_id}/playback-url")
    def original_playback_url(
        asset_id: str, request: Request, claims: Claims = Depends(current_claims),
        ttl: int = 300, download: bool = False,
    ):
        return retired(request, claims)

    @app.post("/api/storage/derived-playback-url")
    def derived_playback_url(
        body: DerivedUrlRequest, request: Request,
        claims: Claims = Depends(current_claims),
    ):
        return retired(request, claims)


__all__ = ["DerivedUrlRequest", "install_routes"]
