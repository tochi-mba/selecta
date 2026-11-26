"""Authenticated account data archive for Selecta Cloud.

The ZIP holds every original (checked against its stored size and SHA-256), `settings.json` (the
account, workspace, plan, feature opt-outs, Lucy choices and signed-in devices), `assets.json`,
`mixes.json`, `song-facts.json` with each song's stored arrays (`cloud_brain.export`) and a
manifest. Cloud doesn't store mix revisions yet, so `mixes.json` says so and
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

from selecta.ai.usage_schema import lucy_usage_ledger
from selecta.billing import plans, stripe_sync
from selecta.cloud_brain import export as song_facts_export
from selecta.flags.rules import user_flag_preferences
from selecta.identity.tokens import Claims
from selecta.lucy import cloud_settings as lucy_cloud
from selecta.lucy import cloud_store as lucy_conversations
from selecta.lucy.cloud_schema import lucy_cloud_conversations, lucy_cloud_turns
from selecta.persistence import transaction
from selecta.playback.default_speaker_schema import playback_default_speakers
from selecta.playback.schema import devices, playback_sessions
from selecta.storage.artifacts import DEFAULT_BUCKETS, Buckets, R2ArtifactStore
from selecta.storage.keys import Bucket, original_key
from selecta.storage.objects import ObjectClient, R2Error
from selecta.storage.schema import assets, upload_sessions


def _safe_filename(name: str) -> str:
    leaf = name.replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._ -]", "_", leaf).strip(" .")[:180]
    return cleaned or "audio"


def _kept_lucy_usage(conn: Any, workspace_id: str, user_id: str) -> list[dict[str, Any]]:
    """Export charges linked to the person's own turns in this workspace."""
    ledger = lucy_usage_ledger.c
    turns = lucy_cloud_turns.c
    conversations = lucy_cloud_conversations.c
    own_turn = (
        select(turns.id)
        .select_from(lucy_cloud_turns.join(lucy_cloud_conversations, and_(
            conversations.workspace_id == turns.workspace_id,
            conversations.id == turns.conversation_id,
        )))
        .where(
            turns.workspace_id == ledger.workspace_id,
            turns.run_id == ledger.run_id,
            conversations.user_id == user_id,
        )
        .exists()
    )
    query = (
        select(
            ledger.run_id, ledger.created_at, ledger.settled_at, ledger.mode, ledger.pool,
            ledger.catalogue_version, ledger.reserved_units, ledger.charged_units, ledger.outcome,
            ledger.week_ends_at, ledger.session_ends_at,
        )
        .where(ledger.workspace_id == workspace_id, own_turn)
        .order_by(ledger.created_at, ledger.run_id)
    )
    return [dict(row) for row in conn.execute(query).mappings()]


