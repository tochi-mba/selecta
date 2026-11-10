"""Deleting guest data 30 days after a room ends.

What a room keeps about guests (their id, hashed IP, nickname, requests, votes and bans) is
deleted 30 days after it closes. The same day the room's code hash is cleared, so from then on the
code may be given to a new room; until then it can't be. The room row itself (its name and
settings) is the host's and stays. Displays whose pairing code was never typed are cleared a day
after it ran out.

This looks across every workspace, so the listing needs the maintenance database role.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa

from selecta.persistence import transaction
from selecta.rooms.codes import REUSE_BLOCK_DAYS
from selecta.rooms.schema import (
    display_pairings,
    room_bans,
    room_guests,
    room_requests,
    room_votes,
    rooms,
)
from selecta.rooms.store import RoomContext, RoomStatus, resolve_now

GUEST_DATA_DAYS = 30
UNPAIRED_KEEP_SECONDS = 24 * 3600.0
_DAY = 24 * 3600.0


@dataclass(frozen=True)
class PurgeReport:
    rooms: int
    guests: int
    unpaired_displays: int


def purge_guest_data(ctx: RoomContext, *, now: float | None = None) -> PurgeReport:
    with transaction(ctx.engine) as conn:
        now = resolve_now(conn, now)
        cutoff = now - max(GUEST_DATA_DAYS, REUSE_BLOCK_DAYS) * _DAY
        due = conn.execute(
            sa.select(rooms.c.id, rooms.c.workspace_id).where(
                rooms.c.status == RoomStatus.ENDED.value,
                rooms.c.ended_at < cutoff,
                rooms.c.code_hash.is_not(None),
            )
        ).all()
        unpaired = conn.execute(
            sa.delete(display_pairings).where(
                display_pairings.c.room_id.is_(None),
                display_pairings.c.expires_at < now - UNPAIRED_KEEP_SECONDS,
            )
        ).rowcount
    guests = 0
    for room_id, workspace_id in due:
        with transaction(ctx.engine, workspace_id) as conn:
            mine = (rooms.c.id == room_id, rooms.c.workspace_id == workspace_id)
            if conn.execute(sa.select(rooms.c.id).where(*mine)).first() is None:
                continue
            for table in (room_votes, room_requests, room_bans, display_pairings):
                conn.execute(
                    sa.delete(table).where(
                        table.c.room_id == room_id, table.c.workspace_id == workspace_id
                    )
                )
            guests += (
                conn.execute(
                    sa.delete(room_guests).where(
                        room_guests.c.room_id == room_id,
                        room_guests.c.workspace_id == workspace_id,
                    )
                ).rowcount
                or 0
            )
            conn.execute(
                sa.update(rooms).where(*mine).values(code_hash=None, code_seed=None)
            )
    return PurgeReport(len(due), guests, unpaired or 0)
