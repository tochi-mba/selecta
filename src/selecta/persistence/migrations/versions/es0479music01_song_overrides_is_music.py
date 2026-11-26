"""A member's set-aside mark on a song: `song_overrides.is_music`, nullable (ADR-0479).

Revision ID: es0479music01
Revises: es0479disc01

"Is it music?" in a device-music Cloud account (T-20261126-3f92): a skit, an interlude or a voice
memo the member set aside is kept out of the mixes the account plans. The mark sits beside the
member's tempo and key corrections: false is set aside, true is music, null is no mark. Only the
member sets it; nothing measured writes it.

`es0479song01` creates `song_overrides` from the live table definition, so a database built from
scratch already has the column: it is added only where it is missing. The table keeps the
fail-closed `workspace_isolation` policy it was created with; nothing here touches it.

A Desktop library file can meet this chain. Its own `song_overrides` is left exactly as it is;
the library chain adds the same column there (`lib0012ismusic`).
"""

import sqlalchemy as sa
from alembic import op

revision = "es0479music01"
down_revision = "es0479disc01"
branch_labels = None
depends_on = None

TABLE = "song_overrides"
COLUMN = "is_music"


def _desktop_library() -> bool:
    return "songs" in sa.inspect(op.get_bind()).get_table_names()


def _present() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(TABLE)}


def upgrade() -> None:
    if _desktop_library():
        return
    if COLUMN not in _present():
        op.add_column(TABLE, sa.Column(COLUMN, sa.Boolean, nullable=True))


def downgrade() -> None:
    if _desktop_library():
        return
    if COLUMN in _present():
        with op.batch_alter_table(TABLE) as batch:
            batch.drop_column(COLUMN)
