"""index dangerous_actions.workspace_id

Revision ID: d41a6b2e9c07
Revises: b7e3c91f0a24
Create Date: 2026-11-10

Every tenant table's `workspace_id` leads an index, so a lookup by workspace, and the row-level
security policy that compares it, never scans the whole table. The delayed staff actions table
was the one without; `tests/test_cloud_workspace_columns.py` found it.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "d41a6b2e9c07"
down_revision: str | Sequence[str] | None = "b7e3c91f0a24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEX = "ix_dangerous_actions_workspace_id"


def upgrade() -> None:
    with op.batch_alter_table("dangerous_actions") as batch_op:
        batch_op.create_index(batch_op.f(INDEX), ["workspace_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("dangerous_actions") as batch_op:
        batch_op.drop_index(batch_op.f(INDEX))
