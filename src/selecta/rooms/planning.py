"""Handing accepted room requests to Selecta's request planner, a few at a time.

An accepted request isn't given to the planner straight away if the planner already holds three
of this room's requests: it waits its turn in the room's round-robin order, so one guest can't
fill the next few spots. Each hand-off counts against the room's render cap (60 an hour by
default), because that's when the planner starts rendering seams for it; past the cap, accepted
requests wait until the hour rolls on.

The planner is called outside any Rooms transaction. A request is first marked as handed over and
committed, then the planner is asked, then its request id is saved. If the planner fails, the mark
is taken off and the next pass tries again; if the process dies in between, the mark goes stale
after five minutes and the request is tried again. The planner already returns the same request
for a song that's waiting, so trying twice can't make two.
"""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Iterable, Sequence

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import transaction
from selecta.rooms.local_first import ready_speaker, valid_receipt, visible
from selecta.rooms.ordering import accepted_order
from selecta.rooms.schema import room_requests
from selecta.rooms.store import (
    RequestStatus,
    Room,
    RoomContext,
    RoomRequest,
    load_room,
    resolve_now,
    room_requests_where,
    set_request,
)

log = logging.getLogger(__name__)

PLANNER_WINDOW = 3  # a room's requests the planner holds at once
CLAIM_STALE_SECONDS = 300.0
RENDER_WINDOW_SECONDS = 3600.0


def renders_used(conn: Connection, room: Room, now: float) -> int:
    return conn.execute(
        sa.select(sa.func.count())
        .select_from(room_requests)
        .where(
            room_requests.c.workspace_id == room.workspace_id,
            room_requests.c.room_id == room.id,
            room_requests.c.submitted_at.is_not(None),
            room_requests.c.submitted_at > now - RENDER_WINDOW_SECONDS,
        )
    ).scalar_one()


def renders_left(conn: Connection, room: Room, now: float) -> int:
    return max(0, room.settings.renders_per_hour - renders_used(conn, room, now))


def _held(request: RoomRequest, now: float) -> bool:
    """With the planner, or being handed over right now."""
    if request.song_request_id is not None:
        return True
    return request.submitted_at is not None and now - request.submitted_at < CLAIM_STALE_SECONDS


def split(
    accepted: Sequence[RoomRequest], now: float
) -> tuple[list[RoomRequest], list[RoomRequest]]:
    held = [request for request in accepted if _held(request, now)]
    waiting = [request for request in accepted if not _held(request, now)]
    return held, waiting


def queue_order(conn: Connection, room: Room, now: float) -> list[RoomRequest]:
    """Every accepted request in the order it will reach the mix: those the planner holds, in the
    order they were handed over, then the rest in round-robin order."""
    held, waiting = split(room_requests_where(conn, room, [RequestStatus.ACCEPTED]), now)
    held.sort(key=lambda request: (request.submitted_at or 0.0, request.id))
    already = Counter(request.guest_id for request in held)
    return held + accepted_order(waiting, votes_on=room.settings.votes, already=already)


