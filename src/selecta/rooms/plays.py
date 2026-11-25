"""Plays: each song the speaker played while the room was open (ADR-0488).

A play is what a heart, a blend tap and a dedication attach to, and what the recap counts. It
is written the first time anyone looks at the room while that song plays: the pulse every phone
and screen reads, the guest page, or the host's panel. Writing it on a look, not on the
speaker's own report, keeps Rooms out of the playback code and covers a song started by a
command, which the speaker never reports as a change.

One row stands for one place in one mix: going back to an earlier song finds its row again, and
the same song later in the night is a new play. A song that is loaded but has never played is
not a play.

The blend between two songs can be loved for a short while after the second one starts, and a
tap that arrives just after the song changed still counts for the song the guest was looking at.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import new_id
from selecta.rooms.ports import NowPlaying
from selecta.rooms.social_schema import room_plays
from selecta.rooms.store import Room, passes_unique

BLEND_WINDOW_SECONDS = 45.0  # how long after a song starts its blend can be loved
LATE_TAP_SECONDS = 15.0  # a tap for the song that just ended still counts this long


@dataclass(frozen=True)
class Play:
    id: str
    room_id: str
    workspace_id: str
    song_id: int
    started_at: float
    loves: int
    blends: int
    previous_play_id: str | None
    previous_song_id: int | None
    love_counted: bool
    blend_counted: bool

    def blend_open(self, now: float) -> bool:
        """Can the blend into this song still be loved?"""
        return (
            self.previous_song_id is not None
            and self.previous_song_id != self.song_id
            and now - self.started_at <= BLEND_WINDOW_SECONDS
        )


def _play(conn: Connection, row: Mapping[str, Any]) -> Play:
    previous_song = None
    if row["previous_play_id"] is not None:
        previous_song = conn.execute(
            sa.select(room_plays.c.song_id).where(room_plays.c.id == row["previous_play_id"])
        ).scalar()
    return Play(
        id=row["id"],
        room_id=row["room_id"],
        workspace_id=row["workspace_id"],
        song_id=int(row["song_id"]),
        started_at=row["started_at"],
        loves=int(row["loves"] or 0),
        blends=int(row["blends"] or 0),
        previous_play_id=row["previous_play_id"],
        previous_song_id=None if previous_song is None else int(previous_song),
        love_counted=bool(row["love_counted"]),
        blend_counted=bool(row["blend_counted"]),
    )


def _mine(room: Room) -> tuple[Any, ...]:
    return (room_plays.c.workspace_id == room.workspace_id, room_plays.c.room_id == room.id)


def load_play(conn: Connection, room: Room, play_id: str) -> Play | None:
    row = (
        conn.execute(sa.select(room_plays).where(*_mine(room), room_plays.c.id == play_id))
        .mappings()
        .first()
    )
    return None if row is None else _play(conn, row)


def latest_play(conn: Connection, room: Room) -> Play | None:
    row = (
        conn.execute(
            sa.select(room_plays)
            .where(*_mine(room))
            .order_by(room_plays.c.started_at.desc(), room_plays.c.id.desc())
            .limit(1)
        )
        .mappings()
        .first()
    )
    return None if row is None else _play(conn, row)


def observe(conn: Connection, room: Room, playing: NowPlaying, now: float) -> Play | None:
    """The play for the song the speaker is on, written down if this is the first look at it.

    None when nothing is loaded, the room has ended, or the song is loaded but has not played.
    """
    song = playing.current
    if song is None or not room.live:
        return None
    index = -1 if playing.song_index is None else int(playing.song_index)
    where = (
        *_mine(room),
        room_plays.c.mix_key == playing.mix_key,
        room_plays.c.song_index == index,
        room_plays.c.song_id == int(song.song_id),
    )
    row = conn.execute(sa.select(room_plays).where(*where)).mappings().first()
    if row is None:
        # Paused at the very start is a song that is loaded, not played. Paused part-way in has
        # played, so it can be loved while the room waits.
        if playing.paused and (playing.offset_s or 0.0) <= 0.0:
            return None
        before = latest_play(conn, room)
        passes_unique(
            conn,
            sa.insert(room_plays).values(
                id=new_id(),
                room_id=room.id,
                workspace_id=room.workspace_id,
                song_id=int(song.song_id),
                mix_key=playing.mix_key,
                song_index=index,
                previous_play_id=None if before is None else before.id,
                # The song began before this look by however far in the speaker says it is.
                started_at=now - max(0.0, playing.offset_s or 0.0),
                loves=0,
                blends=0,
                love_counted=False,
                blend_counted=False,
            ),
        )
        # Another look may have written it in the same instant: either way, read what stands.
        row = conn.execute(sa.select(room_plays).where(*where)).mappings().first()
        if row is None:
            return None
    return _play(conn, row)


def tappable(conn: Connection, room: Room, play_id: str, current: Play | None, now: float) -> Play:
    """The play a tap names, if it may still be tapped: the current one, or the one before it
    for a few seconds after the song changed. Raises `LookupError` otherwise."""
    if current is not None and current.id == play_id:
        return current
    if (
        current is not None
        and current.previous_play_id == play_id
        and now - current.started_at <= LATE_TAP_SECONDS
    ):
        earlier = load_play(conn, room, play_id)
        if earlier is not None:
            return earlier
    raise LookupError(play_id)


def count_plays(conn: Connection, room: Room) -> int:
    return conn.execute(
        sa.select(sa.func.count()).select_from(room_plays).where(*_mine(room))
    ).scalar_one()


__all__ = [
    "BLEND_WINDOW_SECONDS",
    "LATE_TAP_SECONDS",
    "Play",
    "count_plays",
    "latest_play",
    "load_play",
    "observe",
    "tappable",
]
