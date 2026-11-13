"""Guests: joining with a code, being let in, removed or banned, and choosing a nickname.

A guest is an anonymous token in a cookie scoped to the room; only its hash is kept, with a keyed
hash of their IP and a generated nickname. Joining honours the room's join mode (anyone, host
approves, locked), its bans and its guest cap. A guest whose cookie was cleared joins as someone
new, and the host sees a new nickname.

A ban lasts the room's lifetime and covers both the guest and their hashed IP, and their waiting
requests are withdrawn. Note that guests at a home party usually share one IP, so an IP ban also
stops new joins from that network.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import sqlalchemy as sa

from selecta.persistence import new_id, transaction
from selecta.rooms import codes, nicknames
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.planning import pump, withdraw_from_planner
from selecta.rooms.schema import room_bans, room_guests, room_votes
from selecta.rooms.settings import JoinMode
from selecta.rooms.store import (
    WAITING,
    Guest,
    GuestStatus,
    RequestStatus,
    RoomContext,
    RoomStatus,
    active_guest,
    guest_from_row,
    live_room,
    load_guest,
    recount_votes,
    resolve_guest,
    resolve_now,
    room_requests_where,
    set_request,
)
from selecta.rooms.store import find_room_by_code as _find_room

PRESENT = (GuestStatus.ACTIVE.value, GuestStatus.PENDING.value)


@dataclass(frozen=True)
class JoinResult:
    guest_token: str = field(repr=False)  # goes in the guest's cookie; never stored or shown
    guest_id: str
    room_id: str
    nickname: str
    status: GuestStatus  # active, or pending until the host lets them in
    rejoined: bool = False


def join(
    ctx: RoomContext,
    code: str,
    ip_hash: str | None,
    *,
    guest_token: str | None = None,
    now: float | None = None,
) -> JoinResult:
    """Join the room a code opens. A guest who already holds a token for this room gets their
    place back rather than a second one."""
    room_id, workspace_id, status, digest = _find_room(ctx, code)
    if status is RoomStatus.ENDED:
        raise RoomError(Refusal.ROOM_ENDED)
    token_digest = codes.token_hash(guest_token) if guest_token else None
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = live_room(conn, workspace_id, room_id)
        if ctx.local_first is not None and room.ends_at <= now:
            raise RoomError(Refusal.ROOM_ENDED)
        if room.code_hash != digest:
            raise RoomError(Refusal.NO_SUCH_ROOM)  # the code changed a moment ago
        if token_digest is not None:
            row = (
                conn.execute(
                    sa.select(room_guests).where(
                        room_guests.c.room_id == room.id,
                        room_guests.c.token_hash == token_digest,
                    )
                )
                .mappings()
                .first()
            )
            known = guest_from_row(row) if row else None
            if known is not None and known.status is GuestStatus.BANNED:
                raise RoomError(Refusal.BANNED)
            if known is not None and known.status.value in PRESENT:
                conn.execute(
                    sa.update(room_guests)
                    .where(room_guests.c.id == known.id)
                    .values(last_seen_at=now)
                )
                return JoinResult(
                    guest_token, known.id, room.id, known.nickname, known.status, rejoined=True
                )
        if ip_hash and _ip_banned(conn, room.id, ip_hash):
            raise RoomError(Refusal.BANNED)
        if room.status is RoomStatus.LOCKED or room.settings.join_mode is JoinMode.LOCKED:
            raise RoomError(Refusal.ROOM_LOCKED)
        present = conn.execute(
            sa.select(sa.func.count())
            .select_from(room_guests)
            .where(room_guests.c.room_id == room.id, room_guests.c.status.in_(PRESENT))
        ).scalar_one()
        if present >= room.settings.max_guests:
            raise RoomError(Refusal.ROOM_FULL)
        all_names = conn.execute(
            sa.select(room_guests.c.nickname).where(room_guests.c.room_id == room.id)
        ).scalars()
        nickname = nicknames.unique(set(all_names))
        status = (
            GuestStatus.PENDING
            if room.settings.join_mode is JoinMode.APPROVE
            else GuestStatus.ACTIVE
        )
        token = codes.new_token()
        guest_id = new_id()
        conn.execute(
            sa.insert(room_guests).values(
                id=guest_id,
                room_id=room.id,
                workspace_id=workspace_id,
                token_hash=codes.token_hash(token),
                nickname=nickname,
                ip_hash=ip_hash,
                status=status.value,
                joined_at=now,
                last_seen_at=now,
            )
        )
        ctx.publish(conn, room, "room.guest", {"guest_id": guest_id, "status": status.value})
    return JoinResult(token, guest_id, room.id, nickname, status)


def _ip_banned(conn: sa.Connection, room_id: str, ip_hash: str) -> bool:
    return (
        conn.execute(
            sa.select(room_bans.c.id).where(
                room_bans.c.room_id == room_id, room_bans.c.ip_hash == ip_hash
            )
        ).first()
        is not None
    )


def approve_guest(ctx: RoomContext, workspace_id: str, room_id: str, guest_id: str) -> Guest:
    """Let in a guest waiting at the door (join mode "host approves")."""
    return _move_guest(ctx, workspace_id, room_id, guest_id, GuestStatus.ACTIVE)


def remove_guest(ctx: RoomContext, workspace_id: str, room_id: str, guest_id: str) -> Guest:
    """Put a guest out. They can scan the code again and join as someone new; to keep them out,
    ban them. Their requests stay."""
    return _move_guest(ctx, workspace_id, room_id, guest_id, GuestStatus.REMOVED)


def _move_guest(
    ctx: RoomContext, workspace_id: str, room_id: str, guest_id: str, status: GuestStatus
) -> Guest:
    with transaction(ctx.engine, workspace_id) as conn:
        room = live_room(conn, workspace_id, room_id)
        guest = load_guest(conn, room, guest_id)
        if guest.status is GuestStatus.BANNED:
            return guest
        if status is GuestStatus.ACTIVE and guest.status is not GuestStatus.PENDING:
            return guest
        conn.execute(
            sa.update(room_guests).where(room_guests.c.id == guest.id).values(status=status.value)
        )
        ctx.publish(conn, room, "room.guest", {"guest_id": guest.id, "status": status.value})
        return load_guest(conn, room, guest_id)


def ban_guest(
    ctx: RoomContext,
    workspace_id: str,
    room_id: str,
    guest_id: str,
    *,
    now: float | None = None,
) -> Guest:
    """Ban a guest for the rest of the room: their waiting requests are withdrawn and their votes
    taken back."""
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = live_room(conn, workspace_id, room_id)
        guest = load_guest(conn, room, guest_id)
        withdrawn: list[str | None] = []
        if guest.status is not GuestStatus.BANNED:
            conn.execute(
                sa.update(room_guests)
                .where(room_guests.c.id == guest.id)
                .values(status=GuestStatus.BANNED.value)
            )
            conn.execute(
                sa.insert(room_bans).values(
                    id=new_id(),
                    room_id=room.id,
                    workspace_id=workspace_id,
                    guest_id=guest.id,
                    ip_hash=guest.ip_hash,
                    created_at=now,
                )
            )
            for request in room_requests_where(conn, room, WAITING, guest_id=guest.id):
                set_request(
                    conn,
                    request.id,
                    status=RequestStatus.WITHDRAWN,
                    reason="banned",
                    resolved_at=now,
                )
                withdrawn.append(request.song_request_id)
            voted_on = conn.execute(
                sa.select(room_votes.c.request_id).where(room_votes.c.guest_id == guest.id)
            ).scalars()
            voted_on = list(voted_on)
            conn.execute(sa.delete(room_votes).where(room_votes.c.guest_id == guest.id))
            recount_votes(conn, voted_on)
            ctx.publish(conn, room, "room.guest", {"guest_id": guest.id, "status": "banned"})
        guest = load_guest(conn, room, guest_id)
    withdraw_from_planner(ctx, workspace_id, withdrawn)
    pump(ctx, workspace_id, room_id)
    return guest


def leave(ctx: RoomContext, guest_token: str) -> None:
    """A guest leaves. Their requests stay; their cookie should be cleared."""
    ref = resolve_guest(ctx, guest_token)
    with transaction(ctx.engine, ref.workspace_id) as conn:
        room = live_room(conn, ref.workspace_id, ref.room_id)
        guest = load_guest(conn, room, ref.guest_id)
        if guest.status.value in PRESENT:
            conn.execute(
                sa.update(room_guests)
                .where(room_guests.c.id == guest.id)
                .values(status=GuestStatus.REMOVED.value)
            )


def nickname_choices(ctx: RoomContext, guest_token: str, count: int = 6) -> list[str]:
    """Generated nicknames a guest may pick from, none already used in the room."""
    ref = resolve_guest(ctx, guest_token)
    with transaction(ctx.engine, ref.workspace_id) as conn:
        taken = conn.execute(
            sa.select(room_guests.c.nickname).where(room_guests.c.room_id == ref.room_id)
        ).scalars()
        return nicknames.choices(max(1, min(count, 12)), set(taken))


def set_nickname(ctx: RoomContext, guest_token: str, nickname: str) -> Guest:
    """Change to another generated nickname. Anything not from the lists is refused."""
    if not nicknames.is_generated(nickname):
        raise RoomError(Refusal.INVALID_NICKNAME)
    ref = resolve_guest(ctx, guest_token)
    with transaction(ctx.engine, ref.workspace_id) as conn:
        now = resolve_now(conn, None)
        room = live_room(conn, ref.workspace_id, ref.room_id)
        guest = active_guest(conn, room, ref.guest_id, now)
        clash = conn.execute(
            sa.select(room_guests.c.id).where(
                room_guests.c.room_id == room.id,
                room_guests.c.nickname == nickname,
                room_guests.c.id != guest.id,
            )
        ).first()
        if clash is not None:
            raise RoomError(Refusal.INVALID_NICKNAME, "Someone here already has that nickname.")
        conn.execute(
            sa.update(room_guests).where(room_guests.c.id == guest.id).values(nickname=nickname)
        )
        return load_guest(conn, room, guest.id)
