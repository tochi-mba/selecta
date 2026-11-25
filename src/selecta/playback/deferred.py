"""Deferred delivery: presses made while the speaker is offline (ADR-0461, BF-0461-04).

A speaker whose lease has lapsed may still be playing from what it has, or may be dead. A press
for it (play, pause, skip, seek, volume, programme) is no longer applied to the server session
behind its back, to be adopted later as if it had happened then. It is *held*: recorded
"deferred" with its fence and server-time expiry, and nothing changes.

`reconcile` runs, under the session lock, whenever the speaker is heard from again (a renewing
heartbeat, a reconnect, a take-over, a zone hand-back). It walks the held presses in the order
they were made and decides each one exactly once:

- the fence moved since (someone else took over): "superseded", dropped;
- past its expiry by the server's clock: "expired", dropped, never executed late;
- the session moved on since it was pressed (another press got there first): "stale", dropped;
- otherwise delivered now: applied, sequence bumped, and its signed envelope published.

Dropped presses are *missed*: published as one `playback.missed` event and returned, so the
speaker's answer and every controller can say what did not happen. `report` reads the recent
missed presses (and any still waiting) for the session view, judging expiry at read time, so a
speaker that never comes back still shows its controllers which presses lapsed.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.playback import commands, envelope, fencing, ports, programme
from selecta.playback.model import PlaybackError, Session
from selecta.playback.ports import MixControl, PlaybackEvents
from selecta.playback.schema import playback_commands
from selecta.playback.store import save_session, session_payload, zone_payload

DEFERRED = "deferred"
DROPPED = ("superseded", "expired", "stale")
REPORT_WINDOW_SECONDS = 15 * 60  # how long a missed press stays on controllers' screens
REPORT_LIMIT = 20


@dataclass(frozen=True)
class Reconciled:
    session: Session
    delivered: tuple[str, ...] = ()
    missed: tuple[dict[str, Any], ...] = ()


def _this_session(session: Session) -> tuple[Any, ...]:
    zone = (
        playback_commands.c.zone_id.is_(None)
        if session.zone_id is None
        else playback_commands.c.zone_id == session.zone_id
    )
    return (playback_commands.c.workspace_id == session.workspace_id, zone)


def missed_entry(row: Any, reason: str, resolved_at: float | None) -> dict[str, Any]:
    """What controllers are told about a press that never happened. Metadata only."""
    return {
        "command_id": row["id"],
        "command": row["command"],
        "args": row["args"],
        "issued_by": row["device_id"],
        "reason": reason,
        "created_at": row["created_at"],
        "expires_at": row["expires_at"],
        "resolved_at": resolved_at,
    }


def publish_delivery(
    conn: Connection,
    session: Session,
    *,
    command_id: str,
    issued_by: str,
    command: str,
    args: Any,
    fence: int,
    expires_at: float,
    now: float,
    events: PlaybackEvents,
) -> str | None:
    """Sign and publish a delivered command's envelope, then the new state. Returns the
    signature, which the caller records on the command row."""
    session = envelope.ensure_salt(conn, session)
    body = envelope.build(
        session,
        target_device_id=session.active_device_id,
        issued_by=issued_by,
        command=command,
        args=args,
        seq=session.seq,
        command_id=command_id,
        fence=fence,
        expires_at=expires_at,
    )
    events.publish(conn, session.workspace_id, ports.COMMAND, zone_payload(session, body))
    events.publish(conn, session.workspace_id, ports.STATE, session_payload(session, now))
    return body["signature"]


def reconcile(
    conn: Connection,
    session: Session,
    now: float,
    events: PlaybackEvents,
    *,
    mix: MixControl | None = None,
    volume_cap: int = 100,
) -> Reconciled:
    """Deliver or drop every press held for this session. The caller holds the session lock
    and has already saved the session it passes in. With no live speaker, nothing is
    decided yet: the presses wait for one (or for their expiry, reported by `report`)."""
    if not session.lease_live(now):
        return Reconciled(session)
    rows = list(
        conn.execute(
            sa.select(playback_commands)
            .where(*_this_session(session), playback_commands.c.status == DEFERRED)
            .order_by(playback_commands.c.created_at, playback_commands.c.id)
        ).mappings()
    )
    if not rows:
        return Reconciled(session)
    session = envelope.ensure_salt(conn, session)
    delivered: list[str] = []
    missed: list[dict[str, Any]] = []
    for row in rows:
        reason = None
        if fencing.stale_fence(session, row["fence"]):
            reason = "superseded"
        elif row["expires_at"] is not None and now >= row["expires_at"]:
            reason = "expired"
        elif row["based_on_seq"] != session.seq:
            reason = "stale"
        values: dict[str, Any] = {"resolved_at": now}
        if reason is None:
            try:
                name, clean = commands.validate(row["command"], row["args"])
                refs = None
                if name is commands.Command.SET_PROGRAMME:
                    refs = programme.resolve(conn, session.workspace_id, clean["songs"])
                changed = commands.apply(
                    session, name, clean, now, mix, volume_cap=volume_cap, programme=refs
                )
            except PlaybackError:
                reason = "stale"  # the library or the zone changed under it; never half-apply
            else:
                session = replace(changed, seq=session.seq + 1, updated_at=now)
                save_session(conn, session)
                values.update(status="applied", applied_seq=session.seq)
                values["signature"] = publish_delivery(
                    conn,
                    session,
                    command_id=row["id"],
                    issued_by=row["device_id"],
                    command=name.value,
                    args=clean,
                    fence=row["fence"],
                    expires_at=row["expires_at"],
                    now=now,
                    events=events,
                )
                delivered.append(row["id"])
        if reason is not None:
            values["status"] = reason
            missed.append(missed_entry(row, reason, now))
        conn.execute(
            sa.update(playback_commands)
            .where(playback_commands.c.id == row["id"])
            .values(**values)
        )
    if missed:
        events.publish(
            conn,
            session.workspace_id,
            ports.MISSED,
            zone_payload(session, {"missed": missed, "fence": session.fence}),
        )
    return Reconciled(session, tuple(delivered), tuple(missed))


def report(conn: Connection, session: Session, now: float) -> dict[str, list[dict[str, Any]]]:
    """Recent presses that were held: `missed` (dropped, or waiting past expiry) and `waiting`
    (held, still deliverable), plus recent `unavailable` acks with their alternatives."""
    since = now - REPORT_WINDOW_SECONDS
    held = conn.execute(
        sa.select(playback_commands)
        .where(
            *_this_session(session),
            playback_commands.c.deferred_at.is_not(None),
            playback_commands.c.created_at >= since,
        )
        .order_by(playback_commands.c.created_at.desc())
        .limit(REPORT_LIMIT)
    ).mappings()
    missed: list[dict[str, Any]] = []
    waiting: list[dict[str, Any]] = []
    for row in held:
        if row["status"] in DROPPED:
            missed.append(missed_entry(row, row["status"], row["resolved_at"]))
        elif row["status"] == DEFERRED:
            if row["expires_at"] is not None and now >= row["expires_at"]:
                missed.append(missed_entry(row, "expired", None))
            else:
                waiting.append(missed_entry(row, DEFERRED, None))
    unavailable = [
        {
            "command_id": row["id"],
            "command": row["command"],
            "issued_by": row["device_id"],
            "acked_at": row["acked_at"],
            **(row["ack_detail"] or {}),
        }
        for row in conn.execute(
            sa.select(playback_commands)
            .where(
                *_this_session(session),
                playback_commands.c.ack_result == fencing.ACK_UNAVAILABLE_HERE,
                playback_commands.c.acked_at >= since,
                # only while nothing newer has happened: once the music moved on (another
                # press, a take-over), an old "couldn't play that song" is not true any more
                playback_commands.c.applied_seq == session.seq,
            )
            .order_by(playback_commands.c.acked_at.desc())
            .limit(REPORT_LIMIT)
        ).mappings()
    ]
    return {"missed": missed, "waiting": waiting, "unavailable": unavailable}


__all__ = [
    "DEFERRED",
    "REPORT_WINDOW_SECONDS",
    "Reconciled",
    "missed_entry",
    "publish_delivery",
    "reconcile",
    "report",
]
