"""Engine store mixes for Cloud: the current mix, drafts, the mix's named values (ADR-0479).

Revision ID: es0479mix01
Revises: es0479seam01

Creates `queue`, `drafts`, `preferences` and `mix_imports` from `engine_store.schema`, each with
the fail-closed `workspace_isolation` policy of `es0479rate01`: a transaction that names no
workspace sees and writes no mix rows. A `queue` row points at one of the workspace's own
catalogue songs (`local_songs`) with a workspace-scoped foreign key, so the current mix can never
name another workspace's song. A draft's songs are inside its `items` JSON, as on Desktop, and
are checked against the workspace's catalogue on every write (`cloud_brain.mixes_routes`).
Nothing here holds audio, a path or a file name.

A Desktop library file can meet this chain (the Cloud API's default database is the library
file). Nothing is created or changed on such a file: the library chain (`lib0007mixes`) adopts
the Desktop's own `queue`, `drafts` and `preferences` in place.

`COLUMNS` pins what this revision creates, so a column added to the module later must arrive in
its own migration.
"""

import sqlalchemy as sa
from alembic import op

from selecta.engine_store import schema

revision = "es0479mix01"
down_revision = "es0479seam01"
branch_labels = None
depends_on = None

COLUMNS = {
    "queue": (
        "workspace_id",
        "position",
        "song_id",
        "state",
        "transition",
        "reason",
        "locked",
        "seam",
    ),
    "drafts": (
        "id",
        "workspace_id",
        "name",
        "items",
        "history",
        "ready_only",
        "line",
        "created_at",
        "updated_at",
    ),
    "preferences": ("workspace_id", "key", "value", "updated_at"),
    "mix_imports": ("workspace_id", "source", "source_id", "draft_id", "imported_at"),
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
    # On a Desktop library file the library's own tables of these names are left as they are
    # (the library chain adopts them); only the ones it lacks are made, as es0479rate01 does,
    # so the file still matches the declared tables afterwards.
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
