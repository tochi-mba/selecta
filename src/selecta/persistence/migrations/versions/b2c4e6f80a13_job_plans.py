"""job plans: bulk work accepted as one row and materialised a page at a time

Revision ID: b2c4e6f80a13
Revises: a3f8d2c61b97
Create Date: 2026-11-10

Admission control (ADR-0395, SC-0395-05, docs/saas/04-queue-and-scheduling.md 4A.4): a request
for ten million items is accepted as one `job_plans` row and turned into jobs in pages of 500 as
earlier pages drain, so the jobs table, the claim and the API never see the whole of it at once.
It is tenant data, so it gets the same forced workspace policy as every other tenant table on
PostgreSQL (see `b7e3c91f0a24`).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import Text
from sqlalchemy.dialects import postgresql

revision: str = "b2c4e6f80a13"
down_revision: str | Sequence[str] | None = "a3f8d2c61b97"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"
OPEN = "state = 'open'"


def upgrade() -> None:
    op.create_table(
        "job_plans",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("lane", sa.String(length=16), nullable=False),
        sa.Column("urgency", sa.SmallInteger(), nullable=False),
        sa.Column(
            "input_ref",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.String(length=255), nullable=True),
        sa.Column("total", sa.BigInteger(), nullable=False),
        sa.Column("materialised", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.Column("finished_at", sa.Float(precision=53), nullable=True),
        sa.CheckConstraint(
            "lane IN ('interactive', 'speculative', 'standard')", name=op.f("ck_job_plans_lane")
        ),
        sa.CheckConstraint(
            "materialised >= 0 AND materialised <= total", name=op.f("ck_job_plans_materialised")
        ),
        sa.CheckConstraint(
            "state IN ('cancelled', 'done', 'open')", name=op.f("ck_job_plans_state")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_job_plans")),
    )
    with op.batch_alter_table("job_plans", schema=None) as batch_op:
        batch_op.create_index(
            "ix_job_plans_open",
            ["created_at"],
            unique=False,
            sqlite_where=sa.text(OPEN),
            postgresql_where=sa.text(OPEN),
        )
        batch_op.create_index(
            "ix_job_plans_workspace_state", ["workspace_id", "state"], unique=False
        )
        batch_op.create_index(
            "uq_job_plans_open_idempotency",
            ["workspace_id", "type", "idempotency_key"],
            unique=True,
            sqlite_where=sa.text(OPEN),
            postgresql_where=sa.text(OPEN),
        )
    if op.get_bind().dialect.name == "postgresql":
        op.execute('ALTER TABLE "job_plans" ENABLE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE "job_plans" FORCE ROW LEVEL SECURITY')
        op.execute(f'CREATE POLICY {POLICY} ON "job_plans" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "job_plans"')
    with op.batch_alter_table("job_plans", schema=None) as batch_op:
        batch_op.drop_index("uq_job_plans_open_idempotency")
        batch_op.drop_index("ix_job_plans_workspace_state")
        batch_op.drop_index("ix_job_plans_open")
    op.drop_table("job_plans")
