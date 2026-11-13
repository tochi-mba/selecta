"""Authenticated account data archive for Selecta Cloud.

The ZIP holds every original (checked against its stored size and SHA-256), `settings.json` (the
account, workspace, plan, feature opt-outs, Lucy choices and signed-in devices), `assets.json`,
`mixes.json` and a manifest. Cloud doesn't store mix revisions yet, so `mixes.json` says so and
carries what Cloud does keep about mixes: the workspace's playback session.
"""

from __future__ import annotations

import json
import re
import shutil
import tempfile
import zipfile
from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import and_, select
from sqlalchemy.engine import Engine
from starlette.background import BackgroundTask

from selecta.billing import plans, stripe_sync
from selecta.flags.rules import user_flag_preferences
from selecta.identity.tokens import Claims
from selecta.lucy import cloud_settings as lucy_cloud
from selecta.persistence import transaction
from selecta.playback.schema import devices, playback_sessions
from selecta.storage.artifacts import DEFAULT_BUCKETS, Buckets
from selecta.storage.keys import Bucket, original_key
from selecta.storage.objects import ObjectClient, R2Error
from selecta.storage.schema import assets, upload_sessions

MIXES_UNAVAILABLE = "Cloud mix revisions are not yet stored by this application version."


def _safe_filename(name: str) -> str:
    leaf = name.replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._ -]", "_", leaf).strip(" .")[:180]
    return cleaned or "audio"


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    object_client_factory: Callable[[], ObjectClient],
    buckets: Buckets = DEFAULT_BUCKETS,
) -> None:
    """Install a personal-workspace export with integrity-checked original audio files."""

    @app.get("/api/account/export")
    def export_account(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> FileResponse:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        workspace = principal.workspace
        if workspace.kind != "personal" or workspace.owner_user_id != principal.user.id:
            raise HTTPException(status_code=403, detail={"code": "personal_workspace_required"})

        query = (
            select(
                assets.c.id,
                assets.c.original_key,
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
                assets.c.workspace_id == workspace.id,
                assets.c.deleted_at.is_(None),
            )
            .order_by(assets.c.created_at, assets.c.id)
        )
        with transaction(engine, workspace.id) as conn:
            rows = [dict(row) for row in conn.execute(query).mappings().all()]
            preferences = [
                dict(row)
                for row in conn.execute(
                    select(
                        user_flag_preferences.c.flag_id,
                        user_flag_preferences.c.enabled,
                        user_flag_preferences.c.updated_at,
                    ).where(user_flag_preferences.c.user_id == principal.user.id)
                )
                .mappings()
                .all()
                if not str(row["flag_id"]).startswith(lucy_cloud.PREFIX)
            ]
            lucy_choices = lucy_cloud.choices(conn, principal.user.id)
            entitlement = stripe_sync.effective_entitlement(conn, workspace.id)
            plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
            device_rows = [
                dict(row)
                for row in conn.execute(
                    select(
                        devices.c.id,
                        devices.c.name,
                        devices.c.kind,
                        devices.c.created_at,
                        devices.c.last_seen_at,
                        devices.c.signed_out_at,
                    )
                    .where(devices.c.workspace_id == workspace.id)
                    .order_by(devices.c.created_at, devices.c.id)
                )
                .mappings()
                .all()
            ]
            session = (
                conn.execute(
                    select(
                        playback_sessions.c.mix_revision_id,
                        playback_sessions.c.song_index,
                        playback_sessions.c.offset_ms,
                        playback_sessions.c.state,
                        playback_sessions.c.updated_at,
                    ).where(playback_sessions.c.workspace_id == workspace.id)
                )
                .mappings()
                .first()
            )

        temp_dir = Path(tempfile.mkdtemp(prefix="selecta-account-export-"))
        archive_path = temp_dir / "selectadj-account-export.zip"
        exported_assets: list[dict[str, Any]] = []

        @contextmanager
        def object_client():
            client = object_client_factory()
            try:
                yield client
            finally:
                close = getattr(client, "close", None)
                if callable(close):
                    close()

        try:
            with zipfile.ZipFile(
                archive_path, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True
            ) as archive:
                for row in rows:
                    asset_id = str(row["id"])
                    canonical_key = original_key(workspace.id, asset_id)
                    if row["original_key"] != canonical_key:
                        raise HTTPException(
                            status_code=503, detail={"code": "asset_integrity_unavailable"}
                        )
                    bucket = buckets.name(Bucket.ORIGINALS)
                    local_path = temp_dir / f"{asset_id}.original"
                    try:
                        with object_client() as client:
                            head = client.head_object(bucket, canonical_key)
                            metadata = {key.lower(): value for key, value in head.metadata.items()}
                            if (
                                head.size != int(row["size"])
                                or metadata.get("sha256", "").lower() != str(row["sha256"]).lower()
                            ):
                                raise HTTPException(
                                    status_code=503,
                                    detail={"code": "asset_integrity_unavailable"},
                                )
                            downloaded = client.get_object(bucket, canonical_key, local_path)
                    except R2Error as error:
                        raise HTTPException(
                            status_code=503,
                            detail={
                                "code": "asset_export_unavailable",
                                "retryable": error.retryable,
                            },
                        ) from error
                    if (
                        downloaded.size != int(row["size"])
                        or downloaded.sha256.lower() != str(row["sha256"]).lower()
                    ):
                        raise HTTPException(
                            status_code=503, detail={"code": "asset_integrity_unavailable"}
                        )

                    archive_name = (
                        f"originals/{asset_id}-{_safe_filename(row['display_name'] or 'audio')}"
                    )
                    archive.write(local_path, archive_name)
                    local_path.unlink(missing_ok=True)
                    exported_assets.append(
                        {
                            "id": asset_id,
                            "file": archive_name,
                            "size": int(row["size"]),
                            "sha256": row["sha256"],
                            "format": row["format"],
                            "duration_seconds": row["duration_s"],
                            "sample_rate": row["sample_rate"],
                            "channels": row["channels"],
                            "created_at": row["created_at"],
                        }
                    )

                settings = {
                    "schema_version": 1,
                    "account": {
                        "email": principal.user.email,
                        "email_verified": principal.user.email_verified,
                        "timezone": principal.user.timezone,
                        "age_confirmed": principal.user.age_confirmed,
                        "created_at": principal.user.created_at,
                    },
                    "workspace": {
                        "id": workspace.id,
                        "name": workspace.name,
                        "kind": workspace.kind,
                        "created_at": workspace.created_at,
                    },
                    "plan": {
                        "id": plan.id,
                        "version": plan.version,
                        "label": plan.label,
                        "source": entitlement.source,
                    },
                    "feature_preferences": preferences,
                    "lucy": lucy_choices,
                    "devices": device_rows,
                }
                mixes = {
                    "available": False,
                    "reason": MIXES_UNAVAILABLE,
                    "mixes": [],
                    # What was last playing, so the export holds every mix fact Cloud keeps.
                    "playback_session": dict(session) if session else None,
                }
                manifest = {
                    "schema_version": 1,
                    "workspace_id": workspace.id,
                    "asset_count": len(exported_assets),
                    "originals": "included and SHA-256 verified",
                    "settings": "included in settings.json",
                    "mixes": {
                        "available": False,
                        "reason": MIXES_UNAVAILABLE,
                        "playback_session": "included in mixes.json",
                    },
                }
                archive.writestr("manifest.json", json.dumps(manifest, indent=2))
                archive.writestr("settings.json", json.dumps(settings, indent=2))
                archive.writestr("assets.json", json.dumps(exported_assets, indent=2))
                archive.writestr("mixes.json", json.dumps(mixes, indent=2, default=str))
        except Exception:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise

        return FileResponse(
            archive_path,
            media_type="application/zip",
            filename="selectadj-account-export.zip",
            background=BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True),
        )


__all__ = ["install_routes"]
