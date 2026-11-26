"""Cloud upload routes over the tenant-scoped multipart upload protocol."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.engine import Connection, Engine

from selecta.admin import state as emergency_state
from selecta.billing import plans, stripe_sync
from selecta.business import terms, upload_rights
from selecta.business.content.store import record_upload_tag
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction
from selecta.storage import personal_rights, upload_identity, upload_preview
from selecta.storage.artifacts import Buckets
from selecta.storage.audio_check import Rejected
from selecta.storage.failures import storage_failure
from selecta.storage.ids import require_id
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
from selecta.storage.r2 import R2Client
from selecta.storage.sandbox import probe_in_sandbox
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
from selecta.usage import ledger, observability, quota

UPLOAD_NOT_FOUND = {"code": "upload_not_found"}
GENERIC_REJECTION = "The uploaded file could not be safely read as supported audio."


class UploadFileInput(BaseModel):
    name: str = Field(min_length=1, max_length=512)
    size: int = Field(gt=0)
    content_type: str | None = Field(default=None, max_length=127)
    sha256: str | None = Field(default=None, min_length=64, max_length=64)
    # The catalogue song this file is for and its audio id (`storage.upload_identity`); with
    # the flag off both are dropped unread.
    song_id: int | None = Field(default=None, gt=0)
    audio_id: str | None = Field(default=None, max_length=67)


def _file_spec(item: UploadFileInput) -> FileSpec:
    values = item.model_dump()
    if not upload_identity.on():
        values.pop("song_id")
        values.pop("audio_id")
    return FileSpec(**values)


class PlanUploadsRequest(BaseModel):
    files: list[UploadFileInput] = Field(max_length=500)
    # The business venue these files are for, when uploaded from a venue page (ADR-0448).
    venue_id: str | None = Field(default=None, max_length=36)


def _own_venue(conn, workspace_id: str, venue_id: str | None) -> str | None:
    """The venue when it is one of this workspace's, else None (never another tenant's)."""
    if not venue_id:
        return None
    from selecta.business.schema import venues

    found = conn.execute(select(venues.c.id).where(
        venues.c.workspace_id == workspace_id, venues.c.id == venue_id)).scalar()
    return found


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
        found = conn.execute(
            select(assets.c.id)
            .where(assets.c.workspace_id == workspace_id)
            .where(assets.c.sha256 == sha256)
            .where(assets.c.deleted_at.is_(None))
            .limit(1)
        ).scalar_one_or_none()
        if found is None and upload_identity.on():
            # the same song already uploaded under another of its file hashes
            found = upload_identity.cloud_copy_of_hash(conn, workspace_id, sha256)
        return found


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
        # only an upload that named its song (storage.upload_identity) says which
        **({"song_id": session.song_id} if session.song_id is not None else {}),
    }


def _planned_json(result: PlannedFile) -> dict[str, Any]:
    return {
        "index": result.index,
        "name": result.name,
        "refused": result.refused,
        "duplicate_of": result.duplicate_of,
        "same_as": result.same_as,
        "session": _session_json(result.session) if result.session else None,
        **({"refusal_code": result.refusal_code} if result.refusal_code else {}),
    }


def _probe_audio(path: Path) -> Probe:
    """Validate a staged upload in the sandbox (`storage.sandbox`): content sniffing, header
    caps, a full bounded decode, in a child process with hard limits. Raises `Rejected`."""
    return probe_in_sandbox(path)


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


DEPLOYED_ENVIRONMENTS = ("staging", "production")


def default_bucket(kind: str, environment: str | None = None) -> str:
    """The bucket OpenTofu creates for `kind` (`infra/cloudflare/main.tf`): `selecta-ENV-KIND` in
    a deployed environment (`SELECTA_ENV`), else the development stack's `sel-KIND`."""
    stage = (os.environ.get("SELECTA_ENV", "") if environment is None else environment)
    stage = stage.strip().lower()
    return f"selecta-{stage}-{kind}" if stage in DEPLOYED_ENVIRONMENTS else f"sel-{kind}"


def _bucket(kind: str) -> str:
    return (os.environ.get(f"SELECTA_R2_BUCKET_{kind.upper()}", "").strip()
            or default_bucket(kind))


def _buckets() -> Buckets:
    return Buckets(
        originals=_bucket("originals"),
        derived=_bucket("derived"),
        exports=_bucket("exports"),
        staging=_bucket("staging"),
    )


