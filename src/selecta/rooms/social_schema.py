"""Tables for what a room does together (ADR-0488).

- `room_plays`: one row for each song the speaker played while the room was open. A play is
  what a heart, a blend tap and a dedication attach to, and what the recap counts.
- `room_reactions`: one love and one blend tap per guest per play.
- `room_rounds`, `room_round_options`, `room_round_votes`: a vote for the next song, the songs
  offered and each guest's one vote.
- `room_recaps`: the room's totals, built once when it ends.
- `crowd_marks`: what rooms loved, per song and per pair of songs, for the planner.

Reactions and votes name a guest, so they are deleted with the rest of the guest data 30 days
after the room ends (`purge`). The recap and the crowd marks hold no guest id and no nickname:
they belong to the host's workspace and stay.

Unique indexes hold the rules that must survive two requests racing: one row per play, one tap
of each kind per guest per play, one open vote per room, one vote per guest per round.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

REACTION_KINDS = ("love", "blend")
ROUND_STATUSES = ("open", "closed", "cancelled", "void")
ROUND_STARTERS = ("host", "timer")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _room() -> sa.Column:
    return sa.Column(
        "room_id", Id, sa.ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )


def _guest() -> sa.Column:
    return sa.Column(
        "guest_id",
        Id,
        sa.ForeignKey("room_guests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


room_plays = sa.Table(
    "room_plays",
    metadata,
    sa.Column("id", Id, primary_key=True),
    _room(),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("song_id", sa.BigInteger, nullable=False),
    # The mix revision the speaker named, or "" when it named none: a column in a unique rule
    # must never be NULL, or two looks at the same song would each write a row.
    sa.Column("mix_key", sa.String(64), nullable=False),
    sa.Column("song_index", sa.Integer, nullable=False),
    sa.Column("previous_play_id", Id, nullable=True),  # the song before, for the blend pair
    sa.Column("started_at", Epoch, nullable=False),
    sa.Column("loves", sa.Integer, nullable=False, default=0),
    sa.Column("blends", sa.Integer, nullable=False, default=0),
    # Whether this play has already added its room to the crowd marks (once per kind).
    sa.Column("love_counted", sa.Boolean, nullable=False, default=False),
    sa.Column("blend_counted", sa.Boolean, nullable=False, default=False),
    sa.UniqueConstraint("room_id", "mix_key", "song_index", "song_id"),
    sa.Index("ix_room_plays_room_id_started_at", "room_id", "started_at"),
)

room_reactions = sa.Table(
    "room_reactions",
    metadata,
    sa.Column("id", Id, primary_key=True),
    _room(),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    _guest(),
    sa.Column(
        "play_id", Id, sa.ForeignKey("room_plays.id", ondelete="CASCADE"), nullable=False
    ),
    sa.Column("kind", sa.String(8), nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.CheckConstraint(_one_of("kind", REACTION_KINDS), name="kind"),
    sa.UniqueConstraint("play_id", "guest_id", "kind"),
)

room_rounds = sa.Table(
    "room_rounds",
    metadata,
    sa.Column("id", Id, primary_key=True),
    _room(),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("status", sa.String(10), nullable=False),
    sa.Column("opened_by", sa.String(8), nullable=False),
    sa.Column("opened_at", Epoch, nullable=False),
    sa.Column("closes_at", Epoch, nullable=False),
    sa.Column("closed_at", Epoch, nullable=True),
    sa.Column("winner_song_id", sa.BigInteger, nullable=True),
    sa.Column("winner_request_id", Id, nullable=True),
    # What became of the winner: waiting, in_mix, not_placed, or why there was none.
    sa.Column("outcome", sa.String(16), nullable=True),
    sa.CheckConstraint(_one_of("status", ROUND_STATUSES), name="status"),
    sa.CheckConstraint(_one_of("opened_by", ROUND_STARTERS), name="opened_by"),
)

sa.Index(
    "uq_room_rounds_one_open_per_room",
    room_rounds.c.room_id,
    unique=True,
    sqlite_where=room_rounds.c.status == "open",
    postgresql_where=room_rounds.c.status == "open",
)

room_round_options = sa.Table(
    "room_round_options",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column(
        "round_id",
        Id,
        sa.ForeignKey("room_rounds.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    ),
    _room(),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("position", sa.Integer, nullable=False),
    sa.Column("song_id", sa.BigInteger, nullable=False),
    sa.Column("votes", sa.Integer, nullable=False, default=0),
    sa.UniqueConstraint("round_id", "position"),
    sa.UniqueConstraint("round_id", "song_id"),
)

room_round_votes = sa.Table(
    "room_round_votes",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column(
        "round_id",
        Id,
        sa.ForeignKey("room_rounds.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    ),
    _room(),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    _guest(),
    sa.Column("position", sa.Integer, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.UniqueConstraint("round_id", "guest_id"),
)

room_recaps = sa.Table(
    "room_recaps",
    metadata,
    sa.Column(
        "room_id", Id, sa.ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True
    ),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("built_at", Epoch, nullable=False),
    sa.Column("data", sa.JSON, nullable=False),
)

crowd_marks = sa.Table(
    "crowd_marks",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    # "" for a party room, the zone id for a venue room: never NULL, for the unique rule.
    sa.Column("zone_key", sa.String(36), nullable=False, default=""),
    sa.Column("song_id", sa.BigInteger, nullable=False),
    # 0: a love for the song itself. Otherwise the song it blended into.
    sa.Column("next_song_id", sa.BigInteger, nullable=False, default=0),
    sa.Column("loves", sa.Integer, nullable=False, default=0),  # every tap, for showing
    sa.Column("rooms", sa.Integer, nullable=False, default=0),  # rooms past the threshold
    sa.Column("last_at", Epoch, nullable=False),
    sa.UniqueConstraint("workspace_id", "zone_key", "song_id", "next_song_id"),
)

ALL_TABLES = (
    room_plays,
    room_reactions,
    room_rounds,
    room_round_options,
    room_round_votes,
    room_recaps,
    crowd_marks,
)

__all__ = [
    "ALL_TABLES",
    "REACTION_KINDS",
    "ROUND_STARTERS",
    "ROUND_STATUSES",
    "crowd_marks",
    "room_plays",
    "room_reactions",
    "room_recaps",
    "room_round_options",
    "room_round_votes",
    "room_rounds",
]
