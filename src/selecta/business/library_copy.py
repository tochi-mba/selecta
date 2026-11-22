"""Copy songs from a person's own library into their organisation's (ADR-0453 D6 step 6).

`POST /api/business/library/copy-from-personal` (`business.orgs`), in the organisation's
workspace, by an owner or admin (`business.venues.manage`). The person's personal workspace is
the one they sign in to without a workspace header; they must be its member. Each chosen song
is **copied, never moved**: the original stays in the personal library untouched; the
organisation gets its own asset (a new id under its own storage prefix, `storage.keys`), its
own name, the uploader recorded as the person, and the bytes counted against the
organisation's quota. A song whose content the organisation already holds is skipped. The page
says plainly that personal downloads are often licensed for personal use only.

Not built here: copying whole personal crates (the hosted personal library has no crates);
songs only.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta.business.access import BusinessError
from selecta.business.access import guard as business_guard
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, new_id, transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets, upload_sessions

NOT_FOUND = {"code": "not_found"}
MAX_SONGS = 500


class CopyBody(BaseModel):
    song_ids: list[str] = Field(min_length=1, max_length=MAX_SONGS)


def _personal_songs(conn: Connection, workspace_id: str, ids: list[str]) -> list[dict]:
    rows = conn.execute(
        sa.select(assets, upload_sessions.c.display_name)
        .select_from(assets.outerjoin(upload_sessions, sa.and_(
            upload_sessions.c.id == assets.c.id,
            upload_sessions.c.workspace_id == assets.c.workspace_id)))
        .where(assets.c.workspace_id == workspace_id, assets.c.id.in_(ids),
               assets.c.deleted_at.is_(None))
    ).mappings().all()
    return [dict(row) for row in rows]


def _record(conn: Connection, org_id: str, song: dict, new_asset: str, user_id: str,
            now: float) -> None:
    from selecta.storage.parts import PART_SIZE

    name = song.get("display_name") or "Untitled"
    conn.execute(sa.insert(upload_sessions).values(
        id=new_asset, workspace_id=org_id, display_name=name, declared_size=song["size"],
        content_type="audio/" + (song["format"] or "mpeg"), sha256=song["sha256"],
        part_size=PART_SIZE, staging_key=f"copied/{new_asset}", status="accepted",
        uploaded_by=user_id, created_at=now, updated_at=now, expires_at=now,
    ))
    conn.execute(sa.insert(assets).values(
        id=new_asset, workspace_id=org_id, original_key=original_key(org_id, new_asset),
        size=song["size"], sha256=song["sha256"], format=song["format"],
        duration_s=song["duration_s"], sample_rate=song["sample_rate"],
        channels=song["channels"], uploaded_by=user_id, created_at=now,
    ))


def copy_songs(engine: Engine, *, org_id: str, personal_id: str, user_id: str,
               song_ids: list[str], client, originals: str) -> dict[str, Any]:
    """Copy the songs; returns `{copied, skipped, refused}` counts and the new ids."""
    from selecta.usage import quota

    with transaction(engine, personal_id) as conn:
        songs = _personal_songs(conn, personal_id, list(dict.fromkeys(song_ids)))
    with transaction(engine, org_id) as conn:
        held = set(conn.execute(sa.select(assets.c.sha256).where(
            assets.c.workspace_id == org_id, assets.c.deleted_at.is_(None))).scalars())
    copied, skipped, refused = [], 0, 0
    for song in songs:
        if song["sha256"] in held:
            skipped += 1
            continue
        new_asset = new_id()
        try:
            client.copy_object(originals, song["original_key"], originals,
                               original_key(org_id, new_asset), size=int(song["size"]))
        except Exception:  # noqa: BLE001 - storage refused this one; the rest still copy
            refused += 1
            continue
        try:
            with transaction(engine, org_id) as conn:
                now = float(db_now(conn))
                _record(conn, org_id, song, new_asset, user_id, now)
                reservation = quota.reserve(conn, org_id, int(song["size"]), new_asset)
                quota.commit(conn, reservation.id)
        except quota.QuotaExceeded:
            refused += 1
            continue
        held.add(song["sha256"])
        copied.append(new_asset)
    return {"copied": len(copied), "skipped": skipped, "refused": refused,
            "missing": len(set(song_ids)) - len(songs), "song_ids": copied}


def install_routes(app: FastAPI, *, engine: Engine, current_claims: Callable[..., Claims],
                   principal_for: Callable[..., Any],
                   storage: Callable[[], tuple[Any, str]] | None = None) -> None:
    def storage_now() -> tuple[Any, str]:
        if storage is not None:
            return storage()
        from selecta.storage import api as storage_api

        return storage_api.r2_client(), storage_api.buckets().originals

    @app.post("/api/business/library/copy-from-personal")
    def copy_from_personal(body: CopyBody, request: Request,
                           claims: Claims = Depends(current_claims)):  # noqa: B008
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if found.workspace.kind != "business":
            raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
        personal = principal_for(engine, claims, None)
        if personal.workspace.kind == "business" or personal.workspace.id == found.workspace.id:
            raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
        org_id = found.workspace.id
        try:
            with transaction(engine, org_id) as conn:
                actor = business_guard.actor_for(conn, user_id=found.user.id,
                                                 organisation_id=org_id, workspace_id=org_id)
                business_guard.require(conn, actor, "business.venues.manage")
        except BusinessError as error:
            raise HTTPException(status_code=error.status, detail={"code": error.code}) from error
        client, originals = storage_now()
        return copy_songs(engine, org_id=org_id, personal_id=personal.workspace.id,
                          user_id=found.user.id, song_ids=body.song_ids, client=client,
                          originals=originals)


__all__ = ["copy_songs", "install_routes"]
