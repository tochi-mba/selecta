"""which artifacts each mix revision uses, so eviction can protect them

Revision ID: d4522d8bd3ad
Revises: 803a5d74fae3
Create Date: 2026-11-10

Derived data is evicted least-recently-used under a per-workspace budget, except what a frozen
revision or the revision playing now uses (ADR-0397, SC-0397-04). `revision_artifacts` records
those uses, one row per revision and artifact, with whether the revision is frozen. It is tenant
data, so it gets the same forced workspace policy as every other tenant table on PostgreSQL (see
`b7e3c91f0a24`).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4522d8bd3ad"
down_revision: str | Sequence[str] | None = "803a5d74fae3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def upgrade() -> None:
    op.create_table(
        "revision_artifacts",
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("revision_id", sa.String(length=36), nullable=False),
        sa.Column("artifact_id", sa.String(length=36), nullable=False),
        sa.Column("frozen", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint(
            "workspace_id", "revision_id", "artifact_id", name=op.f("pk_revision_artifacts")
        ),
    )
    with op.batch_alter_table("revision_artifacts") as batch_op:
        batch_op.create_index("ix_revision_artifacts_artifact", ["artifact_id"], unique=False)
    if op.get_bind().dialect.name == "postgresql":
        op.execute('ALTER TABLE "revision_artifacts" ENABLE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE "revision_artifacts" FORCE ROW LEVEL SECURITY')
        op.execute(f'CREATE POLICY {POLICY} ON "revision_artifacts" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "revision_artifacts"')
    with op.batch_alter_table("revision_artifacts") as batch_op:
        batch_op.drop_index("ix_revision_artifacts_artifact")
    op.drop_table("revision_artifacts")
