"""Fencing tokens, command TTLs and acknowledgments for the playback session (ADR-0461).

The session carries a fence: a number that moves only when ownership of the speaker lease moves
to a different device (a take-over, a heartbeat picking up a lapsed lease, a zone handing back to
its home kiosk). A device renewing or re-taking its own lease moves nothing, and a refused
take-over changes nothing, so the old fence stays valid and the transfer either provably happens
or loudly does not.

A command row is stamped with the fence it was issued under. A press carried over from an older
regime is refused "superseded" and never applied. Each command carries a TTL counted from server
time (`db_now`), never a device clock: one already past its expiry is refused "expired". Commands
apply to the session synchronously under its lock, so the speaker learns of them from the
COMMAND event, which carries the envelope (`command_id`, `fence`, `expires_at`) for the device to
verify against `server_time` before touching local state.

The ack is the speaker saying what it did with a delivered command: "applied" or
"unavailable_here" (the track isn't on this device, ADR-0458). It proves delivery to local state,
never audibility (ADR-0460 owns that claim). Only the device holding the lease may ack, and only
a command that was actually delivered (status "applied"). What is recorded is the server's
verdict, not just the device's claim: a command from an older fence is recorded "superseded",
one acked after its expiry "expired". A repeated ack gets the first answer again.

An ack may echo the envelope signature it verified (BF-0461-01); one that does not match the
signature recorded for that command is refused `bad_signature` and records nothing. An
`unavailable_here` ack names the song the speaker could not resolve (ADR-0458 id, defaulting to
the session's current programme entry); the server records the alternatives the speaker holds
(`programme.alternatives`) and publishes them to controllers as `playback.unavailable`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.persistence import transaction
from selecta.playback import envelope, ports, programme
from selecta.playback.model import (
    BadSignature,
    InvalidCommand,
    NotTheSpeaker,
    Session,
    UnknownCommand,
)
from selecta.playback.ports import NO_EVENTS, PlaybackEvents
from selecta.playback.schema import COMMAND_ACK_RESULTS, playback_commands
from selecta.playback.store import (
    lock_session,
    require_signed_in,
    resolve_now,
    touch_device,
    zone_payload,
)

DEFAULT_TTL_SECONDS = 60
MAX_TTL_SECONDS = 300

ACK_APPLIED = "applied"
ACK_UNAVAILABLE_HERE = "unavailable_here"
ACK_SUPERSEDED = "superseded"
ACK_EXPIRED = "expired"
ACK_CLAIMS = (ACK_APPLIED, ACK_UNAVAILABLE_HERE)  # what a speaker may claim
ACK_RESULTS = COMMAND_ACK_RESULTS  # what the row may record

DELIVERED = "applied"  # the only command status a speaker ever receives


def fence_after(session: Session, device_id: str) -> int:
    """The fence once `device_id` holds the lease. It moves only when the lease moves to a
    different device; the holder renewing or re-taking its own lease keeps the fence it has."""
    if session.active_device_id == device_id:
        return session.fence
    return session.fence + 1


def stale_fence(session: Session, fence: int | None) -> bool:
    """A fence a device or controller sent that is not the session's current one. None (an
    older client that sends none) is never stale: it is judged by sequence alone, as before."""
    return fence is not None and fence != session.fence


def clean_ttl(ttl_seconds: int | None) -> int:
    """The TTL a command was submitted with, or the default. Zero is accepted and means the
    command is already expired on arrival; anything else out of range is refused before a row
    exists."""
    if ttl_seconds is None:
        return DEFAULT_TTL_SECONDS
    if (
        isinstance(ttl_seconds, bool)
        or not isinstance(ttl_seconds, int)
        or not 0 <= ttl_seconds <= MAX_TTL_SECONDS
    ):
        raise InvalidCommand(f"ttl_seconds must be a whole number from 0 to {MAX_TTL_SECONDS}")
    return ttl_seconds


@dataclass(frozen=True)
class AckOutcome:
    command_id: str
    ack_result: str
    acked_at: float
    fence: int  # the session's current fence, for the speaker to reconcile against
    replayed: bool = False
    song_id: int | None = None  # the song an unavailable_here ack was about
    alternatives: tuple[dict, ...] = ()  # what controllers may offer instead (ADR-0458)


def ack_command(
    engine: Engine,
    workspace_id: str,
    device_id: str,
    command_id: str,
    result: str,
    *,
    signature: str | None = None,
    song_id: int | None = None,
    expected_zone_id: str | None = None,
    authorize_zone: Callable[[Connection, str], None] | None = None,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> AckOutcome:
    """The speaker reports what it did with a delivered command. Recorded once; a retried ack
    gets the first answer again while it remains the current speaker.

    Another workspace's command id looks exactly like one that doesn't exist (the explicit
    workspace filter holds on SQLite too, where there is no row-level security). Lock order is
    the usual one: the device row (`touch_device`) before the session row.
    """
    if result not in ACK_CLAIMS:
        raise InvalidCommand(f"An ack result is one of: {', '.join(ACK_CLAIMS)}")
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        require_signed_in(conn, workspace_id, device_id)
        touch_device(conn, device_id, now)
        this_command = (
            playback_commands.c.workspace_id == workspace_id,
            playback_commands.c.id == command_id,
        )
        found = conn.execute(
            sa.select(playback_commands.c.zone_id).where(*this_command)
        ).first()
        if found is None:
            raise UnknownCommand("No such command here")
        if expected_zone_id is not None and found.zone_id != expected_zone_id:
            raise UnknownCommand("No such command here")
        if authorize_zone is not None:
            # The route's membership check runs in this same transaction as the ACK so a
            # concurrent role revocation cannot slip between authorization and mutation.
            if found.zone_id is None:
                raise UnknownCommand("No such command here")
            authorize_zone(conn, found.zone_id)
        session = lock_session(conn, workspace_id, now, found.zone_id)
        # Read the row again under the session lock: two racing acks are serialised by it, so
        # the second one sees the first one's answer and replays it.
        row = (
            conn.execute(
                sa.select(
                    playback_commands.c.status,
                    playback_commands.c.fence,
                    playback_commands.c.expires_at,
                    playback_commands.c.acked_at,
                    playback_commands.c.ack_result,
                    playback_commands.c.ack_detail,
                    playback_commands.c.signature,
                ).where(*this_command)
            )
            .mappings()
            .one()
        )
        if row["status"] != DELIVERED:
            raise InvalidCommand("That command was refused, so it was never delivered")
        if signature is not None and not envelope.same_signature(row["signature"], signature):
            raise BadSignature("That is not the envelope this command was delivered in")
        # A device that no longer owns the lease cannot read/replay an ACK after takeover.
        # The current speaker can retry idempotently to recover a lost response.
        if session.active_device_id != device_id:
            raise NotTheSpeaker("Only the current speaker acknowledges commands")
        if row["acked_at"] is not None:
            detail = row["ack_detail"] or {}
            return AckOutcome(
                command_id, row["ack_result"], row["acked_at"], session.fence, replayed=True,
                song_id=detail.get("song_id"),
                alternatives=tuple(detail.get("alternatives") or ()),
            )
        recorded = result
        if stale_fence(session, row["fence"]):
            recorded = ACK_SUPERSEDED
        elif row["expires_at"] is not None and now >= row["expires_at"]:
            recorded = ACK_EXPIRED
        detail = None
        missing = None
        offered: tuple[dict, ...] = ()
        if recorded == ACK_UNAVAILABLE_HERE:
            missing = song_id
            if missing is None and session.programme:
                if 0 <= session.song_index < len(session.programme):
                    missing = session.programme[session.song_index].song_id
            if missing is not None:
                offered = tuple(programme.alternatives(conn, session, device_id, missing))
            detail = {"song_id": missing, "alternatives": list(offered)}
        conn.execute(
            sa.update(playback_commands)
            .where(*this_command)
            .values(acked_at=now, ack_result=recorded, ack_detail=detail)
        )
        if detail is not None:
            events.publish(
                conn,
                workspace_id,
                ports.UNAVAILABLE,
                zone_payload(
                    session,
                    {"command_id": command_id, "device_id": device_id, "fence": session.fence,
                     **detail},
                ),
            )
        return AckOutcome(
            command_id, recorded, now, session.fence, song_id=missing, alternatives=offered
        )


__all__ = [
    "ACK_APPLIED",
    "ACK_CLAIMS",
    "ACK_EXPIRED",
    "ACK_RESULTS",
    "ACK_SUPERSEDED",
    "ACK_UNAVAILABLE_HERE",
    "DEFAULT_TTL_SECONDS",
    "DELIVERED",
    "MAX_TTL_SECONDS",
    "AckOutcome",
    "ack_command",
    "clean_ttl",
    "fence_after",
    "stale_fence",
]
