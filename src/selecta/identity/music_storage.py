"""Workspace audio-storage state. An unset mode preserves legacy workspace behaviour."""
from __future__ import annotations

from typing import Literal

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.identity.schema import workspaces

StorageMode = Literal["device", "cloud"]


def snapshot(conn: Connection, workspace_id: str) -> dict:
    mode, revision = conn.execute(
        sa.select(workspaces.c.music_storage_mode, workspaces.c.music_storage_revision)
        .where(workspaces.c.id == workspace_id)
    ).one()
    return {"mode": mode, "revision": revision}


def switch(
    conn: Connection, workspace_id: str, mode: StorageMode, revision: int
) -> dict | None:
    changed = conn.execute(
        workspaces.update()
        .where(
            workspaces.c.id == workspace_id,
            workspaces.c.music_storage_revision == revision,
        )
        .values(music_storage_mode=mode, music_storage_revision=revision + 1)
    )
    if changed.rowcount != 1:
        return None
    return {"mode": mode, "revision": revision + 1}
