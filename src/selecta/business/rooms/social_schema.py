"""Tables for what a standing room does together (ADR-0488, venue rooms).

Every table here is new. The tables ADR-0451 made are created by their migration from the live
declarations in `schema`, so a column added there would be created twice on a fresh database;
what a venue room needs beyond them is therefore kept beside them, never inside them:

- `business_zone_room_social`: the room's choices for the five features, one row per room.
- `business_zone_room_plays`: each song the zone played while anyone was looking.
- `business_zone_room_reactions`: one love and one blend tap per guest per play.
- `business_zone_room_rounds`, `..._round_options`, `..._round_votes`: a vote for the next song.
- `business_zone_room_dedications`: the listed line on a request, and the play it showed on.
- `business_zone_room_recaps`: a trading day's totals; no guest and no staff name.
- `business_zone_room_displays`: a patron screen paired to the zone.

Reactions and votes name a guest and go when the guest's data goes (30 days idle). Recaps hold
no guest data and stay with the venue.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

Hash = sa.String(64)
ROUND_STATUSES = ("open", "closed", "cancelled", "void")
REACTION_KINDS = ("love", "blend")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _tenant() -> list[sa.Column]:
    return [
        sa.Column("workspace_id", Id, nullable=False, index=True),
        sa.Column("organisation_id", Id, nullable=False, index=True),
    ]


def _room() -> sa.Column:
    return sa.Column(
        "room_id", Id, sa.ForeignKey("business_zone_rooms.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )


def _guest() -> sa.Column:
    return sa.Column(
        "guest_id", Id, sa.ForeignKey("business_zone_room_guests.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )


social = sa.Table(
    "business_zone_room_social",
    metadata,
    sa.Column(
        "room_id", Id, sa.ForeignKey("business_zone_rooms.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    *_tenant(),
    sa.Column("settings", sa.JSON, nullable=False),
    # The guest row that stands for "the room" as the asker of a song the room voted in.
    sa.Column("room_guest_id", Id, nullable=True),
    sa.Column("updated_at", Epoch, nullable=False),
)

plays = sa.Table(
    "business_zone_room_plays",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    _room(),
    sa.Column("zone_id", Id, nullable=False, index=True),
    # What tells one play from another: the session's mix and place, and the song.
    sa.Column("play_key", sa.String(200), nullable=False),
    sa.Column("title", sa.String(300), nullable=False),
    sa.Column("artist", sa.String(300), nullable=False),
    sa.Column("previous_play_id", Id, nullable=True),
    sa.Column("started_at", Epoch, nullable=False),
    sa.Column("loves", sa.Integer, nullable=False, default=0),
    sa.Column("blends", sa.Integer, nullable=False, default=0),
    sa.UniqueConstraint("room_id", "play_key"),
    sa.Index("ix_business_zone_room_plays_room_id_started_at", "room_id", "started_at"),
)

reactions = sa.Table(
    "business_zone_room_reactions",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    _room(),
    _guest(),
    sa.Column(
        "play_id", Id, sa.ForeignKey("business_zone_room_plays.id", ondelete="CASCADE"),
        nullable=False,
    ),
    sa.Column("kind", sa.String(8), nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.CheckConstraint(_one_of("kind", REACTION_KINDS), name="kind"),
    sa.UniqueConstraint("play_id", "guest_id", "kind"),
)

rounds = sa.Table(
    "business_zone_room_rounds",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    _room(),
    sa.Column("status", sa.String(10), nullable=False),
    sa.Column("opened_by", sa.String(8), nullable=False),
    sa.Column("opened_at", Epoch, nullable=False),
    sa.Column("closes_at", Epoch, nullable=False),
    sa.Column("closed_at", Epoch, nullable=True),
    sa.Column("winner_song_id", sa.String(64), nullable=True),
    sa.Column("winner_request_id", Id, nullable=True),
    sa.Column("outcome", sa.String(16), nullable=True),
    sa.CheckConstraint(_one_of("status", ROUND_STATUSES), name="status"),
)

sa.Index(
    "uq_business_zone_room_rounds_one_open",
    rounds.c.room_id,
    unique=True,
    sqlite_where=rounds.c.status == "open",
    postgresql_where=rounds.c.status == "open",
)

round_options = sa.Table(
    "business_zone_room_round_options",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column(
        "round_id", Id, sa.ForeignKey("business_zone_room_rounds.id", ondelete="CASCADE"),
        nullable=False, index=True,
    ),
    sa.Column("position", sa.Integer, nullable=False),
    sa.Column("song_id", sa.String(64), nullable=False),
    sa.Column("title", sa.String(300), nullable=False),
    sa.Column("artist", sa.String(300), nullable=False),
    sa.Column("votes", sa.Integer, nullable=False, default=0),
    sa.UniqueConstraint("round_id", "position"),
)

round_votes = sa.Table(
    "business_zone_room_round_votes",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column(
        "round_id", Id, sa.ForeignKey("business_zone_room_rounds.id", ondelete="CASCADE"),
        nullable=False, index=True,
    ),
    _guest(),
    sa.Column("position", sa.Integer, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.UniqueConstraint("round_id", "guest_id"),
)

dedications = sa.Table(
    "business_zone_room_dedications",
    metadata,
    sa.Column(
        "request_id", Id,
        sa.ForeignKey("business_zone_room_requests.id", ondelete="CASCADE"), primary_key=True,
    ),
    *_tenant(),
    _room(),
    sa.Column("line", sa.String(24), nullable=False),
    sa.Column("play_id", Id, nullable=True),  # the play it showed on, so it shows once
    sa.Column("created_at", Epoch, nullable=False),
)

recaps = sa.Table(
    "business_zone_room_recaps",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    _room(),
    sa.Column("day", sa.String(10), nullable=False),  # the trading day, in venue time
    sa.Column("built_at", Epoch, nullable=False),
    sa.Column("data", sa.JSON, nullable=False),
    sa.UniqueConstraint("room_id", "day"),
)

displays = sa.Table(
    "business_zone_room_displays",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    _room(),
    sa.Column("token_hash", Hash, nullable=False, unique=True),
    sa.Column("paired_at", Epoch, nullable=False),
    sa.Column("last_seen_at", Epoch, nullable=True),
)

TABLES = (
    social,
    plays,
    reactions,
    rounds,
    round_options,
    round_votes,
    dedications,
    recaps,
    displays,
)

__all__ = [
    "TABLES",
    "dedications",
    "displays",
    "plays",
    "reactions",
    "recaps",
    "round_options",
    "round_votes",
    "rounds",
    "social",
]
