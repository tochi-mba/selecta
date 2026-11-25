"""Song facts join the engine store: `songs`, `analysis`, `lyrics` and `song_overrides`, in place.

Revision ID: lib0003songs
Revises: lib0002ratings

Adds `workspace_id` (every existing row is the local workspace's) and its index to each table,
and a nullable `content_hash` to `songs`, which the background hash job fills
(`engine_store.song_hashes`). Nothing else changes: no row is copied, moved or rewritten, no
primary key or foreign key changes, and every existing column keeps its name, type and meaning,
so a backup carries the songs exactly as before and an older SelectaDJ still finds the tables
it knows.

A column can already be there without its default, when `recovery.recover` copied rows from a
newer file into an older one; then it is kept and only its empty `workspace_id` values are
filled. `content_hash` is never a key or a unique index here: two copies of one file share it.
"""

import sqlalchemy as sa
from alembic import op

from selecta.persistence import LOCAL_WORKSPACE

revision = "lib0003songs"
down_revision = "lib0002ratings"
branch_labels = None
depends_on = None

TABLES = ("songs", "analysis", "lyrics", "song_overrides")


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    for table in TABLES:
        if "workspace_id" not in _columns(table):
            op.add_column(
                table,
                sa.Column(
                    "workspace_id", sa.String(36), nullable=False, server_default=LOCAL_WORKSPACE
                ),
            )
        else:
            fill = f"UPDATE {table} SET workspace_id = :local WHERE workspace_id IS NULL"  # noqa: S608
            op.execute(sa.text(fill).bindparams(local=LOCAL_WORKSPACE))
        op.create_index(f"ix_{table}_workspace_id", table, ["workspace_id"], if_not_exists=True)
    if "content_hash" not in _columns("songs"):
        op.add_column("songs", sa.Column("content_hash", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("songs", "content_hash")
    for table in reversed(TABLES):
        op.drop_index(f"ix_{table}_workspace_id", table_name=table, if_exists=True)
        op.drop_column(table, "workspace_id")
