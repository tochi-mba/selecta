"""Opening, locking, re-coding and ending a room.

A Premium host has one room open at a time. A room can't open with nothing to request, so it
refuses, saying why, when the host has no mix-ready songs. It ends when the host ends it, after
its hours run out (twelve at most), or after an hour with no speaker device online. When it ends,
requests the planner hasn't been given are withdrawn; ones it already holds carry on into the
host's mix, where the host can still cancel them as usual. In local-first mode a missing
cloud heartbeat cannot prove that a venue speaker stopped its offline playback.

A new code stops the old one working at once. Guests already in stay, unless the host also
chooses to remove everyone; a paired display stays paired because it's tied to the room.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import new_id, transaction
from selecta.rooms import codes
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.planning import pump, withdraw_from_planner
from selecta.rooms.schema import display_pairings, room_guests, room_requests, rooms
from selecta.rooms.settings import RoomSettings
from selecta.rooms.store import (
    LIVE,
    WAITING,
    GuestStatus,
    RequestStatus,
    Room,
    RoomContext,
    RoomStatus,
    current_room_row,
    live_room,
    load_room,
    passes_unique,
    resolve_now,
    room_from_row,
    room_requests_where,
    save_room,
    set_request,
)

ROOM_NAME_MAX = 40
CODE_ATTEMPTS = 8


class EndReason:
    HOST = "host"
    TIME = "time"
    NO_SPEAKER = "no_speaker"


@dataclass(frozen=True)
class OpenedRoom:
    room: Room
    code: str = field(repr=False)  # shown as XXXX-XXXX; never in repr


@dataclass(frozen=True)
class EndedRoom:
    room_id: str
    workspace_id: str
    reason: str


_SPACES = re.compile(r"\s+")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def clean_room_name(name: str | None) -> str:
    # Whitespace first, so a tab or newline between words becomes a space, not nothing.
    text = _CONTROL.sub("", _SPACES.sub(" ", name or "")).strip()
    if not text or len(text) > ROOM_NAME_MAX:
        raise RoomError(Refusal.INVALID_NAME)
    return text


def room_code(ctx: RoomContext, room: Room) -> str | None:
    """The room's current code for the host or a display, worked out from its seed."""
    if not room.live or room.code_seed is None:
        return None
    return codes.display(codes.derive(room.code_seed, ctx.pepper))


def open_room(
    ctx: RoomContext,
    workspace_id: str,
    name: str,
    settings: RoomSettings | Mapping[str, Any] | None = None,
    *,
    now: float | None = None,
) -> OpenedRoom:
    entitlement = ctx.plans.rooms_entitlement(workspace_id)
    if not entitlement.allowed:
        raise RoomError(Refusal.NOT_PREMIUM)
    if settings is None:
        settings = RoomSettings()
    elif not isinstance(settings, RoomSettings):
        settings = RoomSettings.from_json(settings)
    settings = settings.within(entitlement)
    name = clean_room_name(name)
    if ctx.local_first is not None:
        # The room is pinned to a registered zone; never substitute another zone's
        # speaker or an old cloud-upload catalogue when the engine is disconnected.
        from selecta.rooms.local_first import LocalSpeaker

        try:
            speaker = ctx.local_first.speaker(workspace_id, settings.zone_id)
            valid_zone = (
                isinstance(speaker, LocalSpeaker)
                and speaker.workspace_id == workspace_id
                and speaker.zone_id == settings.zone_id
            )
            count = ctx.local_first.count_requestable(
                workspace_id, settings.zone_id, settings.crate, settings.clean_only
            ) if valid_zone else 0
        except Exception:
            count = 0
    else:
        count = ctx.catalog.count_requestable(workspace_id, settings.crate)
    if count <= 0:
        raise RoomError(Refusal.NO_SONGS)
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        if current_room_row(conn, workspace_id) is not None:
            raise RoomError(Refusal.ALREADY_OPEN)
        room_id = new_id()
        for _ in range(CODE_ATTEMPTS):
            seed = codes.new_seed()
            code = codes.derive(seed, ctx.pepper)
            values = {
                "id": room_id,
                "workspace_id": workspace_id,
                "code_hash": codes.code_hash(code, ctx.pepper),
                "code_seed": seed,
                "name": name,
                "status": RoomStatus.OPEN.value,
                "settings": settings.to_json(),
                "created_at": now,
                "ends_at": now + settings.max_hours * 3600,
                "last_speaker_seen_at": now,
            }
            if passes_unique(conn, sa.insert(rooms).values(**values)):
                break
            # Either the code is taken (by a live room, or one closed under 30 days ago) or a
            # second room opened at the same moment.
            if current_room_row(conn, workspace_id) is not None:
                raise RoomError(Refusal.ALREADY_OPEN)
        else:
            raise RuntimeError("Couldn't find an unused room code")
        room = load_room(conn, workspace_id, room_id)
        ctx.publish(conn, room, "room.opened")
    return OpenedRoom(room, codes.display(code))


