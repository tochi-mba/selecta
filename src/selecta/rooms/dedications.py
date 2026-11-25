"""Dedications: one line from a fixed list on a guest's own request (ADR-0488).

The guest sends the id of a line, never words. `roomsocial.dedications` holds the words, so
nothing a guest types is ever shown to anyone, which keeps Rooms inside ADR-0416's rule. A
host can hide any line, switch the feature off, or clear one dedication.

A dedication can be set or changed while the request is still waiting. It shows while the song
plays: it is bound to the first play of that song after the request was accepted, and shown on
that play only, so the same song later in the night does not repeat it. The asker's nickname
goes with it only when the host has names shown.

It leaves with its request: withdrawn, passed, banned or the room ending all drop it.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import transaction
from selecta.rooms import plays
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.schema import room_guests, room_requests
from selecta.rooms.store import (
    PENDING,
    RequestStatus,
    Room,
    RoomContext,
    RoomRequest,
    active_guest,
    live_room,
    load_request,
    resolve_guest,
    resolve_now,
    set_request,
)
from selecta.roomsocial import dedications as lines

KIND = lines.PARTY


def offered(room: Room) -> list[dict[str, str]]:
    """The lines a guest in this room may pick, as the page lists them."""
    return [
        {"id": line.id, "words": line.words}
        for line in lines.lines_for(KIND, room.settings.dedications_hidden)
    ]


def set_line(
    ctx: RoomContext, guest_token: str, request_id: str, line_id: str | None
) -> RoomRequest:
    """Put a line on the guest's own waiting request, change it, or (None) take it off."""
    ref = resolve_guest(ctx, guest_token)
    with transaction(ctx.engine, ref.workspace_id) as conn:
        now = resolve_now(conn, None)
        room = live_room(conn, ref.workspace_id, ref.room_id)
        if not room.settings.dedications:
            raise RoomError(Refusal.FEATURE_OFF)
        guest = active_guest(conn, room, ref.guest_id, now)
        target = load_request(conn, room, request_id)
        if target.guest_id != guest.id:
            raise RoomError(Refusal.NO_SUCH_REQUEST)
        if target.status not in PENDING:
            raise RoomError(Refusal.NOT_ALLOWED)
        if line_id is not None and not lines.allowed(
            line_id, KIND, room.settings.dedications_hidden
        ):
            raise RoomError(Refusal.NO_SUCH_LINE)
        set_request(conn, target.id, dedication=line_id, dedication_play_id=None)
        ctx.publish(conn, room, "room.request", {"request_id": target.id})
        return load_request(conn, room, target.id)


def host_clear(ctx: RoomContext, workspace_id: str, room_id: str, request_id: str) -> RoomRequest:
    """The host takes a dedication off a request, leaving the request as it is."""
    with transaction(ctx.engine, workspace_id) as conn:
        room = live_room(conn, workspace_id, room_id)
        target = load_request(conn, room, request_id)
        set_request(conn, target.id, dedication=None, dedication_play_id=None)
        ctx.publish(conn, room, "room.request", {"request_id": target.id})
        return load_request(conn, room, target.id)


def showing(conn: Connection, room: Room, play: plays.Play | None) -> dict[str, Any] | None:
    """The dedication for the song that is on, if a request for it carries one. The first look
    binds it to this play, so it shows for this play and no other."""
    if play is None or not room.settings.dedications:
        return None
    hidden = set(room.settings.dedications_hidden)
    rows = conn.execute(
        sa.select(
            room_requests.c.id,
            room_requests.c.dedication,
            room_requests.c.dedication_play_id,
            room_requests.c.guest_id,
        )
        .where(
            room_requests.c.workspace_id == room.workspace_id,
            room_requests.c.room_id == room.id,
            room_requests.c.song_id == play.song_id,
            room_requests.c.dedication.is_not(None),
            room_requests.c.status.in_(
                [RequestStatus.ACCEPTED.value, RequestStatus.PLAYED.value]
            ),
            sa.or_(
                room_requests.c.dedication_play_id.is_(None),
                room_requests.c.dedication_play_id == play.id,
            ),
        )
        .order_by(room_requests.c.approved_at, room_requests.c.id)
    ).all()
    for row in rows:
        words = lines.words_of(row.dedication)
        if words is None or row.dedication in hidden:
            continue
        if row.dedication_play_id is None:
            set_request(conn, row.id, dedication_play_id=play.id)
        nickname = None
        if room.settings.names_shown and row.guest_id is not None:
            nickname = conn.execute(
                sa.select(room_guests.c.nickname).where(room_guests.c.id == row.guest_id)
            ).scalar()
        return {"request_id": row.id, "line": row.dedication, "words": words, "from": nickname}
    return None


__all__ = ["KIND", "host_clear", "offered", "set_line", "showing"]
