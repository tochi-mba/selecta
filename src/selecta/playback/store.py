"""Row-level helpers shared by devices and the session. Every function here takes an open
connection and leaves committing to the caller's `transaction()`.

The session row is locked with a plain `FOR UPDATE`, not `persistence.lock_rows`: that one skips
locked rows, which suits a job queue, but here a skipped row would look like a missing session and
a second writer would try to create it. Waiting for the one row is what's wanted. SQLite ignores
`FOR UPDATE`; its `BEGIN IMMEDIATE` already makes each write transaction exclusive.
"""

from __future__ import annotations

import secrets
from collections.abc import Iterable, Mapping
from dataclasses import replace
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import db_now, new_id
from selecta.playback import ports
from selecta.playback.model import (
    Capabilities,
    Device,
    DeviceKind,
    DeviceSignedOut,
    PlayState,
    Principal,
    ProgrammeRef,
    Session,
    SpeakerOutput,
    UnknownDevice,
    frozen,
    state_confidence,
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
        principal=Principal(row.get("principal") or Principal.PERSON.value),
        zone_id=row.get("zone_id"),
        machine_fingerprint=row.get("machine_fingerprint"),
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
        zone_id=row.get("zone_id"),
        # Legacy zone sessions predate the shared-volume column and may still have NULL.
        # Treat those as the documented full-volume default; personal sessions keep NULL
        # because their level belongs to each device.
        volume=(
            100
            if row.get("zone_id") is not None and row.get("volume") is None
            else row.get("volume")
        ),
        hand_back_to_device_id=row.get("hand_back_to_device_id"),
        fence=row.get("fence") or 0,
        signing_salt=row.get("signing_salt"),
        programme=programme_from_json(row.get("programme")),
        speaker_output=_output_from_json(row.get("speaker_output")),
    )


def _output_from_json(raw: Any) -> SpeakerOutput | None:
    if not raw:
        return None
    return SpeakerOutput(str(raw["device_id"]), str(raw["status"]), raw.get("verified_at"))


def programme_from_json(raw: Any) -> tuple[ProgrammeRef, ...] | None:
    if raw is None:
        return None
    return tuple(ProgrammeRef(int(item["song_id"]), str(item["sha256"])) for item in raw)


def programme_json(programme: tuple[ProgrammeRef, ...] | None) -> list[dict[str, Any]] | None:
    return None if programme is None else [ref.to_json() for ref in programme]


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


def _zone_is(zone_id: str | None):
    if zone_id is None:
        return playback_sessions.c.zone_id.is_(None)
    return playback_sessions.c.zone_id == zone_id


def _session_query(workspace_id: str, zone_id: str | None = None) -> sa.Select:
    """The one session for this workspace and zone. A personal workspace's has no zone."""
    return sa.select(playback_sessions).where(
        playback_sessions.c.workspace_id == workspace_id, _zone_is(zone_id)
    )


def load_session(
    conn: Connection, workspace_id: str, zone_id: str | None = None
) -> Session | None:
    row = conn.execute(_session_query(workspace_id, zone_id)).mappings().first()
    return session_from_row(row) if row else None


def lock_session(
    conn: Connection, workspace_id: str, now: float, zone_id: str | None = None
) -> Session:
    """The session for this workspace and zone, locked for this transaction, created stopped if
    there's none."""
    query = _session_query(workspace_id, zone_id).with_for_update()
    row = conn.execute(query).mappings().first()
    if row is None:
        try:
            with conn.begin_nested():
                conn.execute(
                    sa.insert(playback_sessions).values(
                        id=new_id(),
                        workspace_id=workspace_id,
                        zone_id=zone_id,
                        song_index=0,
                        offset_ms=0,
                        state=PlayState.STOPPED.value,
                        seq=0,
                        fence=0,
                        signing_salt=secrets.token_hex(32),
                        updated_at=now,
                    )
                )
        except sa.exc.IntegrityError:
            pass  # another transaction created it first; lock theirs
        row = conn.execute(query).mappings().one()
    return session_from_row(row)


def zone_sessions(conn: Connection, workspace_id: str) -> list[Session]:
    """Every zone session of a business workspace (none for a personal one)."""
    rows = conn.execute(
        sa.select(playback_sessions)
        .where(
            playback_sessions.c.workspace_id == workspace_id,
            playback_sessions.c.zone_id.is_not(None),
        )
        .order_by(playback_sessions.c.zone_id)
    ).mappings()
    return [session_from_row(row) for row in rows]


