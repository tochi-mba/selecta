"""Cached LRCLIB lyrics for catalogue songs (Word connections in browser-first Cloud).

One row per catalogue song whose lyrics were looked up: what LRCLIB answered (`synced`,
`plain`, `instrumental`, `missing`, or `error` for a failed request, which is asked again later)
and, for `synced`, the line-timed text the word links are found in. Only the synced text is kept:
plain lyrics are never needed to find a link, so they are not stored. The lookup sent LRCLIB the
song's artist, title, album and duration only; no audio, path or device detail is stored here.

`workspace_id` leads the key, so it leads an index, and the table receives the forced
PostgreSQL workspace isolation policy in its migration (`bf0470lyrics01`). The workspace-scoped
foreign key means a row can never point at another workspace's song, and deleting a song's row
from the catalogue takes its lyrics with it.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

LYRIC_STATUSES = ("synced", "plain", "instrumental", "missing", "error")

local_song_lyrics = sa.Table(
    "local_song_lyrics",
    metadata,
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("song_id", sa.Integer, nullable=False),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("synced", sa.Text, nullable=True),
    sa.Column("fetched_at", Epoch, nullable=False),
    sa.CheckConstraint(
        "status IN ('synced', 'plain', 'instrumental', 'missing', 'error')", name="status"
    ),
    sa.CheckConstraint("status = 'synced' OR synced IS NULL", name="synced_only"),
    sa.PrimaryKeyConstraint("workspace_id", "song_id"),
    sa.ForeignKeyConstraint(
        ["workspace_id", "song_id"],
        ["local_songs.workspace_id", "local_songs.id"],
        name="fk_local_song_lyrics_song",
        ondelete="CASCADE",
    ),
)

# The migration (`bf0470lyrics01`) checks this list, so a schema change must add a new migration.
ALL_TABLES = [local_song_lyrics]

__all__ = ["ALL_TABLES", "LYRIC_STATUSES", "local_song_lyrics"]
