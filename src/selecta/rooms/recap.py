"""Tonight in numbers for a party room (ADR-0488).

The recap is built once, the first time anyone asks for it after the room has ended: the
host's panel, a guest's ended screen, or a paired screen. It is kept in `room_recaps`, which
holds no guest id and no nickname, so it stays with the host's workspace when the guest data is
deleted 30 days later. The purge builds a recap nobody had asked for yet before it deletes the
plays and taps the recap is counted from.

A room whose host had the recap switched off when it ended gets none. Song titles are added
outside the counting transaction, because the catalogue opens a connection of its own.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import transaction
from selecta.rooms.schema import room_guests, room_requests, room_votes
from selecta.rooms.social_schema import (
    room_plays,
    room_recaps,
    room_round_options,
    room_round_votes,
    room_rounds,
)
from selecta.rooms.store import RequestStatus, Room, RoomContext, load_room, resolve_now
from selecta.roomsocial import recap as rules
from selecta.roomsocial import rounds as round_rules


def _count(conn: Connection, table: sa.Table, room: Room, *where: Any) -> int:
    return conn.execute(
        sa.select(sa.func.count())
        .select_from(table)
        .where(table.c.workspace_id == room.workspace_id, table.c.room_id == room.id, *where)
    ).scalar_one()


def _counts(conn: Connection, room: Room, ended_at: float) -> dict[str, Any]:
    plays = room_plays
    loved = conn.execute(
        sa.select(plays.c.song_id, sa.func.sum(plays.c.loves).label("loves"))
        .where(plays.c.workspace_id == room.workspace_id, plays.c.room_id == room.id)
        .group_by(plays.c.song_id)
        .order_by(sa.func.sum(plays.c.loves).desc(), plays.c.song_id)
        .limit(rules.TOP_SONGS)
    ).all()
    before = plays.alias("before")
    blend = conn.execute(
        sa.select(before.c.song_id.label("from_id"), plays.c.song_id, plays.c.blends)
        .select_from(plays.join(before, before.c.id == plays.c.previous_play_id))
        .where(plays.c.workspace_id == room.workspace_id, plays.c.room_id == room.id)
        .order_by(plays.c.blends.desc(), plays.c.id)
        .limit(1)
    ).first()
    closed = conn.execute(
        sa.select(room_rounds.c.id, room_rounds.c.winner_song_id).where(
            room_rounds.c.workspace_id == room.workspace_id,
            room_rounds.c.room_id == room.id,
            room_rounds.c.status == round_rules.CLOSED,
        )
    ).all()
    landslide = None
    for found in closed:
        options = conn.execute(
            sa.select(room_round_options.c.song_id, room_round_options.c.votes).where(
                room_round_options.c.round_id == found.id
            )
        ).all()
        total = sum(int(option.votes or 0) for option in options)
        won = next((int(o.votes or 0) for o in options if o.song_id == found.winner_song_id), 0)
        if total > 0 and (landslide is None or won / total > landslide["share"]):
            landslide = {
                "song_id": int(found.winner_song_id),
                "votes": won,
                "of": total,
                "share": won / total,
            }
    return {
        "name": room.name,
        "started_at": room.created_at,
        "ended_at": ended_at,
        "guests": _count(conn, room_guests, room),
        "songs_played": _count(conn, plays, room),
        "requests_asked": _count(conn, room_requests, room, room_requests.c.source == "guest"),
        "requests_played": _count(
            conn,
            room_requests,
            room,
            room_requests.c.source == "guest",
            room_requests.c.status == RequestStatus.PLAYED.value,
        ),
        "votes": _count(conn, room_votes, room) + _count(conn, room_round_votes, room),
        "loved": [{"song_id": int(row.song_id), "loves": int(row.loves or 0)} for row in loved],
        "blend": None
        if blend is None
        else {
            "from_id": int(blend.from_id),
            "to_id": int(blend.song_id),
            "loves": int(blend.blends or 0),
        },
        "rounds": len(closed),
        "landslide": landslide,
    }


def _named(ctx: RoomContext, workspace_id: str, counts: dict[str, Any]) -> dict[str, Any]:
    """The counts with song ids turned into titles. A song no longer in the library drops out."""
    wanted = {song["song_id"] for song in counts["loved"]}
    if counts["blend"]:
        wanted |= {counts["blend"]["from_id"], counts["blend"]["to_id"]}
    if counts["landslide"]:
        wanted.add(counts["landslide"]["song_id"])
    songs = ctx.catalog.describe(workspace_id, wanted) if wanted else {}
    loved = [
        {"title": songs[s["song_id"]].title, "artist": songs[s["song_id"]].artist, **s}
        for s in counts["loved"]
        if s["song_id"] in songs
    ]
    blend = counts["blend"]
    if blend and blend["from_id"] in songs and blend["to_id"] in songs:
        blend = {
            "from": songs[blend["from_id"]].title,
            "to": songs[blend["to_id"]].title,
            "loves": blend["loves"],
        }
    else:
        blend = None
    landslide = counts["landslide"]
    if landslide and landslide["song_id"] in songs:
        landslide = {
            "title": songs[landslide["song_id"]].title,
            "votes": landslide["votes"],
            "of": landslide["of"],
        }
    else:
        landslide = None
    return {**counts, "loved": loved, "blend": blend, "landslide": landslide}


def recap_of(
    ctx: RoomContext, workspace_id: str, room_id: str, *, now: float | None = None
) -> dict[str, Any] | None:
    """The room's recap: None while the room is open, when the host had it off, or when nobody
    joined. Built and kept on the first call after the room ends."""
    with transaction(ctx.engine, workspace_id) as conn:
        at = resolve_now(conn, now)
        room = load_room(conn, workspace_id, room_id)
        ended = not room.live or room.ends_at <= at
        if not ended:
            return None
        kept = conn.execute(
            sa.select(room_recaps.c.data).where(
                room_recaps.c.workspace_id == workspace_id, room_recaps.c.room_id == room_id
            )
        ).scalar()
        if kept is not None:
            return dict(kept) or None
        if not room.settings.recap:
            return None
        counts = _counts(conn, room, room.ended_at if room.ended_at is not None else room.ends_at)
    built = rules.build(**_named(ctx, workspace_id, counts))
    with transaction(ctx.engine, workspace_id) as conn:
        at = resolve_now(conn, now)
        try:
            with conn.begin_nested():
                conn.execute(
                    sa.insert(room_recaps).values(
                        room_id=room_id,
                        workspace_id=workspace_id,
                        built_at=at,
                        # an empty recap is kept too, so a room nobody joined is counted once
                        data=built or {},
                    )
                )
        except sa.exc.IntegrityError:
            pass  # another reader kept it in the same moment; theirs stands
    return built


__all__ = ["recap_of"]
