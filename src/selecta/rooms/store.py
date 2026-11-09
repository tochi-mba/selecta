"""Rooms, guests and requests as records, and the row helpers every Rooms module shares.

Guests and displays arrive with only a token or a code, so the first step of their calls is a
lookup by hash that doesn't yet know the workspace. Those lookups run in a transaction with no
workspace set; in the cloud that needs a database role allowed to find rooms, guests and pairings
by hash (and nothing more). Everything after the lookup runs in the room's own workspace.

Room rows are locked with a plain `FOR UPDATE` while a request or a moderation step runs, so a
room's limits are checked by one writer at a time. `persistence.lock_rows` skips locked rows,
which suits a job queue, not a single row everyone must wait for.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.persistence import db_now, transaction
from selecta.rooms import codes
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.ports import (
    NoRoomEvents,
    NothingPlaying,
    NowPlayingPort,
    PlanPort,
    RequestPlannerPort,
    RoomEventsPort,
    SongCatalogPort,
    SpeakerPort,
)
from selecta.rooms.schema import room_guests, room_requests, room_votes, rooms
from selecta.rooms.settings import RoomSettings


class RoomStatus(StrEnum):
    OPEN = "open"
    LOCKED = "locked"
    ENDED = "ended"


class GuestStatus(StrEnum):
    ACTIVE = "active"
    PENDING = "pending"
    REMOVED = "removed"
    BANNED = "banned"


class RequestStatus(StrEnum):
    SENT = "sent"
    ACCEPTED = "accepted"
    PASSED = "passed"
    UNFIT = "unfit"
    PLAYED = "played"
    WITHDRAWN = "withdrawn"


# Waiting for the host or for its spot: what the per-guest and per-room limits count.
PENDING = (RequestStatus.SENT, RequestStatus.ACCEPTED)
# Still one request per song: a new ask for any of these becomes a vote.
WAITING = (RequestStatus.SENT, RequestStatus.ACCEPTED, RequestStatus.UNFIT)
LIVE = (RoomStatus.OPEN, RoomStatus.LOCKED)


@dataclass
class RoomContext:
    """Everything Rooms need from outside: the database, the pepper for codes, and the ports."""

    engine: Engine
    pepper: bytes
    catalog: SongCatalogPort
    planner: RequestPlannerPort
    plans: PlanPort
    speakers: SpeakerPort
    now_playing: NowPlayingPort = field(default_factory=NothingPlaying)
    events: RoomEventsPort = field(default_factory=NoRoomEvents)

    def __post_init__(self) -> None:
        codes.check_pepper(self.pepper)

    def publish(
        self, conn: Connection, room: Room, kind: str, payload: Mapping[str, Any] | None = None
    ) -> None:
        self.events.publish(conn, room.workspace_id, room.id, kind, dict(payload or {}))


@dataclass(frozen=True)
class Room:
    id: str
    workspace_id: str
    name: str
    status: RoomStatus
    settings: RoomSettings
    created_at: float
    ends_at: float
    ended_at: float | None
    end_reason: str | None
    last_speaker_seen_at: float | None
    code_seed: str | None
    code_hash: str | None

    @property
    def live(self) -> bool:
        return self.status is not RoomStatus.ENDED


@dataclass(frozen=True)
class Guest:
    id: str
    room_id: str
    workspace_id: str
    nickname: str
    status: GuestStatus
    ip_hash: str | None
    joined_at: float
    last_seen_at: float


@dataclass(frozen=True)
class RoomRequest:
    id: str
    room_id: str
    workspace_id: str
    guest_id: str
    song_id: int
    song_request_id: str | None
    status: RequestStatus
    reason: str | None
    votes: int
    created_at: float
    approved_at: float | None
    submitted_at: float | None
    resolved_at: float | None


@dataclass(frozen=True)
class GuestRef:
    guest_id: str
    room_id: str
    workspace_id: str


def resolve_now(conn: Connection, now: float | None) -> float:
    return db_now(conn) if now is None else float(now)


def room_from_row(row: Mapping[str, Any]) -> Room:
    return Room(
        id=row["id"],
        workspace_id=row["workspace_id"],
        name=row["name"],
        status=RoomStatus(row["status"]),
        settings=RoomSettings.from_json(row["settings"]),
        created_at=row["created_at"],
        ends_at=row["ends_at"],
        ended_at=row["ended_at"],
        end_reason=row["end_reason"],
        last_speaker_seen_at=row["last_speaker_seen_at"],
        code_seed=row["code_seed"],
        code_hash=row["code_hash"],
    )


def guest_from_row(row: Mapping[str, Any]) -> Guest:
    return Guest(
        id=row["id"],
        room_id=row["room_id"],
        workspace_id=row["workspace_id"],
        nickname=row["nickname"],
        status=GuestStatus(row["status"]),
        ip_hash=row["ip_hash"],
        joined_at=row["joined_at"],
        last_seen_at=row["last_seen_at"],
    )


def request_from_row(row: Mapping[str, Any]) -> RoomRequest:
    return RoomRequest(
        id=row["id"],
        room_id=row["room_id"],
        workspace_id=row["workspace_id"],
        guest_id=row["guest_id"],
        song_id=int(row["song_id"]),
        song_request_id=row["song_request_id"],
        status=RequestStatus(row["status"]),
        reason=row["reason"],
        votes=row["votes"],
        created_at=row["created_at"],
        approved_at=row["approved_at"],
        submitted_at=row["submitted_at"],
        resolved_at=row["resolved_at"],
    )


def load_room(
    conn: Connection, workspace_id: str, room_id: str, *, lock: bool = False
) -> Room:
    query = sa.select(rooms).where(rooms.c.workspace_id == workspace_id, rooms.c.id == room_id)
    if lock:
        query = query.with_for_update()
    row = conn.execute(query).mappings().first()
    if row is None:
        raise RoomError(Refusal.NO_SUCH_ROOM)
    return room_from_row(row)


def live_room(conn: Connection, workspace_id: str, room_id: str) -> Room:
    """The room, locked, refusing if it has ended."""
    room = load_room(conn, workspace_id, room_id, lock=True)
    if not room.live:
        raise RoomError(Refusal.ROOM_ENDED)
    return room


def current_room_row(conn: Connection, workspace_id: str) -> Mapping[str, Any] | None:
    return (
        conn.execute(
            sa.select(rooms).where(
                rooms.c.workspace_id == workspace_id, rooms.c.status.in_([s.value for s in LIVE])
            )
        )
        .mappings()
        .first()
    )


def save_room(conn: Connection, room_id: str, **values: Any) -> None:
    if "settings" in values and isinstance(values["settings"], RoomSettings):
        values["settings"] = values["settings"].to_json()
    if "status" in values:
        values["status"] = RoomStatus(values["status"]).value
    conn.execute(sa.update(rooms).where(rooms.c.id == room_id).values(**values))


def load_guest(conn: Connection, room: Room, guest_id: str) -> Guest:
    row = (
        conn.execute(
            sa.select(room_guests).where(
                room_guests.c.workspace_id == room.workspace_id,
                room_guests.c.room_id == room.id,
                room_guests.c.id == guest_id,
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise RoomError(Refusal.NO_SUCH_GUEST)
    return guest_from_row(row)


def active_guest(conn: Connection, room: Room, guest_id: str, now: float) -> Guest:
    """The guest, seen just now, refusing anyone the host hasn't let in or has put out."""
    guest = load_guest(conn, room, guest_id)
    if guest.status is GuestStatus.BANNED:
        raise RoomError(Refusal.BANNED)
    if guest.status is GuestStatus.REMOVED:
        raise RoomError(Refusal.NOT_A_GUEST)
    conn.execute(
        sa.update(room_guests).where(room_guests.c.id == guest.id).values(last_seen_at=now)
    )
    if guest.status is GuestStatus.PENDING:
        raise RoomError(Refusal.AWAITING_APPROVAL)
    return guest


