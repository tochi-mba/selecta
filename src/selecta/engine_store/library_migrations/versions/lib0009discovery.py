"""Discovery joins the engine store: `seam_book` and `discovery_comparisons`, adopted in place.

Revision ID: lib0009discovery
Revises: lib0008requests

`seam_book` is the hand-made table of `db.SCHEMA`. `discovery_comparisons` was made by the
exhaustive sweep on its first run (runtime DDL); it is made here with exactly that statement when
missing, so with `core.engine_store` on the sweep only writes.

Both are then adopted the same way as the earlier slices: `workspace_id` (every row the local
workspace's) and its index. No row is copied, moved or rewritten, and every key stays: a library
file holds one workspace, so `seam_book`'s UNIQUE(song_a, song_b, kind, payload) and the
comparisons' (song_a, song_b) stay correct here (Cloud's keys include the workspace).

A column can already be there without its default, when `recovery.recover` copied rows from a
newer file into an older one; then it is kept and only its empty `workspace_id` values are filled.
"""

import sqlalchemy as sa
from alembic import op

from selecta.persistence import LOCAL_WORKSPACE

revision = "lib0009discovery"
down_revision = "lib0008requests"
branch_labels = None
depends_on = None

TABLES = ("seam_book", "discovery_comparisons")
# exactly what `discovery.sweep` creates on the old path; a test holds the two equal
COMPARISONS = """CREATE TABLE IF NOT EXISTS discovery_comparisons (
        song_a INTEGER NOT NULL, song_b INTEGER NOT NULL,
        fingerprint_a TEXT NOT NULL, fingerprint_b TEXT NOT NULL,
        PRIMARY KEY(song_a, song_b)
    )"""


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    op.execute(COMPARISONS)
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