def _kept_library(conn: Any, workspace_id: str) -> dict[str, Any]:
    """What the account keeps about its library and mixes, beyond hosted files: the songs'
    details (title, artist, never play), every saved mix revision, and the current mix."""
    from selecta.local_media.current_mix_schema import local_current_mix
    from selecta.local_media.recipe_schema import local_recipes
    from selecta.local_media.schema import local_songs

    def rows(query: Any) -> list[dict[str, Any]]:
        return [dict(row) for row in conn.execute(query).mappings().all()]

    songs = rows(
        select(local_songs.c.id, local_songs.c.title, local_songs.c.artist, local_songs.c.album,
               local_songs.c.duration_s, local_songs.c.codec, local_songs.c.never_play,
               local_songs.c.content_sha256)
        .where(local_songs.c.workspace_id == workspace_id).order_by(local_songs.c.id)
    )
    saved = rows(
        select(local_recipes.c.mix_id, local_recipes.c.number, local_recipes.c.revision,
               local_recipes.c.name, local_recipes.c.contract, local_recipes.c.created_at)
        .where(local_recipes.c.workspace_id == workspace_id)
        .order_by(local_recipes.c.mix_id, local_recipes.c.number)
    )
    current = rows(
        select(local_current_mix).where(local_current_mix.c.workspace_id == workspace_id)
    )
    # ADR-0488: what the host's rooms left behind that is the host's to keep. Neither holds a
    # guest id or a nickname: a recap is a room's totals, a crowd mark is how often rooms loved
    # a song or a blend.
    from selecta.rooms.social_schema import crowd_marks, room_recaps

    recaps = rows(
        select(room_recaps.c.room_id, room_recaps.c.built_at, room_recaps.c.data)
        .where(room_recaps.c.workspace_id == workspace_id).order_by(room_recaps.c.built_at)
    )
    marks = rows(
        select(crowd_marks.c.zone_key, crowd_marks.c.song_id, crowd_marks.c.next_song_id,
               crowd_marks.c.loves, crowd_marks.c.rooms, crowd_marks.c.last_at)
        .where(crowd_marks.c.workspace_id == workspace_id)
        .order_by(crowd_marks.c.song_id, crowd_marks.c.next_song_id)
    )
    return {"songs": songs, "saved_mixes": saved, "current_mix": current[0] if current else None,
            "rooms": {"recaps": [row for row in recaps if row["data"]], "crowd_marks": marks}}


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
            lucy_talk = lucy_conversations.export(conn, workspace.id, principal.user.id)
            lucy_usage = _kept_lucy_usage(conn, workspace.id, principal.user.id)
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
            # ADR-0475 C20: which of them is the default speaker
            default_id = conn.execute(
                select(playback_default_speakers.c.device_id).where(
                    playback_default_speakers.c.workspace_id == workspace.id
                )
            ).scalar()
            for row in device_rows:
                row["default_speaker"] = row["id"] == default_id
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
            kept = _kept_library(conn, workspace.id)
            # ADR-0479: song facts, corrections, ratings and the other hashes a song is known by
            engine_rows = song_facts_export.kept(conn, workspace.id)

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

                try:
                    features = song_facts_export.write_features(
                        archive,
                        lambda: R2ArtifactStore(object_client_factory(), buckets),
                        workspace.id,
                        engine_rows["measurements"],
                    )
                except R2Error as error:
                    raise HTTPException(
                        status_code=503,
                        detail={"code": "asset_export_unavailable", "retryable": error.retryable},
                    ) from error

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
                    # saved mixes (every revision of each) and the mix last chosen as current
                    "available": True,
                    "saved_mixes": kept["saved_mixes"],
                    "current_mix": kept["current_mix"],
                    # What was last playing, so the export holds every mix fact Cloud keeps.
                    "playback_session": dict(session) if session else None,
                }
                manifest = {
                    "schema_version": 1,
                    "workspace_id": workspace.id,
                    "asset_count": len(exported_assets),
                    # BF-0456-07: a workspace with no stored originals still gets a complete
                    # metadata, settings and recipes archive; the loop above never touched the
                    # object client because the assets query returned no rows.
                    "originals": (
                        "included and SHA-256 verified"
                        if exported_assets
                        else "none stored for this workspace"
                    ),
                    "settings": "included in settings.json",
                    "lucy_conversations": "included in lucy-conversations.json",
                    "lucy_usage": "included in lucy-usage.json",
                    "mixes": {
                        "saved_mixes": f"{len(kept['saved_mixes'])} revisions in mixes.json",
                        "current_mix": "included in mixes.json",
                        "playback_session": "included in mixes.json",
                    },
                    "library": f"{len(kept['songs'])} songs in library.json (details, never "
                    "the files on your devices)",
                    "song_facts": f"{len(engine_rows['measurements'])} songs' measurements, "
                    f"{len(engine_rows['corrections'])} corrections and "
                    f"{len(engine_rows['ratings'])} ratings in song-facts.json; {features} "
                    "songs' per-bar numbers in song-facts/features/",
                    "rooms": f"{len(kept['rooms']['recaps'])} room recaps and "
                    f"{len(kept['rooms']['crowd_marks'])} crowd marks in rooms.json (totals "
                    "only, no guest)",
                }
                archive.writestr("manifest.json", json.dumps(manifest, indent=2))
                archive.writestr("settings.json", json.dumps(settings, indent=2))
                archive.writestr("assets.json", json.dumps(exported_assets, indent=2))
                archive.writestr("mixes.json", json.dumps(mixes, indent=2, default=str))
                archive.writestr("library.json", json.dumps(kept["songs"], indent=2, default=str))
                archive.writestr("rooms.json", json.dumps(kept["rooms"], indent=2, default=str))
                archive.writestr(
                    song_facts_export.FACTS_FILE, json.dumps(engine_rows, indent=2, default=str)
                )
                # ADR-0476: this person's Lucy conversations, as they read them
                archive.writestr("lucy-conversations.json", json.dumps(lucy_talk, indent=2))
                archive.writestr("lucy-usage.json", json.dumps(lucy_usage, indent=2, default=str))
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
