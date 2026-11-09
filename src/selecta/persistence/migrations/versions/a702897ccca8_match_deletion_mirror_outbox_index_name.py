"""give the deletion mirror outbox index its conventional name

Revision ID: a702897ccca8
Revises: c84f6d33a9a1
Create Date: 2026-11-09

The previous migration named the (delivered_at, created_at) index by hand, so it didn't match the
name the naming convention gives the declared index, and `pending_changes()` reported a
difference. This renames it; databases that already ran the previous migration stay valid.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "a702897ccca8"
down_revision: str | Sequence[str] | None = "c84f6d33a9a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD = "ix_deletion_mirror_outbox_delivered_at"
NEW = "ix_deletion_mirror_outbox_delivered_at_created_at"
COLUMNS = ["delivered_at", "created_at"]


def upgrade() -> None:
    with op.batch_alter_table("deletion_mirror_outbox") as batch_op:
        batch_op.drop_index(batch_op.f(OLD))
        batch_op.create_index(batch_op.f(NEW), COLUMNS, unique=False)


def downgrade() -> None:
    with op.batch_alter_table("deletion_mirror_outbox") as batch_op:
        batch_op.drop_index(batch_op.f(NEW))
        batch_op.create_index(batch_op.f(OLD), COLUMNS, unique=False)
