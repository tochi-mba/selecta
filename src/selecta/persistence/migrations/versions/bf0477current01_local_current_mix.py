"""The account's current mix, one row per workspace (ADR-0475 R8).

Revision ID: bf0477current01
Revises: bf0476never01

Tenant data: receives the forced PostgreSQL workspace isolation policy. Only ids, a counter and
times are stored. The table is created only where it is missing, in case a database was built
from the live definitions.
"""

import sqlalchemy as sa
from alembic import op

from selecta.local_media import current_mix_schema

revision = "bf0477current01"
down_revision = "bf0476never01"
branch_labels = None
depends_on = None

TABLES = ("local_current_mix",)
POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def _tables():
    if tuple(table.name for table in current_mix_schema.ALL_TABLES) != TABLES:
        raise RuntimeError("Local current mix schema changed; add a new migration")
    return current_mix_schema.ALL_TABLES


def upgrade() -> None:
    bind = op.get_bind()
    for table in _tables():
        if not sa.inspect(bind).has_table(table.name):
            table.create(bind)
    if bind.dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{name}" FORCE ROW LEVEL SECURITY')
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{name}"')
            op.execute(f'CREATE POLICY {POLICY} ON "{name}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{name}"')
    for table in reversed(_tables()):
        if sa.inspect(bind).has_table(table.name):
            table.drop(bind)
