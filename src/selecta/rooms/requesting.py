"""Guest requests, votes, and the host's decisions on them.

A guest picks a song from the host's requestable songs; there's no free text. The request is
checked against the room's crate and the library (mix-ready, not set aside), the replay cooldown,
and the limits: by default one waiting request per guest, three an hour, twenty waiting in the
room. A song someone has already asked for doesn't make a second request: the new ask becomes a
vote. In an auto-accept room the request is accepted at once; otherwise the host approves or
passes it. Accepted requests reach the planner in round-robin order (see `planning`).

The planner tells the room what happened through `record_outcome`: played, couldn't fit, or the
song left the library. "Couldn't fit" isn't final: the host can approve it again later.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import new_id, transaction
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.planning import pump, queue_order, renders_left, withdraw_from_planner
from selecta.rooms.ports import SongSummary
from selecta.rooms.schema import room_requests, room_votes
from selecta.rooms.settings import RequestMode
from selecta.rooms.store import (
    PENDING,
    WAITING,
    Guest,
    RequestStatus,
    Room,
    RoomContext,
    RoomRequest,
    active_guest,
    live_room,
    load_request,
    load_room,
    passes_unique,
    recount_votes,
    request_from_row,
    resolve_guest,
    resolve_now,
    room_requests_where,
    set_request,
)

HOUR = 3600.0
SEARCH_LIMIT_MAX = 50
QUERY_MAX = 80


class Outcome(StrEnum):
    PLAYED = "played"
    UNFIT = "unfit"
    SONG_GONE = "song_gone"


@dataclass(frozen=True)
class RequestOutcome:
    request: RoomRequest
    became_vote: bool = False  # someone had asked already; this ask became a vote for it
    already_queued: bool = False  # it was already waiting and nothing changed


def search(
    ctx: RoomContext, guest_token: str, query: str, limit: int = 20
) -> list[SongSummary]:
    """Requestable songs matching what the guest typed: title, artist and length only."""
    ref = resolve_guest(ctx, guest_token)
    with transaction(ctx.engine, ref.workspace_id) as conn:
        now = resolve_now(conn, None)
        room = live_room(conn, ref.workspace_id, ref.room_id)
        active_guest(conn, room, ref.guest_id, now)
    limit = max(1, min(int(limit), SEARCH_LIMIT_MAX))
    return ctx.catalog.search(
        ref.workspace_id, (query or "").strip()[:QUERY_MAX], room.settings.crate, limit
    )


def request(
    ctx: RoomContext, guest_token: str, song_id: int, *, now: float | None = None
) -> RequestOutcome:
    """A guest asks for a song."""
    if isinstance(song_id, bool) or not isinstance(song_id, int):
        raise RoomError(Refusal.NOT_REQUESTABLE)
    ref = resolve_guest(ctx, guest_token)
    workspace_id = ref.workspace_id
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = live_room(conn, workspace_id, ref.room_id)
        guest = active_guest(conn, room, ref.guest_id, now)
        if room.settings.request_mode is RequestMode.OFF:
            raise RoomError(Refusal.REQUESTS_OFF)
        existing = room_requests_where(conn, room, WAITING, song_id=song_id)
        if existing:
            outcome = _ask_again(conn, ctx, room, guest, existing[0], now)
        else:
            _check_song(conn, ctx, room, song_id, now)
            _check_limits(conn, room, guest, now)
            outcome = RequestOutcome(_create(conn, ctx, room, guest, song_id, now))
    if outcome.request.status is RequestStatus.ACCEPTED and not outcome.already_queued:
        pump(ctx, workspace_id, room.id, now=now)
        outcome = RequestOutcome(
            _reload(ctx, room, outcome.request.id), outcome.became_vote, outcome.already_queued
        )
    return outcome


def _ask_again(
    conn: Connection,
    ctx: RoomContext,
    room: Room,
    guest: Guest,
    existing: RoomRequest,
    now: float,
) -> RequestOutcome:
    if existing.guest_id == guest.id or not room.settings.votes:
        return RequestOutcome(existing, already_queued=True)
    _add_vote(conn, room, existing.id, guest.id, now)
    ctx.publish(conn, room, "room.request", {"request_id": existing.id})
    return RequestOutcome(load_request(conn, room, existing.id), became_vote=True)


def _check_song(
    conn: Connection, ctx: RoomContext, room: Room, song_id: int, now: float
) -> None:
    crate = room.settings.crate
    if crate is not None and song_id not in crate:
        raise RoomError(Refusal.NOT_REQUESTABLE)
    if not ctx.catalog.is_requestable(room.workspace_id, song_id):
        raise RoomError(Refusal.NOT_REQUESTABLE)
    cooldown = room.settings.replay_cooldown_minutes * 60.0
    if cooldown <= 0:
        return
    played_in_room = conn.execute(
        sa.select(sa.func.max(room_requests.c.resolved_at)).where(
            room_requests.c.room_id == room.id,
            room_requests.c.song_id == song_id,
            room_requests.c.status == RequestStatus.PLAYED.value,
        )
    ).scalar_one()
    played_in_mix = ctx.catalog.last_played_at(room.workspace_id, song_id)
    last = max((t for t in (played_in_room, played_in_mix) if t is not None), default=None)
    if last is not None and now - last < cooldown:
        raise RoomError(Refusal.COOLDOWN, retry_after_s=cooldown - (now - last))


def _count(conn: Connection, *conditions: sa.ColumnElement[bool]) -> int:
    return conn.execute(
        sa.select(sa.func.count()).select_from(room_requests).where(*conditions)
    ).scalar_one()


def _check_limits(conn: Connection, room: Room, guest: Guest, now: float) -> None:
    settings = room.settings
    pending = [status.value for status in PENDING]
    mine = room_requests.c.guest_id == guest.id
    if _count(conn, mine, room_requests.c.status.in_(pending)) >= settings.pending_per_guest:
        raise RoomError(Refusal.GUEST_PENDING_LIMIT)
    hour_ago = now - HOUR
    recent = conn.execute(
        sa.select(sa.func.count(), sa.func.min(room_requests.c.created_at)).where(
            mine, room_requests.c.created_at > hour_ago
        )
    ).one()
    if recent[0] >= settings.requests_per_guest_per_hour:
        raise RoomError(Refusal.GUEST_HOURLY_LIMIT, retry_after_s=recent[1] + HOUR - now)
    in_room = _count(
        conn, room_requests.c.room_id == room.id, room_requests.c.status.in_(pending)
    )
    if in_room >= settings.pending_per_room:
        raise RoomError(Refusal.ROOM_BUSY)


def _create(
    conn: Connection, ctx: RoomContext, room: Room, guest: Guest, song_id: int, now: float
) -> RoomRequest:
    auto = room.settings.request_mode is RequestMode.AUTO
    request_id = new_id()
    conn.execute(
        sa.insert(room_requests).values(
            id=request_id,
            room_id=room.id,
            workspace_id=room.workspace_id,
            guest_id=guest.id,
            song_id=song_id,
            status=(RequestStatus.ACCEPTED if auto else RequestStatus.SENT).value,
            votes=0,
            created_at=now,
            approved_at=now if auto else None,
        )
    )
    # Asking counts as wanting it: forty guests asking for one song is one request, forty votes.
    _add_vote(conn, room, request_id, guest.id, now)
    ctx.publish(conn, room, "room.request", {"request_id": request_id})
    return load_request(conn, room, request_id)


def _add_vote(conn: Connection, room: Room, request_id: str, guest_id: str, now: float) -> None:
    passes_unique(
        conn,
        sa.insert(room_votes).values(
            id=new_id(),
            room_id=room.id,
            workspace_id=room.workspace_id,
            request_id=request_id,
            guest_id=guest_id,
            created_at=now,
        ),
    )
    recount_votes(conn, [request_id])


def _reload(ctx: RoomContext, room: Room, request_id: str) -> RoomRequest:
    with transaction(ctx.engine, room.workspace_id) as conn:
        return load_request(conn, room, request_id)


def vote(
    ctx: RoomContext, guest_token: str, request_id: str, *, now: float | None = None
) -> RoomRequest:
    """Upvote a waiting request. Voting twice counts once."""
    ref = resolve_guest(ctx, guest_token)
    with transaction(ctx.engine, ref.workspace_id) as conn:
        now = resolve_now(conn, now)
        room = live_room(conn, ref.workspace_id, ref.room_id)
        guest = active_guest(conn, room, ref.guest_id, now)
        if not room.settings.votes:
            raise RoomError(Refusal.VOTES_OFF)
        target = load_request(conn, room, request_id)
        if target.status not in PENDING:
            raise RoomError(Refusal.NOT_ALLOWED)
        _add_vote(conn, room, target.id, guest.id, now)
        ctx.publish(conn, room, "room.request", {"request_id": target.id})
        return load_request(conn, room, target.id)


def unvote(ctx: RoomContext, guest_token: str, request_id: str) -> RoomRequest:
    """Take a vote back. A guest's ask for their own request can't be taken back this way;
    withdrawing the request does that."""
    ref = resolve_guest(ctx, guest_token)
    with transaction(ctx.engine, ref.workspace_id) as conn:
        now = resolve_now(conn, None)
        room = live_room(conn, ref.workspace_id, ref.room_id)
        guest = active_guest(conn, room, ref.guest_id, now)
        target = load_request(conn, room, request_id)
        if target.guest_id != guest.id:
            conn.execute(
                sa.delete(room_votes).where(
                    room_votes.c.request_id == target.id, room_votes.c.guest_id == guest.id
                )
            )
            recount_votes(conn, [target.id])
            ctx.publish(conn, room, "room.request", {"request_id": target.id})
        return load_request(conn, room, target.id)


def withdraw(
    ctx: RoomContext, guest_token: str, request_id: str, *, now: float | None = None
) -> RoomRequest:
    """A guest takes back their own request."""
    ref = resolve_guest(ctx, guest_token)
    with transaction(ctx.engine, ref.workspace_id) as conn:
        now = resolve_now(conn, now)
        room = live_room(conn, ref.workspace_id, ref.room_id)
        guest = active_guest(conn, room, ref.guest_id, now)
        target = load_request(conn, room, request_id)
        if target.guest_id != guest.id:
            raise RoomError(Refusal.NO_SUCH_REQUEST)
        if target.status not in WAITING:
            raise RoomError(Refusal.NOT_ALLOWED)
        set_request(
            conn, target.id, status=RequestStatus.WITHDRAWN, reason="guest", resolved_at=now
        )
        ctx.publish(conn, room, "room.request", {"request_id": target.id})
        done = load_request(conn, room, target.id)
    withdraw_from_planner(ctx, ref.workspace_id, [target.song_request_id])
    pump(ctx, ref.workspace_id, room.id, now=now)
    return done


def approve(
    ctx: RoomContext,
    workspace_id: str,
    room_id: str,
    request_id: str,
    *,
    now: float | None = None,
) -> RoomRequest:
    """The host accepts a request: one that was sent, or one that couldn't fit before."""
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = live_room(conn, workspace_id, room_id)
        target = load_request(conn, room, request_id)
        if target.status in (RequestStatus.SENT, RequestStatus.UNFIT):
            set_request(
                conn, target.id, status=RequestStatus.ACCEPTED, approved_at=now, reason=None
            )
            ctx.publish(conn, room, "room.request", {"request_id": target.id})
        elif target.status is not RequestStatus.ACCEPTED:
            raise RoomError(Refusal.NOT_ALLOWED)
    pump(ctx, workspace_id, room_id, now=now)
    return _reload(ctx, room, request_id)


