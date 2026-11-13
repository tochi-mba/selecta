"""Rooms for Business tables (ADR-0451).

Separate from the personal `rooms` tables on purpose: that table allows one live room per
workspace, and an organisation has a standing room in every zone. Codes are kept the way
ADR-0416 keeps them (`selecta.rooms.codes`): a keyed hash to look a code up and a seed the code
is derived from, never the code itself. A rotated code's hash moves to
`business_zone_room_retired_codes`, so a scan of an old printed card can be told the code has
changed instead of "no such room".

Venue and zone ids are plain strings: BZ-1 owns those tables and nothing here has a foreign key
to them. Guest addresses and kiosk addresses are only ever kept as keyed hashes.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

MODES = ("staff_approve", "auto_accept", "off")
GUEST_STATUSES = ("active", "removed", "banned")
REQUEST_STATUSES = ("sent", "approved", "passed", "expired", "withdrawn", "played")
WAITING_STATUSES = ("sent", "approved")  # one waiting request per song in a room
DECIDER_KINDS = ("person", "device", "auto", "system")

Hash = sa.String(64)


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _tenant() -> list[sa.Column]:
    return [
        sa.Column("workspace_id", Id, nullable=False, index=True),
        sa.Column("organisation_id", Id, nullable=False, index=True),
    ]


business_zone_rooms = sa.Table(
    "business_zone_rooms",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("venue_id", Id, nullable=False, index=True),
    sa.Column("zone_id", Id, nullable=False, unique=True),
    sa.Column("code_hash", Hash, nullable=False, unique=True),
    sa.Column("code_seed", sa.String(64), nullable=False),
    sa.Column("code_version", sa.Integer, nullable=False, default=1),
    sa.Column("requests_on", sa.Boolean, nullable=False, default=True),
    sa.Column("mode", sa.String(16), nullable=False, default="staff_approve"),
    # {"<daypart name>": "<mode>"}: a daypart can change the mode or turn requests off.
    sa.Column("daypart_modes", sa.JSON, nullable=False),
    sa.Column("paused", sa.Boolean, nullable=False, default=False),
    sa.Column("flood_switched_at", Epoch, nullable=True),
    sa.Column("screen_code_on", sa.Boolean, nullable=False, default=False),
    sa.Column("screen_seed", sa.String(64), nullable=False),
    sa.Column("welcome", sa.String(140), nullable=True),
    sa.Column("accent", sa.String(7), nullable=True),
    sa.Column("logo_url", sa.String(500), nullable=True),
    sa.Column("limits", sa.JSON, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.CheckConstraint(_one_of("mode", MODES), name="mode"),
)

business_zone_room_retired_codes = sa.Table(
    "business_zone_room_retired_codes",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column(
        "room_id", Id, sa.ForeignKey("business_zone_rooms.id", ondelete="CASCADE"),
        nullable=False, index=True,
    ),
    sa.Column("code_hash", Hash, nullable=False, unique=True),
    sa.Column("code_version", sa.Integer, nullable=False),
    sa.Column("retired_at", Epoch, nullable=False),
)

business_zone_room_guests = sa.Table(
    "business_zone_room_guests",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column(
        "room_id", Id, sa.ForeignKey("business_zone_rooms.id", ondelete="CASCADE"),
        nullable=False, index=True,
    ),
    sa.Column("token_hash", Hash, nullable=False, unique=True),
    sa.Column("nickname", sa.String(40), nullable=False),
    sa.Column("ip_hash", Hash, nullable=True),
    sa.Column("status", sa.String(8), nullable=False),
    sa.Column("banned_until", Epoch, nullable=True),
    sa.Column("joined_at", Epoch, nullable=False),
    sa.Column("last_seen", Epoch, nullable=False, index=True),
    sa.CheckConstraint(_one_of("status", GUEST_STATUSES), name="status"),
    sa.Index("ix_business_zone_room_guests_room_ip", "room_id", "ip_hash"),
)

business_zone_room_requests = sa.Table(
    "business_zone_room_requests",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column(
        "room_id", Id, sa.ForeignKey("business_zone_rooms.id", ondelete="CASCADE"),
        nullable=False, index=True,
    ),
    sa.Column("zone_id", Id, nullable=False, index=True),
    sa.Column(
        "guest_id", Id, sa.ForeignKey("business_zone_room_guests.id", ondelete="CASCADE"),
        nullable=False, index=True,
    ),
    sa.Column("song_id", sa.String(64), nullable=False),
    sa.Column("title", sa.String(300), nullable=False),
    sa.Column("artist", sa.String(300), nullable=False),
    sa.Column("status", sa.String(10), nullable=False),
    sa.Column("reason", sa.String(16), nullable=True),  # internal only, never shown to guests
    sa.Column("votes", sa.Integer, nullable=False, default=1),
    sa.Column("decided_by_kind", sa.String(8), nullable=True),
    sa.Column("decided_by_id", sa.String(64), nullable=True),
    sa.Column("decided_by_name", sa.String(120), nullable=True),
    sa.Column("decided_at", Epoch, nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("resolved_at", Epoch, nullable=True),
    sa.Column("snapshot_version", sa.Integer, nullable=True),
    sa.CheckConstraint(_one_of("status", REQUEST_STATUSES), name="status"),
)

sa.Index(
    "uq_business_zone_room_requests_one_waiting_per_song",
    business_zone_room_requests.c.room_id,
    business_zone_room_requests.c.song_id,
    unique=True,
    sqlite_where=business_zone_room_requests.c.status.in_(WAITING_STATUSES),
    postgresql_where=business_zone_room_requests.c.status.in_(WAITING_STATUSES),
)

business_zone_room_votes = sa.Table(
    "business_zone_room_votes",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column(
        "request_id", Id,
        sa.ForeignKey("business_zone_room_requests.id", ondelete="CASCADE"), nullable=False,
    ),
    sa.Column(
        "guest_id", Id, sa.ForeignKey("business_zone_room_guests.id", ondelete="CASCADE"),
        nullable=False, index=True,
    ),
    sa.Column("created_at", Epoch, nullable=False),
    sa.UniqueConstraint("request_id", "guest_id"),
)

business_venue_networks = sa.Table(
    "business_venue_networks",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("venue_id", Id, nullable=False, index=True),
    sa.Column("address_hash", Hash, nullable=False, index=True),
    sa.Column("seen_at", Epoch, nullable=False),
    sa.UniqueConstraint("venue_id", "address_hash"),
)

business_staff_presence = sa.Table(
    "business_staff_presence",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("venue_id", Id, nullable=False, index=True),
    sa.Column("actor_kind", sa.String(16), nullable=False),
    sa.Column("actor_id", sa.String(64), nullable=False),
    sa.Column("seen_at", Epoch, nullable=False),
    sa.UniqueConstraint("venue_id", "actor_kind", "actor_id"),
)

TABLES = (
    business_zone_rooms,
    business_zone_room_retired_codes,
    business_zone_room_guests,
    business_zone_room_requests,
    business_zone_room_votes,
    business_venue_networks,
    business_staff_presence,
)

__all__ = [
    "DECIDER_KINDS",
    "GUEST_STATUSES",
    "MODES",
    "REQUEST_STATUSES",
    "TABLES",
    "WAITING_STATUSES",
    "business_staff_presence",
    "business_venue_networks",
    "business_zone_room_guests",
    "business_zone_room_requests",
    "business_zone_room_retired_codes",
    "business_zone_room_votes",
    "business_zone_rooms",
]
