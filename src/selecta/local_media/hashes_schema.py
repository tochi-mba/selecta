"""The other file hashes known for a catalogue song (`library.audio_identity`).

A song is its `local_songs` row, unique per (workspace, file hash). When a device registers a
file the workspace hasn't seen whose audio id matches exactly one song, that file is the same
song with new bytes (a tag edit, new artwork): its hash is recorded here against the song, and
the row itself, its own hash and everything that points at it stay exactly as they were
(docs/engineering/audio-identity.md, "Cloud: the same song with new bytes").

(workspace, file hash) is the key, so a file hash names at most one song here; registration
checks this table and the row's own hash under one lock, so between them a file hash names at
most one song in a workspace. The workspace-scoped foreign key means a row can never point at
another workspace's song, and removing a song's row takes its hashes with it. The table receives
the forced PostgreSQL workspace isolation policy in its migration (`bf0479audio01`).
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

local_song_hashes = sa.Table(
    "local_song_hashes",
    metadata,
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("content_sha256", sa.String(64), nullable=False),
    sa.Column("song_id", sa.Integer, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.CheckConstraint("length(content_sha256) = 64", name="content_sha256"),
    sa.PrimaryKeyConstraint("workspace_id", "content_sha256"),
    sa.ForeignKeyConstraint(
        ["workspace_id", "song_id"],
        ["local_songs.workspace_id", "local_songs.id"],
        name="fk_local_song_hashes_song",
        ondelete="CASCADE",
    ),
    sa.Index("ix_local_song_hashes_workspace_id_song_id", "workspace_id", "song_id"),
)

# The migration (`bf0479audio01`) checks this list, so a schema change must add a new migration.
ALL_TABLES = [local_song_hashes]

__all__ = ["ALL_TABLES", "local_song_hashes"]
