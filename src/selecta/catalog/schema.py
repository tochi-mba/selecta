"""The catalogue tables (ADR-0478 FL-0478-03).

Four are platform-wide on purpose, with no `workspace_id` and so no row-level security policy:
they hold public catalogue facts (MusicBrainz ids, names, dates, ISRCs, which are CC0) and the
cover images fetched for them, and one lookup serves every account with the same song. Nothing
in them says which account asked.

- `catalog_lookups`: one row per normalised query (`match.lookup_key`): what was asked, the
  outcome, the candidates found, and when it may be tried again, so a miss is not retried at once.
- `catalog_recordings`: a MusicBrainz recording: title, artist credit, length, ISRCs, and the
  release ids it appears on, best first.
- `catalog_releases`: a MusicBrainz release: title, date, status, release group and type, and
  whether the Cover Art Archive had a front cover for it when asked.
- `catalog_art`: a cover stored in our own object storage: the key for each stored size, a
  palette hue, where it came from, when it was fetched, and the admin hide flag and reason.

One is tenant data and receives the forced workspace isolation policy in its migration:

- `song_catalog_links`: which recording and release a workspace's song matched, by which method
  and how confidently, and the person's own choice ("Wrong cover?"), which wins over any later
  lookup.

Times are epoch seconds from the database's clock (`persistence.db_now`).
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

MbId = sa.String(36)
"""A MusicBrainz id: a UUID in text form."""

catalog_lookups = sa.Table(
    "catalog_lookups",
    metadata,
    # sha256 hex of the normalised query (`match.lookup_key`)
    sa.Column("key", sa.String(64), primary_key=True),
    # what is sent: artist, title, album, duration_s, isrc (all normalised; no person, no file)
    sa.Column("query", sa.JSON, nullable=False),
    # pending, running, matched, no_match, ambiguous, error
    sa.Column("outcome", sa.String(16), nullable=False),
    # isrc or search, once matched
    sa.Column("method", sa.String(16), nullable=True),
    sa.Column("confidence", sa.Float, nullable=True),
    sa.Column("recording_id", MbId, nullable=True),
    sa.Column("release_id", MbId, nullable=True),
    # [{recording_id, release_id, title, artist, length_s, score}], best first, for "Wrong cover?"
    sa.Column("candidates", sa.JSON, nullable=False),
    sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
    sa.Column("last_error", sa.String(200), nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    # null while pending; otherwise the earliest time the lookup may run again
    sa.Column("next_retry_at", Epoch, nullable=True),
    sa.Index("ix_catalog_lookups_outcome_retry", "outcome", "next_retry_at"),
)

catalog_recordings = sa.Table(
    "catalog_recordings",
    metadata,
    sa.Column("id", MbId, primary_key=True),
    sa.Column("title", sa.String(512), nullable=False),
    sa.Column("artist", sa.String(512), nullable=False),
    sa.Column("length_s", sa.Float, nullable=True),
    sa.Column("isrcs", sa.JSON, nullable=False),
    # release ids, best cover first (`match.rank_releases`)
    sa.Column("release_ids", sa.JSON, nullable=False),
    sa.Column("first_release_date", sa.String(10), nullable=True),
    sa.Column("fetched_at", Epoch, nullable=False),
)

catalog_releases = sa.Table(
    "catalog_releases",
    metadata,
    sa.Column("id", MbId, primary_key=True),
    sa.Column("title", sa.String(512), nullable=False),
    sa.Column("artist", sa.String(512), nullable=True),
    sa.Column("date", sa.String(10), nullable=True),
    sa.Column("year", sa.Integer, nullable=True),
    sa.Column("country", sa.String(8), nullable=True),
    sa.Column("status", sa.String(32), nullable=True),
    sa.Column("release_group_id", MbId, nullable=True),
    sa.Column("primary_type", sa.String(32), nullable=True),
    sa.Column("secondary_types", sa.JSON, nullable=False),
    # unknown, present, absent: whether the Cover Art Archive had a front cover when asked
    sa.Column("cover", sa.String(8), nullable=False, server_default="unknown"),
    sa.Column("cover_checked_at", Epoch, nullable=True),
    sa.Column("fetched_at", Epoch, nullable=False),
)

catalog_art = sa.Table(
    "catalog_art",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("release_id", MbId, nullable=False, unique=True),
    # caa-release or caa-release-group
    sa.Column("source", sa.String(24), nullable=False),
    # {"500": "catalog/v1/art/<id>/500.jpg"}: one object key per stored width
    sa.Column("sizes", sa.JSON, nullable=False),
    sa.Column("content_type", sa.String(40), nullable=False),
    sa.Column("sha256", sa.String(64), nullable=False),
    sa.Column("bytes", sa.Integer, nullable=False),
    # 0 to 359, or null when it could not be computed
    sa.Column("palette_hue", sa.Integer, nullable=True),
    sa.Column("fetched_at", Epoch, nullable=False),
    sa.Column("hidden", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("hidden_reason", sa.String(2000), nullable=True),
    sa.Column("hidden_at", Epoch, nullable=True),
    sa.Column("hidden_by", Id, nullable=True),
    sa.CheckConstraint("palette_hue IS NULL OR (palette_hue >= 0 AND palette_hue < 360)",
                       name="palette_hue"),
)

song_catalog_links = sa.Table(
    "song_catalog_links",
    metadata,
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("song_id", sa.Integer, nullable=False),
    sa.Column("lookup_key", sa.String(64), nullable=False),
    # what the lookup found: filled for every workspace waiting on the same key
    sa.Column("recording_id", MbId, nullable=True),
    sa.Column("release_id", MbId, nullable=True),
    sa.Column("method", sa.String(16), nullable=True),
    sa.Column("confidence", sa.Float, nullable=True),
    # auto (follow the lookup), release (the person picked `chosen_release_id`) or generated
    # (the person chose the generated tile); a person's choice wins over any later lookup
    sa.Column("choice", sa.String(12), nullable=False, server_default="auto"),
    sa.Column("chosen_release_id", MbId, nullable=True),
    sa.Column("chosen_by", Id, nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.PrimaryKeyConstraint("workspace_id", "song_id"),
    sa.ForeignKeyConstraint(
        ["workspace_id", "song_id"],
        ["local_songs.workspace_id", "local_songs.id"],
        name="fk_song_catalog_links_song",
        ondelete="CASCADE",
    ),
    sa.CheckConstraint("choice IN ('auto', 'release', 'generated')", name="choice"),
    sa.Index("ix_song_catalog_links_lookup", "lookup_key"),
)

# The migration (`fl0478cat01`) checks these lists, so a schema change must add a new migration.
PLATFORM_TABLES = [catalog_lookups, catalog_recordings, catalog_releases, catalog_art]
TENANT_TABLES = [song_catalog_links]
ALL_TABLES = [*PLATFORM_TABLES, *TENANT_TABLES]

__all__ = [
    "ALL_TABLES",
    "PLATFORM_TABLES",
    "TENANT_TABLES",
    "catalog_art",
    "catalog_lookups",
    "catalog_recordings",
    "catalog_releases",
    "song_catalog_links",
]
