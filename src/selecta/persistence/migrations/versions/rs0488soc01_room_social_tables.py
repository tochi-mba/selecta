"""Rooms: plays, reactions, votes for the next song, recaps and crowd marks (ADR-0488).

Revision ID: rs0488soc01
Revises: lm0481usage01

Tenant data: all seven new tables receive the forced PostgreSQL workspace isolation policy.

`room_requests` gains three columns and loses one rule: `source` says whether a guest asked for
the song or the room voted it in, `dedication` and `dedication_play_id` carry a line from the
fixed list, and `guest_id` may now be empty, because a song the room voted in has no asker.

The tables are created from the live schema module. `COLUMNS` pins every table and column this
revision creates, so a column added to the module later is refused here and must arrive in its
own migration.
"""

import sqlalchemy as sa
from alembic import op

from selecta.rooms import social_schema

revision = "rs0488soc01"
down_revision = "lm0481usage01"
branch_labels = None
depends_on = None

COLUMNS = {
    "room_plays": (
        "id",
        "room_id",
        "workspace_id",
        "song_id",
        "mix_key",
        "song_index",
        "previous_play_id",
        "started_at",
        "loves",
        "blends",
        "love_counted",
        "blend_counted",
    ),
    "room_reactions": (
        "id",
        "room_id",
        "workspace_id",
        "guest_id",
        "play_id",
        "kind",
        "created_at",
    ),
    "room_rounds": (
        "id",
        "room_id",
        "workspace_id",
        "status",
        "opened_by",
        "opened_at",
        "closes_at",
        "closed_at",
        "winner_song_id",
        "winner_request_id",
        "outcome",
    ),
    "room_round_options": (
        "id",
        "round_id",
        "room_id",
        "workspace_id",
        "position",
        "song_id",
        "votes",
    ),
    "room_round_votes": (
        "id",
        "round_id",
        "room_id",
        "workspace_id",
        "guest_id",
        "position",
        "created_at",
    ),
    "room_recaps": ("room_id", "workspace_id", "built_at", "data"),
    "crowd_marks": (
        "id",
        "workspace_id",
        "zone_key",
        "song_id",
        "next_song_id",
        "loves",
        "rooms",
        "last_at",
    ),
}
TABLES = tuple(COLUMNS)
POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"
Id = sa.String(36)


def _tables():
    declared = {table.name: tuple(table.c.keys()) for table in social_schema.ALL_TABLES}
    if declared != COLUMNS or tuple(declared) != TABLES:
        raise RuntimeError("The room social schema changed; add a new migration")
    return social_schema.ALL_TABLES


def upgrade() -> None:
    for table in _tables():
        table.create(op.get_bind())
    if op.get_bind().dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{name}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY {POLICY} ON "{name}" USING {RULE} WITH CHECK {RULE}')
    with op.batch_alter_table("room_requests") as batch_op:
        batch_op.add_column(
            sa.Column("source", sa.String(8), nullable=False, server_default="guest")
        )
        batch_op.add_column(sa.Column("dedication", sa.String(24), nullable=True))
        batch_op.add_column(sa.Column("dedication_play_id", Id, nullable=True))
        batch_op.alter_column("guest_id", existing_type=Id, nullable=True)
        batch_op.create_check_constraint("source", "source IN ('guest', 'round')")


def downgrade() -> None:
    # A song the room voted in has no asker, so it cannot survive `guest_id` being required.
    op.execute("DELETE FROM room_requests WHERE guest_id IS NULL")
    with op.batch_alter_table("room_requests") as batch_op:
        # op.f: the name is already final; without it the naming rule prefixes it a second time
        batch_op.drop_constraint(op.f("ck_room_requests_source"), type_="check")
        batch_op.alter_column("guest_id", existing_type=Id, nullable=False)
        batch_op.drop_column("dedication_play_id")
        batch_op.drop_column("dedication")
        batch_op.drop_column("source")
    if op.get_bind().dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{name}"')
    for table in reversed(_tables()):
        table.drop(op.get_bind())
