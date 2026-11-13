"""What a guest, the host and a display may see.

A guest sees the room name the host chose (never the host's name or email), what's playing and
next, the requests waiting, and their own requests with honest states: Sent, Accepted (with
"playing in about 12 min" when the planner knows), passed, can't fit, played. Nicknames are shown
to other guests only if the host chose that; the host always sees them.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import transaction
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.lifecycle import room_code
from selecta.rooms.ordering import inbox_order
from selecta.rooms.planning import queue_order, renders_left
from selecta.rooms.ports import NowPlaying, SongSummary
from selecta.rooms.schema import display_pairings, room_guests, room_requests, room_votes
from selecta.rooms.settings import RequestMode, RoomSettings
from selecta.rooms.store import (
    GuestStatus,
    RequestStatus,
    Room,
    RoomContext,
    RoomRequest,
    RoomStatus,
    guest_from_row,
    load_guest,
    load_room,
    request_from_row,
    resolve_guest,
    resolve_now,
    room_requests_where,
)

MY_REQUESTS_SHOWN = 20
# Presence. An open guest page reads the room every 5 s and a big screen every 3 s, so a guest
# not seen for a minute or a screen not seen for 30 s has gone (closed the tab, lost signal, or
# the server restarted under them).
GUEST_ONLINE_SECONDS = 60.0
DISPLAY_ONLINE_SECONDS = 30.0

STATUS_TEXT = {
    RequestStatus.SENT: "Sent",
    RequestStatus.ACCEPTED: "Accepted",
    RequestStatus.PASSED: "The host passed on this one",
    RequestStatus.UNFIT: "Can't fit this into the mix right now",
    RequestStatus.PLAYED: "Played",
    RequestStatus.WITHDRAWN: "Withdrawn",
}
WITHDRAWN_TEXT = {
    "guest": "You withdrew this",
    "banned": "Withdrawn",
    "song_gone": "This song isn't available any more",
    "room_ended": "The room ended before this one played",
}


@dataclass(frozen=True)
class UpcomingItem:
    request_id: str
    song: SongSummary | None
    status: RequestStatus
    votes: int
    nickname: str | None  # None when names are hidden from this viewer
    voted: bool = False  # this guest has voted for it
    mine: bool = False


@dataclass(frozen=True)
class MyRequest:
    request_id: str
    song: SongSummary | None
    status: RequestStatus
    text: str
    votes: int
    minutes_until: float | None = None


@dataclass(frozen=True)
class GuestView:
    room_name: str
    room_status: RoomStatus
    nickname: str
    names_shown: bool
    votes_on: bool
    requests_open: bool
    music_paused: bool  # no speaker online: "The music's paused"
    now_playing: SongSummary | None = None
    up_next: tuple[SongSummary, ...] = ()
    coming_up: tuple[UpcomingItem, ...] = ()  # accepted, in the order they'll reach the mix
    waiting: tuple[UpcomingItem, ...] = ()  # sent, waiting for the host
    my_requests: tuple[MyRequest, ...] = ()


@dataclass(frozen=True)
class GuestSummary:
    guest_id: str
    nickname: str
    status: GuestStatus
    joined_at: float
    last_seen_at: float
    online: bool = False  # their page checked in within GUEST_ONLINE_SECONDS


@dataclass(frozen=True)
class ScreenSummary:
    """A paired big screen, numbered in the order it was paired."""

    display_id: str
    label: str
    paired_at: float | None
    last_seen_at: float | None
    online: bool


@dataclass(frozen=True)
class HostView:
    room: Room
    code: str | None = field(repr=False)  # never in repr
    settings: RoomSettings
    guests: tuple[GuestSummary, ...]
    inbox: tuple[UpcomingItem, ...]  # sent, most wanted first
    coming_up: tuple[UpcomingItem, ...]  # accepted, in order
    unfit: tuple[UpcomingItem, ...]  # couldn't fit; the host may approve them again
    renders_left: int
    music_paused: bool
    displays: int  # paired screens, online or not
    screens: tuple[ScreenSummary, ...] = ()
    now: float = 0.0  # the server's clock, so "last seen 5 min ago" ignores the host's clock


def is_online(
    last_seen_at: float | None, now: float, window: float, started_at: float | None = None
) -> bool:
    """Seen within the window, and since this app instance came up (see `RoomContext`)."""
    if last_seen_at is None or last_seen_at <= now - window:
        return False
    return started_at is None or last_seen_at >= started_at


def now_playing_for(ctx: RoomContext, workspace_id: str) -> NowPlaying:
    return ctx.now_playing.now_playing(workspace_id)


def nickname_map(conn: Connection, room: Room) -> dict[str, str]:
    rows = conn.execute(
        sa.select(room_guests.c.id, room_guests.c.nickname).where(room_guests.c.room_id == room.id)
    )
    return {row.id: row.nickname for row in rows}


def describe_songs(
    ctx: RoomContext, room: Room, requests: Iterable[RoomRequest]
) -> Mapping[int, SongSummary]:
    ids = {request.song_id for request in requests}
    return ctx.catalog.describe(room.workspace_id, ids) if ids else {}


def as_items(
    requests: Sequence[RoomRequest],
    songs: Mapping[int, SongSummary],
    names: Mapping[str, str],
    *,
    show_names: bool,
    voted: Iterable[str] = (),
    me: str | None = None,
) -> tuple[UpcomingItem, ...]:
    voted = set(voted)
    return tuple(
        UpcomingItem(
            request_id=request.id,
            song=songs.get(request.song_id),
            status=request.status,
            votes=request.votes,
            nickname=names.get(request.guest_id) if show_names else None,
            voted=request.id in voted,
            mine=request.guest_id == me,
        )
        for request in requests
    )


def guest_view(ctx: RoomContext, guest_token: str, *, now: float | None = None) -> GuestView:
    ref = resolve_guest(ctx, guest_token)
    workspace_id = ref.workspace_id
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = load_room(conn, workspace_id, ref.room_id)
        guest = load_guest(conn, room, ref.guest_id)
        if guest.status is GuestStatus.BANNED:
            raise RoomError(Refusal.BANNED)
        if guest.status is GuestStatus.REMOVED:
            raise RoomError(Refusal.NOT_A_GUEST)
        conn.execute(
            sa.update(room_guests).where(room_guests.c.id == guest.id).values(last_seen_at=now)
        )
        mine = [
            request_from_row(row)
            for row in conn.execute(
                sa.select(room_requests)
                .where(room_requests.c.guest_id == guest.id)
                .order_by(room_requests.c.created_at.desc())
                .limit(MY_REQUESTS_SHOWN)
            ).mappings()
        ]
        if not room.live:
            coming_up: list[RoomRequest] = []
            waiting: list[RoomRequest] = []
        else:
            coming_up = queue_order(conn, room, now)
            waiting = inbox_order(
                room_requests_where(conn, room, [RequestStatus.SENT]),
                votes_on=room.settings.votes,
            )
        voted = conn.execute(
            sa.select(room_votes.c.request_id).where(room_votes.c.guest_id == guest.id)
        ).scalars()
        voted = set(voted)
        names = nickname_map(conn, room)
    settings = room.settings
    base = GuestView(
        room_name=room.name,
        room_status=room.status,
        nickname=guest.nickname,
        names_shown=settings.names_shown,
        votes_on=settings.votes,
        requests_open=(
            room.live
            and guest.status is GuestStatus.ACTIVE
            and settings.request_mode is not RequestMode.OFF
        ),
        music_paused=room.live and not ctx.speakers.speaker_online(workspace_id),
    )
    songs = describe_songs(ctx, room, [*mine, *coming_up, *waiting])
    my_requests = tuple(_mine(ctx, workspace_id, request, songs) for request in mine)
    if not room.live or guest.status is not GuestStatus.ACTIVE:
        return replace(base, my_requests=my_requests)
    playing = now_playing_for(ctx, workspace_id)
    show = settings.names_shown
    return replace(
        base,
        now_playing=playing.current,
        up_next=playing.up_next,
        coming_up=as_items(coming_up, songs, names, show_names=show, voted=voted, me=guest.id),
        waiting=as_items(waiting, songs, names, show_names=show, voted=voted, me=guest.id),
        my_requests=my_requests,
    )


def _mine(
    ctx: RoomContext, workspace_id: str, request: RoomRequest, songs: Mapping[int, SongSummary]
) -> MyRequest:
    text = STATUS_TEXT[request.status]
    if request.status is RequestStatus.WITHDRAWN and request.reason in WITHDRAWN_TEXT:
        text = WITHDRAWN_TEXT[request.reason]
    minutes = None
    if request.status is RequestStatus.ACCEPTED and request.song_request_id:
        minutes = ctx.now_playing.minutes_until(workspace_id, request.song_request_id)
        if minutes is not None:
            text = f"Accepted, playing in about {max(1, round(minutes))} min"
    return MyRequest(
        request.id, songs.get(request.song_id), request.status, text, request.votes, minutes
    )


def host_view(
    ctx: RoomContext, workspace_id: str, room_id: str, *, now: float | None = None
) -> HostView:
    """The room panel: code, settings, guests, the inbox and the queue."""
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = load_room(conn, workspace_id, room_id)
        guests = tuple(
            GuestSummary(
                g.id,
                g.nickname,
                g.status,
                g.joined_at,
                g.last_seen_at,
                is_online(g.last_seen_at, now, GUEST_ONLINE_SECONDS, ctx.started_at),
            )
            for g in (
                guest_from_row(row)
                for row in conn.execute(
                    sa.select(room_guests)
                    .where(room_guests.c.room_id == room.id)
                    .order_by(room_guests.c.joined_at)
                ).mappings()
            )
        )
        coming_up = queue_order(conn, room, now) if room.live else []
        inbox = inbox_order(
            room_requests_where(conn, room, [RequestStatus.SENT]), votes_on=room.settings.votes
        )
        unfit = room_requests_where(conn, room, [RequestStatus.UNFIT])
        left = renders_left(conn, room, now)
        screens = tuple(
            ScreenSummary(
                row.id,
                f"Screen {number}",
                row.paired_at,
                row.last_seen_at,
                is_online(row.last_seen_at, now, DISPLAY_ONLINE_SECONDS, ctx.started_at),
            )
            for number, row in enumerate(
                conn.execute(
                    sa.select(
                        display_pairings.c.id,
                        display_pairings.c.paired_at,
                        display_pairings.c.last_seen_at,
                    )
                    .where(
                        display_pairings.c.workspace_id == workspace_id,
                        display_pairings.c.room_id == room.id,
                        display_pairings.c.expires_at > now,
                    )
                    .order_by(display_pairings.c.paired_at, display_pairings.c.id)
                ),
                start=1,
            )
        )
        names = nickname_map(conn, room)
    songs = describe_songs(ctx, room, [*coming_up, *inbox, *unfit])
    return HostView(
        room=room,
        code=room_code(ctx, room),
        settings=room.settings,
        guests=guests,
        inbox=as_items(inbox, songs, names, show_names=True),
        coming_up=as_items(coming_up, songs, names, show_names=True),
        unfit=as_items(unfit, songs, names, show_names=True),
        renders_left=left,
        music_paused=room.live and not ctx.speakers.speaker_online(workspace_id),
        displays=len(screens),
        screens=screens,
        now=now,
    )
