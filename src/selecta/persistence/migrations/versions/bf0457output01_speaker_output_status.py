"""The speaker's reported output status on the playback session (ADR-0457, BF-0457-03).

Revision ID: bf0457output01
Revises: bf0461defer01

`playback_sessions.speaker_output` holds what the lease holder last reported about its sound
output ({"device_id", "status", "verified_at"}), so controllers can show it. Empty on every
existing row. No new table, so the workspace isolation policies are unchanged.
"""

import sqlalchemy as sa
from alembic import op

revision = "bf0457output01"
down_revision = "bf0461defer01"
branch_labels = None
depends_on = None

SESSION_ZONE_INDEX = "uq_playback_sessions_workspace_id_zone"


def upgrade() -> None:
    with op.batch_alter_table("playback_sessions") as batch:
        batch.add_column(sa.Column("speaker_output", sa.JSON(), nullable=True))


def downgrade() -> None:
    # SQLite's rebuild cannot see the expression index; take it off and put it back.
    op.drop_index(SESSION_ZONE_INDEX, table_name="playback_sessions")
    with op.batch_alter_table("playback_sessions") as batch:
        batch.drop_column("speaker_output")
    op.create_index(
        SESSION_ZONE_INDEX,
        "playback_sessions",
        ["workspace_id", sa.text("coalesce(zone_id, '')")],
        unique=True,
    )
