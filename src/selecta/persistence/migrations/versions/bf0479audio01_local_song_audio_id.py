"""Catalogue songs known by their audio: `local_songs.audio_id` and `local_song_hashes`.

Revision ID: bf0479audio01
Revises: es0479song01

`audio_id` is a hash of a song's audio alone, sent by the device that registers it
(`library.audio_identity`, docs/engineering/audio-identity.md). Nullable: existing songs fill it
in when a device next registers them. Indexed on (workspace_id, audio_id), not unique, because
two files with the same audio may be two rows until a registration finds they are one song.

`local_song_hashes` holds the other file hashes known for a song. It is tenant data and receives
the same forced workspace isolation policy as the rest of the catalogue (`bf0458media01`).

`bf0458media01` creates `local_songs` from the live table definition, so a database built from
scratch already has the column and its index by the time this runs: each is added only where it
is missing. No row is rewritten.
"""

import sqlalchemy as sa
from alembic import op

from selecta.local_media import hashes_schema

revision = "bf0479audio01"
down_revision = "es0479song01"
branch_labels = None
depends_on = None

COLUMN = "audio_id"
INDEX = "ix_local_songs_workspace_id_audio_id"
TABLES = ("local_song_hashes",)
POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def _tables():
    if tuple(table.name for table in hashes_schema.ALL_TABLES) != TABLES:
        raise RuntimeError("Local song hashes schema changed; add a new migration")
    return hashes_schema.ALL_TABLES


def _has_column() -> bool:
    columns = sa.inspect(op.get_bind()).get_columns("local_songs")
    return any(column["name"] == COLUMN for column in columns)


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_column():
        op.add_column("local_songs", sa.Column(COLUMN, sa.String(67), nullable=True))
    op.create_index(INDEX, "local_songs", ["workspace_id", COLUMN], if_not_exists=True)
    there = set(sa.inspect(bind).get_table_names())
    made = [table for table in _tables() if table.name not in there]
    for table in made:
        table.create(bind)
    if bind.dialect.name == "postgresql":
        for name in (table.name for table in made):
            op.execute(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{name}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY {POLICY} ON "{name}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{name}"')
    there = set(sa.inspect(bind).get_table_names())
    for table in reversed(_tables()):
        if table.name in there:
            table.drop(bind)
    op.drop_index(INDEX, table_name="local_songs", if_exists=True)
    if _has_column():
        with op.batch_alter_table("local_songs") as batch:
            batch.drop_column(COLUMN)
