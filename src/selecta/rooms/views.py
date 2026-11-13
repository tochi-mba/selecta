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
from selecta.rooms.local_first import (
    LocalNowPlaying,
    LocalStage,
    fresh,
    ready_speaker,
    valid_progress,
    visible,
)
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
    "expired": "The local request expired before it could play",
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
    stage: str = "requested"


@dataclass(frozen=True)
class MyRequest:
    request_id: str
    song: SongSummary | None
    status: RequestStatus
    text: str
    votes: int
    minutes_until: float | None = None
    stage: str = "requested"


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
    local_first: bool = False


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
    local_first: bool = False


def is_online(
    last_seen_at: float | None, now: float, window: float, started_at: float | None = None
) -> bool:
    """Seen within the window, and since this app instance came up (see `RoomContext`)."""
    if last_seen_at is None or last_seen_at <= now - window:
        return False
    return started_at is None or last_seen_at >= started_at


def now_playing_for(
    ctx: RoomContext, workspace_id: str, *, room: Room | None = None,
    now: float | None = None,
) -> NowPlaying:
    if ctx.local_first is None:
        return ctx.now_playing.now_playing(workspace_id)
    # A legacy workspace-wide snapshot could describe a different speaker/zone.
    if room is None or now is None or room.workspace_id != workspace_id:
        return NowPlaying(None)
    try:
        speaker = ctx.local_first.speaker(workspace_id, room.settings.zone_id)
        snapshot = ctx.local_first.now_playing(workspace_id, room.settings.zone_id)
    except Exception:
        return NowPlaying(None)
    if (
        not ready_speaker(speaker, workspace_id, room.settings.zone_id, now)
        or not isinstance(snapshot, LocalNowPlaying)
        or snapshot.workspace_id != workspace_id
        or snapshot.zone_id != room.settings.zone_id
        or snapshot.generation != speaker.generation
        or not fresh(snapshot.checked_at, now)
    ):
        return NowPlaying(None)
    current = visible(
        snapshot.current, workspace_id, room.settings.zone_id, now,
        clean_only=room.settings.clean_only,
    )
    following = tuple(
        song for entry in snapshot.up_next[:3]
        if (song := visible(
            entry, workspace_id, room.settings.zone_id, now,
            clean_only=room.settings.clean_only,
        )) is not None
    )
    return NowPlaying(current, following)


def speaker_ready(ctx: RoomContext, room: Room, now: float) -> bool:
    if ctx.local_first is None:
        return ctx.speakers.speaker_online(room.workspace_id)
    try:
        speaker = ctx.local_first.speaker(room.workspace_id, room.settings.zone_id)
    except Exception:
        return False
    return ready_speaker(speaker, room.workspace_id, room.settings.zone_id, now)


def request_stage(ctx: RoomContext, room: Room, request: RoomRequest, now: float) -> str:
    if request.status is RequestStatus.SENT:
        return LocalStage.AWAITING_MODERATION.value
    if request.status is RequestStatus.PASSED:
        return LocalStage.REJECTED.value
    if request.status is RequestStatus.UNFIT:
        return LocalStage.DEFERRED.value
    if request.status is RequestStatus.WITHDRAWN:
        return (
            LocalStage.EXPIRED.value
            if request.reason in ("room_ended", "expired")
            else LocalStage.WITHDRAWN.value
        )
    if request.status is RequestStatus.PLAYED:
        return LocalStage.PLAYED.value
    if request.status is RequestStatus.ACCEPTED:
        if ctx.local_first is None:
            return LocalStage.ACCEPTED.value
        if request.song_request_id:
            try:
                progress = ctx.local_first.progress(
                    room.workspace_id, room.settings.zone_id, request.song_request_id
                )
            except Exception:
                progress = None
            if valid_progress(
                progress, room.workspace_id, room.settings.zone_id, request.song_request_id
            ) and progress.stage in (
                LocalStage.LOCALLY_SCHEDULED, LocalStage.PREPARED, LocalStage.PLAYED
            ):
                # A played progress is not stored as played until the trusted
                # record_outcome callback confirms it; don't leapfrog the DB.
                return (
                    progress.stage.value if progress.stage is not LocalStage.PLAYED
                    else LocalStage.PREPARED.value
                )
            return LocalStage.LOCALLY_SCHEDULED.value  # durable ack ID stored by pump
        return (LocalStage.ACCEPTED.value if speaker_ready(ctx, room, now)
                else LocalStage.DEFERRED.value)
    return LocalStage.REQUESTED.value


def nickname_map(conn: Connection, room: Room) -> dict[str, str]:
    rows = conn.execute(
        sa.select(room_guests.c.id, room_guests.c.nickname).where(room_guests.c.room_id == room.id)
    )
    return {row.id: row.nickname for row in rows}