def current_room(ctx: RoomContext, workspace_id: str) -> Room | None:
    """The workspace's open or locked room, if it has one."""
    with transaction(ctx.engine, workspace_id) as conn:
        row = current_room_row(conn, workspace_id)
        return room_from_row(row) if row else None


def lock(ctx: RoomContext, workspace_id: str, room_id: str) -> Room:
    """No new guests until unlocked; guests already in carry on."""
    return _set_status(ctx, workspace_id, room_id, RoomStatus.LOCKED)


def unlock(ctx: RoomContext, workspace_id: str, room_id: str) -> Room:
    return _set_status(ctx, workspace_id, room_id, RoomStatus.OPEN)


def _set_status(ctx: RoomContext, workspace_id: str, room_id: str, status: RoomStatus) -> Room:
    with transaction(ctx.engine, workspace_id) as conn:
        room = live_room(conn, workspace_id, room_id)
        if room.status is not status:
            save_room(conn, room.id, status=status)
            room = load_room(conn, workspace_id, room_id)
            ctx.publish(conn, room, "room.updated", {"status": status.value})
        return room


def rotate_code(
    ctx: RoomContext, workspace_id: str, room_id: str, *, remove_everyone: bool = False
) -> str:
    """A new code; the old one stops working now. Returns the new code as XXXX-XXXX."""
    with transaction(ctx.engine, workspace_id) as conn:
        room = live_room(conn, workspace_id, room_id)
        for _ in range(CODE_ATTEMPTS):
            seed = codes.new_seed()
            code = codes.derive(seed, ctx.pepper)
            statement = (
                sa.update(rooms)
                .where(rooms.c.id == room.id)
                .values(code_seed=seed, code_hash=codes.code_hash(code, ctx.pepper))
            )
            if passes_unique(conn, statement):
                break
        else:
            raise RuntimeError("Couldn't find an unused room code")
        if remove_everyone:
            conn.execute(
                sa.update(room_guests)
                .where(
                    room_guests.c.room_id == room.id,
                    room_guests.c.status.in_([GuestStatus.ACTIVE.value, GuestStatus.PENDING.value]),
                )
                .values(status=GuestStatus.REMOVED.value)
            )
        ctx.publish(conn, room, "room.updated", {"code_changed": True})
    return codes.display(code)


def update_settings(
    ctx: RoomContext,
    workspace_id: str,
    room_id: str,
    settings: RoomSettings | Mapping[str, Any],
) -> Room:
    """Change an open room's settings. The plan limits copied in at opening can only go down.
    Turning the big screen off unpairs any display."""
    if not isinstance(settings, RoomSettings):
        settings = RoomSettings.from_json(settings)
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, None)
        room = live_room(conn, workspace_id, room_id)
        settings = settings.keeping_limits_of(room.settings)
        # Switching a live room to a different output zone would let old guests
        # schedule requests against a speaker they never joined.
        if ctx.local_first is not None and settings.zone_id != room.settings.zone_id:
            raise RoomError(Refusal.NOT_ALLOWED)
        if ctx.local_first is not None and settings.clean_only and not room.settings.clean_only:
            # A newly restricted policy cannot silently invalidate already
            # committed physical playback on the local speaker.
            scheduled = conn.execute(
                sa.select(room_requests.c.id).where(
                    room_requests.c.workspace_id == workspace_id,
                    room_requests.c.room_id == room.id,
                    room_requests.c.song_request_id.is_not(None),
                    room_requests.c.status.in_(
                        [RequestStatus.ACCEPTED.value, RequestStatus.UNFIT.value]
                    ),
                ).limit(1)
            ).first()
            if scheduled is not None:
                raise RoomError(
                    Refusal.NOT_ALLOWED,
                    "Finish the locally scheduled requests before enabling clean-only music.",
                )
        ends_at = min(room.ends_at, room.created_at + settings.max_hours * 3600)
        save_room(conn, room.id, settings=settings, ends_at=ends_at)
        if room.settings.display and not settings.display:
            expire_displays(conn, room, now)
        room = load_room(conn, workspace_id, room_id)
        ctx.publish(conn, room, "room.updated", {"settings": True})
    pump(ctx, workspace_id, room_id)
    return room


