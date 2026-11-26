"""The upload rights statement a workspace confirmed: `upload_rights` (ADR-0489).

Revision ID: st0480rights01
Revises: st0480up01

Before a member's first upload from this device to the cloud library, the workspace confirms a
short rights statement (`storage.personal_rights`, behind `cloud.move_to_cloud`). Each row keeps
the statement's version, the SHA-256 of its words, who confirmed it and when. Business
workspaces keep their own statement per batch and have no rows here.

Tenant data: the table receives the forced, fail-closed PostgreSQL workspace isolation policy,
so a transaction that names no workspace sees and writes none of it.

A Desktop library file can meet this chain (the Cloud API's default database is the library
file): upgrading it creates the table only where it is missing, and downgrading it drops
nothing. `COLUMNS` pins what this revision creates, so a column added to the module later must
arrive in its own migration.
"""

import sqlalchemy as sa
from alembic import op

from selecta.storage import rights_schema

revision = "st0480rights01"
down_revision = "st0480up01"
branch_labels = None
depends_on = None

TABLE = "upload_rights"
COLUMNS = ("id", "workspace_id", "version", "wording_sha256", "user_id", "accepted_at")
POLICY = "workspace_isolation"
# No coalesce and no '' branch: an unset or empty workspace matches no row.
RULE = "(workspace_id = current_setting('app.workspace_id', true))"


def _table() -> sa.Table:
    table = rights_schema.upload_rights
    if tuple(table.c.keys()) != COLUMNS or table.name != TABLE:
        raise RuntimeError("The upload rights schema changed; add a new migration")
    return table


def _desktop_library() -> bool:
    return "songs" in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    if TABLE in sa.inspect(bind).get_table_names():
        return
    _table().create(bind)
    if bind.dialect.name == "postgresql":
        op.execute(f'ALTER TABLE "{TABLE}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{TABLE}" FORCE ROW LEVEL SECURITY')
        op.execute(f'CREATE POLICY {POLICY} ON "{TABLE}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    bind = op.get_bind()
    if _desktop_library():
        return
    if bind.dialect.name == "postgresql":
        op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{TABLE}"')
    if TABLE in sa.inspect(bind).get_table_names():
        _table().drop(bind)
