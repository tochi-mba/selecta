"""Fencing tokens, command TTLs and acknowledgments for the playback session (ADR-0461).

The session carries a fence: a number that moves only when ownership of the speaker lease
moves (a take-over, a heartbeat picking up a lapsed lease, a zone handing back to its home
kiosk). A command row is stamped with the fence it was issued under; once ownership has moved,
a press carried over from the old regime is refused "superseded" rather than applied to a
speaker it never meant. Each command also carries a TTL from server time, never a device
clock: one past its expiry is refused "expired", never executed late. A failed take-over
changes nothing, so the old fence stays valid and the transfer either provably happens or
loudly does not.

The ack is the speaker saying what it did with a delivered command: "applied" or
"unavailable_here" (the track isn't on this device, ADR-0458). An ack proves the command was
delivered and applied to local state, never that anything is audible (ADR-0460 owns that
claim). Only the current speaker may ack; a command stamped with an older fence is recorded
"superseded" whatever the speaker claims; a repeated ack gets the first answer again.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.persistence import transaction
from selecta.playback.model import (
    InvalidCommand,
    NotTheSpeaker,
    Session,
    UnknownCommand,
)
from selecta.playback.schema import COMMAND_ACK_RESULTS, playback_commands
from selecta.playback.store import (
    lock_session,
    require_signed_in,
    resolve_now,
    touch_device,
)

DEFAULT_TTL_SECONDS = 60
MAX_TTL_SECONDS = 300

ACK_APPLIED = "applied"
ACK_UNAVAILABLE_HERE = "unavailable_here"
ACK_SUPERSEDED = "superseded"
ACK_CLAIMS = (ACK_APPLIED, ACK_UNAVAILABLE_HERE)  # what a speaker may claim
ACK_RESULTS = COMMAND_ACK_RESULTS  # what the row may record


def next_fence(session: Session) -> int:
    """The fence after an ownership change. Every path that moves the lease to a device uses
    this, and only those paths (take-over, a heartbeat picking up a lapsed lease, a zone
    hand-back): anything else leaves the fence exactly as it was."""
    return session.fence + 1


def clean_ttl(ttl_seconds: int | None) -> int:
    """The TTL a command was submitted with, or the default. Zero is allowed and means the
    command is already expired; anything else out of range is refused before a row exists."""
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


def ack_command(
    engine: Engine,
    workspace_id: str,
    device_id: str,
    command_id: str,
    result: str,
    *,
    now: float | None = None,
) -> AckOutcome:
    """The speaker reports what it did with a delivered command. Recorded once; a retried ack
    gets the first answer again. A command stamped with an older fence is recorded
    "superseded" whatever the speaker claims: ownership moved between delivery and execution,
    so the press belongs to a regime that no longer exists.

    Another workspace's command id looks exactly like one that doesn't exist, and only the
    device holding the lease may ack at all.
    """
    if result not in ACK_CLAIMS:
        raise InvalidCommand(f"An ack result is one of: {', '.join(ACK_CLAIMS)}")
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        require_signed_in(conn, workspace_id, device_id)
        touch_device(conn, device_id, now)
        row = (
            conn.execute(
                sa.select(playback_commands).where(
                    playback_commands.c.workspace_id == workspace_id,
                    playback_commands.c.id == command_id,
                )
            )
            .mappings()
            .first()
        )
        if row is None:
            raise UnknownCommand("No such command here")
        session = lock_session(conn, workspace_id, now, row["zone_id"])
        if session.active_device_id != device_id:
            raise NotTheSpeaker("Only the current speaker acknowledges commands")
        if row["acked_at"] is not None:
            return AckOutcome(
                command_id, row["ack_result"], row["acked_at"], session.fence, replayed=True
            )
        recorded = result
        if row["fence"] is not None and row["fence"] != session.fence:
            recorded = ACK_SUPERSEDED
        conn.execute(
            sa.update(playback_commands)
            .where(
                playback_commands.c.workspace_id == workspace_id,
                playback_commands.c.id == command_id,
            )
            .values(acked_at=now, ack_result=recorded)
        )
        return AckOutcome(command_id, recorded, now, session.fence)


__all__ = [
    "ACK_APPLIED",
    "ACK_CLAIMS",
    "ACK_RESULTS",
    "ACK_SUPERSEDED",
    "ACK_UNAVAILABLE_HERE",
    "DEFAULT_TTL_SECONDS",
    "MAX_TTL_SECONDS",
    "AckOutcome",
    "ack_command",
    "clean_ttl",
    "next_fence",
]
