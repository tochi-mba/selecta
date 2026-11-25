"""Reactions: a love for the playing song, or for the blend into it (ADR-0488).

A guest may tap each once per play, and take it back. The room sees counts; nobody ever sees
who tapped. There is no negative tap: a song nobody loved is the signal, and a boo button
invites a pile-on.

Every tap also adds to the host's crowd marks, which outlive the room. A mark's `loves` is every
tap, for showing ("loved 14 times"). Its `rooms` is how many rooms loved it, and a room counts
once per song or blend, only when enough of the guests in it agreed (`roomsocial.reactions`).
The planner reads `rooms`, so one guest, or one guest who joined many times, cannot steer it.

A tap names the play it is for. A tap that arrives just after the song changed still counts
for the song the guest was looking at; one for an older song is refused as `song_changed`, and
the page quietly shows the new song. The blend can only be loved while it is fresh.

A banned guest's taps are taken back with their votes.
"""

from __future__ import annotations

from collections.abc import Collection

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import new_id, transaction
from selecta.rooms import plays
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.schema import room_guests
from selecta.rooms.social_schema import crowd_marks, room_plays, room_reactions
from selecta.rooms.store import (
    GuestStatus,
    Room,
    RoomContext,
    active_guest,
    live_room,
    passes_unique,
    resolve_guest,
    resolve_now,
)
from selecta.rooms.views import GUEST_ONLINE_SECONDS, now_playing_for
from selecta.roomsocial import reactions as rules

_COUNT = {rules.LOVE: room_plays.c.loves, rules.BLEND: room_plays.c.blends}
_COUNTED = {rules.LOVE: room_plays.c.love_counted, rules.BLEND: room_plays.c.blend_counted}


def guests_online(conn: Connection, room: Room, now: float) -> int:
    """Active guests whose page has read the room lately: who a share of the room is a share of."""
    return conn.execute(
        sa.select(sa.func.count())
        .select_from(room_guests)
        .where(
            room_guests.c.workspace_id == room.workspace_id,
            room_guests.c.room_id == room.id,
            room_guests.c.status == GuestStatus.ACTIVE.value,
            room_guests.c.last_seen_at > now - GUEST_ONLINE_SECONDS,
        )
    ).scalar_one()


def _mark_where(room: Room, song_id: int, next_song_id: int) -> tuple:
    return (
        crowd_marks.c.workspace_id == room.workspace_id,
        crowd_marks.c.zone_key == "",
        crowd_marks.c.song_id == song_id,
        crowd_marks.c.next_song_id == next_song_id,
    )


def _pair(play: plays.Play, kind: str) -> tuple[int, int] | None:
    """What a tap is about, as a crowd mark's two songs: the song alone, or the song before it
    and this one for a blend."""
    if kind == rules.LOVE:
        return play.song_id, 0
    if play.previous_song_id is None:
        return None
    return play.previous_song_id, play.song_id


def _bump_mark(
    conn: Connection, room: Room, pair: tuple[int, int], now: float, *, loves: int, rooms: int
) -> None:
    where = _mark_where(room, *pair)
    total = crowd_marks.c.loves + loves
    changed = conn.execute(
        sa.update(crowd_marks)
        .where(*where)
        .values(
            loves=sa.case((total < 0, 0), else_=total),
            rooms=crowd_marks.c.rooms + rooms,
            last_at=now,
        )
    ).rowcount
    if changed or loves <= 0:
        return
    made = passes_unique(
        conn,
        sa.insert(crowd_marks).values(
            id=new_id(),
            workspace_id=room.workspace_id,
            zone_key="",
            song_id=pair[0],
            next_song_id=pair[1],
            loves=loves,
            rooms=rooms,
            last_at=now,
        ),
    )
    if not made:
        # Another tap made the mark in the same instant: add to it instead.
        _bump_mark(conn, room, pair, now, loves=loves, rooms=rooms)


def _already_counted(conn: Connection, room: Room, play: plays.Play, kind: str) -> bool:
    """Has this room already counted for this song (or this blend) on another play of it?"""
    mine = room_plays.alias("mine")
    query = sa.select(mine.c.id).where(
        mine.c.workspace_id == room.workspace_id,
        mine.c.room_id == room.id,
        mine.c.song_id == play.song_id,
        mine.c[_COUNTED[kind].name].is_(True),
    )
    if kind == rules.BLEND:
        before = room_plays.alias("before")
        query = query.join(before, before.c.id == mine.c.previous_play_id).where(
            before.c.song_id == play.previous_song_id
        )
    return conn.execute(query.limit(1)).first() is not None


