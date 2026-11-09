"""Cloud upload routes over the tenant-scoped multipart upload protocol."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import mutagen
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.engine import Connection, Engine

from selecta.billing import plans, stripe_sync
from selecta.identity.tokens import Claims
from selecta.persistence import transaction
from selecta.storage.artifacts import Buckets
from selecta.storage.objects import ObjectClient, R2Error
from selecta.storage.ports import (
    DuplicatePort,
    PlanLimits,
    PlanLimitsPort,
    QuotaPort,
)
from selecta.storage.ports import (
    QuotaExceeded as UploadQuotaExceeded,
)
from selecta.storage.r2 import R2Client, file_sha256
from selecta.storage.schema import assets, upload_sessions
from selecta.storage.uploads import (
    BatchTooLarge,
    FileSpec,
    InvalidState,
    Outcome,
    PlannedFile,
    Probe,
    SessionNotFound,
    Uploads,
    UploadSession,
)
from selecta.usage import quota


class UploadFileInput(BaseModel):
    name: str = Field(min_length=1, max_length=512)
    size: int = Field(gt=0)
    content_type: str | None = Field(default=None, max_length=127)
    sha256: str | None = Field(default=None, min_length=64, max_length=64)


class PlanUploadsRequest(BaseModel):
    files: list[UploadFileInput] = Field(max_length=500)


class PartsRequest(BaseModel):
    part_numbers: list[int] = Field(min_length=1, max_length=100)


class _QuotaAdapter(QuotaPort):
    def reserve(self, conn: Connection, workspace_id: str, size: int, session_id: str) -> str:
        try:
            return quota.reserve(conn, workspace_id, size, session_id).id
        except quota.QuotaExceeded as error:
            raise UploadQuotaExceeded(
                workspace_id, size, error.usage.available_bytes, str(error)
            ) from error

    def commit(self, conn: Connection, reservation_id: str) -> None:
        quota.commit(conn, reservation_id)

    def release(self, conn: Connection, reservation_id: str) -> None:
        quota.release(conn, reservation_id)


class _LimitsAdapter(PlanLimitsPort):
    def limits(self, conn: Connection, workspace_id: str) -> PlanLimits:
        entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
        plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
        return PlanLimits(plan.max_upload_bytes, float(plan.max_upload_seconds))


class _DuplicateAdapter(DuplicatePort):
    def find_by_sha256(self, conn: Connection, workspace_id: str, sha256: str) -> str | None:
        return conn.execute(
            select(assets.c.id)
            .where(assets.c.workspace_id == workspace_id)
            .where(assets.c.sha256 == sha256)
            .where(assets.c.deleted_at.is_(None))
            .limit(1)
        ).scalar_one_or_none()


def _session_json(session: UploadSession) -> dict[str, Any]:
    return {
        "id": session.id,
        "name": session.display_name,
        "size": session.declared_size,
        "content_type": session.content_type,
        "sha256": session.sha256,
        "part_size": session.part_size,
        "part_count": session.part_count,
        "status": session.status.value,
        "expires_at": session.expires_at,
        "duplicate_of": session.duplicate_of,
        "error": session.error,
    }


def _planned_json(result: PlannedFile) -> dict[str, Any]:
    return {
        "index": result.index,
        "name": result.name,
        "refused": result.refused,
        "duplicate_of": result.duplicate_of,
        "same_as": result.same_as,
        "session": _session_json(result.session) if result.session else None,
    }


def _probe_audio(path: Path) -> Probe:
    """Read a bounded metadata probe and a content hash; tags and extensions are not trusted."""
    actual_size, digest = file_sha256(path)
    audio = mutagen.File(path, easy=True)
    if audio is None or audio.info is None:
        raise ValueError("This file isn't a supported audio format.")
    info = audio.info
    mime_values = getattr(audio, "mime", ()) or ()
    mime = str(mime_values[0]).lower() if mime_values else ""
    formats = {
        "audio/mpeg": "mp3",
        "audio/flac": "flac",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/aiff": "aiff",
        "audio/x-aiff": "aiff",
        "audio/mp4": "m4a",
        "audio/aac": "aac",
        "audio/ogg": "ogg",
    }
    audio_format = formats.get(mime)
    if audio_format is None:
        raise ValueError("This file's audio format isn't supported for Cloud uploads.")
    duration = float(getattr(info, "length", 0.0) or 0.0)
    sample_rate = int(getattr(info, "sample_rate", 0) or 0)
    channels = int(getattr(info, "channels", 0) or 0)
    return Probe(audio_format, duration, sample_rate, channels, digest, actual_size)


def _r2_client() -> R2Client:
    account_id = os.environ.get("SELECTA_R2_ACCOUNT_ID", "").strip()
    access_key = os.environ.get("SELECTA_R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("SELECTA_R2_SECRET_ACCESS_KEY", "").strip()
    if not all((account_id, access_key, secret_key)):
        raise HTTPException(status_code=503, detail={"code": "storage_not_configured"})
    from selecta.storage.sigv4 import Credentials

    jurisdiction = os.environ.get("SELECTA_R2_JURISDICTION", "eu").strip().lower()
    return R2Client(
        account_id,
        Credentials(access_key, secret_key),
        jurisdiction=None if jurisdiction == "default" else jurisdiction,
    )


def _buckets() -> Buckets:
    return Buckets(
        originals=os.environ.get("SELECTA_R2_BUCKET_ORIGINALS", "sel-originals"),
        derived=os.environ.get("SELECTA_R2_BUCKET_DERIVED", "sel-derived"),
        exports=os.environ.get("SELECTA_R2_BUCKET_EXPORTS", "sel-exports"),
        staging=os.environ.get("SELECTA_R2_BUCKET_STAGING", "sel-staging"),
    )


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    object_client_factory: Callable[[], ObjectClient] = _r2_client,
    probe: Callable[[Path], Probe] = _probe_audio,
) -> None:
    """Add Cloud upload endpoints. Every session lookup and write is scoped to the principal."""

    @contextmanager
    def service():
        client = object_client_factory()
        try:
            yield (
                Uploads(
                    client,
                    quota=_QuotaAdapter(),
                    limits=_LimitsAdapter(),
                    duplicates=_DuplicateAdapter(),
                    buckets=_buckets(),
                ),
                client,
            )
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()

    def workspace(request: Request, claims: Claims):
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        return principal.workspace.id

    def map_error(error: Exception) -> HTTPException:
        if isinstance(error, SessionNotFound):
            return HTTPException(status_code=404, detail={"code": "upload_not_found"})
        if isinstance(error, (InvalidState, ValueError)):
            return HTTPException(
                status_code=400, detail={"code": "invalid_upload", "message": str(error)}
            )
        if isinstance(error, R2Error):
            return HTTPException(
                status_code=503, detail={"code": "storage_temporarily_unavailable"}
            )
        return HTTPException(status_code=500, detail={"code": "upload_failed"})

    @app.post("/api/uploads/plan", status_code=201)
    def plan_uploads(
        body: PlanUploadsRequest,
        request: Request,
        claims: Claims = Depends(current_claims),
    ):
        workspace_id = workspace(request, claims)
        try:
            with service() as (uploads, _client):
                with transaction(engine, workspace_id) as conn:
                    results = uploads.plan_batch(
                        conn,
                        workspace_id,
                        [FileSpec(**item.model_dump()) for item in body.files],
                    )
        except BatchTooLarge as error:
            raise HTTPException(status_code=422, detail={"code": "batch_too_large"}) from error
        except UploadQuotaExceeded as error:
            raise HTTPException(
                status_code=413,
                detail={"code": "storage_quota_exceeded", "message": str(error)},
            ) from error
        except (R2Error, ValueError) as error:
            raise map_error(error) from error
        return {"uploads": [_planned_json(item) for item in results]}

    @app.get("/api/uploads")
    def list_uploads(
        request: Request,
        claims: Claims = Depends(current_claims),
    ):
        workspace_id = workspace(request, claims)
        with transaction(engine, workspace_id) as conn:
            rows = conn.execute(
                select(upload_sessions)
                .where(upload_sessions.c.workspace_id == workspace_id)
                .order_by(upload_sessions.c.created_at.desc())
                .limit(500)
            ).mappings()
            sessions = [UploadSession.from_row(row) for row in rows]
        return {"uploads": [_session_json(item) for item in sessions]}

    @app.get("/api/uploads/{session_id}")
    def get_upload(
        session_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),
    ):
        workspace_id = workspace(request, claims)
        try:
            with service() as (uploads, _client):
                with transaction(engine, workspace_id) as conn:
                    session = uploads.get(conn, session_id, workspace_id=workspace_id)
                    if session.status.value == "planned":
                        session = uploads.start(conn, session_id, workspace_id=workspace_id)
                parts = uploads.uploaded_parts(session)
        except (SessionNotFound, InvalidState, R2Error, ValueError) as error:
            raise map_error(error) from error
        return {
            "upload": _session_json(session),
            "uploaded_parts": [
                {"number": part.number, "etag": part.etag, "size": part.size} for part in parts
            ],
        }

    @app.post("/api/uploads/{session_id}/parts")
    def presign_parts(
        session_id: str,
        body: PartsRequest,
        request: Request,
        claims: Claims = Depends(current_claims),
    ):
        workspace_id = workspace(request, claims)
        try:
            with service() as (uploads, _client):
                with transaction(engine, workspace_id) as conn:
                    session = uploads.get(conn, session_id, workspace_id=workspace_id)
                    if session.status.value == "planned":
                        session = uploads.start(conn, session_id, workspace_id=workspace_id)
                urls = uploads.presign_parts(session, body.part_numbers)
        except (SessionNotFound, InvalidState, R2Error, ValueError) as error:
            raise map_error(error) from error
        return {"part_urls": {str(number): url for number, url in urls.items()}}

    @app.post("/api/uploads/{session_id}/complete")
    def complete_upload(
        session_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),
    ):
        workspace_id = workspace(request, claims)
        try:
            with service() as (uploads, client):
                with transaction(engine, workspace_id) as conn:
                    outcome = uploads.complete(conn, session_id, workspace_id=workspace_id)
                    if outcome.status.value != "completed":
                        return _outcome_json(outcome)
                    session = outcome.session
                with tempfile.TemporaryDirectory(prefix="selecta-upload-") as temporary:
                    staged_path = Path(temporary) / "source.audio"
                    client.get_object(uploads.buckets.staging, session.staging_key, staged_path)
                    try:
                        audio_probe = probe(staged_path)
                    except Exception:
                        with transaction(engine, workspace_id) as conn:
                            outcome = uploads.reject(
                                conn,
                                session_id,
                                "The uploaded file could not be safely read as supported audio.",
                                workspace_id=workspace_id,
                            )
                        return _outcome_json(outcome)
                    with transaction(engine, workspace_id) as conn:
                        outcome = uploads.accept(
                            conn,
                            session_id,
                            audio_probe,
                            workspace_id=workspace_id,
                        )
        except (SessionNotFound, InvalidState, R2Error, ValueError) as error:
            raise map_error(error) from error
        return _outcome_json(outcome)

    @app.delete("/api/uploads/{session_id}")
    def cancel_upload(
        session_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),
    ):
        workspace_id = workspace(request, claims)
        try:
            with service() as (uploads, _client):
                with transaction(engine, workspace_id) as conn:
                    outcome = uploads.cancel(conn, session_id, workspace_id=workspace_id)
        except (SessionNotFound, InvalidState, R2Error, ValueError) as error:
            raise map_error(error) from error
        return _outcome_json(outcome)


def _outcome_json(outcome: Outcome) -> dict[str, Any]:
    return {
        "upload": _session_json(outcome.session),
        "asset_id": outcome.asset_id,
        "status": outcome.status.value,
        "error": outcome.error,
    }


__all__ = ["install_routes"]
