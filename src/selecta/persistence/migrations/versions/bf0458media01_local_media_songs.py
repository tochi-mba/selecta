"""The metadata-only local media catalogue: songs and device availability (ADR-0458).

Revision ID: bf0458media01
Revises: bz0452role01

Both tables are tenant data and receive the forced PostgreSQL workspace isolation policy. No
audio and no raw path is ever stored; the `assets` table's non-null upload contract is untouched.
"""

from alembic import op

from selecta.local_media import schema as local_media_schema

revision = "bf0458media01"
down_revision = "bz0452role01"
branch_labels = None
depends_on = None

TABLES = ("local_songs", "local_song_availability")
POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def _tables():
    if tuple(table.name for table in local_media_schema.ALL_TABLES) != TABLES:
        raise RuntimeError("Local media schema changed; add a new migration")
    return local_media_schema.ALL_TABLES


def upgrade() -> None:
    for table in _tables():
        table.create(op.get_bind())
    if op.get_bind().dialect.name == "postgresql":
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
