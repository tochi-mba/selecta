"""Song facts say who measured them: `analysis.implementation` and `analysis.source`.

Revision ID: es0479prov01
Revises: bf0479audio01

Cloud now saves facts a member's device measured, beside facts a SelectaDJ worker measured
(docs/engineering/cloud-planning.md). Each row records the implementation that measured it
(`python-beatthis-3`, a device's `web-dsp-1`) and where it came from (`device` or `worker`), so
the planner can tell them apart and one rule decides which measurement a song keeps
(`engine_store.facts.wins`). Both nullable: no Cloud row exists from before this revision, and
null means SelectaDJ's own Python analysis at the row's `version`, as on Desktop.

`es0479song01` creates `analysis` from the live table definition, so a database built from
scratch already has both columns: each is added only where it is missing. The table keeps the
fail-closed `workspace_isolation` policy it was created with; nothing here touches it.

A Desktop library file can meet this chain (the Cloud API's default database is the library
file). Its own `analysis` table is left exactly as it is; the library chain adds the same
columns there (`lib0005provenance`).
"""

import sqlalchemy as sa
from alembic import op

revision = "es0479prov01"
down_revision = "bf0479audio01"
branch_labels = None
depends_on = None

TABLE = "analysis"
COLUMNS = ("implementation", "source")


def _desktop_library() -> bool:
    return "songs" in sa.inspect(op.get_bind()).get_table_names()


def _present() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(TABLE)}


def upgrade() -> None:
    if _desktop_library():
        return
    there = _present()
    for name in COLUMNS:
        if name not in there:
            op.add_column(TABLE, sa.Column(name, sa.Text, nullable=True))


def downgrade() -> None:
    if _desktop_library():
        return
    there = _present()
    with op.batch_alter_table(TABLE) as batch:
        for name in reversed(COLUMNS):
            if name in there:
                batch.drop_column(name)
