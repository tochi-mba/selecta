"""durable account deletion workflows

Revision ID: a31c82df0b54
Revises: 4930a0bda869
Create Date: 2026-11-09

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a31c82df0b54"
down_revision: str | Sequence[str] | None = "4930a0bda869"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "account_deletion_workflows",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("plan", sa.JSON(), nullable=False),
        sa.Column("next_step", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "status", sa.String(length=16), server_default=sa.text("'pending'"), nullable=False
        ),
        sa.Column("available_at", sa.Float(precision=53), nullable=False),
        sa.Column("lease_id", sa.String(length=36), nullable=True),
        sa.Column("lease_owner", sa.String(length=64), nullable=True),
        sa.Column("lease_generation", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("lease_expires_at", sa.Float(precision=53), nullable=True),
        sa.Column("attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.Column("completed_at", sa.Float(precision=53), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'complete')",
            name=op.f("ck_account_deletion_workflows_status"),
        ),
        sa.CheckConstraint(
            "next_step >= 0", name=op.f("ck_account_deletion_workflows_next_step_nonnegative")
        ),
        sa.CheckConstraint(
            "lease_generation >= 0",
            name=op.f("ck_account_deletion_workflows_lease_generation_nonnegative"),
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name=op.f("ck_account_deletion_workflows_attempt_count_nonnegative"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_account_deletion_workflows")),
        sa.UniqueConstraint("user_id", name=op.f("uq_account_deletion_workflows_user_id")),
    )
    with op.batch_alter_table("account_deletion_workflows", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_account_deletion_workflows_available"),
            ["status", "available_at", "lease_expires_at"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("account_deletion_workflows", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_account_deletion_workflows_available"))
    op.drop_table("account_deletion_workflows")