def _tap(
    ctx: RoomContext, guest_token: str, kind: str, play_id: str, *, on: bool, now: float | None
) -> plays.Play:
    if kind not in rules.KINDS:
        raise RoomError(Refusal.NOT_ALLOWED)
    ref = resolve_guest(ctx, guest_token)
    workspace_id = ref.workspace_id
    playing = now_playing_for(ctx, workspace_id)
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = live_room(conn, workspace_id, ref.room_id)
        if not room.settings.reactions:
            raise RoomError(Refusal.FEATURE_OFF)
        guest = active_guest(conn, room, ref.guest_id, now)
        current = plays.observe(conn, room, playing, now)
        try:
            play = plays.tappable(conn, room, play_id, current, now)
        except LookupError:
            raise RoomError(Refusal.SONG_CHANGED) from None
        if kind == rules.BLEND and on and not play.blend_open(now):
            raise RoomError(Refusal.SONG_CHANGED, "That blend has passed.")
        pair = _pair(play, kind)
        own = (
            room_reactions.c.play_id == play.id,
            room_reactions.c.guest_id == guest.id,
            room_reactions.c.kind == kind,
        )
        if on:
            changed = passes_unique(
                conn,
                sa.insert(room_reactions).values(
                    id=new_id(),
                    room_id=room.id,
                    workspace_id=workspace_id,
                    guest_id=guest.id,
                    play_id=play.id,
                    kind=kind,
                    created_at=now,
                ),
            )
        else:
            changed = bool(conn.execute(sa.delete(room_reactions).where(*own)).rowcount)
        if changed:
            step = 1 if on else -1
            column = _COUNT[kind]
            conn.execute(
                sa.update(room_plays)
                .where(room_plays.c.id == play.id)
                .values({column.name: sa.case((column + step < 0, 0), else_=column + step)})
            )
            if pair is not None:
                taps = (play.loves if kind == rules.LOVE else play.blends) + step
                counted = play.love_counted if kind == rules.LOVE else play.blend_counted
                adds_room = (
                    on
                    and not counted
                    and rules.room_counts(taps, guests_online(conn, room, now))
                    and not _already_counted(conn, room, play, kind)
                )
                if adds_room:
                    conn.execute(
                        sa.update(room_plays)
                        .where(room_plays.c.id == play.id)
                        .values({_COUNTED[kind].name: True})
                    )
                _bump_mark(conn, room, pair, now, loves=step, rooms=1 if adds_room else 0)
        fresh = plays.load_play(conn, room, play.id)
    return fresh if fresh is not None else play


def react(
    ctx: RoomContext, guest_token: str, kind: str, play_id: str, *, now: float | None = None
) -> plays.Play:
    """Add this guest's love for the song, or for the blend into it. Tapping twice changes
    nothing."""
    return _tap(ctx, guest_token, kind, play_id, on=True, now=now)


def unreact(
    ctx: RoomContext, guest_token: str, kind: str, play_id: str, *, now: float | None = None
) -> plays.Play:
    """Take the tap back. The room's count goes down; a room that already counted towards the
    crowd marks stays counted, since the room did love it."""
    return _tap(ctx, guest_token, kind, play_id, on=False, now=now)


def mine(
    conn: Connection, room_id: str, guest_id: str, play_ids: Collection[str]
) -> dict[str, set[str]]:
    """This guest's own taps on the given plays: play id to the kinds they tapped."""
    wanted = [play_id for play_id in play_ids if play_id]
    found: dict[str, set[str]] = {}
    if not wanted:
        return found
    rows = conn.execute(
        sa.select(room_reactions.c.play_id, room_reactions.c.kind).where(
            room_reactions.c.room_id == room_id,
            room_reactions.c.guest_id == guest_id,
            room_reactions.c.play_id.in_(wanted),
        )
    )
    for row in rows:
        found.setdefault(row.play_id, set()).add(row.kind)
    return found


def forget_guest(conn: Connection, room: Room, guest_id: str) -> None:
    """A banned guest's taps are taken back, and the plays they were on counted again. The crowd
    marks keep their totals: they name no guest, and the room's own counts are what is shown."""
    touched = set(
        conn.execute(
            sa.select(room_reactions.c.play_id).where(
                room_reactions.c.workspace_id == room.workspace_id,
                room_reactions.c.room_id == room.id,
                room_reactions.c.guest_id == guest_id,
            )
        ).scalars()
    )
    if not touched:
        return
    conn.execute(
        sa.delete(room_reactions).where(
            room_reactions.c.workspace_id == room.workspace_id,
            room_reactions.c.room_id == room.id,
            room_reactions.c.guest_id == guest_id,
        )
    )
    for kind, column in _COUNT.items():
        count = (
            sa.select(sa.func.count())
            .select_from(room_reactions)
            .where(room_reactions.c.play_id == room_plays.c.id, room_reactions.c.kind == kind)
            .scalar_subquery()
        )
        conn.execute(
            sa.update(room_plays)
            .where(room_plays.c.id.in_(sorted(touched)))
            .values({column.name: count})
        )


def loved_songs(conn: Connection, workspace_id: str, limit: int = 500) -> list[dict]:
    """The host's crowd marks, most-loved rooms first: what the planner and the library read."""
    rows = conn.execute(
        sa.select(
            crowd_marks.c.song_id,
            crowd_marks.c.next_song_id,
            crowd_marks.c.loves,
            crowd_marks.c.rooms,
            crowd_marks.c.last_at,
        )
        .where(crowd_marks.c.workspace_id == workspace_id, crowd_marks.c.zone_key == "")
        .order_by(crowd_marks.c.rooms.desc(), crowd_marks.c.loves.desc(), crowd_marks.c.id)
        .limit(limit)
    )
    return [
        {
            "song_id": int(row.song_id),
            # None for a love of the song itself; else the song it blended into
            "next_song_id": int(row.next_song_id) or None,
            "loves": int(row.loves),
            "rooms": int(row.rooms),
            "last_at": row.last_at,
        }
        for row in rows
    ]


__all__ = [
    "forget_guest",
    "guests_online",
    "loved_songs",
    "mine",
    "react",
    "unreact",
]