def end_room(
    ctx: RoomContext,
    workspace_id: str,
    room_id: str,
    *,
    reason: str = EndReason.HOST,
    now: float | None = None,
) -> Room:
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = load_room(conn, workspace_id, room_id, lock=True)
        if not room.live:
            return room
        withdrawn = end_in(conn, ctx, room, now, reason)
        room = load_room(conn, workspace_id, room_id)
    withdraw_from_planner(ctx, workspace_id, withdrawn)
    return room


def end_in(
    conn: Connection, ctx: RoomContext, room: Room, now: float, reason: str
) -> list[str | None]:
    """End a locked, live room inside the caller's transaction. Returns the planner requests to
    withdraw once it commits."""
    save_room(conn, room.id, status=RoomStatus.ENDED, ended_at=now, end_reason=reason)
    withdrawn: list[str | None] = []
    for request in room_requests_where(conn, room, WAITING):
        handed_over = request.song_request_id is not None
        if request.status is RequestStatus.ACCEPTED and handed_over:
            continue  # the planner has it; it plays into the host's mix
        set_request(
            conn, request.id, status=RequestStatus.WITHDRAWN, reason="room_ended", resolved_at=now
        )
        withdrawn.append(request.song_request_id)
    expire_displays(conn, room, now)
    ctx.publish(conn, room, "room.ended", {"reason": reason})
    return withdrawn


def expire_displays(conn: Connection, room: Room, now: float) -> None:
    conn.execute(
        sa.update(display_pairings)
        .where(display_pairings.c.room_id == room.id, display_pairings.c.expires_at > now)
        .values(expires_at=now)
    )


def expire_rooms(ctx: RoomContext, *, now: float | None = None) -> list[EndedRoom]:
    """The regular sweep: end rooms past their hours or without a speaker for too long, note when
    a speaker was last seen, and hand waiting requests to the planner as the cap allows.

    It looks across every workspace, so the listing needs the maintenance database role.
    """
    with transaction(ctx.engine) as conn:
        now = resolve_now(conn, now)
        live = conn.execute(
            sa.select(rooms.c.id, rooms.c.workspace_id).where(
                rooms.c.status.in_([status.value for status in LIVE])
            )
        ).all()
    ended: list[EndedRoom] = []
    for room_id, workspace_id in live:
        withdrawn: list[str | None] = []
        reason = None
        with transaction(ctx.engine, workspace_id) as conn:
            room = load_room(conn, workspace_id, room_id, lock=True)
            if not room.live:
                continue
            if ctx.local_first is None:
                online = ctx.speakers.speaker_online(workspace_id)
            else:
                from selecta.rooms.local_first import ready_speaker

                try:
                    snapshot = ctx.local_first.speaker(workspace_id, room.settings.zone_id)
                    online = ready_speaker(
                        snapshot, workspace_id, room.settings.zone_id, now
                    )
                except Exception:
                    online = False
            if online:
                save_room(conn, room.id, last_speaker_seen_at=now)
            last_seen = now if online else (room.last_speaker_seen_at or room.created_at)
            if now >= room.ends_at:
                reason = EndReason.TIME
            elif (
                ctx.local_first is None
                and now - last_seen >= room.settings.no_speaker_minutes * 60
            ):
                reason = EndReason.NO_SPEAKER
            # An unreachable local engine may still be executing approved playback
            # offline. Losing its cloud heartbeat cannot close its room or stop sound.
            if reason is not None:
                withdrawn = end_in(conn, ctx, room, now, reason)
        if reason is not None:
            withdraw_from_planner(ctx, workspace_id, withdrawn)
            ended.append(EndedRoom(room_id, workspace_id, reason))
        else:
            pump(ctx, workspace_id, room_id, now=now)
    return ended
