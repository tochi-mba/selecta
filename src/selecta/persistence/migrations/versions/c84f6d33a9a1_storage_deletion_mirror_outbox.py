"""durable outbox for offsite storage tombstones

Revision ID: c84f6d33a9a1
Revises: a31c82df0b54
Create Date: 2026-11-09

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c84f6d33a9a1"
down_revision: str | Sequence[str] | None = "a31c82df0b54"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "deletion_mirror_outbox",
        sa.Column("event_key", sa.String(length=64), nullable=False),
        sa.Column("deletion_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("delivered_at", sa.Float(precision=53), nullable=True),
        sa.Column("attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "attempt_count >= 0", name=op.f("ck_deletion_mirror_outbox_attempt_count_nonnegative")
        ),
        sa.PrimaryKeyConstraint("event_key", name=op.f("pk_deletion_mirror_outbox")),
    )
    with op.batch_alter_table("deletion_mirror_outbox", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_deletion_mirror_outbox_deletion_id"), ["deletion_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_deletion_mirror_outbox_workspace_id"), ["workspace_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_deletion_mirror_outbox_delivered_at"),
            ["delivered_at", "created_at"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("deletion_mirror_outbox", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_deletion_mirror_outbox_delivered_at"))
        batch_op.drop_index(batch_op.f("ix_deletion_mirror_outbox_workspace_id"))
        batch_op.drop_index(batch_op.f("ix_deletion_mirror_outbox_deletion_id"))
    op.drop_table("deletion_mirror_outbox")
