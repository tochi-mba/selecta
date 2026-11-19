"""venue closing mode, zone plan state and upload venue attribution (ADR-0444, ADR-0448)

Revision ID: bz0444hour02
Revises: bz0443jobs01
Create Date: 2026-11-19

- `venue_closing_modes`: a venue's choice between ending on the song's natural end (within 4
  minutes) and ending exactly at the closing time (ADR-0444).
- `zone_plan_states`: what the zone autoplanner last planned for a zone (programme version,
  close, block) and the zone's staff steering, so Bigger and Calmer decay over three songs.
- `upload_sessions.venue_id` and `assets.venue_id`: the venue an upload was made for, so the
  organisation's pooled storage shows real per-venue usage (ADR-0448). Nullable: uploads made
  for the whole organisation, and every older one, have none.

The two new tables carry `workspace_id` and get the forced `workspace_isolation` policy on
PostgreSQL, like every tenant table.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bz0444hour02"
down_revision: str | Sequence[str] | None = "bz0443jobs01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(36)
EPOCH = sa.Float(precision=53)
JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"
TENANT_TABLES = ("venue_closing_modes", "zone_plan_states")


def upgrade() -> None:
    op.create_table(
        "venue_closing_modes",
        sa.Column("venue_id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("closing_mode", sa.String(16), nullable=False),
        sa.Column("updated_by", ID, nullable=False),
        sa.Column("updated_at", EPOCH, nullable=False),
        sa.CheckConstraint(
            "closing_mode IN ('natural', 'exact')", name=op.f("ck_venue_closing_modes_mode")
        ),
    )
    op.create_index(op.f("ix_venue_closing_modes_workspace_id"), "venue_closing_modes",
                    ["workspace_id"])
    op.create_table(
        "zone_plan_states",
        sa.Column("zone_id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("plan_json", JSON),
        sa.Column("steering_json", JSON),
        sa.Column("dirty", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_at", EPOCH, nullable=False),
    )
    op.create_index(op.f("ix_zone_plan_states_workspace_id"), "zone_plan_states",
                    ["workspace_id"])
    with op.batch_alter_table("upload_sessions") as batch:
        batch.add_column(sa.Column("venue_id", ID, nullable=True))
    with op.batch_alter_table("assets") as batch:
        batch.add_column(sa.Column("venue_id", ID, nullable=True))
    if op.get_bind().dialect.name == "postgresql":
        for table in TENANT_TABLES:
            op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY {POLICY} ON "{table}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for table in TENANT_TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{table}"')
    with op.batch_alter_table("assets") as batch:
        batch.drop_column("venue_id")
    with op.batch_alter_table("upload_sessions") as batch:
        batch.drop_column("venue_id")
    op.drop_table("zone_plan_states")
    op.drop_table("venue_closing_modes")
