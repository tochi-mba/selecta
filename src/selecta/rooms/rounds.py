"""Pick the next song: the room votes between songs the DJ can blend into (ADR-0488).

A round is opened with two to four songs. In a browser-first room the host's browser is the
planner, so it is the speaker's browser that offers them: the server checks each one may be
requested here and leaves the musical choice where the music is. Each active guest who was in
the room when the round opened has one vote and may change it until the round closes.

Nothing here runs on a timer of the server's own. A round is closed by whoever looks at the
room first once its time is up: the speaker asking for the result, or the next read of the
pulse. Closing is done under the room's lock and gives the same answer whoever does it
(`roomsocial.rounds`).

The winner becomes a request with no asker (`source` = round) and goes through the same
hand-over as any accepted request, so the host's Requests list, the "coming up" lists and the
undo paths all already know what to do with it. If a guest asked for the same song while the
room was voting, their request is the one that is promoted. Where the winner stands (waiting,
in the mix, not placed) is read from that request.

Starting by itself: when the host has set "every N songs", the first look at a new song that
is the Nth since the last round tells the speaker's browser the room wants a vote. The browser
decides whether the song has long enough left.
"""

from __future__ import annotations

import threading
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import new_id, transaction
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.planning import pump
from selecta.rooms.schema import room_requests
from selecta.rooms.social_schema import (
    room_plays,
    room_round_options,
    room_round_votes,
    room_rounds,
)
from selecta.rooms.store import (
    WAITING,
    RequestStatus,
    Room,
    RoomContext,
    active_guest,
    live_room,
    load_room,
    passes_unique,
    resolve_guest,
    resolve_now,
    room_requests_where,
    set_request,
)
from selecta.roomsocial import rounds as rules

RESULT_SECONDS = 45.0  # how long a finished round's result stays in the pulse
TIMER_FRESH_SECONDS = 20.0  # a round by itself only starts near the start of a song
EVENT = "room.round"

# The play a "the room wants a vote" was last sent for, per room: at most once per song from
# each app instance. The speaker's browser and the one-open-round rule absorb a second one.
_asked: dict[str, str] = {}
_asked_lock = threading.Lock()


@dataclass(frozen=True)
class Round:
    id: str
    room_id: str
    workspace_id: str
    status: str
    opened_by: str
    opened_at: float
    closes_at: float
    closed_at: float | None
    winner_song_id: int | None
    winner_request_id: str | None
    outcome: str | None
    options: tuple[rules.Option, ...] = ()

    @property
    def open(self) -> bool:
        return self.status == rules.OPEN

    @property
    def total(self) -> int:
        return sum(option.votes for option in self.options)


def _options(conn: Connection, round_id: str) -> tuple[rules.Option, ...]:
    rows = conn.execute(
        sa.select(
            room_round_options.c.position,
            room_round_options.c.song_id,
            room_round_options.c.votes,
        )
        .where(room_round_options.c.round_id == round_id)
        .order_by(room_round_options.c.position)
    )
    return tuple(rules.Option(int(r.position), int(r.song_id), int(r.votes or 0)) for r in rows)


def _round(conn: Connection, row: Mapping[str, Any]) -> Round:
    status = None
    if row["winner_request_id"] is not None:
        status = conn.execute(
            sa.select(room_requests.c.status).where(room_requests.c.id == row["winner_request_id"])
        ).scalar()
    return Round(
        id=row["id"],
        room_id=row["room_id"],
        workspace_id=row["workspace_id"],
        status=row["status"],
        opened_by=row["opened_by"],
        opened_at=row["opened_at"],
        closes_at=row["closes_at"],
        closed_at=row["closed_at"],
        winner_song_id=None if row["winner_song_id"] is None else int(row["winner_song_id"]),
        winner_request_id=row["winner_request_id"],
        # the request that carries the winner says where it stands; a round without one keeps
        # the reason it was written with (no votes, called off)
        outcome=rules.outcome_of(status) or row["outcome"],
        options=_options(conn, row["id"]),
    )


def _mine(room: Room) -> tuple:
    return (room_rounds.c.workspace_id == room.workspace_id, room_rounds.c.room_id == room.id)


def open_round_of(conn: Connection, room: Room) -> Round | None:
    row = (
        conn.execute(sa.select(room_rounds).where(*_mine(room), room_rounds.c.status == rules.OPEN))
        .mappings()
        .first()
    )
    return None if row is None else _round(conn, row)


