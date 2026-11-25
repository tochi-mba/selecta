"""Venue rooms: plays, reactions, votes, dedications, recaps and patron screens (ADR-0488).

Revision ID: rs0488soc02
Revises: rs0488soc01

Tenant data: all nine tables receive the forced PostgreSQL workspace isolation policy.

Only new tables. The tables ADR-0451 made are created from their live declarations, so nothing
is added to them here; what a standing room needs beyond them is kept beside them.

`NAMES` pins the tables this revision creates, so a table added to the module later is refused
here and must arrive in its own migration.
"""

from alembic import op

from selecta.business.rooms import social_schema

revision = "rs0488soc02"
down_revision = "rs0488soc01"
branch_labels = None
depends_on = None

NAMES = (
    "business_zone_room_social",
    "business_zone_room_plays",
    "business_zone_room_reactions",
    "business_zone_room_rounds",
    "business_zone_room_round_options",
    "business_zone_room_round_votes",
    "business_zone_room_dedications",
    "business_zone_room_recaps",
    "business_zone_room_displays",
)
POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def _tables():
    if tuple(table.name for table in social_schema.TABLES) != NAMES:
        raise RuntimeError("The venue room social schema changed; add a new migration")
    return social_schema.TABLES


def upgrade() -> None:
    for table in _tables():
        table.create(op.get_bind())
    if op.get_bind().dialect.name == "postgresql":
        for name in NAMES:
            op.execute(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{name}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY {POLICY} ON "{name}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for name in NAMES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{name}"')
    for table in reversed(_tables()):
        table.drop(op.get_bind())
