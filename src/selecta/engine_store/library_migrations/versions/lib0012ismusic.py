"""`song_overrides.is_music`, nullable: the same column Cloud's table gains in `es0479music01`.

Revision ID: lib0012ismusic
Revises: lib0011lucy

One table definition serves both. On Desktop whether a song is music stays on `songs`
(`is_music`, `music_override`), which the scan and the correction route keep; nothing on Desktop
writes this column, so it stays null and no row is rewritten. An older SelectaDJ reading the file
simply doesn't name it.

The column can already be there (a file `recovery.recover` copied rows into); then nothing is added.
"""

import sqlalchemy as sa
from alembic import op

revision = "lib0012ismusic"
down_revision = "lib0011lucy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    there = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("song_overrides")}
    if "is_music" not in there:
        op.add_column("song_overrides", sa.Column("is_music", sa.Boolean, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("song_overrides") as batch:
        batch.drop_column("is_music")