def load_round(conn: Connection, room: Room, round_id: str) -> Round | None:
    row = (
        conn.execute(sa.select(room_rounds).where(*_mine(room), room_rounds.c.id == round_id))
        .mappings()
        .first()
    )
    return None if row is None else _round(conn, row)


def showing(conn: Connection, room: Room, now: float) -> Round | None:
    """The round the room should be looking at: the open one, or the one that just finished,
    for long enough to read its result."""
    row = (
        conn.execute(
            sa.select(room_rounds)
            .where(*_mine(room))
            .order_by(room_rounds.c.opened_at.desc(), room_rounds.c.id.desc())
            .limit(1)
        )
        .mappings()
        .first()
    )
    if row is None:
        return None
    if row["status"] != rules.OPEN and now - (row["closed_at"] or 0.0) > RESULT_SECONDS:
        return None
    return _round(conn, row)


def _recount(conn: Connection, round_id: str) -> None:
    count = (
        sa.select(sa.func.count())
        .select_from(room_round_votes)
        .where(
            room_round_votes.c.round_id == room_round_options.c.round_id,
            room_round_votes.c.position == room_round_options.c.position,
        )
        .scalar_subquery()
    )
    conn.execute(
        sa.update(room_round_options)
        .where(room_round_options.c.round_id == round_id)
        .values(votes=count)
    )


def _requestable(ctx: RoomContext, room: Room, song_ids: Collection[int]) -> set[int]:
    """Which of these songs may go into this room's mix now. The catalogue opens its own
    connection, so this is asked outside any transaction of ours."""
    crate = room.settings.crate
    return {
        song_id
        for song_id in song_ids
        if (crate is None or song_id in crate)
        and ctx.catalog.is_requestable(room.workspace_id, song_id)
    }


def open_round(
    ctx: RoomContext,
    workspace_id: str,
    room_id: str,
    song_ids: Collection[object],
    *,
    opened_by: str = "host",
    now: float | None = None,
) -> Round:
    """Open a vote between these songs. Refuses while one is open, with too few songs that can
    be played here, with the feature off, or with no device playing."""
    try:
        wanted = rules.clean_options(song_ids)
    except ValueError:
        raise RoomError(Refusal.TOO_FEW_SONGS) from None
    settle_due(ctx, workspace_id, room_id, now=now)
    if not ctx.speakers.speaker_online(workspace_id):
        raise RoomError(Refusal.NO_SPEAKER)
    with transaction(ctx.engine, workspace_id) as conn:
        room = load_room(conn, workspace_id, room_id)
    playable = _requestable(ctx, room, wanted)
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = live_room(conn, workspace_id, room_id)
        if not room.settings.rounds:
            raise RoomError(Refusal.FEATURE_OFF)
        if open_round_of(conn, room) is not None:
            raise RoomError(Refusal.ROUND_OPEN)
        # a song a guest is already waiting on is on its way in; voting on it would only delay it
        waiting = {request.song_id for request in room_requests_where(conn, room, WAITING)}
        offered = [song_id for song_id in wanted if song_id in playable and song_id not in waiting]
        if len(offered) < rules.MIN_OPTIONS:
            raise RoomError(Refusal.TOO_FEW_SONGS)
        round_id = new_id()
        made = passes_unique(
            conn,
            sa.insert(room_rounds).values(
                id=round_id,
                room_id=room.id,
                workspace_id=workspace_id,
                status=rules.OPEN,
                opened_by="timer" if opened_by == "timer" else "host",
                opened_at=now,
                closes_at=now + float(room.settings.round_seconds),
            ),
        )
        if not made:
            raise RoomError(Refusal.ROUND_OPEN)
        for position, song_id in enumerate(offered):
            conn.execute(
                sa.insert(room_round_options).values(
                    id=new_id(),
                    round_id=round_id,
                    room_id=room.id,
                    workspace_id=workspace_id,
                    position=position,
                    song_id=song_id,
                    votes=0,
                )
            )
        ctx.publish(conn, room, EVENT, {"round_id": round_id, "state": rules.OPEN})
        opened = load_round(conn, room, round_id)
    assert opened is not None
    return opened


