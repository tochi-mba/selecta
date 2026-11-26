"""Engine store requests for Cloud: songs asked for, bridges agreed to, marks (ADR-0479).

Revision ID: es0479req01
Revises: es0479mix01

Creates `song_requests`, `request_bridge_approvals`, `request_routes` and `request_marks` from
`engine_store.schema`, each with the fail-closed `workspace_isolation` policy of `es0479rate01`:
a transaction that names no workspace sees and writes no request rows. A request and a mark
point at one of the workspace's own catalogue songs (`local_songs`) with a workspace-scoped
foreign key, and an answer about a request points at that workspace's request, so none can name
another workspace's song or request. At most one waiting request per song in a workspace.
Nothing here holds audio, a path or a file name: a song is its catalogue id.

A Desktop library file can meet this chain (the Cloud API's default database is the library
file). Its own request tables, where it has them, are left as they are (the library chain,
`lib0008requests`, adopts them); only the ones it lacks are made, as `es0479mix01` does, and a
downgrade drops nothing there.

`COLUMNS` pins what this revision creates, so a column added to the module later must arrive in
its own migration.
"""

import sqlalchemy as sa
from alembic import op

from selecta.engine_store import schema

revision = "es0479req01"
down_revision = "es0479mix01"
branch_labels = None
depends_on = None

COLUMNS = {
    "song_requests": ("id", "workspace_id", "song_id", "status", "created_at"),
    "request_bridge_approvals": ("request_id", "signature", "workspace_id"),
    "request_routes": ("request_id", "songs", "workspace_id"),
    "request_marks": ("workspace_id", "song_id", "kind", "for_song"),
}
TABLES = tuple(COLUMNS)
POLICY = "workspace_isolation"
# No coalesce and no '' branch: an unset or empty workspace matches no row.
RULE = "(workspace_id = current_setting('app.workspace_id', true))"


def _tables():
    mine = tuple(table for table in schema.ENGINE_TABLES if table.name in COLUMNS)
    declared = {table.name: tuple(table.c.keys()) for table in mine}
    if declared != COLUMNS or tuple(declared) != TABLES:
        raise RuntimeError("The engine store schema changed; add a new migration")
    return mine


def _desktop_library(bind) -> bool:
    return "songs" in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    there = set(sa.inspect(bind).get_table_names())
    made = [table for table in _tables() if table.name not in there]
    for table in made:
        table.create(bind)
    if bind.dialect.name == "postgresql":
        for name in (table.name for table in made):
            op.execute(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{name}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY {POLICY} ON "{name}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    bind = op.get_bind()
    if _desktop_library(bind):
        return
    if bind.dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{name}"')
    there = set(sa.inspect(bind).get_table_names())
    for table in reversed(_tables()):
        if table.name in there:
            table.drop(bind)
