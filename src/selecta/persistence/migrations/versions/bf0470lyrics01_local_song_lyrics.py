"""Cached LRCLIB lyrics for catalogue songs (Word connections in browser-first Cloud).

Revision ID: bf0470lyrics01
Revises: bz0446log01

Tenant data: receives the forced PostgreSQL workspace isolation policy. Only the line-synced
lyric text and LRCLIB's answer are stored, keyed by catalogue song; no audio, path or device
detail.
"""

from alembic import op

from selecta.local_media import lyrics_schema

revision = "bf0470lyrics01"
down_revision = "bz0446log01"
branch_labels = None
depends_on = None

TABLES = ("local_song_lyrics",)
POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def _tables():
    if tuple(table.name for table in lyrics_schema.ALL_TABLES) != TABLES:
        raise RuntimeError("Local song lyrics schema changed; add a new migration")
    return lyrics_schema.ALL_TABLES


def upgrade() -> None:
    for table in _tables():
        table.create(op.get_bind())
    if op.get_bind().dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{name}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY {POLICY} ON "{name}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{name}"')
    for table in reversed(_tables()):
        table.drop(op.get_bind())
