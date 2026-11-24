"""The staff console's change windows, preferences, notes and status banners (doc 07b).

Revision ID: adm07b01
Revises: bfaudit01

Platform tables, no workspace: none gets the tenant isolation policy. Each is created only where
it is missing, in case a database was built from the live definitions.
"""

import sqlalchemy as sa
from alembic import op

from selecta.admin import schema as admin_schema

revision = "adm07b01"
down_revision = "bfaudit01"
branch_labels = None
depends_on = None

TABLES = ("staff_change_windows", "staff_preferences", "staff_notes", "status_banners")


def _tables():
    if tuple(table.name for table in admin_schema.CONSOLE_TABLES) != TABLES:
        raise RuntimeError("Console schema changed; add a new migration")
    return admin_schema.CONSOLE_TABLES


def upgrade() -> None:
    bind = op.get_bind()
    for table in _tables():
        if not sa.inspect(bind).has_table(table.name):
            table.create(bind)


def downgrade() -> None:
    bind = op.get_bind()
    for table in reversed(_tables()):
        if sa.inspect(bind).has_table(table.name):
            table.drop(bind)
