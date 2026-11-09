"""HTTP boundary for remote workers, backed by the fenced durable job store.

The gateway authenticates enrollment separately from worker traffic. Enrollment is protected by
an operator-issued bootstrap secret; the response is a short-lived JWT limited to one worker and
one pool. A worker never receives database credentials.
"""

from __future__ import annotations

import hmac
import time
from collections.abc import Callable
from dataclasses import asdict
from typing import Any

import jwt
import sqlalchemy as sa
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from selecta.persistence import new_id
from selecta.scheduling.policy import WorkerCaps
from selecta.work.catalogue import POOLS, lookup
from selecta.work.errors import CompletionRejected, JobCancelled, StaleLease
from selecta.work.model import Attempt, ErrorClass, Job
from selecta.work.ports import ArtifactOutput
from selecta.work.schema import workers
from selecta.work.store import JobStore

TOKEN_AUDIENCE = "selecta-workers"
MAX_TOKEN_TTL_S = 3600
MAX_DETAIL_CHARS = 5000
PUBLIC_POOLS = frozenset(pool for pool in POOLS if pool != "internal")


class WorkerRegistration(BaseModel):
    pool: str
    slots: int = Field(default=1, ge=1, le=32)
    engine_version: int | None = Field(default=None, ge=0)
    gpu_memory_mb: int = Field(default=0, ge=0, le=2_000_000)
    scratch_mb: int = Field(default=0, ge=0, le=2_000_000)
    worker_class: int = Field(default=0, ge=0, le=16)
    speed_factor: float = Field(default=1.0, gt=0, le=100)
    job_types: set[str] | None = None
    region: str | None = Field(default=None, max_length=64)


class AttemptRequest(BaseModel):
    fencing_token: int = Field(ge=1)


class ProgressRequest(AttemptRequest):
    done: float = Field(ge=0)
    total: float | None = Field(default=None, gt=0)


class ArtifactRequest(BaseModel):
    kind: str = Field(min_length=2, max_length=32, pattern="^[a-z][a-z0-9_]+$")
    input_hash: str = Field(pattern="^[0-9a-f]{64}$")
    keys: Any
    checksum: str | None = Field(default=None, max_length=128)
    size_bytes: int | None = Field(default=None, ge=0)
    provenance: dict[str, Any] | None = None
    protected: bool = False

    def as_output(self) -> ArtifactOutput:
        return ArtifactOutput(**self.model_dump())


class CompleteRequest(AttemptRequest):
    result: Any = None
    artifacts: list[ArtifactRequest] = Field(default_factory=list, max_length=100)
    cost_s: float | None = Field(default=None, ge=0)


class FailRequest(AttemptRequest):
    error_class: ErrorClass
    detail: str = Field(default="", max_length=MAX_DETAIL_CHARS)
    cost_s: float | None = Field(default=None, ge=0)


class OutputSlotsRequest(BaseModel):
    fencing_token: int = Field(ge=1)
    names: list[str] = Field(min_length=1, max_length=100)


def _job_payload(job: Job) -> dict[str, Any]:
    """Full worker-safe row so a remote runner can reconstruct the existing `Job` value."""
    return asdict(job)


def _safe_outputs(outputs: list[ArtifactRequest], workspace_id: str, attempt_id: str) -> None:
    """Refuse artifact keys outside this workspace and the attempt's own output prefix."""
    from selecta.storage.keys import Bucket, validate_key

    for output in outputs:
        keys = output.keys if isinstance(output.keys, list) else [output.keys]
        if not keys or any(not isinstance(key, str) for key in keys):
            raise HTTPException(status_code=422, detail={"code": "invalid_artifact_keys"})
        prefix = f"w/{workspace_id}/{output.kind}/{output.input_hash}/attempts/{attempt_id}/"
        for key in keys:
            try:
                bucket = validate_key(key)
            except ValueError as error:
                raise HTTPException(
                    status_code=422, detail={"code": "invalid_artifact_keys"}
                ) from error
            if bucket is not Bucket.DERIVED or not key.startswith(prefix):
                raise HTTPException(status_code=422, detail={"code": "invalid_artifact_keys"})


