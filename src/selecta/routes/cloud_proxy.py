"""On-demand lossless playback preparation and tenant-scoped delivery."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.engine import Engine

from selecta.admin.state import DbWorkControls
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction
from selecta.scheduling.policy import Lane
from selecta.storage.artifacts import Buckets
from selecta.storage.ids import require_id
from selecta.storage.keys import Bucket, original_key, validate_key, workspace_of
from selecta.storage.objects import ObjectClient, R2Error, R2NotFound
from selecta.storage.schema import assets
from selecta.work import artifacts, proxies
from selecta.work.cloud_ports import CloudJobEntitlements
from selecta.work.enqueue import JobSpec
from selecta.work.model import TERMINAL
from selecta.work.schema import jobs
from selecta.work.store import JobStore


def install_routes(
    app: FastAPI, *, engine: Engine, current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any], object_client_factory: Callable[[], ObjectClient],
    buckets: Buckets,
) -> None:
    store = JobStore(
        engine, entitlements=CloudJobEntitlements(engine), controls=DbWorkControls()
    )

    def prepare(asset_id: str, request: Request, claims: Claims, *, submit: bool):
        require_id(asset_id, {"code": "asset_not_found"})
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        workspace_id = principal.workspace.id
        with transaction(engine, workspace_id) as conn:
            asset = conn.execute(select(assets).where(
                assets.c.id == asset_id, assets.c.workspace_id == workspace_id,
                assets.c.deleted_at.is_(None),
            )).mappings().first()
            if asset is None:
                raise HTTPException(404, detail={"code": "asset_not_found"})
            key = original_key(workspace_id, asset_id)
            if asset["original_key"] != key:
                raise HTTPException(503, detail={"code": "asset_integrity_unavailable"})
            source_hash, rate = asset["sha256"], asset["sample_rate"]
            if (not isinstance(source_hash, str)
                    or not re.fullmatch(r"[0-9a-f]{64}", source_hash)
                    or not isinstance(rate, int) or not 8000 <= rate <= 192000):
                raise HTTPException(409, detail={"code": "playback_metadata_unavailable"})
            # This is the worker's versioned PCM conversion identity. Before analysis exists,
            # use the original sample rate; a future analysis producer must pin its own rate.
            _, input_hash = proxies.identity(source_hash, rate)
            artifact = artifacts.find(conn, workspace_id, "playback", input_hash, db_now(conn))
            recent = conn.execute(select(jobs.c.id, jobs.c.state).where(
                jobs.c.workspace_id == workspace_id, jobs.c.type == "play.proxy",
                jobs.c.idempotency_key == input_hash,
            ).order_by(jobs.c.created_at.desc(), jobs.c.id.desc()).limit(1)).mappings().first()
        base = {"sample_rate": rate, "input_hash": input_hash}
        if artifact is not None:
            keys = artifact.keys if isinstance(artifact.keys, list) else [artifact.keys]
            if len(keys) != 1 or not isinstance(keys[0], str):
                raise HTTPException(503, detail={"code": "playback_integrity_unavailable"})
            output_key = keys[0]
            try:
                valid = (validate_key(output_key) is Bucket.DERIVED
                         and workspace_of(output_key) == workspace_id
                         and f"/playback/{input_hash}/attempts/" in output_key)
            except ValueError:
                valid = False
            if not valid:
                raise HTTPException(503, detail={"code": "playback_integrity_unavailable"})
            client = object_client_factory()
            try:
                head = client.head_object(buckets.derived, output_key)
                if head.size != artifact.size_bytes:
                    raise HTTPException(503, detail={"code": "playback_integrity_unavailable"})
                return {**base, "status": "ready", "expires_in": 300,
                        "url": client.presign_get(buckets.derived, output_key, 300)}
            except R2NotFound:
                pass  # Evicted derived files are regenerated on the next explicit request.
            except R2Error as error:
                raise HTTPException(
                    503, detail={"code": "storage_temporarily_unavailable"}
                ) from error
            finally:
                client.close()
        if not submit:
            if recent is None or recent["state"] == "succeeded":
                return {**base, "status": "not_requested"}
            return {**base, "status": recent["state"], "job_id": recent["id"]}
        if recent is not None and recent["state"] not in {str(state) for state in TERMINAL}:
            return {**base, "status": recent["state"], "job_id": recent["id"]}
        spec = JobSpec(
            workspace_id=workspace_id, type="play.proxy", idempotency_key=input_hash,
            lane=Lane.INTERACTIVE, created_by=principal.user.id,
            input_ref={"objects": [key], "source_sha256": source_hash, "sample_rate": rate,
                       "output": {"kind": "playback", "input_hash": input_hash}},
        )
        admission = store.admit(spec)
        if not admission.creates_job:
            raise HTTPException(429, detail={"code": "playback_capacity_unavailable"},
                                headers={"Retry-After": "10"})
        result = store.enqueue(spec)
        return {**base, "status": str(result.job.state), "job_id": result.job.id}

    @app.post("/api/assets/{asset_id}/playback-proxy")
    def request_proxy(asset_id: str, request: Request,
                      claims: Claims = Depends(current_claims)):  # noqa: B008
        return prepare(asset_id, request, claims, submit=True)

    @app.get("/api/assets/{asset_id}/playback-proxy")
    def proxy_status(asset_id: str, request: Request,
                     claims: Claims = Depends(current_claims)):  # noqa: B008
        return prepare(asset_id, request, claims, submit=False)