def want_round(
    ctx: RoomContext, workspace_id: str, room_id: str, *, opened_by: str = "host"
) -> None:
    """Tell the speaker's browser the room wants a vote. It answers by opening one with the
    songs it can blend into, or not at all when the song has too little left."""
    with transaction(ctx.engine, workspace_id) as conn:
        load_room(conn, workspace_id, room_id)  # another workspace's room is no room at all
    if not ctx.speakers.speaker_online(workspace_id):
        raise RoomError(Refusal.NO_SPEAKER)
    with transaction(ctx.engine, workspace_id) as conn:
        room = live_room(conn, workspace_id, room_id)
        if not room.settings.rounds:
            raise RoomError(Refusal.FEATURE_OFF)
        if open_round_of(conn, room) is not None:
            raise RoomError(Refusal.ROUND_OPEN)
        ctx.publish(conn, room, EVENT, {"state": "wanted", "opened_by": opened_by})


def cast(
    ctx: RoomContext, guest_token: str, round_id: str, position: int, *, now: float | None = None
) -> Round:
    """A guest votes, or changes their vote. One vote each; voting twice for the same song
    changes nothing."""
    ref = resolve_guest(ctx, guest_token)
    workspace_id = ref.workspace_id
    settle_due(ctx, workspace_id, ref.room_id, now=now)
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = live_room(conn, workspace_id, ref.room_id)
        if not room.settings.rounds:
            raise RoomError(Refusal.FEATURE_OFF)
        guest = active_guest(conn, room, ref.guest_id, now)
        current = open_round_of(conn, room)
        if current is None or current.id != round_id or now >= current.closes_at:
            raise RoomError(Refusal.NO_ROUND)
        if guest.joined_at > current.opened_at:
            # a new cookie is a new guest, so a vote could be stuffed by joining again
            raise RoomError(Refusal.JOINED_LATE)
        if not any(option.position == position for option in current.options):
            raise RoomError(Refusal.NOT_AN_OPTION)
        mine = (
            room_round_votes.c.round_id == current.id,
            room_round_votes.c.guest_id == guest.id,
        )
        changed = conn.execute(
            sa.update(room_round_votes).where(*mine).values(position=position)
        ).rowcount
        if not changed:
            passes_unique(
                conn,
                sa.insert(room_round_votes).values(
                    id=new_id(),
                    round_id=current.id,
                    room_id=room.id,
                    workspace_id=workspace_id,
                    guest_id=guest.id,
                    position=position,
                    created_at=now,
                ),
            )
        _recount(conn, current.id)
        voted = load_round(conn, room, current.id)
    assert voted is not None
    return voted


def my_vote(conn: Connection, round_id: str, guest_id: str) -> int | None:
    found = conn.execute(
        sa.select(room_round_votes.c.position).where(
            room_round_votes.c.round_id == round_id, room_round_votes.c.guest_id == guest_id
        )
    ).scalar()
    return None if found is None else int(found)


def cancel(ctx: RoomContext, workspace_id: str, room_id: str, round_id: str) -> Round:
    """The host calls the vote off. A round that already closed is left as it finished."""
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, None)
        room = load_room(conn, workspace_id, room_id, lock=True)
        current = load_round(conn, room, round_id)
        if current is None:
            raise RoomError(Refusal.NO_ROUND)
        if current.open:
            conn.execute(
                sa.update(room_rounds)
                .where(room_rounds.c.id == current.id, room_rounds.c.status == rules.OPEN)
                .values(status=rules.CANCELLED, closed_at=now, outcome="called_off")
            )
            ctx.publish(conn, room, EVENT, {"round_id": current.id, "state": rules.CANCELLED})
        done = load_round(conn, room, round_id)
    assert done is not None
    return done


def _carry_winner(conn: Connection, room: Room, song_id: int, votes: int, now: float) -> str:
    """Put the winning song on its way into the mix and return the request that carries it.

    A request already waiting for the song (a guest asked while the room was voting) is the one
    promoted, accepted whatever the host's approval setting: the room has decided. Otherwise a
    request with no asker is made. Either way it is marked as the room's pick."""
    existing = room_requests_where(conn, room, WAITING, song_id=song_id)
    if not existing:
        request_id = new_id()
        made = passes_unique(
            conn,
            sa.insert(room_requests).values(
                id=request_id,
                room_id=room.id,
                workspace_id=room.workspace_id,
                guest_id=None,
                song_id=song_id,
                status=RequestStatus.ACCEPTED.value,
                votes=votes,
                created_at=now,
                approved_at=now,
                source="round",
            ),
        )
        if made:
            return request_id
        existing = room_requests_where(conn, room, WAITING, song_id=song_id)
    request = existing[0]
    set_request(
        conn,
        request.id,
        status=RequestStatus.ACCEPTED,
        approved_at=request.approved_at or now,
        reason=None,
        source="round",
    )
    return request.id


