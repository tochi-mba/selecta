"""Ratings join the engine store: the hand-made `ratings` table, adopted in place.

Revision ID: lib0002ratings
Revises: lib0001baseline

Adds `workspace_id` (every existing row is the local workspace's) and its index. Nothing else
changes: no row is copied, moved or rewritten, and every existing column keeps its name, type,
constraint and meaning, so a backup of the file carries the ratings exactly as before and an
older SelectaDJ reading the file still finds the table it knows.

A column of that name can already be there without its default, when `recovery.recover` copied
rows from a newer file into an older one; then it is kept and only its empty values are filled.
"""

import sqlalchemy as sa
from alembic import op

from selecta.persistence import LOCAL_WORKSPACE

revision = "lib0002ratings"
down_revision = "lib0001baseline"
branch_labels = None
depends_on = None

INDEX = "ix_ratings_workspace_id"


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("ratings")}
    if "workspace_id" not in columns:
        op.add_column(
            "ratings",
            sa.Column(
                "workspace_id", sa.String(36), nullable=False, server_default=LOCAL_WORKSPACE
            ),
        )
    else:
        op.execute(
            sa.text("UPDATE ratings SET workspace_id = :local WHERE workspace_id IS NULL")
            .bindparams(local=LOCAL_WORKSPACE)
        )
    op.create_index(INDEX, "ratings", ["workspace_id"], if_not_exists=True)


def downgrade() -> None:
    op.drop_index(INDEX, table_name="ratings", if_exists=True)
    op.drop_column("ratings", "workspace_id")
