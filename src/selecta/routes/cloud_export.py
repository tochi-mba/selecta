"""Metadata-only personal account data export for browser-first Selecta Cloud.

Archive settings, billing and safe historical recipe references; never fetch,
download, sign or package original music, stems, renders or source paths.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import and_, select
from sqlalchemy.engine import Engine
from starlette.background import BackgroundTask

from selecta.billing import plans, stripe_sync
from selecta.billing.schema import entitlement_snapshots, subscriptions
from selecta.flags.rules import user_flag_preferences
from selecta.identity.tokens import Claims
from selecta.lf_migration.retrieval import RetrievalGrant
from selecta.lucy import cloud_settings as lucy_cloud
from selecta.persistence import transaction
from selecta.playback.schema import devices, playback_sessions
from selecta.storage.artifacts import DEFAULT_BUCKETS, Buckets
from selecta.storage.objects import ObjectClient
from selecta.storage.schema import assets, upload_sessions
from selecta.work.schema import artifacts


# Historical recipe provenance is untrusted: never forward arbitrary JSON
# settings, diagnostic payloads, source paths, raw hashes or embedded audio.
_RECIPE_FIELDS = frozenset({
    "recipe_id", "revision_id", "parent_revision_id", "recording_ref",
    "occurrences", "occurrence_id", "position", "cue_in_ms", "cue_out_ms",
    "transition_ms", "transition_kind", "title", "artist", "status",
    "bpm", "key", "confidence", "notes",
})


def _recipe_metadata(value: Any, *, depth: int = 0) -> dict[str, Any] | None:
    import math
    from selecta.lf_egress.contract import PayloadRejected, _check_text

    if not isinstance(value, dict) or depth > 5:
        return None
    clean: dict[str, Any] = {}
    for key, item in value.items():
        if key not in _RECIPE_FIELDS:
            continue
        if key == "occurrences":
            if not isinstance(item, list) or len(item) > 128:
                continue
            clean[key] = [
                candidate for entry in item
                if (candidate := _recipe_metadata(entry, depth=depth + 1))
            ]
        elif isinstance(item, str):
            try:
                _check_text(item)
            except PayloadRejected:
                continue
            clean[key] = item
        elif isinstance(item, (int, float)) and not isinstance(item, bool):
            if math.isfinite(item) and abs(item) <= 10**15:
                clean[key] = item
    return clean



def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    object_client_factory: Callable[[], ObjectClient],
    buckets: Buckets = DEFAULT_BUCKETS,
    legacy_retrieval_grant_factory: Callable[[str], RetrievalGrant | None] | None = None,
) -> None:
    """Install a personal-workspace export with integrity-checked original audio files."""

    @app.get("/api/account/export")
    def export_account(
        request: Request,
        mode: str = "metadata",
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> FileResponse:
        if mode != "metadata":
            raise HTTPException(status_code=410, detail={"code": "cloud_audio_export_retired"})
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        workspace = principal.workspace
        if workspace.kind != "personal" or workspace.owner_user_id != principal.user.id:
            raise HTTPException(status_code=403, detail={"code": "personal_workspace_required"})

        query = (
            select(
                assets.c.id,
                assets.c.size,
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
            billing_rows = [
                {"id": item["id"], "status": item["status"],
                 "price_id": item["price_id"],
                 "current_period_end": item["current_period_end"]}
                for item in conn.execute(
                    select(subscriptions.c.id, subscriptions.c.status,
                           subscriptions.c.price_id, subscriptions.c.current_period_end)
                    .where(subscriptions.c.workspace_id == workspace.id)
                ).mappings()
            ]
            plan_history = [
                dict(item)
                for item in conn.execute(
                    select(entitlement_snapshots.c.version, entitlement_snapshots.c.plan_id,
                           entitlement_snapshots.c.plan_version, entitlement_snapshots.c.source,
                           entitlement_snapshots.c.reason, entitlement_snapshots.c.computed_at)
                    .where(entitlement_snapshots.c.workspace_id == workspace.id)
                    .order_by(entitlement_snapshots.c.version)
                ).mappings()
            ]
            revision_rows = [
                dict(row)
                for row in conn.execute(
                    select(artifacts.c.id, artifacts.c.input_hash, artifacts.c.protected,
                           artifacts.c.provenance, artifacts.c.created_at)
                    .where(artifacts.c.workspace_id == workspace.id,
                           artifacts.c.kind == "mix_revision")
                    .order_by(artifacts.c.created_at, artifacts.c.input_hash)
                ).mappings()
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

        try:
            with zipfile.ZipFile(
                archive_path, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True
            ) as archive:
                # Historical metadata only; no R2 original retrieval or audio in archives.
                for row in rows:
                    asset_id = str(row["id"])
                    exported_assets.append({
                        "id": asset_id,
                        "legacy_asset_id": asset_id,
                        "format": row["format"],
                        "size": int(row["size"]),
                        "created_at": row["created_at"],
                        "status": "historical_cloud_reference",
                        "local_original_included": False,
                    })
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
                preserved: list[dict[str, Any]] = []
                for revision in revision_rows:
                    provenance = revision.get("provenance") or {}
                    revision_settings = (
                        provenance.get("settings") if isinstance(provenance, dict) else {}
                    ) or {}
                    raw_contract = (
                        revision_settings.get("contract")
                        if isinstance(revision_settings, dict) else None
                    )
                    contract = _recipe_metadata(raw_contract)
                    preserved.append({
                        "id": revision["id"],
                        "revision": revision["input_hash"],
                        "created_at": revision["created_at"],
                        "protected": bool(revision["protected"]),
                        "contract": contract,
                        "requires_review": (
                            not isinstance(raw_contract, dict)
                            or raw_contract.get("revision") != revision["input_hash"]
                            or contract is None
                        ),
                    })
                mixes = {
                    "schema_version": 2,
                    "available": True,
                    "mixes": preserved,
                    "historical_revisions_immutable": True,
                    "playback_session": dict(session) if session else None,
                }
                manifest = {
                    "schema_version": 2,
                    "workspace_id": workspace.id,
                    "mode": "metadata_only",
                    "asset_count": len(exported_assets),
                    "originals": "never included: user recordings remain on their devices",
                    "mixes": {"available": True, "revision_count": len(preserved)},
                    "local_recordings": "never collected or deleted by Cloud",
                }
                archive.writestr("manifest.json", json.dumps(manifest, indent=2))
                archive.writestr("settings.json", json.dumps(settings, indent=2))
                archive.writestr("assets.json", json.dumps(exported_assets, indent=2))
                archive.writestr("mixes.json", json.dumps(mixes, indent=2, default=str))
                archive.writestr("billing.json", json.dumps({
                    "subscriptions": billing_rows,
                    "entitlement_history": plan_history,
                    "stripe_payment_details": "not included",
                }, indent=2, default=str))
        except Exception:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise

        return FileResponse(
            archive_path,
            media_type="application/zip",
            filename="selectadj-account-export.zip",
            headers={"Cache-Control": "no-store", "X-Selecta-Export-Mode": "metadata"},
            background=BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True),
        )


__all__ = ["install_routes"]
