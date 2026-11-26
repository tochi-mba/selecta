"""Engine store tables for Cloud, starting with ratings, behind a fail-closed policy (ADR-0479).

Revision ID: es0479rate01
Revises: rs0488soc02

Creates the engine tables from `engine_store.schema`. On PostgreSQL each gets the
`workspace_isolation` policy without the empty-scope branch the earlier tenant tables have
(`b7e3c91f0a24`): a transaction that names no workspace sees and writes no engine rows at all,
so a forgotten workspace fails closed instead of reading every account. Existing tables keep their
policies unchanged.

A Desktop library file can meet this chain (the Cloud API's default database is the library
file). Its own tables of these names are left untouched, on the way up and on the way down;
the library chain (`engine_store/library_migrations`) is what adopts them.

`COLUMNS` pins what this revision creates, so a column added to the module later must arrive in
its own migration.
"""

import sqlalchemy as sa
from alembic import op

from selecta.engine_store import schema

revision = "es0479rate01"
down_revision = "rs0488soc02"
branch_labels = None
depends_on = None

COLUMNS = {
    "ratings": (
        "id",
        "workspace_id",
        "seam_id",
        "song_a",
        "song_b",
        "method",
        "rating",
        "tags",
        "created_at",
    ),
}
TABLES = tuple(COLUMNS)
POLICY = "workspace_isolation"
# No coalesce and no '' branch: an unset or empty workspace matches no row.
RULE = "(workspace_id = current_setting('app.workspace_id', true))"


def _tables():
    # only this revision's tables: a later slice adds its own tables in its own migration
    mine = tuple(table for table in schema.ENGINE_TABLES if table.name in COLUMNS)
    declared = {table.name: tuple(table.c.keys()) for table in mine}
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
