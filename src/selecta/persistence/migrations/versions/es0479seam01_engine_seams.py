"""Engine store seams for Cloud: records, attestations, history and verdicts (ADR-0479).

Revision ID: es0479seam01
Revises: es0479prov01

Creates `seams`, `seam_attestations`, `seam_history` and `seam_verdicts` from
`engine_store.schema`, each with the fail-closed `workspace_isolation` policy of `es0479rate01`:
a transaction that names no workspace sees and writes no seam rows. A seam row points at two of
the workspace's own catalogue songs (`local_songs`) with workspace-scoped foreign keys, so no
seam can name another workspace's song and removing a song removes what was said about it.
Nothing here holds audio, a path or a file name: a clip stays with the studio that made it, and
an attestation only says who made it, its length and its hash.

Also adds `ratings.seam_key` (the rendered seam a listening grade was given to) where missing.

A Desktop library file can meet this chain (the Cloud API's default database is the library
file). Nothing is created or changed on such a file: the library chain (`lib0006seams`) makes
the Desktop's own seam tables, without Cloud's foreign keys.

`COLUMNS` pins what this revision creates, so a column added to the module later must arrive in
its own migration.
"""

import sqlalchemy as sa
from alembic import op

from selecta.engine_store import schema

revision = "es0479seam01"
down_revision = "es0479prov01"
branch_labels = None
depends_on = None

COLUMNS = {
    "seams": (
        "workspace_id",
        "key",
        "song_a",
        "song_b",
        "asked",
        "status",
        "style",
        "bars",
        "exit_bar",
        "entry_bar",
        "a_source_start",
        "b_source_end",
        "duration",
        "rules",
        "fingerprint",
        "passed",
        "near_miss",
        "fell_back",
        "pair",
        "checks",
        "error",
        "rating",
        "rated_at",
        "note",
        "source",
        "record",
        "record_hash",
        "updated_at",
    ),
    "seam_attestations": (
        "id",
        "workspace_id",
        "key",
        "studio",
        "studio_id",
        "implementation",
        "clip_sha256",
        "clip_seconds",
        "attested_at",
    ),
    "seam_history": (
        "id",
        "workspace_id",
        "key",
        "song_a",
        "song_b",
        "status",
        "rating",
        "record",
        "record_hash",
        "recorded_at",
    ),
    "seam_verdicts": (
        "id",
        "workspace_id",
        "key",
        "song_a",
        "song_b",
        "verdict",
        "note",
        "rated_at",
        "rated_by",
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
    # On a Desktop library file the library's own tables are left as they are; only the ones it
    # lacks are made, as es0479rate01 does, so the file matches the declared tables afterwards.
    there = set(sa.inspect(bind).get_table_names())
    made = [table for table in _tables() if table.name not in there]
    for table in made:
        table.create(bind)
    if bind.dialect.name == "postgresql":
        for name in (table.name for table in made):
            op.execute(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{name}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY {POLICY} ON "{name}" USING {RULE} WITH CHECK {RULE}')
    rated = {column["name"] for column in sa.inspect(bind).get_columns("ratings")}
    if "seam_key" not in rated:
        op.add_column("ratings", sa.Column("seam_key", sa.String(80), nullable=True))


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
    rated = {column["name"] for column in sa.inspect(bind).get_columns("ratings")}
    if "seam_key" in rated:
        with op.batch_alter_table("ratings") as batch:
            batch.drop_column("seam_key")
