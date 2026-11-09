"""Big-screen displays: a TV or projector that shows the room's QR code, what's playing and the
requests coming up. It never plays audio and can't change anything.

The TV opens the display page and calls `start_pairing`, which gives it a short pairing code to
show and a long display token to keep. The host types the pairing code into the room panel
(`confirm_pairing`), and from then on the token reads that room's display view. Pairing codes
last ten minutes and work once. The token lasts until the room ends, so a display that loses
power reconnects by itself, and it's tied to the room rather than the code, so it stays paired
when the host makes a new code.

An unpaired display belongs to no workspace yet, so these statements run without one; in the
cloud that needs the lookup role described in `store`.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum

import sqlalchemy as sa

from selecta.persistence import new_id, transaction
from selecta.rooms import codes
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.lifecycle import room_code
from selecta.rooms.planning import queue_order
from selecta.rooms.ports import SongSummary
from selecta.rooms.schema import display_pairings, rooms
from selecta.rooms.store import RoomContext, live_room, load_room, resolve_now, save_room
from selecta.rooms.views import (
    UpcomingItem,
    as_items,
    describe_songs,
    nickname_map,
    now_playing_for,
)

PAIRING_SECONDS = 600.0
PAIRING_ATTEMPTS = 8


class DisplayState(StrEnum):
    WAITING = "waiting"  # showing its pairing code
    PAIRED = "paired"
    EXPIRED = "expired"  # the pairing code ran out before anyone typed it
    ENDED = "ended"  # the room ended or the host turned the big screen off


@dataclass(frozen=True)
class PairingStart:
    pairing_code: str  # shown on the TV as XXX-XXX
    display_token: str  # kept by the TV; never stored
    expires_at: float


@dataclass(frozen=True)
class DisplayView:
    state: DisplayState
    room_name: str | None = None
    code: str | None = None  # the room code, for the QR and "Scan to request a song"
    now_playing: SongSummary | None = None
    up_next: tuple[SongSummary, ...] = ()
    upcoming: tuple[UpcomingItem, ...] = ()
    music_paused: bool = False


def start_pairing(ctx: RoomContext, *, now: float | None = None) -> PairingStart:
    with transaction(ctx.engine) as conn:
        now = resolve_now(conn, now)
        token = codes.new_token()
        for _ in range(PAIRING_ATTEMPTS):
            code = codes.generate(codes.PAIRING_CODE_LENGTH)
            digest = codes.pairing_hash(code, ctx.pepper)
            # A pairing code nobody used in time can be handed out again.
            conn.execute(
                sa.delete(display_pairings).where(
                    display_pairings.c.pairing_code_hash == digest,
                    display_pairings.c.room_id.is_(None),
                    display_pairings.c.expires_at <= now,
                )
            )
            try:
                with conn.begin_nested():
                    conn.execute(
                        sa.insert(display_pairings).values(
                            id=new_id(),
                            workspace_id=None,
                            room_id=None,
                            pairing_code_hash=digest,
                            token_hash=codes.token_hash(token),
                            created_at=now,
                            paired_at=None,
                            expires_at=now + PAIRING_SECONDS,
                        )
                    )
            except sa.exc.IntegrityError:
                continue
            return PairingStart(codes.display(code), token, now + PAIRING_SECONDS)
    raise RuntimeError("Couldn't find an unused pairing code")


def confirm_pairing(
    ctx: RoomContext,
    workspace_id: str,
    room_id: str,
    pairing_code: str,
    *,
    now: float | None = None,
) -> None:
    """The host typed the code the TV is showing. The TV's next look at its view is the room."""
    try:
        digest = codes.pairing_hash(pairing_code, ctx.pepper)
    except codes.InvalidCode:
        raise RoomError(Refusal.INVALID_CODE) from None
    with transaction(ctx.engine) as conn:
        now = resolve_now(conn, now)
        room = live_room(conn, workspace_id, room_id)
        claimed = conn.execute(
            sa.update(display_pairings)
            .where(
                display_pairings.c.pairing_code_hash == digest,
                display_pairings.c.room_id.is_(None),
                display_pairings.c.expires_at > now,
            )
            .values(
                workspace_id=workspace_id,
                room_id=room.id,
                pairing_code_hash=None,
                paired_at=now,
                expires_at=room.ends_at,
            )
        ).rowcount
        if not claimed:
            raise RoomError(Refusal.NO_SUCH_PAIRING)
        if not room.settings.display:
            save_room(conn, room.id, settings=replace(room.settings, display=True))
        ctx.publish(conn, room, "room.display", {"paired": True})


def unpair_displays(
    ctx: RoomContext, workspace_id: str, room_id: str, *, now: float | None = None
) -> int:
    """Disconnect every display from this room."""
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        load_room(conn, workspace_id, room_id)
        return (
            conn.execute(
                sa.update(display_pairings)
                .where(
                    display_pairings.c.workspace_id == workspace_id,
                    display_pairings.c.room_id == room_id,
                    display_pairings.c.expires_at > now,
                )
                .values(expires_at=now)
            ).rowcount
            or 0
        )


def display_view(
    ctx: RoomContext, display_token: str, *, now: float | None = None
) -> DisplayView:
    """What the TV shows now. Read-only: the token can't do anything else."""
    if not display_token:
        raise RoomError(Refusal.NO_SUCH_PAIRING)
    with transaction(ctx.engine) as conn:
        now = resolve_now(conn, now)
        row = conn.execute(
            sa.select(
                display_pairings.c.room_id,
                display_pairings.c.workspace_id,
                display_pairings.c.expires_at,
            ).where(display_pairings.c.token_hash == codes.token_hash(display_token))
        ).first()
    if row is None:
        raise RoomError(Refusal.NO_SUCH_PAIRING)
    if row.room_id is None:
        state = DisplayState.WAITING if row.expires_at > now else DisplayState.EXPIRED
        return DisplayView(state)
    if row.expires_at <= now:
        return DisplayView(DisplayState.ENDED)
    workspace_id = row.workspace_id
    with transaction(ctx.engine, workspace_id) as conn:
        found = conn.execute(
            sa.select(rooms.c.id).where(
                rooms.c.workspace_id == workspace_id, rooms.c.id == row.room_id
            )
        ).first()
        if found is None:
            return DisplayView(DisplayState.ENDED)
        room = load_room(conn, workspace_id, row.room_id)
        if not room.live:
            return DisplayView(DisplayState.ENDED, room_name=room.name)
        coming_up = queue_order(conn, room, now)
        names = nickname_map(conn, room)
    songs = describe_songs(ctx, room, coming_up)
    playing = now_playing_for(ctx, workspace_id)
    return DisplayView(
        DisplayState.PAIRED,
        room_name=room.name,
        code=room_code(ctx, room),
        now_playing=playing.current,
        up_next=playing.up_next,
        upcoming=as_items(coming_up, songs, names, show_names=room.settings.names_shown),
        music_paused=not ctx.speakers.speaker_online(workspace_id),
    )
