"""Engine store song facts for Cloud: analysis and tempo or key corrections (ADR-0479).

Revision ID: es0479song01
Revises: es0479rate01

Creates `analysis` and `song_overrides` from `engine_store.schema`, with the same fail-closed
`workspace_isolation` policy as `es0479rate01`: a transaction that names no workspace sees and
writes no song facts.

A song in Cloud is the catalogue's `local_songs` row, keyed by (workspace, content hash). These
tables hold only what analysis measured and what a listener corrected, against that row's id,
with a workspace-scoped foreign key, so no fact can point at another workspace's song and
removing a song from the catalogue removes its facts. No audio, path, folder or file handle is
stored: those stay on the member's device.

A Desktop library file can meet this chain (the Cloud API's default database is the library
file). Its own tables of these names are left untouched, on the way up and on the way down;
the library chain (`engine_store/library_migrations`) is what adopts them.

`COLUMNS` pins what this revision creates, so a column added to the module later must arrive in
its own migration.
"""

import sqlalchemy as sa
from alembic import op

from selecta.engine_store import schema

revision = "es0479song01"
down_revision = "es0479rate01"
branch_labels = None
depends_on = None

COLUMNS = {
    "analysis": (
        "song_id",
        "workspace_id",
        "version",
        "bpm",
        "constant_tempo",
        "grid_confidence",
        "beats_per_bar",
        "key",
        "camelot",
        "key_confidence",
        "key_agrees_chroma",
        "lufs",
        "peak_db",
        "energy",
        "sections",
        "timbre",
        "timings",
        "error",
        "analysed_at",
    ),
    "song_overrides": ("song_id", "workspace_id", "bpm", "camelot", "updated_at"),
}
TABLES = tuple(COLUMNS)
# Columns a later revision adds where missing (`es0479prov01`). A database built from scratch
# gets them here with the rest, as `bf0458media01` does for `local_songs`.
LATER = {"analysis": ("implementation", "source")}
POLICY = "workspace_isolation"
# No coalesce and no '' branch: an unset or empty workspace matches no row.
RULE = "(workspace_id = current_setting('app.workspace_id', true))"


def _tables():
    mine = tuple(table for table in schema.ENGINE_TABLES if table.name in COLUMNS)
    declared = {
        table.name: tuple(name for name in table.c.keys() if name not in LATER.get(table.name, ()))
        for table in mine
    }
    if declared != COLUMNS or tuple(declared) != TABLES:
        raise RuntimeError("The engine store schema changed; add a new migration")
    return mine


def upgrade() -> None:
    bind = op.get_bind()
    # A table of this name already here is a Desktop library's own (the Cloud chain may run on
    # the library file): it is left exactly as it is, and the library chain adopts it.
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
    if op.get_bind().dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{name}"')
    bind = op.get_bind()
    if "songs" in sa.inspect(bind).get_table_names():
        # a Desktop library file: these tables may be the library's own, so none is dropped
        return
    for table in reversed(_tables()):
        table.drop(bind)