def install_routes(
    app: FastAPI,
    *,
    store: JobStore,
    token_secret: str,
    bootstrap_token: str,
    allowed_pools: frozenset[str] = PUBLIC_POOLS,
    max_slots: int = 8,
    token_ttl_s: int = 900,
    now: Callable[[], float] = time.time,
    sign_inputs: Callable[[Job], list[dict[str, str]]] | None = None,
    output_prefix_for: Callable[[Job, str], str | None] | None = None,
    sign_outputs: Callable[[Attempt, list[str]], list[dict[str, str]]] | None = None,
) -> None:
    """Install `/internal/workers/*` with a bootstrap enrollment route and scoped JWT auth."""
    if len(token_secret.encode()) < 32 or len(bootstrap_token.encode()) < 32:
        raise ValueError("Worker token and bootstrap secrets must each be at least 32 bytes.")
    if not 1 <= token_ttl_s <= MAX_TOKEN_TTL_S:
        raise ValueError(f"Worker tokens must live 1 to {MAX_TOKEN_TTL_S} seconds.")
    if not allowed_pools or not allowed_pools <= PUBLIC_POOLS:
        raise ValueError("Worker enrollment may allow only known, externally runnable pools.")

    def worker_claims(request: Request) -> dict[str, Any]:
        scheme, _, token = request.headers.get("authorization", "").partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            raise HTTPException(status_code=401, detail={"code": "worker_auth_required"})
        try:
            claims = jwt.decode(
                token.strip(),
                token_secret,
                algorithms=["HS256"],
                audience=TOKEN_AUDIENCE,
                options={"require": ["exp", "iat", "sub", "pool", "aud"]},
                leeway=5,
            )
        except jwt.PyJWTError as error:
            raise HTTPException(status_code=401, detail={"code": "invalid_worker_token"}) from error
        if claims.get("pool") not in allowed_pools or not isinstance(claims.get("sub"), str):
            raise HTTPException(status_code=401, detail={"code": "invalid_worker_token"})
        return claims

    def registered_caps(claims: dict[str, Any]) -> WorkerCaps:
        worker_id = claims["sub"]
        with store.engine.connect() as connection:
            row = connection.execute(
                sa.select(workers.c.pool, workers.c.capabilities).where(workers.c.id == worker_id)
            ).first()
        if row is None or row.pool != claims.get("pool"):
            raise HTTPException(status_code=401, detail={"code": "worker_not_registered"})
        capabilities = dict(row.capabilities or {})
        try:
            caps = WorkerCaps(
                pool=row.pool,
                engine_version=capabilities.get("engine_version"),
                gpu_memory_mb=int(capabilities.get("gpu_memory_mb", 0)),
                scratch_mb=int(capabilities.get("scratch_mb", 0)),
                worker_class=int(capabilities.get("worker_class", 0)),
                speed_factor=float(capabilities.get("speed_factor", 1.0)),
                slots=int(capabilities.get("slots", 1)),
                job_types=(
                    frozenset(capabilities["job_types"])
                    if capabilities.get("job_types") is not None
                    else None
                ),
                worker_id=worker_id,
                region=capabilities.get("region"),
            )
        except (TypeError, ValueError) as error:
            raise HTTPException(
                status_code=401, detail={"code": "worker_registration_invalid"}
            ) from error
        return caps

    def authorized_attempt(attempt_id: str, claims: dict[str, Any], token: int):
        attempt = store.attempt(attempt_id)
        if attempt is None or attempt.worker_id != claims["sub"] or attempt.pool != claims["pool"]:
            raise HTTPException(status_code=404, detail={"code": "attempt_not_found"})
        if attempt.fencing_token != token:
            raise HTTPException(status_code=409, detail={"code": "stale_lease"})
        return attempt

    def issue_worker_token(worker_id: str, pool: str) -> str:
        issued = int(now())
        return jwt.encode(
            {
                "sub": worker_id,
                "pool": pool,
                "aud": TOKEN_AUDIENCE,
                "iat": issued,
                "exp": issued + token_ttl_s,
            },
            token_secret,
            algorithm="HS256",
        )

    @app.post("/internal/workers/register", status_code=201)
    def register_worker(
        body: WorkerRegistration,
        authorization: str | None = Header(default=None),
    ):
        scheme, _, supplied = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not hmac.compare_digest(supplied, bootstrap_token):
            raise HTTPException(status_code=401, detail={"code": "worker_enrollment_required"})
        if body.pool not in allowed_pools or body.slots > max_slots:
            raise HTTPException(status_code=400, detail={"code": "worker_capability_not_allowed"})
        if body.job_types is not None:
            for job_type in body.job_types:
                try:
                    kind = lookup(job_type)
                except KeyError as error:
                    raise HTTPException(
                        status_code=400, detail={"code": "unknown_worker_job_type"}
                    ) from error
                if kind.pool != body.pool:
                    raise HTTPException(
                        status_code=400, detail={"code": "worker_job_type_pool_mismatch"}
                    )
        worker_id = f"worker-{new_id()}"
        caps = WorkerCaps(**body.model_dump(), worker_id=worker_id)
        try:
            store.register_worker(caps, worker_id=worker_id)
        except (TypeError, ValueError) as error:
            raise HTTPException(status_code=400, detail={"code": "invalid_worker_caps"}) from error
        token = issue_worker_token(worker_id, body.pool)
        return {"worker_id": worker_id, "token": token, "expires_in": token_ttl_s}

    @app.post("/internal/workers/refresh")
    def refresh_worker_token(claims: dict[str, Any] = Depends(worker_claims)):  # noqa: B008
        registered_caps(claims)
        return {
            "token": issue_worker_token(claims["sub"], claims["pool"]),
            "expires_in": token_ttl_s,
        }

    @app.post("/internal/workers/claim")
    def claim(claims: dict[str, Any] = Depends(worker_claims)):  # noqa: B008
        caps = registered_caps(claims)
        store.touch_worker(caps.worker_id)
        claimed = store.claim(caps.pool, caps)
        if claimed is None:
            return {"claim": None}
        try:
            job = store.start(claimed.attempt_id, claimed.fencing_token)
        except StaleLease as error:
            raise HTTPException(status_code=409, detail={"code": "stale_lease"}) from error
        return {
            "claim": {
                "attempt_id": claimed.attempt_id,
                "fencing_token": claimed.fencing_token,
                "lease_expires_at": claimed.lease_expires_at,
                "boosted": claimed.boosted,
                "job": _job_payload(job),
                "input_urls": sign_inputs(job) if sign_inputs else [],
                "output_prefix": output_prefix_for(job, claimed.attempt_id)
                if output_prefix_for
                else None,
            }
        }

    @app.post("/internal/workers/attempts/{attempt_id}/outputs")
    def output_slots(
        attempt_id: str,
        body: OutputSlotsRequest,
        claims: dict[str, Any] = Depends(worker_claims),  # noqa: B008
    ):
        attempt = authorized_attempt(attempt_id, claims, body.fencing_token)
        if sign_outputs is None:
            raise HTTPException(status_code=503, detail={"code": "worker_outputs_unavailable"})
        try:
            result = sign_outputs(attempt, body.names)
        except (TypeError, ValueError) as error:
            raise HTTPException(status_code=422, detail={"code": "invalid_output_slots"}) from error
        return {"outputs": result}

    @app.post("/internal/workers/attempts/{attempt_id}/heartbeat")
    def heartbeat(
        attempt_id: str,
        body: AttemptRequest,
        claims: dict[str, Any] = Depends(worker_claims),  # noqa: B008
    ):
        authorized_attempt(attempt_id, claims, body.fencing_token)
        try:
            state = store.heartbeat(attempt_id, body.fencing_token)
            store.touch_worker(claims["sub"])
        except StaleLease as error:
            raise HTTPException(status_code=409, detail={"code": "stale_lease"}) from error
        return asdict(state)

    @app.post("/internal/workers/attempts/{attempt_id}/release")
    def release(
        attempt_id: str,
        body: AttemptRequest,
        claims: dict[str, Any] = Depends(worker_claims),  # noqa: B008
    ):
        authorized_attempt(attempt_id, claims, body.fencing_token)
        try:
            job = store.release(attempt_id, body.fencing_token)
        except StaleLease as error:
            raise HTTPException(status_code=409, detail={"code": "stale_lease"}) from error
        return {"job_id": job.id, "state": str(job.state)}

    @app.post("/internal/workers/attempts/{attempt_id}/progress", status_code=204)
    def progress(
        attempt_id: str,
        body: ProgressRequest,
        claims: dict[str, Any] = Depends(worker_claims),  # noqa: B008
    ):
        authorized_attempt(attempt_id, claims, body.fencing_token)
        try:
            store.progress(attempt_id, body.fencing_token, body.done, body.total)
        except StaleLease as error:
            raise HTTPException(status_code=409, detail={"code": "stale_lease"}) from error

    @app.post("/internal/workers/attempts/{attempt_id}/complete")
    def complete(
        attempt_id: str,
        body: CompleteRequest,
        claims: dict[str, Any] = Depends(worker_claims),  # noqa: B008
    ):
        attempt = authorized_attempt(attempt_id, claims, body.fencing_token)
        _safe_outputs(body.artifacts, attempt.workspace_id, attempt_id)
        try:
            job = store.complete(
                attempt_id,
                body.fencing_token,
                result=body.result,
                artifacts=[item.as_output() for item in body.artifacts],
                cost_s=body.cost_s,
            )
        except (StaleLease, JobCancelled) as error:
            raise HTTPException(status_code=409, detail={"code": "stale_lease"}) from error
        except CompletionRejected as error:
            raise HTTPException(
                status_code=422,
                detail={"code": "completion_rejected", "error_class": error.error_class},
            ) from error
        except ValueError as error:
            raise HTTPException(status_code=413, detail={"code": "result_too_large"}) from error
        return {"job_id": job.id, "state": str(job.state)}

    @app.post("/internal/workers/attempts/{attempt_id}/fail")
    def fail(
        attempt_id: str,
        body: FailRequest,
        claims: dict[str, Any] = Depends(worker_claims),  # noqa: B008
    ):
        authorized_attempt(attempt_id, claims, body.fencing_token)
        try:
            job = store.fail(
                attempt_id,
                body.fencing_token,
                body.error_class,
                body.detail,
                body.cost_s,
            )
        except StaleLease as error:
            raise HTTPException(status_code=409, detail={"code": "stale_lease"}) from error
        return {"job_id": job.id, "state": str(job.state)}


__all__ = ["install_routes"]