def settle_due(
    ctx: RoomContext, workspace_id: str, room_id: str, *, now: float | None = None
) -> Round | None:
    """Close the room's round if its time is up, and send its winner towards the mix.

    Safe to call on every look at the room: with nothing due it is one small read. Returns the
    round it closed, or None."""
    with transaction(ctx.engine, workspace_id) as conn:
        at = resolve_now(conn, now)
        room = load_room(conn, workspace_id, room_id)
        due = open_round_of(conn, room)
        if due is None or (room.live and at < due.closes_at):
            return None
    playable = _requestable(ctx, room, [option.song_id for option in due.options])
    with transaction(ctx.engine, workspace_id) as conn:
        at = resolve_now(conn, now)
        room = load_room(conn, workspace_id, room_id, lock=True)
        current = open_round_of(conn, room)
        if current is None or current.id != due.id:
            return None  # someone else closed it while the catalogue was asked
        if not room.live:
            values: dict[str, Any] = {"status": rules.CANCELLED, "outcome": "room_ended"}
        elif at < current.closes_at:
            return None
        else:
            won = rules.winner(current.id, current.options, playable)
            if won is None:
                values = {"status": rules.VOID, "outcome": rules.void_reason(current.total)}
            else:
                values = {
                    "status": rules.CLOSED,
                    "winner_song_id": won.song_id,
                    "winner_request_id": _carry_winner(conn, room, won.song_id, won.votes, at),
                    "outcome": rules.WAITING,
                }
        conn.execute(
            sa.update(room_rounds)
            .where(room_rounds.c.id == current.id, room_rounds.c.status == rules.OPEN)
            .values(closed_at=at, **values)
        )
        ctx.publish(conn, room, EVENT, {"round_id": current.id, "state": values["status"]})
        closed = load_round(conn, room, current.id)
    if closed is not None and closed.winner_request_id is not None:
        # the same hand-over as any accepted request: the host's browser hears of it at once
        pump(ctx, workspace_id, room_id)
    return closed


def forget_vote(conn: Connection, room: Room, guest_id: str) -> None:
    """A guest who left, was put out or was banned no longer has a say in the open vote."""
    current = open_round_of(conn, room)
    if current is None:
        return
    removed = conn.execute(
        sa.delete(room_round_votes).where(
            room_round_votes.c.round_id == current.id, room_round_votes.c.guest_id == guest_id
        )
    ).rowcount
    if removed:
        _recount(conn, current.id)


def timer_due(conn: Connection, room: Room, now: float, guests_here: int) -> bool:
    """Should the room start a vote by itself on this look? Only when the host set "every N
    songs", two guests are here to vote, nothing is open, the last winner is not still waiting,
    this song has only just started, and it is the Nth since the last round."""
    every = room.settings.round_every_songs
    if not room.live or not room.settings.rounds or every <= 0:
        return False
    if guests_here < rules.MIN_VOTERS:
        return False
    last = (
        conn.execute(
            sa.select(room_rounds)
            .where(*_mine(room))
            .order_by(room_rounds.c.opened_at.desc(), room_rounds.c.id.desc())
            .limit(1)
        )
        .mappings()
        .first()
    )
    since = room.created_at
    if last is not None:
        latest = _round(conn, last)
        if latest.open or latest.outcome == rules.WAITING:
            return False
        since = latest.opened_at
    newest = conn.execute(
        sa.select(room_plays.c.id, room_plays.c.started_at)
        .where(room_plays.c.workspace_id == room.workspace_id, room_plays.c.room_id == room.id)
        .order_by(room_plays.c.started_at.desc(), room_plays.c.id.desc())
        .limit(1)
    ).first()
    if newest is None or now - newest.started_at > TIMER_FRESH_SECONDS:
        return False
    played = conn.execute(
        sa.select(sa.func.count())
        .select_from(room_plays)
        .where(
            room_plays.c.workspace_id == room.workspace_id,
            room_plays.c.room_id == room.id,
            room_plays.c.started_at > since,
        )
    ).scalar_one()
    if played < every:
        return False
    with _asked_lock:
        if _asked.get(room.id) == newest.id:
            return False
        if len(_asked) > 5000:
            _asked.clear()
        _asked[room.id] = newest.id
    return True


__all__ = [
    "EVENT",
    "RESULT_SECONDS",
    "Round",
    "cancel",
    "cast",
    "forget_vote",
    "load_round",
    "my_vote",
    "open_round",
    "open_round_of",
    "settle_due",
    "showing",
    "timer_due",
    "want_round",
]
