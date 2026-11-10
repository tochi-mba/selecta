"""revoked AuthKit sessions, WorkOS webhook events, staff privileged sessions, suspension

Revision ID: 65d364978488
Revises: a702897ccca8
Create Date: 2026-11-10

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "65d364978488"
down_revision: str | Sequence[str] | None = "a702897ccca8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workos_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("event_id", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=128), nullable=False),
        sa.Column("received_at", sa.Float(precision=53), nullable=False),
        sa.Column("processed_at", sa.Float(precision=53), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error", sa.String(length=255), nullable=True),
        sa.CheckConstraint(
            "status IN ('received', 'processed', 'ignored', 'failed')",
            name=op.f("ck_workos_events_status"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workos_events")),
        sa.UniqueConstraint("event_id", name=op.f("uq_workos_events_event_id")),
    )
    op.create_table(
        "privileged_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("workos_sid", sa.String(length=255), nullable=False),
        sa.Column("issued_at", sa.Float(precision=53), nullable=False),
        sa.Column("mfa_at", sa.Float(precision=53), nullable=False),
        sa.Column("expires_at", sa.Float(precision=53), nullable=False),
        sa.Column("revoked_at", sa.Float(precision=53), nullable=True),
        sa.Column("revoke_reason", sa.String(length=64), nullable=True),
        sa.CheckConstraint(
            "expires_at > issued_at AND expires_at <= issued_at + 3600",
            name=op.f("ck_privileged_sessions_at_most_an_hour"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_privileged_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_privileged_sessions")),
    )
    with op.batch_alter_table("privileged_sessions", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_privileged_sessions_user_id"), ["user_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_privileged_sessions_workos_sid"), ["workos_sid"], unique=False
        )

    op.create_table(
        "revoked_sessions",
        sa.Column("sid", sa.String(length=255), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("revoked_at", sa.Float(precision=53), nullable=False),
        sa.Column("reason", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_revoked_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("sid", name=op.f("pk_revoked_sessions")),
    )
    with op.batch_alter_table("revoked_sessions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_revoked_sessions_user_id"), ["user_id"], unique=False)

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("suspended_at", sa.Float(precision=53), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("suspended_at")

    with op.batch_alter_table("revoked_sessions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_revoked_sessions_user_id"))
    op.drop_table("revoked_sessions")

    with op.batch_alter_table("privileged_sessions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_privileged_sessions_workos_sid"))
        batch_op.drop_index(batch_op.f("ix_privileged_sessions_user_id"))
    op.drop_table("privileged_sessions")
    op.drop_table("workos_events")