def describe_songs(
    ctx: RoomContext, room: Room, requests: Iterable[RoomRequest], *,
    now: float | None = None,
) -> Mapping[int, SongSummary]:
    ids = {request.song_id for request in requests}
    if not ids:
        return {}
    if ctx.local_first is None:
        return ctx.catalog.describe(room.workspace_id, ids)
    try:
        entries = ctx.local_first.describe(room.workspace_id, room.settings.zone_id, ids)
    except Exception:
        return {}
    # Recheck every metadata DTO to prevent another zone's catalogue leaking to guests.
    if now is None:
        from selecta.persistence import db_now
        with ctx.engine.connect() as conn:
            now = db_now(conn)
    results: dict[int, SongSummary] = {}
    for song_id in ids:
        song = visible(
            entries.get(song_id), room.workspace_id, room.settings.zone_id, now,
            clean_only=room.settings.clean_only,
        )
        if song is not None and song.song_id == song_id:
            results[song_id] = song
    return results


def as_items(
    requests: Sequence[RoomRequest],
    songs: Mapping[int, SongSummary],
    names: Mapping[str, str],
    *,
    show_names: bool,
    voted: Iterable[str] = (),
    me: str | None = None,
    stages: Mapping[str, str] | None = None,
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
            stage=stages.get(request.id, "requested") if stages else "requested",
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
        music_paused=room.live and not speaker_ready(ctx, room, now),
        local_first=ctx.local_first is not None,
    )
    songs = describe_songs(ctx, room, [*mine, *coming_up, *waiting], now=now)
    my_requests = tuple(_mine(ctx, room, request, songs, now) for request in mine)
    if not room.live or guest.status is not GuestStatus.ACTIVE:
        return replace(base, my_requests=my_requests)
    playing = now_playing_for(ctx, workspace_id, room=room, now=now)
    show = settings.names_shown
    stages = {request.id: request_stage(ctx, room, request, now)
              for request in [*coming_up, *waiting]}
    return replace(
        base,
        now_playing=playing.current,
        up_next=playing.up_next,
        coming_up=as_items(coming_up, songs, names, show_names=show, voted=voted,
                           me=guest.id, stages=stages),
        waiting=as_items(waiting, songs, names, show_names=show, voted=voted,
                         me=guest.id, stages=stages),
        my_requests=my_requests,
    )


def _mine(
    ctx: RoomContext, room: Room, request: RoomRequest,
    songs: Mapping[int, SongSummary], now: float,
) -> MyRequest:
    stage = request_stage(ctx, room, request, now)
    text = STATUS_TEXT[request.status]
    if request.status is RequestStatus.WITHDRAWN and request.reason in WITHDRAWN_TEXT:
        text = WITHDRAWN_TEXT[request.reason]
    minutes = None
    if ctx.local_first is not None:
        text = {
            LocalStage.AWAITING_MODERATION.value: "Waiting for the host to review",
            LocalStage.ACCEPTED.value: "Accepted by the host; awaiting local scheduling",
            LocalStage.DEFERRED.value: "Deferred: the venue speaker or recording is unavailable",
            LocalStage.LOCALLY_SCHEDULED.value: "Scheduled on the venue speaker",
            LocalStage.PREPARED.value: "Prepared on the venue speaker",
            LocalStage.PLAYED.value: "Played on the venue speaker",
            LocalStage.REJECTED.value: "The host passed on this one",
            LocalStage.EXPIRED.value: "Expired when the room ended",
        }.get(stage, text)
        if request.status is RequestStatus.UNFIT and request.reason == "unavailable":
            text = "Can't schedule: this recording is no longer available"
        elif request.status is RequestStatus.UNFIT and request.reason == "blocked":
            text = "Blocked by the venue's music policy"
    elif request.status is RequestStatus.ACCEPTED and request.song_request_id:
        minutes = ctx.now_playing.minutes_until(room.workspace_id, request.song_request_id)
        if minutes is not None:
            text = f"Accepted, playing in about {max(1, round(minutes))} min"
    return MyRequest(
        request.id, songs.get(request.song_id), request.status, text, request.votes, minutes,
        stage,
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
    songs = describe_songs(ctx, room, [*coming_up, *inbox, *unfit], now=now)
    return HostView(
        room=room,
        code=room_code(ctx, room),
        settings=room.settings,
        guests=guests,
        inbox=as_items(inbox, songs, names, show_names=True,
                       stages={r.id: request_stage(ctx, room, r, now) for r in inbox}),
        coming_up=as_items(coming_up, songs, names, show_names=True,
                           stages={r.id: request_stage(ctx, room, r, now) for r in coming_up}),
        unfit=as_items(unfit, songs, names, show_names=True,
                       stages={r.id: request_stage(ctx, room, r, now) for r in unfit}),
        renders_left=left,
        music_paused=room.live and not speaker_ready(ctx, room, now),
        displays=len(screens),
        screens=screens,
        now=now,
        local_first=ctx.local_first is not None,
    )
