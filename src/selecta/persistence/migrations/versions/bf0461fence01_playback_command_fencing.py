"""Playback ownership fences, command expiry and delivery acknowledgments (ADR-0461).

Revision ID: bf0461fence01
Revises: bf0458media01

`playback_sessions.fence` starts at 0 for every existing session. The new `playback_commands`
columns stay empty on old rows. No new table, so the forced workspace isolation policies that
already cover both tables (b7e3c91f0a24) are unchanged. `batch_alter_table` lets SQLite rebuild
`playback_commands` to swap its status CHECK; PostgreSQL runs the same steps as plain ALTERs.
"""

import sqlalchemy as sa
from alembic import op

revision = "bf0461fence01"
down_revision = "bf0458media01"
branch_labels = None
depends_on = None

OLD_STATUSES = ("applied", "stale", "no_speaker")
NEW_STATUSES = (*OLD_STATUSES, "superseded", "expired")
ACK_RESULTS = ("applied", "unavailable_here", "superseded", "expired")
EPOCH = sa.Float(precision=53)
SESSION_ZONE_INDEX = "uq_playback_sessions_workspace_id_zone"


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def upgrade() -> None:
    with op.batch_alter_table("playback_sessions") as batch:
        batch.add_column(
            sa.Column("fence", sa.BigInteger(), nullable=False, server_default="0")
        )

    with op.batch_alter_table("playback_commands") as batch:
        batch.drop_constraint(op.f("ck_playback_commands_status"), type_="check")
        batch.add_column(sa.Column("ttl_seconds", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("expires_at", EPOCH, nullable=True))
        batch.add_column(sa.Column("fence", sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column("acked_at", EPOCH, nullable=True))
        batch.add_column(sa.Column("ack_result", sa.String(24), nullable=True))
        batch.create_check_constraint(
            op.f("ck_playback_commands_status"), _one_of("status", NEW_STATUSES)
        )
        batch.create_check_constraint(
            op.f("ck_playback_commands_ack_result"),
            "ack_result IS NULL OR " + _one_of("ack_result", ACK_RESULTS),
        )


def downgrade() -> None:
    # The old status CHECK cannot hold the two new refusals. Those rows only answer retried
    # presses (purged after a week), so refuse loudly rather than rewrite their meaning.
    connection = op.get_bind()
    if connection.execute(
        sa.text(
            "SELECT 1 FROM playback_commands "
            "WHERE status IN ('superseded', 'expired') LIMIT 1"
        )
    ).first():
        raise RuntimeError("Cannot downgrade while superseded or expired commands exist")

    with op.batch_alter_table("playback_commands") as batch:
        batch.drop_constraint(op.f("ck_playback_commands_ack_result"), type_="check")
        batch.drop_constraint(op.f("ck_playback_commands_status"), type_="check")
        batch.create_check_constraint(
            op.f("ck_playback_commands_status"), _one_of("status", OLD_STATUSES)
        )
        batch.drop_column("ack_result")
        batch.drop_column("acked_at")
        batch.drop_column("fence")
        batch.drop_column("expires_at")
        batch.drop_column("ttl_seconds")

    # Dropping a column makes SQLite rebuild the table, and its inspector cannot see the
    # expression index, so the rebuild would silently lose it. Take it off and put it back.
    op.drop_index(SESSION_ZONE_INDEX, table_name="playback_sessions")
    with op.batch_alter_table("playback_sessions") as batch:
        batch.drop_column("fence")
    op.create_index(
        SESSION_ZONE_INDEX,
        "playback_sessions",
        ["workspace_id", sa.text("coalesce(zone_id, '')")],
        unique=True,
    )
