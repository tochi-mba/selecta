"""The song catalogue: lookups, recordings, releases, art and song links (ADR-0478).

Revision ID: fl0478cat01
Revises: bf0469vers01

`catalog_lookups`, `catalog_recordings`, `catalog_releases` and `catalog_art` are global data, on
purpose: no workspace_id and so no row-level security policy. They hold public catalogue facts and
the covers fetched for them, shared by every account, and nothing in them names an account.

`song_catalog_links` is tenant data: it receives the forced PostgreSQL workspace isolation policy.
"""

from alembic import op

from selecta.catalog import schema

revision = "fl0478cat01"
down_revision = "bf0469vers01"
branch_labels = None
depends_on = None

PLATFORM = ("catalog_lookups", "catalog_recordings", "catalog_releases", "catalog_art")
TENANT = ("song_catalog_links",)
POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def _tables():
    if (
        tuple(table.name for table in schema.PLATFORM_TABLES) != PLATFORM
        or tuple(table.name for table in schema.TENANT_TABLES) != TENANT
    ):
        raise RuntimeError("The catalogue schema changed; add a new migration")
    return schema.ALL_TABLES


def upgrade() -> None:
    for table in _tables():
        table.create(op.get_bind())
    if op.get_bind().dialect.name == "postgresql":
        for name in TENANT:
            op.execute(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{name}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY {POLICY} ON "{name}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for name in TENANT:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{name}"')
    for table in reversed(_tables()):
        table.drop(op.get_bind())
