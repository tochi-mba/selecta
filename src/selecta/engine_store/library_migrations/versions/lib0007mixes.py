"""Mixes join the engine store: `queue`, `drafts` and `preferences`, adopted in place.

Revision ID: lib0007mixes
Revises: lib0006seams

Adds `workspace_id` (every existing row is the local workspace's) and its index to each table.
Nothing else changes: no row is copied, moved or rewritten, no key changes, and every column keeps
its name, type and meaning, so a backup carries the mixes exactly as before and an older SelectaDJ
still finds the tables it knows. `queue.position` and `preferences.key` stay the keys: a library
file holds one workspace, so they stay unique (Cloud's tables, `es0479mix01`, key on the
workspace too).

`queue.seam` and `drafts.ready_only` are added by `db.connect`'s own steps, which always run
first; they are added here too when missing, so the store never meets a file without them.

`playback_skips` was made by its route on the first skip (runtime DDL). It is made here with the
same columns when missing, then adopted the same way, so with the flag on the route only writes.

A column can already be there without its default, when `recovery.recover` copied rows from a
newer file into an older one; then it is kept and only its empty `workspace_id` values are filled.
"""

import sqlalchemy as sa
from alembic import op

from selecta.persistence import LOCAL_WORKSPACE

revision = "lib0007mixes"
down_revision = "lib0006seams"
branch_labels = None
depends_on = None

TABLES = ("queue", "drafts", "preferences", "playback_skips")
# exactly what `routes/mixes.py` creates on the old path, so either way the table is the same
PLAYBACK_SKIPS = (
    "CREATE TABLE IF NOT EXISTS playback_skips (id INTEGER PRIMARY KEY, "
    "song_id INTEGER NOT NULL REFERENCES songs(id), heard_seconds REAL NOT NULL, "
    "source_position REAL NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
)


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    op.execute(PLAYBACK_SKIPS)
    if "seam" not in _columns("queue"):
        op.add_column("queue", sa.Column("seam", sa.Text, nullable=True))
    if "ready_only" not in _columns("drafts"):
        op.add_column(
            "drafts", sa.Column("ready_only", sa.Integer, nullable=False, server_default="0")
        )
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


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_index(f"ix_{table}_workspace_id", table_name=table, if_exists=True)
        op.drop_column(table, "workspace_id")