def pass_request(
    ctx: RoomContext,
    workspace_id: str,
    room_id: str,
    request_id: str,
    *,
    now: float | None = None,
) -> RoomRequest:
    """The host passes on a request. The guest sees "The host passed on this one"."""
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = live_room(conn, workspace_id, room_id)
        target = load_request(conn, room, request_id)
        if target.status not in WAITING:
            raise RoomError(Refusal.NOT_ALLOWED)
        set_request(conn, target.id, status=RequestStatus.PASSED, reason="host", resolved_at=now)
        ctx.publish(conn, room, "room.request", {"request_id": target.id})
        done = load_request(conn, room, target.id)
    withdraw_from_planner(ctx, workspace_id, [target.song_request_id])
    pump(ctx, workspace_id, room_id, now=now)
    return done


def record_outcome(
    ctx: RoomContext,
    workspace_id: str,
    song_request_id: str,
    outcome: Outcome | str,
    *,
    now: float | None = None,
) -> RoomRequest | None:
    """What the planner did with a room request. None if it isn't a room request."""
    outcome = Outcome(outcome)
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        row = (
            conn.execute(
                sa.select(room_requests)
                .where(
                    room_requests.c.workspace_id == workspace_id,
                    room_requests.c.song_request_id == str(song_request_id),
                    room_requests.c.status.in_([status.value for status in WAITING]),
                )
                .order_by(room_requests.c.created_at.desc())
            )
            .mappings()
            .first()
        )
        if row is None:
            return None
        target = request_from_row(row)
        room = load_room(conn, workspace_id, target.room_id, lock=True)
        if outcome is Outcome.PLAYED:
            set_request(conn, target.id, status=RequestStatus.PLAYED, resolved_at=now)
        elif outcome is Outcome.UNFIT and target.status is RequestStatus.ACCEPTED:
            set_request(conn, target.id, status=RequestStatus.UNFIT)
        elif outcome is Outcome.SONG_GONE:
            set_request(
                conn,
                target.id,
                status=RequestStatus.WITHDRAWN,
                reason="song_gone",
                resolved_at=now,
            )
        ctx.publish(conn, room, "room.request", {"request_id": target.id})
        done = load_request(conn, room, target.id)
    if room.live:
        pump(ctx, workspace_id, room.id, now=now)
    return done


