"""Song facts say who measured them: `analysis.implementation` and `analysis.source`, nullable.

Revision ID: lib0005provenance
Revises: lib0004audioid

The same columns Cloud's `analysis` gains in `es0479prov01`, so one table definition serves
both. On Desktop every row is the app's own Python analysis, and `db.save_analysis` doesn't
name these columns, so they stay null; null reads as `python-beatthis-{version}`, measured by
SelectaDJ itself (`engine_store.facts.implementation_of`). No row is rewritten, and an older
SelectaDJ reading the file simply doesn't name the columns.

A column can already be there (a file `recovery.recover` copied rows into, or a run cut off after
one column but before the stamp); then only the missing one is added.
"""

import sqlalchemy as sa
from alembic import op

revision = "lib0005provenance"
down_revision = "lib0004audioid"
branch_labels = None
depends_on = None

COLUMNS = ("implementation", "source")


def upgrade() -> None:
    there = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("analysis")}
    for name in COLUMNS:
        if name not in there:
            op.add_column("analysis", sa.Column(name, sa.Text, nullable=True))


def downgrade() -> None:
    for name in reversed(COLUMNS):
        op.drop_column("analysis", name)
