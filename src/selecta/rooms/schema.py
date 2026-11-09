"""The Rooms tables.

A room keeps its code only as a keyed hash (see `codes`). When a room ends, its hash stays for 30
days so the code can't be handed to another room in that time; then it's cleared along with every
guest's data. Unique indexes do the jobs that must hold even when two requests race: one open room
per workspace, one waiting request per song in a room, one vote per guest per request.

`display_pairings` is the one table whose rows start out belonging to no workspace: a TV shows a
pairing code before anyone has claimed it. Its `workspace_id` is filled in when the host pairs it.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

ROOM_STATUSES = ("open", "locked", "ended")
LIVE_ROOM_STATUSES = ("open", "locked")
GUEST_STATUSES = ("active", "pending", "removed", "banned")
REQUEST_STATUSES = ("sent", "accepted", "passed", "unfit", "played", "withdrawn")
WAITING_REQUEST_STATUSES = ("sent", "accepted", "unfit")  # still one per song

Hash = sa.String(64)


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


rooms = sa.Table(
    "rooms",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("code_hash", Hash, nullable=True, unique=True),
    sa.Column("code_seed", sa.String(64), nullable=True),
    sa.Column("name", sa.String(40), nullable=False),
    sa.Column("status", sa.String(8), nullable=False),
    sa.Column("settings", sa.JSON, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("ends_at", Epoch, nullable=False),
    sa.Column("ended_at", Epoch, nullable=True),
    sa.Column("end_reason", sa.String(16), nullable=True),
    sa.Column("last_speaker_seen_at", Epoch, nullable=True),
    sa.CheckConstraint(_one_of("status", ROOM_STATUSES), name="status"),
    sa.Index("ix_rooms_status", "status"),
)

sa.Index(
    "uq_rooms_one_live_per_workspace",
    rooms.c.workspace_id,
    unique=True,
    sqlite_where=rooms.c.status.in_(LIVE_ROOM_STATUSES),
    postgresql_where=rooms.c.status.in_(LIVE_ROOM_STATUSES),
)

room_guests = sa.Table(
    "room_guests",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column(
        "room_id", Id, sa.ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    ),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("token_hash", Hash, nullable=False, unique=True),
    sa.Column("nickname", sa.String(40), nullable=False),
    sa.Column("ip_hash", Hash, nullable=True),
    sa.Column("status", sa.String(8), nullable=False),
    sa.Column("joined_at", Epoch, nullable=False),
    sa.Column("last_seen_at", Epoch, nullable=False),
    sa.CheckConstraint(_one_of("status", GUEST_STATUSES), name="status"),
)

room_requests = sa.Table(
    "room_requests",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column(
        "room_id", Id, sa.ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    ),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column(
        "guest_id",
        Id,
        sa.ForeignKey("room_guests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    ),
    sa.Column("song_id", sa.BigInteger, nullable=False),
    sa.Column("song_request_id", sa.String(64), nullable=True),
    sa.Column("status", sa.String(10), nullable=False),
    sa.Column("reason", sa.String(16), nullable=True),
    sa.Column("votes", sa.Integer, nullable=False, default=0),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("approved_at", Epoch, nullable=True),
    sa.Column("submitted_at", Epoch, nullable=True),  # handed to the planner; counts as a render
    sa.Column("resolved_at", Epoch, nullable=True),
    sa.CheckConstraint(_one_of("status", REQUEST_STATUSES), name="status"),
    sa.Index("ix_room_requests_workspace_id_song_request_id", "workspace_id", "song_request_id"),
)

sa.Index(
    "uq_room_requests_one_waiting_per_song",
    room_requests.c.room_id,
    room_requests.c.song_id,
    unique=True,
    sqlite_where=room_requests.c.status.in_(WAITING_REQUEST_STATUSES),
    postgresql_where=room_requests.c.status.in_(WAITING_REQUEST_STATUSES),
)

room_votes = sa.Table(
    "room_votes",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column(
        "room_id", Id, sa.ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    ),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column(
        "request_id", Id, sa.ForeignKey("room_requests.id", ondelete="CASCADE"), nullable=False
    ),
    sa.Column(
        "guest_id",
        Id,
        sa.ForeignKey("room_guests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    ),
    sa.Column("created_at", Epoch, nullable=False),
    sa.UniqueConstraint("request_id", "guest_id"),
)

room_bans = sa.Table(
    "room_bans",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column(
        "room_id", Id, sa.ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    ),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column(
        "guest_id", Id, sa.ForeignKey("room_guests.id", ondelete="CASCADE"), nullable=False
    ),
    sa.Column("ip_hash", Hash, nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Index("ix_room_bans_room_id_ip_hash", "room_id", "ip_hash"),
)

display_pairings = sa.Table(
    "display_pairings",
    metadata,
    sa.Column("id", Id, primary_key=True),
    # Empty until the host pairs the display; see the module notes.
    sa.Column("workspace_id", Id, nullable=True, index=True),
    sa.Column(
        "room_id", Id, sa.ForeignKey("rooms.id", ondelete="CASCADE"), nullable=True, index=True
    ),
    # Cleared once paired, so a pairing code works once.
    sa.Column("pairing_code_hash", Hash, nullable=True, unique=True),
    sa.Column("token_hash", Hash, nullable=False, unique=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("paired_at", Epoch, nullable=True),
    sa.Column("expires_at", Epoch, nullable=False),
)
