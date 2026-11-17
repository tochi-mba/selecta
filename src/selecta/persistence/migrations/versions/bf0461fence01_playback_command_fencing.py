"""Playback ownership fences, command expiry and delivery acknowledgments (ADR-0461).

Revision ID: bf0461fence01
Revises: bf0458media01
"""

import sqlalchemy as sa
from alembic import op

revision = "bf0461fence01"
down_revision = "bf0458media01"
branch_labels = None
depends_on = None

OLD_STATUSES = ("applied", "stale", "no_speaker")
NEW_STATUSES = (*OLD_STATUSES, "superseded", "expired")
ACK_RESULTS = ("applied", "unavailable_here", "superseded")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def upgrade() -> None:
    with op.batch_alter_table("playback_sessions") as batch:
        batch.add_column(sa.Column("fence", sa.BigInteger(), nullable=False, server_default="0"))

    with op.batch_alter_table("playback_commands") as batch:
        batch.drop_constraint(op.f("ck_playback_commands_status"), type_="check")
        batch.add_column(sa.Column("ttl_seconds", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("expires_at", sa.Float(precision=53), nullable=True))
        batch.add_column(sa.Column("fence", sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column("acked_at", sa.Float(precision=53), nullable=True))
        batch.add_column(sa.Column("ack_result", sa.String(24), nullable=True))
        batch.create_check_constraint(
            op.f("ck_playback_commands_status"), _one_of("status", NEW_STATUSES)
        )
        batch.create_check_constraint(
            op.f("ck_playback_commands_ack_result"),
            "ack_result IS NULL OR " + _one_of("ack_result", ACK_RESULTS),
        )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(
        sa.text(
            "SELECT 1 FROM playback_commands "
            "WHERE status IN ('superseded', 'expired') OR ack_result IS NOT NULL LIMIT 1"
        )
    ).first():
        raise RuntimeError("Cannot downgrade while fenced or acknowledged commands exist")

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

    with op.batch_alter_table("playback_sessions") as batch:
        batch.drop_column("fence")