def pump(ctx: RoomContext, workspace_id: str, room_id: str, *, now: float | None = None) -> int:
    """Hand the next accepted requests to the planner, as far as the window and the render cap
    allow. Returns how many were handed over.

    With no speaker online the music's paused, so requests wait here, in order, until one is
    back (the regular sweep then hands them on)."""
    with transaction(ctx.engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        room = load_room(conn, workspace_id, room_id, lock=True)
        if not room.live:
            return 0
        if ctx.local_first is not None:
            try:
                speaker = ctx.local_first.speaker(workspace_id, room.settings.zone_id)
            except Exception:
                return 0
            if not ready_speaker(speaker, workspace_id, room.settings.zone_id, now):
                return 0  # Host approval remains pending while venue is offline.
        elif not ctx.speakers.speaker_online(workspace_id):
            return 0
        held, waiting = split(room_requests_where(conn, room, [RequestStatus.ACCEPTED]), now)
        slots = min(PLANNER_WINDOW - len(held), renders_left(conn, room, now))
        if slots <= 0 or not waiting:
            return 0
        already = Counter(request.guest_id for request in held)
        chosen = accepted_order(waiting, votes_on=room.settings.votes, already=already)[:slots]
        for request in chosen:
            set_request(conn, request.id, submitted_at=now)
    handed = 0
    for request in chosen:
        if _hand_over(ctx, room, request, now=now):
            handed += 1
    return handed


def _hand_over(
    ctx: RoomContext, room: Room, request: RoomRequest, *, now: float | None = None
) -> bool:
    workspace_id = room.workspace_id
    if ctx.local_first is not None:
        return _hand_over_local(ctx, room, request, now=now)
    try:
        song_request_id = str(
            ctx.planner.submit(
                workspace_id,
                request.song_id,
                source="room",
                room_id=room.id,
                guest_id=request.guest_id,
            )
        )
    except Exception:
        log.exception("The planner refused room request %s; it will be tried again", request.id)
        with transaction(ctx.engine, workspace_id) as conn:
            conn.execute(
                sa.update(room_requests)
                .where(
                    room_requests.c.id == request.id,
                    room_requests.c.song_request_id.is_(None),
                )
                .values(submitted_at=None)
            )
        return False
    with transaction(ctx.engine, workspace_id) as conn:
        kept = conn.execute(
            sa.update(room_requests)
            .where(
                room_requests.c.id == request.id,
                room_requests.c.status == RequestStatus.ACCEPTED.value,
            )
            .values(song_request_id=song_request_id)
        ).rowcount
        if kept:
            ctx.publish(conn, room, "room.request", {"request_id": request.id})
    if not kept:
        # The host passed it, or the guest withdrew it, while it was being handed over.
        withdraw_from_planner(ctx, workspace_id, [song_request_id])
        return False
    return True


def _release_local_claim(ctx: RoomContext, room: Room, request: RoomRequest) -> None:
    with transaction(ctx.engine, room.workspace_id) as conn:
        conn.execute(
            sa.update(room_requests)
            .where(
                room_requests.c.workspace_id == room.workspace_id,
                room_requests.c.room_id == room.id,
                room_requests.c.id == request.id,
                room_requests.c.song_request_id.is_(None),
            )
            .values(submitted_at=None)
        )


def _hand_over_local(
    ctx: RoomContext, room: Room, request: RoomRequest, *, now: float | None
) -> bool:
    """Only a fenced, acknowledged local schedule enters the held window.

    Submit is outside the Rooms DB transaction. The operation's idempotency key
    is the immutable room request ID. The engine must not insert inside its
    committed horizon even if the cloud requests an earlier time.
    """
    bridge = ctx.local_first
    assert bridge is not None
    workspace_id, zone_id = room.workspace_id, room.settings.zone_id
    stamp = request.submitted_at if now is None else now
    if stamp is None:
        _release_local_claim(ctx, room, request)
        return False
    try:
        speaker = bridge.speaker(workspace_id, zone_id)
        if not ready_speaker(speaker, workspace_id, zone_id, stamp):
            _release_local_claim(ctx, room, request)
            return False
        entry = bridge.track(workspace_id, zone_id, request.song_id)
        if visible(entry, workspace_id, zone_id, stamp, clean_only=room.settings.clean_only) is None:
            with transaction(ctx.engine, workspace_id) as conn:
                updated = conn.execute(
                    sa.update(room_requests)
                    .where(
                        room_requests.c.workspace_id == workspace_id,
                        room_requests.c.room_id == room.id,
                        room_requests.c.id == request.id,
                        room_requests.c.status == RequestStatus.ACCEPTED.value,
                        room_requests.c.song_request_id.is_(None),
                    )
                    .values(status=RequestStatus.UNFIT.value, reason="unavailable", submitted_at=None)
                ).rowcount
                if updated:
                    ctx.publish(conn, room, "room.request", {"request_id": request.id})
            return False
        earliest = max(float(stamp), speaker.committed_until)
        receipt = bridge.schedule(
            workspace_id, zone_id, room.id, request.id, request.song_id,
            expected_generation=speaker.generation,
            not_before=earliest,
            policy_revision=speaker.policy_revision,
        )
        if not valid_receipt(receipt, speaker, workspace_id, zone_id, earliest):
            _release_local_claim(ctx, room, request)
            return False
        operation_id = receipt.operation_id
    except Exception:
        log.exception("Local venue could not schedule room request %s", request.id)
        _release_local_claim(ctx, room, request)
        return False
    with transaction(ctx.engine, workspace_id) as conn:
        kept = conn.execute(
            sa.update(room_requests)
            .where(
                room_requests.c.workspace_id == workspace_id,
                room_requests.c.room_id == room.id,
                room_requests.c.id == request.id,
                room_requests.c.status == RequestStatus.ACCEPTED.value,
                room_requests.c.song_request_id.is_(None),
            )
            .values(song_request_id=operation_id)
        ).rowcount
        if kept:
            ctx.publish(conn, room, "room.request", {"request_id": request.id})
    if not kept:
        try:
            bridge.cancel(workspace_id, zone_id, operation_id)
        except Exception:
            log.exception("Local venue cancellation failed for %s", operation_id)
    return bool(kept)


def withdraw_from_planner(
    ctx: RoomContext, workspace_id: str, song_request_ids: Iterable[str | None]
) -> None:
    """Take requests back from the planner. Best effort: a failure is logged, and the room's own
    record already says the request was withdrawn."""
    for song_request_id in song_request_ids:
        if not song_request_id:
            continue
        try:
            if ctx.local_first is None:
                ctx.planner.withdraw(workspace_id, song_request_id)
            else:
                # Cancellation is advisory for a committed speaker; no guest API
                # claims that already-prepared local playback has been stopped.
                with transaction(ctx.engine, workspace_id) as conn:
                    room_id = conn.execute(
                        sa.select(room_requests.c.room_id).where(
                            room_requests.c.workspace_id == workspace_id,
                            room_requests.c.song_request_id == song_request_id,
                        ).limit(1)
                    ).scalar()
                    zone_id = load_room(conn, workspace_id, room_id).settings.zone_id if room_id else None
                if zone_id is not None:
                    ctx.local_first.cancel(workspace_id, zone_id, song_request_id)
        except Exception:
            log.exception("Couldn't withdraw planner request %s", song_request_id)
