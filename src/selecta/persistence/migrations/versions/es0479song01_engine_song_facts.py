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

A Desktop library file never runs this chain: its own hand-made `analysis` and `song_overrides`
are adopted in place by the library chain (`lib0003songs`). If one is pointed here by mistake,
this stops rather than touching them.

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
POLICY = "workspace_isolation"
# No coalesce and no '' branch: an unset or empty workspace matches no row.
RULE = "(workspace_id = current_setting('app.workspace_id', true))"


def _tables():
    mine = tuple(table for table in schema.ENGINE_TABLES if table.name in COLUMNS)
    declared = {table.name: tuple(table.c.keys()) for table in mine}
    if declared != COLUMNS or tuple(declared) != TABLES:
        raise RuntimeError("The engine store schema changed; add a new migration")
    return mine


def upgrade() -> None:
    bind = op.get_bind()
    if "songs" in sa.inspect(bind).get_table_names():
        raise RuntimeError(
            "This is a Desktop library file; its engine tables move with the library chain."
        )
    for table in _tables():
        table.create(bind)
    if bind.dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{name}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY {POLICY} ON "{name}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{name}"')
    for table in reversed(_tables()):
        table.drop(op.get_bind())
