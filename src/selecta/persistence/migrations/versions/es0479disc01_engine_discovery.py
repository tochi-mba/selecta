"""Engine store discovery for Cloud: links found between songs and the compared pairs (ADR-0479).

Revision ID: es0479disc01
Revises: es0479req01

Creates `seam_book` and `discovery_comparisons` from `engine_store.schema`, each with the
fail-closed `workspace_isolation` policy of `es0479rate01`: a transaction that names no
workspace sees and writes no discovery rows. Both songs of a row point at the workspace's own
catalogue songs (`local_songs`) with workspace-scoped foreign keys, so no link or mark can name
another workspace's song, and a link is unique per (workspace, pair, kind, payload). Nothing here
holds audio, a path or a file name: a song is its catalogue id, a payload is bar numbers, seconds
and scores.

A Desktop library file can meet this chain. Its own tables, where it has them, are left as they
are (the library chain, `lib0009discovery`, adopts them); only the ones it lacks are made, and a
downgrade drops nothing there.

`COLUMNS` pins what this revision creates, so a column added to the module later must arrive in
its own migration.
"""

import sqlalchemy as sa
from alembic import op

from selecta.engine_store import schema

revision = "es0479disc01"
down_revision = "es0479req01"
branch_labels = None
depends_on = None

COLUMNS = {
    "seam_book": (
        "id", "workspace_id", "song_a", "song_b", "kind", "payload", "score", "status"
    ),
    "discovery_comparisons": (
        "workspace_id", "song_a", "song_b", "fingerprint_a", "fingerprint_b"
    ),
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
