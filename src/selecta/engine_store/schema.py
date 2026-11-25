"""The engine's tables in SQLAlchemy Core: one definition for Desktop's library and for Cloud.

Each table carries `workspace_id`. On Desktop it is always `LOCAL_WORKSPACE`; in Cloud it is the
account's workspace, and PostgreSQL's fail-closed policy (migrations `es0479rate01`,
`es0479song01`) shows a transaction only the rows of the workspace it names.

`ratings` is the first slice. On Desktop it is the hand-made `ratings` table in `db.SCHEMA`,
adopted in place by the library migration `lib0002ratings`: the same rows, the same columns with
the same meaning, plus `workspace_id`. The hand-made table's own foreign keys to `songs` and
`seam_book` stay in the library file; they are not declared here because Cloud has neither table.

The song facts are the second slice (`lib0003songs`, `es0479song01`):

- `analysis` and `song_overrides` are on both. On Desktop they are the hand-made tables, adopted
  in place. In Cloud a song is the catalogue's `local_songs` row, keyed by (workspace,
  content hash), so these point at it by its id; `local_songs.id` is unique across workspaces,
  so `song_id` stays the primary key exactly as on Desktop.
- `songs` and `lyrics` exist only on Desktop and are declared on `library_metadata`, never on
  the shared `metadata`, so no Cloud migration or check ever sees them. Cloud already holds the
  same identity in `local_songs` and the same lyrics in `local_song_lyrics`; a song's device
  path, folder and file facts never reach the server.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.local_media import schema as _catalogue  # noqa: F401  (the foreign keys' target)
from selecta.persistence import Id, metadata

ratings = sa.Table(
    "ratings",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    # the discovered link that was rated, when there was one (a `seam_book` row on Desktop)
    sa.Column("seam_id", sa.Integer, nullable=True),
    sa.Column("song_a", sa.Integer, nullable=False),
    sa.Column("song_b", sa.Integer, nullable=False),
    # how the transition was made, hidden from the listener while they rated it
    sa.Column("method", sa.Text, nullable=False),
    sa.Column("rating", sa.Integer, nullable=False),
    # a JSON list of words the listener picked, `[]` when none
    sa.Column("tags", sa.Text, nullable=False, server_default="[]"),
    # UTC as `YYYY-MM-DD HH:MM:SS`, the format SQLite's CURRENT_TIMESTAMP wrote for older rows
    sa.Column("created_at", sa.Text, nullable=True),
    sa.CheckConstraint("rating BETWEEN 1 AND 5", name="rating_range"),
)


def _of_a_song(table: str) -> sa.ForeignKeyConstraint:
    # Cloud only: a fact row can never point at another workspace's song. Desktop's hand-made
    # tables keep their own foreign key to `songs`.
    return sa.ForeignKeyConstraint(
        ["workspace_id", "song_id"],
        ["local_songs.workspace_id", "local_songs.id"],
        name=f"fk_{table}_song",
        ondelete="CASCADE",
    )


# What analysis measured: machine facts only. The arrays are in the features artifact, keyed by
# the song's content hash and `version` (`engine_store.songs.features_key`).
analysis = sa.Table(
    "analysis",
    metadata,
    sa.Column("song_id", sa.Integer, primary_key=True, autoincrement=False),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("version", sa.Integer, nullable=False),
    sa.Column("bpm", sa.Float, nullable=True),
    sa.Column("constant_tempo", sa.Integer, nullable=True),
    sa.Column("grid_confidence", sa.Float, nullable=True),
    sa.Column("beats_per_bar", sa.Integer, nullable=True),
    sa.Column("key", sa.Text, nullable=True),
    sa.Column("camelot", sa.Text, nullable=True),
    sa.Column("key_confidence", sa.Float, nullable=True),
    sa.Column("key_agrees_chroma", sa.Integer, nullable=True),
    sa.Column("lufs", sa.Float, nullable=True),
    sa.Column("peak_db", sa.Float, nullable=True),
    sa.Column("energy", sa.Float, nullable=True),
    # JSON text, as `db.save_analysis` writes it
    sa.Column("sections", sa.Text, nullable=True),
    sa.Column("timbre", sa.Text, nullable=True),
    sa.Column("timings", sa.Text, nullable=True),
    # why analysis gave up, when it did
    sa.Column("error", sa.Text, nullable=True),
    sa.Column("analysed_at", sa.Text, nullable=True),
    _of_a_song("analysis"),
)

# A listener's correction of the tempo or key, which wins over what analysis heard.
song_overrides = sa.Table(
    "song_overrides",
    metadata,
    sa.Column("song_id", sa.Integer, primary_key=True, autoincrement=False),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("bpm", sa.Float, nullable=True),
    sa.Column("camelot", sa.Text, nullable=True),
    sa.Column("updated_at", sa.Text, nullable=True),
    _of_a_song("song_overrides"),
)

ENGINE_TABLES = (ratings, analysis, song_overrides)
"""Every engine table Cloud has, for the migrations and the fail-closed policy."""

library_metadata = sa.MetaData()
"""Desktop's own engine tables: adopted in place by the library chain, never created anywhere."""

# Only the columns the engine store reads or writes. The hand-made table has more (folder,
# album, duplicate_of, ...), which these statements simply don't name.
songs = sa.Table(
    "songs",
    library_metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("path", sa.Text, nullable=False),
    sa.Column("size", sa.Integer, nullable=False),
    sa.Column("mtime", sa.Float, nullable=False),
    sa.Column("duration", sa.Float, nullable=False),
    sa.Column("artist", sa.Text, nullable=True),
    sa.Column("title", sa.Text, nullable=True),
    sa.Column("genre", sa.Text, nullable=True),
    sa.Column("is_music", sa.Integer, nullable=False),
    # SHA-256 of the file's bytes, as Cloud's catalogue keys a song. Filled in the background
    # (`engine_store.song_hashes`); not a key on Desktop, where two copies may share it.
    sa.Column("content_hash", sa.String(64), nullable=True),
    # A hash of the audio alone (`library.audio_identity`, docs/engineering/audio-identity.md):
    # the same after a tag edit. Filled beside `content_hash`; null for a format it can't place.
    sa.Column("audio_id", sa.String(67), nullable=True),
)

lyrics = sa.Table(
    "lyrics",
    library_metadata,
    sa.Column("song_id", sa.Integer, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("status", sa.Text, nullable=False),
    sa.Column("synced", sa.Text, nullable=True),
)

LIBRARY_TABLES = (songs, lyrics)

__all__ = [
    "ENGINE_TABLES",
    "LIBRARY_TABLES",
    "analysis",
    "library_metadata",
    "lyrics",
    "ratings",
    "song_overrides",
    "songs",
]
