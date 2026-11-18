"""Portable recipes over the metadata-only catalogue (ADR-0458, BF-0462-05).

Revision ID: bf0462recipe01
Revises: bf0457output01

Tenant data: receives the forced PostgreSQL workspace isolation policy. Revisions are insert-only
rows of the shared mix contract; no audio, path or device detail is stored.
"""

from alembic import op

from selecta.local_media import recipe_schema

revision = "bf0462recipe01"
down_revision = "bf0457output01"
branch_labels = None
depends_on = None

TABLES = ("local_recipes",)
POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def _tables():
    if tuple(table.name for table in recipe_schema.ALL_TABLES) != TABLES:
        raise RuntimeError("Local recipe schema changed; add a new migration")
    return recipe_schema.ALL_TABLES


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
