"""The catalogue song an upload is for: `upload_sessions.song_id`, nullable.

Revision ID: st0480up01
Revises: es0479music01

With `storage.upload_identity` an upload may name the song it is for, so an accepted file lands
on that same catalogue song (`local_songs`) and keeps its measurements, corrections, mixes and
ratings. The plan checks the file is that song and acceptance checks again
(`storage.upload_identity`). Null for every upload that names no song, and for every row made
before this. No row is rewritten.

`2d157911bd72` creates `upload_sessions` from its own list of columns, but a database built from
the live table definitions already has this one, so it is added only where it is missing. A
Desktop library file can meet this chain (the Cloud API's default database is the library file):
upgrading it adds only what is missing, and downgrading it drops nothing.
"""

import sqlalchemy as sa
from alembic import op

revision = "st0480up01"
down_revision = "es0479music01"
branch_labels = None
depends_on = None

TABLE = "upload_sessions"
COLUMN = "song_id"


def _desktop_library() -> bool:
    return "songs" in sa.inspect(op.get_bind()).get_table_names()


def _present() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(TABLE)}


def upgrade() -> None:
    if COLUMN not in _present():
        op.add_column(TABLE, sa.Column(COLUMN, sa.Integer, nullable=True))


def downgrade() -> None:
    if _desktop_library():
        return
    if COLUMN in _present():
        with op.batch_alter_table(TABLE) as batch:
            batch.drop_column(COLUMN)
