"""'Never play' on catalogue songs, so browser-first Cloud can keep a song out of built mixes.

Revision ID: bf0476never01
Revises: bf0470lyrics01

One boolean column on `local_songs`, false for every existing song. The table already carries the
workspace isolation policy; a new column needs no policy of its own.

`bf0458media01` creates `local_songs` from the live table definition, so a database built from
scratch already has the column by the time this runs. It is added only where it is missing.
"""

import sqlalchemy as sa
from alembic import op

revision = "bf0476never01"
down_revision = "bf0470lyrics01"
branch_labels = None
depends_on = None

COLUMN = "never_play"


def _has_column() -> bool:
    columns = sa.inspect(op.get_bind()).get_columns("local_songs")
    return any(column["name"] == COLUMN for column in columns)


def upgrade() -> None:
    if _has_column():
        return
    op.add_column(
        "local_songs",
        sa.Column(COLUMN, sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    if not _has_column():
        return
    with op.batch_alter_table("local_songs") as batch:
        batch.drop_column(COLUMN)
