"""Retired hosted-audio playback proxy endpoints.

Keep tombstone routes for older browsers. No job store, R2 credentials or signing
objects are instantiated, even if a client replays a previously valid request.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from sqlalchemy.engine import Engine

from selecta.identity.tokens import Claims
from selecta.storage.artifacts import Buckets
from selecta.storage.objects import ObjectClient


def install_routes(
    app: FastAPI, *, engine: Engine, current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any], object_client_factory: Callable[[], ObjectClient],
    buckets: Buckets,
) -> None:
    """Reject both creation and polling of obsolete Cloud PCM playback jobs."""

    def retired(request: Request, claims: Claims) -> None:
        principal_for(engine, claims, request.headers.get("x-workspace-id"))
        raise HTTPException(status_code=410, detail={"code": "cloud_audio_processing_retired"})

    @app.post("/api/assets/{asset_id}/playback-proxy")
    def request_proxy(asset_id: str, request: Request,
                      claims: Claims = Depends(current_claims)):
        return retired(request, claims)

    @app.get("/api/assets/{asset_id}/playback-proxy")
    def proxy_status(asset_id: str, request: Request,
                     claims: Claims = Depends(current_claims)):
        return retired(request, claims)
