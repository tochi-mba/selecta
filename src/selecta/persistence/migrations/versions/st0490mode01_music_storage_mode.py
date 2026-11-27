"""Persist the active audio storage mode and its optimistic revision."""
import sqlalchemy as sa
from alembic import op

revision = "st0490mode01"
down_revision = "st0480rights01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "workspaces" not in sa.inspect(bind).get_table_names():
        return
    columns = {column["name"] for column in sa.inspect(bind).get_columns("workspaces")}
    if "music_storage_mode" not in columns:
        op.add_column("workspaces", sa.Column("music_storage_mode", sa.String(16), nullable=True))
    if "music_storage_revision" not in columns:
        op.add_column(
            "workspaces",
            sa.Column("music_storage_revision", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    # Keep the persisted audio upload boundary during a downgrade.
    pass
