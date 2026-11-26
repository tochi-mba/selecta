"""Song requests join the library chain: their four tables made here, not at run time.

Revision ID: lib0008requests
Revises: lib0007mixes

`requests.initialise` made `song_requests`, `request_bridge_approvals`, `request_marks` and
`request_routes` (and the one-waiting-request index) on every call, the first time any request
code ran. Here they are made with exactly those statements when missing, then adopted the same
way as the earlier slices: `workspace_id` (every row the local workspace's) and its index, no row
copied, moved or rewritten, every key kept. With `core.engine_store` on, `requests.initialise`
then runs no DDL: this revision has already made them. With it off, nothing here runs and
`initialise` does what it always did.
"""

import sqlalchemy as sa
from alembic import op

from selecta.persistence import LOCAL_WORKSPACE

revision = "lib0008requests"
down_revision = "lib0007mixes"
branch_labels = None
depends_on = None

TABLES = ("song_requests", "request_bridge_approvals", "request_marks", "request_routes")
# `requests.DDL` as it was when this revision was written; a test holds the two equal
DDL = (
    """CREATE TABLE IF NOT EXISTS song_requests (
        id INTEGER PRIMARY KEY,
        song_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE UNIQUE INDEX IF NOT EXISTS one_waiting_request_per_song
        ON song_requests(song_id) WHERE status='waiting' """,
    """CREATE TABLE IF NOT EXISTS request_bridge_approvals (
        request_id INTEGER PRIMARY KEY, signature TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS request_marks (
        song_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, for_song INTEGER
    )""",
    """CREATE TABLE IF NOT EXISTS request_routes (
        request_id INTEGER PRIMARY KEY, songs TEXT NOT NULL
    )""",
)


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    for statement in DDL:
        op.execute(statement)
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
