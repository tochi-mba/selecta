"""Songs get an audio id beside their file hash: `songs.audio_id`, nullable, indexed.

Revision ID: lib0004audioid
Revises: lib0003songs

The audio id is a hash of a song's audio alone (docs/engineering/audio-identity.md), filled by
the background hash job and by analysis with `library.audio_identity` on. Nothing else changes:
no row is rewritten, and an older SelectaDJ reading the file simply doesn't name the column.

The column can already be there (a file `recovery.recover` copied rows into, or a run cut off
after the column but before the stamp); then only the index is made, if it is missing.
"""

import sqlalchemy as sa
from alembic import op

revision = "lib0004audioid"
down_revision = "lib0003songs"
branch_labels = None
depends_on = None

INDEX = "ix_songs_audio_id"


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("songs")}
    if "audio_id" not in columns:
        # "a1:" and 64 hex digits
        op.add_column("songs", sa.Column("audio_id", sa.String(67), nullable=True))
    op.create_index(INDEX, "songs", ["audio_id"], if_not_exists=True)


def downgrade() -> None:
    op.drop_index(INDEX, table_name="songs", if_exists=True)
    op.drop_column("songs", "audio_id")