def song_removed(
    ctx: RoomContext, workspace_id: str, song_id: int, *, now: float | None = None
) -> list[RoomRequest]:
    """The host deleted or set aside a song: waiting requests for it are withdrawn, saying why."""
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        row = conn.execute(
            sa.select(room_requests.c.room_id).where(
                room_requests.c.workspace_id == workspace_id,
                room_requests.c.song_id == song_id,
                room_requests.c.status.in_([status.value for status in WAITING]),
            )
        ).first()
        if row is None:
            return []
        room = load_room(conn, workspace_id, row.room_id, lock=True)
        affected = room_requests_where(conn, room, WAITING, song_id=song_id)
        for target in affected:
            set_request(
                conn,
                target.id,
                status=RequestStatus.WITHDRAWN,
                reason="song_gone",
                resolved_at=now,
            )
            ctx.publish(conn, room, "room.request", {"request_id": target.id})
    withdraw_from_planner(ctx, workspace_id, [target.song_request_id for target in affected])
    if room.live:
        pump(ctx, workspace_id, room.id, now=now)
    return affected


def accepted_order(
    ctx: RoomContext, workspace_id: str, room_id: str, *, now: float | None = None
) -> list[RoomRequest]:
    """Accepted requests in the order they reach the mix: approval time, then votes, dealt
    round-robin across guests."""
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = load_room(conn, workspace_id, room_id)
        return queue_order(conn, room, now)


def room_renders_left(
    ctx: RoomContext, workspace_id: str, room_id: str, *, now: float | None = None
) -> int:
    """How many more requests the planner may take from this room this hour."""
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = load_room(conn, workspace_id, room_id)
        return renders_left(conn, room, now)