def r2_client() -> R2Client:
    """Create a configured R2 client for other Cloud storage route modules."""
    return _r2_client()


def buckets() -> Buckets:
    """Resolve the configured private R2 bucket names."""
    return _buckets()


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

    def uploader(request: Request, claims: Claims) -> str | None:
        """The uploading person, or None for a principal with no person (a service or test
        principal): the upload then records no uploader."""
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        return getattr(getattr(found, "user", None), "id", None)

    def refuse_if_restricted(workspace_id: str) -> None:
        """Staff suspended this workspace's uploads (the repeat-infringer policy, §12.3)."""
        with transaction(engine, workspace_id) as conn:
            restricted = emergency_state.uploads_restricted(conn, workspace_id)
        if restricted:
            raise HTTPException(
                status_code=403,
                detail={"code": "uploads_restricted",
                        "message": "Uploads are suspended for this account."},
            )

    def map_error(error: Exception) -> HTTPException:
        if isinstance(error, SessionNotFound):
            return HTTPException(status_code=404, detail=dict(UPLOAD_NOT_FOUND))
        if isinstance(error, (InvalidState, ValueError)):
            return HTTPException(
                status_code=400, detail={"code": "invalid_upload", "message": str(error)}
            )
        if isinstance(error, R2Error):
            return storage_failure(engine, error)
        return HTTPException(status_code=500, detail={"code": "upload_failed"})

    @app.post("/api/uploads/plan", status_code=201)
    def plan_uploads(
        body: PlanUploadsRequest,
        request: Request,
        claims: Claims = Depends(current_claims),
    ):
        workspace_id = workspace(request, claims)
        refuse_if_restricted(workspace_id)
        try:
            with transaction(engine, workspace_id) as conn:
                upload_rights.require_batch(conn, workspace_id,
                                            request.headers.get(upload_rights.HEADER),
                                            len(body.files))
                # cloud.move_to_cloud: a personal workspace agrees once first
                rights_needed = personal_rights.needed(conn, workspace_id)
        except upload_rights.AttestationRequired as error:
            raise HTTPException(status_code=403, detail={
                "code": error.code, "message": str(error),
                "statement": terms.UPLOAD_STATEMENT,
                "statement_version": terms.CURRENT_UPLOAD_STATEMENT_VERSION,
            }) from error
        if rights_needed:
            raise personal_rights.refusal()
        # Read before the plan's transaction: on SQLite a second one would wait on the first.
        uploaded_by = uploader(request, claims)
        try:
            with service() as (uploads, _client):
                with transaction(engine, workspace_id) as conn:
                    venue_id = _own_venue(conn, workspace_id, body.venue_id)
                    results = uploads.plan_batch(
                        conn,
                        workspace_id,
                        [_file_spec(item) for item in body.files],
                        uploaded_by=uploaded_by,
                        venue_id=venue_id,
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

    upload_preview.install(app, engine=engine, current_claims=current_claims,
                           workspace=workspace, refuse_if_restricted=refuse_if_restricted,
                           limits=_LimitsAdapter())
    # before GET /api/uploads/{session_id}, so `rights` is never read as an upload's id
    personal_rights.install(app, engine=engine, current_claims=current_claims,
                            principal_for=principal_for)

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
        require_id(session_id, UPLOAD_NOT_FOUND)
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
        require_id(session_id, UPLOAD_NOT_FOUND)
        workspace_id = workspace(request, claims)
        refuse_if_restricted(workspace_id)
        try:
            with service() as (uploads, _client):
                with transaction(engine, workspace_id) as conn:
                    session = uploads.get(conn, session_id, workspace_id=workspace_id)
                    if session.status.value == "planned":
                        session = uploads.start(conn, session_id, workspace_id=workspace_id)
                urls = uploads.presign_parts(session, body.part_numbers)
        except (SessionNotFound, InvalidState, R2Error, ValueError) as error:
            raise map_error(error) from error
        if urls:
            # These are authorizations for browser PUTs, not proof that R2 received a part.
            with transaction(engine, workspace_id) as conn:
                observability.observe(
                    conn, workspace_id, ledger.Kind.OBJECT_WRITE_AUTH_OPS, len(urls),
                    source="presigned_multipart_put_issued", ref=session_id,
                )
        return {"part_urls": {str(number): url for number, url in urls.items()}}

    @app.post("/api/uploads/{session_id}/complete")
    def complete_upload(
        session_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),
    ):
        require_id(session_id, UPLOAD_NOT_FOUND)
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
                    downloaded = client.get_object(
                        uploads.buckets.staging, session.staging_key, staged_path
                    )
                    with transaction(engine, workspace_id) as conn:
                        observability.observe(
                            conn, workspace_id, ledger.Kind.OBJECT_READ_OPS, 1,
                            source="server_staging_get_completed", ref=session_id,
                        )
                        observability.observe(
                            conn, workspace_id, ledger.Kind.OBJECT_READ_BYTES,
                            int(downloaded.size), source="server_staging_get_completed",
                            ref=session_id,
                        )
                    try:
                        audio_probe = probe(staged_path)
                    except Exception as error:
                        # A sandbox refusal carries its own code and words; anything else
                        # the probe raised is a generic refusal, never a 500.
                        rejected = isinstance(error, Rejected)
                        reason = str(error) if rejected else GENERIC_REJECTION
                        with transaction(engine, workspace_id) as conn:
                            outcome = uploads.reject(
                                conn, session_id, reason, workspace_id=workspace_id
                            )
                        code = error.code if rejected else "unreadable_audio"
                        return _outcome_json(outcome, rejection_code=code)
                    audio_id = upload_identity.audio_id_of(staged_path)
                    with transaction(engine, workspace_id) as conn:
                        outcome = uploads.accept(
                            conn,
                            session_id,
                            audio_probe,
                            workspace_id=workspace_id,
                            audio_id=audio_id,
                        )
                        if outcome.asset_id and audio_probe.explicit_tag:
                            record_upload_tag(
                                conn, workspace_id, outcome.asset_id, audio_probe.explicit_tag,
                                now=db_now(conn),
                            )
                        if outcome.asset_id and audio_probe.isrc_tag:
                            upload_rights.record_isrc(
                                conn, workspace_id, outcome.asset_id, audio_probe.isrc_tag,
                                actor=f"upload:{session_id}", now=db_now(conn),
                            )
        except (SessionNotFound, InvalidState, R2Error, ValueError) as error:
            raise map_error(error) from error
        if outcome.asset_id:
            _analyse_upload(workspace_id, outcome.asset_id)
        if outcome.error == upload_identity.MISMATCH_WORDS:
            return _outcome_json(outcome, rejection_code=upload_identity.MISMATCH)
        return _outcome_json(outcome)

    def _analyse_upload(workspace_id: str, asset_id: str) -> None:
        """Hosted processing starts at upload (`selecta.hosted_render`, cloud.hosted_render)."""
        from selecta import flags, hosted_render

        if not flags.on(hosted_render.FLAG):
            return
        if not hosted_work:
            from selecta.admin.state import DbWorkControls
            from selecta.business.weight import business_policy
            from selecta.work.cloud_ports import CloudJobEntitlements
            from selecta.work.store import JobStore

            hosted_work.append(hosted_render.Work(JobStore(
                engine, business_policy(), entitlements=CloudJobEntitlements(engine),
                controls=DbWorkControls())))
        hosted_render.on_upload_accepted(engine, hosted_work[0], workspace_id, asset_id)

    hosted_work: list = []

    @app.delete("/api/uploads/{session_id}")
    def cancel_upload(
        session_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),
    ):
        require_id(session_id, UPLOAD_NOT_FOUND)
        workspace_id = workspace(request, claims)
        try:
            with service() as (uploads, _client):
                with transaction(engine, workspace_id) as conn:
                    outcome = uploads.cancel(conn, session_id, workspace_id=workspace_id)
        except (SessionNotFound, InvalidState, R2Error, ValueError) as error:
            raise map_error(error) from error
        return _outcome_json(outcome)


def _outcome_json(outcome: Outcome, *, rejection_code: str | None = None) -> dict[str, Any]:
    answer = {
        "upload": _session_json(outcome.session),
        "asset_id": outcome.asset_id,
        "status": outcome.status.value,
        "error": outcome.error,
    }
    if rejection_code is not None and outcome.status.value == "rejected":
        answer["rejection_code"] = rejection_code
    return answer


__all__ = ["install_routes"]