def load_request(conn: Connection, room: Room, request_id: str) -> RoomRequest:
    row = (
        conn.execute(
            sa.select(room_requests).where(
                room_requests.c.workspace_id == room.workspace_id,
                room_requests.c.room_id == room.id,
                room_requests.c.id == request_id,
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise RoomError(Refusal.NO_SUCH_REQUEST)
    return request_from_row(row)


def room_requests_where(
    conn: Connection, room: Room, statuses: Iterable[RequestStatus], **match: Any
) -> list[RoomRequest]:
    query = sa.select(room_requests).where(
        room_requests.c.workspace_id == room.workspace_id,
        room_requests.c.room_id == room.id,
        room_requests.c.status.in_([status.value for status in statuses]),
    )
    for name, value in match.items():
        query = query.where(room_requests.c[name] == value)
    return [request_from_row(row) for row in conn.execute(query).mappings()]


def set_request(conn: Connection, request_id: str, **values: Any) -> None:
    if "status" in values:
        values["status"] = RequestStatus(values["status"]).value
    conn.execute(sa.update(room_requests).where(room_requests.c.id == request_id).values(**values))


def recount_votes(conn: Connection, request_ids: Iterable[str]) -> None:
    ids = sorted(set(request_ids))
    if not ids:
        return
    count = (
        sa.select(sa.func.count())
        .select_from(room_votes)
        .where(room_votes.c.request_id == room_requests.c.id)
        .scalar_subquery()
    )
    conn.execute(sa.update(room_requests).where(room_requests.c.id.in_(ids)).values(votes=count))


def passes_unique(conn: Connection, statement: sa.Executable) -> bool:
    """Run a write in a savepoint. False if a unique rule refused it; the transaction lives on."""
    try:
        with conn.begin_nested():
            conn.execute(statement)
    except sa.exc.IntegrityError:
        return False
    return True


def resolve_guest(ctx: RoomContext, guest_token: str | None) -> GuestRef:
    """Who a guest token belongs to. See the module notes about the lookup."""
    if not guest_token:
        raise RoomError(Refusal.NOT_A_GUEST)
    digest = codes.token_hash(guest_token)
    with transaction(ctx.engine) as conn:
        row = conn.execute(
            sa.select(room_guests.c.id, room_guests.c.room_id, room_guests.c.workspace_id).where(
                room_guests.c.token_hash == digest
            )
        ).first()
    if row is None:
        raise RoomError(Refusal.NOT_A_GUEST)
    return GuestRef(row.id, row.room_id, row.workspace_id)


def find_room_by_code(ctx: RoomContext, code: str) -> tuple[str, str, RoomStatus, str]:
    """The room a typed code opens: (room id, workspace id, status, code hash)."""
    try:
        digest = codes.code_hash(code, ctx.pepper)
    except codes.InvalidCode:
        raise RoomError(Refusal.INVALID_CODE) from None
    with transaction(ctx.engine) as conn:
        row = conn.execute(
            sa.select(rooms.c.id, rooms.c.workspace_id, rooms.c.status).where(
                rooms.c.code_hash == digest
            )
        ).first()
    if row is None:
        raise RoomError(Refusal.NO_SUCH_ROOM)
    return row.id, row.workspace_id, RoomStatus(row.status), digest