def lock_device(conn: Connection, workspace_id: str, device_id: str) -> None:
    """Hold this device's row for the transaction, so two zone leases for one device are decided
    one after the other (ADR-0443: a device holds at most one zone lease). Zone callers lock the
    device before any session, always in that order, so two of them can't deadlock."""
    conn.execute(
        sa.select(devices.c.id)
        .where(devices.c.workspace_id == workspace_id, devices.c.id == device_id)
        .with_for_update()
    ).first()


def save_session(conn: Connection, session: Session) -> None:
    conn.execute(
        sa.update(playback_sessions)
        .where(
            playback_sessions.c.workspace_id == session.workspace_id,
            _zone_is(session.zone_id),
        )
        .values(
            mix_revision_id=session.mix_revision_id,
            song_index=session.song_index,
            offset_ms=session.offset_ms,
            anchor_at=session.anchor_at,
            state=session.state.value,
            active_device_id=session.active_device_id,
            lease_expires_at=session.lease_expires_at,
            seq=session.seq,
            fence=session.fence,
            signing_salt=session.signing_salt,
            programme=programme_json(session.programme),
            speaker_output=None
            if session.speaker_output is None
            else session.speaker_output.to_json(),
            updated_at=session.updated_at,
            volume=session.volume,
            hand_back_to_device_id=session.hand_back_to_device_id,
        )
    )


def session_payload(session: Session, now: float | None = None) -> dict[str, Any]:
    """The session as every device sees it on its event stream. A zone session also names its
    zone and carries the zone's shared volume; a personal one looks exactly as before.

    `fence` and `state_confidence` are the ADR-0461 truth: which ownership regime commands
    must be fenced to, and whether the lease backs what's shown ("fresh") or lapsed
    ("uncertain"). Give `now` (server time) when you have it; without one, confidence is as
    of the session's last write."""
    payload: dict[str, Any] = {
        "mix_revision_id": session.mix_revision_id,
        "song_index": session.song_index,
        "offset_ms": session.offset_ms,
        "anchor_at": session.anchor_at,
        "state": session.state.value,
        "active_device_id": session.active_device_id,
        "lease_expires_at": session.lease_expires_at,
        "seq": session.seq,
        "fence": session.fence,
        "state_confidence": state_confidence(session, now),
    }
    output = session.speaker_output
    if output is not None and output.device_id == session.active_device_id:
        # The speaker's own report, never stronger than the lease backing it (ADR-0457/0461).
        status = "uncertain" if payload["state_confidence"] != "fresh" else output.status
        payload["output_status"] = status
        payload["output_verified_at"] = output.verified_at if status == "playing" else None
    if session.programme is not None:
        # ADR-0458 identities only: each device resolves them against its own library.
        payload["programme"] = programme_json(session.programme)
        playing = session.song_index
        payload["track"] = (
            session.programme[playing].to_json() if 0 <= playing < len(session.programme) else None
        )
    if session.zone_id is not None:
        payload["zone_id"] = session.zone_id
        payload["volume"] = session.volume
        payload["hand_back_to_device_id"] = session.hand_back_to_device_id
    return payload


def zone_payload(session: Session, payload: Mapping[str, Any]) -> dict[str, Any]:
    """An event payload with the session's zone added, when it has one (ADR-0443 events)."""
    out = dict(payload)
    if session.zone_id is not None:
        out["zone_id"] = session.zone_id
    return out


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
        zone_payload(
            session,
            {"device_id": session.active_device_id, "reason": reason, "seq": stopped.seq},
        ),
    )
    events.publish(conn, session.workspace_id, ports.STATE, session_payload(stopped, now))
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
    # The personal session, and every zone session of a business workspace (ADR-0443).
    candidates = [load_session(conn, workspace_id), *zone_sessions(conn, workspace_id)]
    stopped = False
    for found in candidates:
        if found is None or found.active_device_id not in ids:
            continue
        session = lock_session(conn, workspace_id, now, found.zone_id)
        if session.active_device_id not in ids:
            continue
        stop_playback(conn, session, now, reason, events)
        stopped = True
    return stopped
