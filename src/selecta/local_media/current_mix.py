"""The account's current mix (ADR-0475 R8).

One recipe per workspace is the current mix on every device. A device sets it with
compare-and-set: it names the mix it last saw as current (`expected_mix_id`), and when another
device changed it meanwhile the set is refused with the value that stands, so two devices choosing
at once never overwrite each other silently. Each change goes out on the workspace event stream
as `mix.current`, so every open device follows without a reload. What plays stays the playback
session's to say: choosing a mix never switches a speaker by itself.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.local_media.current_mix_schema import local_current_mix
from selecta.local_media.recipe_schema import local_recipes
from selecta.persistence import db_now
from selecta.playback.schema import devices as playback_devices
from selecta.work import outbox

TOPIC = "mix.current"


class CurrentMixError(Exception):
    def __init__(self, code: str, message: str, status: int, current: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.current = current


def read(conn: Connection, workspace_id: str) -> dict[str, Any]:
    """The current mix as every device sees it; nulls when none has been chosen."""
    row = conn.execute(
        sa.select(local_current_mix).where(local_current_mix.c.workspace_id == workspace_id)
    ).first()
    if row is None:
        return {"mix_id": None, "revision": 0, "updated_at": None, "updated_by_device_name": None}
    name = None
    if row.updated_by_device is not None:
        name = conn.execute(
            sa.select(playback_devices.c.name)
            .where(playback_devices.c.workspace_id == workspace_id)
            .where(playback_devices.c.id == row.updated_by_device)
        ).scalar()
    return {
        "mix_id": row.mix_id,
        "revision": row.revision,
        "updated_at": row.updated_at,
        "updated_by_device_name": name,
    }


def _mix_exists(conn: Connection, workspace_id: str, mix_id: str) -> bool:
    return conn.execute(
        sa.select(local_recipes.c.mix_id)
        .where(local_recipes.c.workspace_id == workspace_id)
        .where(local_recipes.c.mix_id == mix_id)
        .limit(1)
    ).first() is not None


def _device_of(conn: Connection, workspace_id: str, device_id: str | None) -> str | None:
    """The chooser's device id when it is a signed-in device of this workspace; else nothing."""
    if not device_id:
        return None
    found = conn.execute(
        sa.select(playback_devices.c.id)
        .where(playback_devices.c.workspace_id == workspace_id)
        .where(playback_devices.c.id == device_id)
    ).scalar()
    return found


def _write(conn: Connection, workspace_id: str, mix_id: str | None, device: str | None) -> dict:
    now = db_now(conn)
    revision = conn.execute(
        sa.select(local_current_mix.c.revision)
        .where(local_current_mix.c.workspace_id == workspace_id)
    ).scalar()
    values = {"mix_id": mix_id, "updated_at": now, "updated_by_device": device}
    if revision is None:
        conn.execute(
            local_current_mix.insert().values(workspace_id=workspace_id, revision=1, **values)
        )
    else:
        conn.execute(
            local_current_mix.update()
            .where(local_current_mix.c.workspace_id == workspace_id)
            .values(revision=revision + 1, **values)
        )
    current = read(conn, workspace_id)
    outbox.emit(conn, TOPIC, workspace_id, current, now)
    return current


def choose(
    conn: Connection,
    workspace_id: str,
    mix_id: str | None,
    expected_mix_id: str | None,
    device_id: str | None = None,
) -> dict[str, Any]:
    """Make `mix_id` the current mix (null clears it), only if the current one is still
    `expected_mix_id`. Choosing the mix that is already current changes nothing."""
    current = read(conn, workspace_id)
    if current["mix_id"] == mix_id:
        return current
    if current["mix_id"] != expected_mix_id:
        raise CurrentMixError(
            "current_mix_changed",
            "Another device chose a different mix a moment ago.",
            409,
            current,
        )
    if mix_id is not None and not _mix_exists(conn, workspace_id, mix_id):
        raise CurrentMixError("mix_not_found", "That mix is not in this account.", 404)
    return _write(conn, workspace_id, mix_id, _device_of(conn, workspace_id, device_id))


def forget_deleted(conn: Connection, workspace_id: str, mix_id: str) -> None:
    """A deleted mix stops being current (and every device hears that)."""
    if read(conn, workspace_id)["mix_id"] == mix_id:
        _write(conn, workspace_id, None, None)


__all__ = ["TOPIC", "CurrentMixError", "choose", "forget_deleted", "read"]
