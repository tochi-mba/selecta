"""The metadata-only song catalogue tables (ADR-0458).

Declared on the shared `persistence.metadata`, so Alembic sees them alongside every other
package's tables. Both tables are tenant-owned and carry a non-null `workspace_id` leading an
index. Times are epoch seconds from the database's clock (`persistence.db_now`).

- `local_songs`: one row per track identity a member's browser registered. Identity is the
  content hash plus the display metadata; the audio itself never leaves the member's device, so
  there is no key, size or path column, and never will be (the `assets` table keeps its non-null
  `original_key` contract untouched). Ids are integers because Rooms' `SongCatalogPort` speaks
  today's integer song ids. `duplicate_of` marks a likely duplicate (another hash, same
  normalised title and artist); entries are marked, never merged.
- `local_song_availability`: which devices report holding a playable copy of a song, from device
  reports, so requestability can follow what this account can actually play.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

local_songs = sa.Table(
    "local_songs",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("content_sha256", sa.String(64), nullable=False),
    sa.Column("title", sa.String(512), nullable=False),
    sa.Column("artist", sa.String(512), nullable=False),
    sa.Column("album", sa.String(512), nullable=True),
    sa.Column("duration_s", sa.Float, nullable=True),
    sa.Column("codec", sa.String(32), nullable=True),
    sa.Column("sample_rate", sa.Integer, nullable=True),
    # "Never play", for the whole account: a mix SelectaDJ builds never picks this song. It can
    # still be added to a mix by hand.
    sa.Column("never_play", sa.Boolean, nullable=False, server_default=sa.false()),
    # A different hash whose normalised title and artist match an earlier entry: marked as a
    # likely duplicate for the library page, never silently merged (ADR-0458 edge case).
    sa.Column("duplicate_of", sa.Integer, sa.ForeignKey("local_songs.id"), nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.Column("deleted_at", Epoch, nullable=True),
    sa.CheckConstraint("length(content_sha256) = 64", name="content_sha256"),
    sa.CheckConstraint("duration_s IS NULL OR duration_s > 0", name="duration_s"),
    sa.CheckConstraint("sample_rate IS NULL OR sample_rate > 0", name="sample_rate"),
    # The same file imported on two devices resolves to one entry per workspace.
    sa.UniqueConstraint("workspace_id", "content_sha256"),
    # The target of the availability table's workspace-scoped foreign key.
    sa.UniqueConstraint("workspace_id", "id"),
    sa.Index("ix_local_songs_workspace_id_deleted_at", "workspace_id", "deleted_at"),
)

local_song_availability = sa.Table(
    "local_song_availability",
    metadata,
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("song_id", sa.Integer, nullable=False),
    sa.Column("device_id", Id, nullable=False),
    sa.Column("present", sa.Boolean, nullable=False),
    sa.Column("reported_at", Epoch, nullable=False),
    # One report per device per song; `workspace_id` leads the key, so it leads an index.
    sa.PrimaryKeyConstraint("workspace_id", "song_id", "device_id"),
    # Workspace-scoped, so a report row can never point at another workspace's song, even from a
    # system transaction that row-level security doesn't bind.
    sa.ForeignKeyConstraint(
        ["workspace_id", "song_id"],
        ["local_songs.workspace_id", "local_songs.id"],
        name="fk_local_song_availability_song",
        ondelete="CASCADE",
    ),
)

# The migration (`bf0458media01`) checks this list, so a schema change must add a new migration.
ALL_TABLES = [local_songs, local_song_availability]

__all__ = ["ALL_TABLES", "local_song_availability", "local_songs"]
