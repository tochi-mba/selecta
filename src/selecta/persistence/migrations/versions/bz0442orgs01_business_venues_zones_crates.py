"""Business organisation venues, zones and crates (ADR-0442).

Revision ID: bz0442orgs01
Revises: c5f08d3a71e2
Create Date: 2026-11-12

An organisation is an existing workspace with kind=business. This migration
adds its physical venues, playback zones, crates and ordered crate songs.
The DDL matches selecta.business.schema; all tables are workspace-scoped.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bz0442orgs01"
down_revision: str | Sequence[str] | None = "c5f08d3a71e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(36)
EPOCH = sa.Float(precision=53)
JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
TABLES = ("venues", "zones", "crates", "crate_songs")
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def _index(table: str, *columns: str) -> None:
    op.create_index(op.f(f"ix_{table}_{'_'.join(columns)}"), table, list(columns))


def upgrade() -> None:
    op.create_table(
        "venues",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("address_json", JSON),
        sa.Column("country", sa.String(2), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", EPOCH, nullable=False),
        sa.Column("archived_at", EPOCH),
        sa.Column("purge_after", EPOCH),
        sa.CheckConstraint(
            "status IN ('active', 'paused', 'archived')", name=op.f("ck_venues_status"),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], ondelete="CASCADE",
            name=op.f("fk_venues_workspace_id_workspaces"),
        ),
    )
    _index("venues", "workspace_id")

    op.create_table(
        "zones",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("venue_id", ID, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("pause_at", EPOCH),
        sa.Column("home_device_id", ID),
        sa.Column("standby_device_id", ID),
        sa.Column("created_at", EPOCH, nullable=False),
        sa.Column("archived_at", EPOCH),
        sa.CheckConstraint(
            "status IN ('active', 'paused', 'archived')", name=op.f("ck_zones_status"),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], ondelete="CASCADE",
            name=op.f("fk_zones_workspace_id_workspaces"),
        ),
        sa.ForeignKeyConstraint(
            ["venue_id"], ["venues.id"], ondelete="CASCADE",
            name=op.f("fk_zones_venue_id_venues"),
        ),
    )
    _index("zones", "workspace_id")
    _index("zones", "venue_id")
    op.create_index(
        "uq_zones_venue_id_lower_name",
        "zones",
        ["venue_id", sa.text("lower(name)")],
        unique=True,
    )

    op.create_table(
        "crates",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("venue_id", ID),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("created_by", ID),
        sa.Column("created_at", EPOCH, nullable=False),
        sa.Column("archived_at", EPOCH),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], ondelete="CASCADE",
            name=op.f("fk_crates_workspace_id_workspaces"),
        ),
        sa.ForeignKeyConstraint(
            ["venue_id"], ["venues.id"], ondelete="CASCADE",
            name=op.f("fk_crates_venue_id_venues"),
        ),
    )
    _index("crates", "workspace_id")
    _index("crates", "venue_id")

    op.create_table(
        "crate_songs",
        sa.Column("crate_id", ID, primary_key=True),
        sa.Column("song_id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("removed_at", EPOCH),
        sa.ForeignKeyConstraint(
            ["crate_id"], ["crates.id"], ondelete="CASCADE",
            name=op.f("fk_crate_songs_crate_id_crates"),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], ondelete="CASCADE",
            name=op.f("fk_crate_songs_workspace_id_workspaces"),
        ),
    )
    _index("crate_songs", "workspace_id")
    _index("crate_songs", "workspace_id", "song_id")

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
            op.execute(
                f'CREATE POLICY workspace_isolation ON "{table}" USING {RULE} WITH CHECK {RULE}'
            )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f'DROP POLICY IF EXISTS workspace_isolation ON "{table}"')
    for table in reversed(TABLES):
        op.drop_table(table)
