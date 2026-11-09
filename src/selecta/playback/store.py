"""Row-level helpers shared by devices and the session. Every function here takes an open
connection and leaves committing to the caller's `transaction()`.

The session row is locked with a plain `FOR UPDATE`, not `persistence.lock_rows`: that one skips
locked rows, which suits a job queue, but here a skipped row would look like a missing session and
a second writer would try to create it. Waiting for the one row is what's wanted. SQLite ignores
`FOR UPDATE`; its `BEGIN IMMEDIATE` already makes each write transaction exclusive.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import replace
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import db_now
from selecta.playback import ports
from selecta.playback.model import (
    Capabilities,
    Device,
    DeviceKind,
    DeviceSignedOut,
    PlayState,
    Session,
    UnknownDevice,
    frozen,
)
from selecta.playback.ports import PlaybackEvents
from selecta.playback.schema import devices, playback_sessions


def resolve_now(conn: Connection, now: float | None) -> float:
    """The database clock, unless a caller (a test, or one tick doing several things) gives one."""
    return db_now(conn) if now is None else float(now)


def device_from_row(row: Mapping[str, Any]) -> Device:
    return Device(
        id=row["id"],
        workspace_id=row["workspace_id"],
        user_id=row["user_id"],
        name=row["name"],
        kind=DeviceKind(row["kind"]),
        capabilities=Capabilities.from_json(row["capabilities"]),
        created_at=row["created_at"],
        last_seen_at=row["last_seen_at"],
        signed_out_at=row["signed_out_at"],
    )


def session_from_row(row: Mapping[str, Any]) -> Session:
    return Session(
        workspace_id=row["workspace_id"],
        mix_revision_id=row["mix_revision_id"],
        song_index=row["song_index"],
        offset_ms=row["offset_ms"],
        anchor_at=row["anchor_at"],
        state=PlayState(row["state"]),
        active_device_id=row["active_device_id"],
        lease_expires_at=row["lease_expires_at"],
        seq=row["seq"],
        updated_at=row["updated_at"],
    )


def load_device(conn: Connection, workspace_id: str, device_id: str) -> Device | None:
    row = (
        conn.execute(
            sa.select(devices).where(
                devices.c.workspace_id == workspace_id, devices.c.id == device_id
            )
        )
        .mappings()
        .first()
    )
    return device_from_row(row) if row else None


def require_device(conn: Connection, workspace_id: str, device_id: str) -> Device:
    device = load_device(conn, workspace_id, device_id)
    if device is None:
        raise UnknownDevice("That device isn't registered to this account")
    return device


def require_signed_in(conn: Connection, workspace_id: str, device_id: str) -> Device:
    device = require_device(conn, workspace_id, device_id)
    if not device.signed_in:
        raise DeviceSignedOut("This device was signed out. Sign in again to use it")
    return device


def touch_device(conn: Connection, device_id: str, now: float) -> None:
    conn.execute(sa.update(devices).where(devices.c.id == device_id).values(last_seen_at=now))


def device_names(conn: Connection, workspace_id: str, ids: Iterable[str | None]) -> dict[str, str]:
    wanted = {device_id for device_id in ids if device_id}
    if not wanted:
        return {}
    rows = conn.execute(
        sa.select(devices.c.id, devices.c.name).where(
            devices.c.workspace_id == workspace_id, devices.c.id.in_(wanted)
        )
    )
    return {row.id: row.name for row in rows}


def _session_query(workspace_id: str) -> sa.Select:
    return sa.select(playback_sessions).where(playback_sessions.c.workspace_id == workspace_id)


def load_session(conn: Connection, workspace_id: str) -> Session | None:
    row = conn.execute(_session_query(workspace_id)).mappings().first()
    return session_from_row(row) if row else None


def lock_session(conn: Connection, workspace_id: str, now: float) -> Session:
    """The workspace's session, locked for this transaction, created stopped if there's none."""
    query = _session_query(workspace_id).with_for_update()
    row = conn.execute(query).mappings().first()
    if row is None:
        try:
            with conn.begin_nested():
                conn.execute(
                    sa.insert(playback_sessions).values(
                        workspace_id=workspace_id,
                        song_index=0,
                        offset_ms=0,
                        state=PlayState.STOPPED.value,
                        seq=0,
                        updated_at=now,
                    )
                )
        except sa.exc.IntegrityError:
            pass  # another transaction created it first; lock theirs
        row = conn.execute(query).mappings().one()
    return session_from_row(row)


def save_session(conn: Connection, session: Session) -> None:
    conn.execute(
        sa.update(playback_sessions)
        .where(playback_sessions.c.workspace_id == session.workspace_id)
        .values(
            mix_revision_id=session.mix_revision_id,
            song_index=session.song_index,
            offset_ms=session.offset_ms,
            anchor_at=session.anchor_at,
            state=session.state.value,
            active_device_id=session.active_device_id,
            lease_expires_at=session.lease_expires_at,
            seq=session.seq,
            updated_at=session.updated_at,
        )
    )


def session_payload(session: Session) -> dict[str, Any]:
    """The session as every device sees it on its event stream."""
    return {
        "mix_revision_id": session.mix_revision_id,
        "song_index": session.song_index,
        "offset_ms": session.offset_ms,
        "anchor_at": session.anchor_at,
        "state": session.state.value,
        "active_device_id": session.active_device_id,
        "lease_expires_at": session.lease_expires_at,
        "seq": session.seq,
    }


def stop_playback(
    conn: Connection, session: Session, now: float, reason: str, events: PlaybackEvents
) -> Session:
    """Stop where it is: the position is kept so a remote can offer "Play here" from it, but no
    device is the speaker any more."""
    stopped = replace(
        frozen(session, now),
        state=PlayState.STOPPED,
        active_device_id=None,
        lease_expires_at=None,
        seq=session.seq + 1,
        updated_at=now,
    )
    save_session(conn, stopped)
    events.publish(
        conn,
        session.workspace_id,
        ports.STOPPED,
        {"device_id": session.active_device_id, "reason": reason, "seq": stopped.seq},
    )
    events.publish(conn, session.workspace_id, ports.STATE, session_payload(stopped))
    return stopped


def sign_out_devices(
    conn: Connection,
    workspace_id: str,
    device_ids: Iterable[str],
    now: float,
    reason: str,
    events: PlaybackEvents,
) -> bool:
    """Sign these devices out. If one of them is the speaker, playback stops gracefully.

    Returns whether playback was stopped.
    """
    ids = sorted(set(device_ids))
    if not ids:
        return False
    conn.execute(
        sa.update(devices)
        .where(
            devices.c.workspace_id == workspace_id,
            devices.c.id.in_(ids),
            devices.c.signed_out_at.is_(None),
        )
        .values(signed_out_at=now)
    )
    for device_id in ids:
        events.publish(
            conn, workspace_id, ports.SIGNED_OUT, {"device_id": device_id, "reason": reason}
        )
    session = load_session(conn, workspace_id)
    if session is None or session.active_device_id not in ids:
        return False
    session = lock_session(conn, workspace_id, now)
    if session.active_device_id not in ids:
        return False
    stop_playback(conn, session, now, reason, events)
    return True
