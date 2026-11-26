"""The engine's tables in SQLAlchemy Core: one definition for Desktop's library and for Cloud.

Each table carries `workspace_id`. On Desktop it is always `LOCAL_WORKSPACE`; in Cloud it is the
account's workspace, and PostgreSQL's fail-closed policy (migrations `es0479rate01`,
`es0479song01`) shows a transaction only the rows of the workspace it names.

`ratings` is the first slice. On Desktop it is the hand-made `ratings` table in `db.SCHEMA`,
adopted in place by the library migration `lib0002ratings`: the same rows, the same columns with
the same meaning, plus `workspace_id`. The hand-made table's own foreign keys to `songs` and
`seam_book` stay in the library file; they are not declared here (Cloud has no `songs`, and its
`seam_book`, made by `es0479disc01`, is keyed by workspace).

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
    # the rendered seam the grade was given to, when the reel knew it (`seams.key`); added by
    # `lib0006seams` and `es0479seam01`, null on every older row
    sa.Column("seam_key", sa.String(80), nullable=True),
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
    # Provenance (`es0479prov01`, `lib0005provenance`): which implementation measured these
    # facts, such as `python-beatthis-3` or a device's `web-dsp-1`, and whether a SelectaDJ
    # worker or the member's device sent them. Null on a row the Desktop's own Python analysis
    # wrote: `python-beatthis-{version}`, measured by SelectaDJ itself (`engine_store.facts`).
    sa.Column("implementation", sa.Text, nullable=True),
    sa.Column("source", sa.Text, nullable=True),
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
    # Cloud: the member's "Is it music?" (false: set aside, kept out of planned mixes; null: no
    # mark). Desktop keeps it on `songs` and leaves this null (es0479music01, lib0012ismusic).
    sa.Column("is_music", sa.Boolean, nullable=True),
    _of_a_song("song_overrides"),
)

def _of_two_songs(table: str) -> tuple[sa.ForeignKeyConstraint, ...]:
    # Cloud only, as above, for a row about song A into song B. Desktop's library migration
    # creates its seam tables without these (its songs are the library's own `songs`).
    return tuple(
        sa.ForeignKeyConstraint(
            ["workspace_id", side],
            ["local_songs.workspace_id", "local_songs.id"],
            name=f"fk_{table}_{side}",
            ondelete="CASCADE",
        )
        for side in ("song_a", "song_b")
    )


# The seams slice (`engine_store.seams`, docs/engineering/engine-store-seams.md). `record` is the
# seam's record exactly as `seam.json` or its `seam-history` file holds it; the named columns are
# copies of its fields, written from it in one place, so a reader can ask by pair, state or
# verdict without parsing every record.
SEAM_KEY = 80

seams = sa.Table(
    "seams",
    metadata,
    sa.Column("workspace_id", Id, primary_key=True),
    # `SeamRequest.key` on Desktop (20 hex); a device's or worker's key in Cloud
    sa.Column("key", sa.String(SEAM_KEY), primary_key=True),
    sa.Column("song_a", sa.Integer, nullable=False),  # request.a
    sa.Column("song_b", sa.Integer, nullable=False),  # request.b
    sa.Column("asked", sa.Text, nullable=True),  # request.move: the move asked for, or auto
    sa.Column("status", sa.Text, nullable=False),  # ready or failed; nothing under way is kept
    sa.Column("style", sa.Text, nullable=True),  # the move rendered
    sa.Column("bars", sa.Integer, nullable=True),
    sa.Column("exit_bar", sa.Integer, nullable=True),
    sa.Column("entry_bar", sa.Integer, nullable=True),
    sa.Column("a_source_start", sa.Float, nullable=True),  # where A is left, in A's seconds
    sa.Column("b_source_end", sa.Float, nullable=True),  # where B is joined, in B's seconds
    sa.Column("duration", sa.Float, nullable=True),
    sa.Column("rules", sa.Integer, nullable=True),  # `planner_core.memory.RULES_VERSION`
    # the planner's answer the script came from (Cloud's candidates fingerprint); null on Desktop
    sa.Column("fingerprint", sa.String(64), nullable=True),
    sa.Column("passed", sa.Boolean, nullable=True),
    sa.Column("near_miss", sa.Boolean, nullable=True),
    sa.Column("fell_back", sa.Boolean, nullable=True),
    sa.Column("pair", sa.Text, nullable=True),  # JSON: the pair's facts when it was made
    sa.Column("checks", sa.Text, nullable=True),  # JSON: the audit report, as the record says
    sa.Column("error", sa.Text, nullable=True),  # why it failed
    # the verdict on this version, exactly as the record holds it; every click is in seam_verdicts
    sa.Column("rating", sa.Text, nullable=True),
    sa.Column("rated_at", sa.Float, nullable=True),
    sa.Column("note", sa.Text, nullable=True),
    sa.Column("source", sa.Text, nullable=False),  # desktop, device or worker
    sa.Column("record", sa.Text, nullable=False),  # JSON: the whole record, as the file holds it
    sa.Column("record_hash", sa.String(64), nullable=False),
    sa.Column("updated_at", sa.Text, nullable=False),
    *_of_two_songs("seams"),
)
sa.Index("ix_seams_pair", seams.c.workspace_id, seams.c.song_a, seams.c.song_b)

# Who rendered a seam's clip. A seam is ready for a reader with an attestation from a studio it
# can play from (`engine_store.seams`); the clip itself is never in the database.
seam_attestations = sa.Table(
    "seam_attestations",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("key", sa.String(SEAM_KEY), nullable=False),
    sa.Column("studio", sa.Text, nullable=False),  # desktop, worker or device
    # which one: `desktop`, a worker's id, or the member's playback device id
    sa.Column("studio_id", sa.String(80), nullable=False),
    sa.Column("implementation", sa.Text, nullable=False),
    sa.Column("clip_sha256", sa.String(64), nullable=False),
    sa.Column("clip_seconds", sa.Float, nullable=False),
    sa.Column("attested_at", sa.Text, nullable=False),
    sa.UniqueConstraint("workspace_id", "key", "studio_id", name="uq_seam_attestations_studio"),
    sa.ForeignKeyConstraint(
        ["workspace_id", "key"],
        ["seams.workspace_id", "seams.key"],
        name="fk_seam_attestations_seam",
        ondelete="CASCADE",
    ),
)

# Every version of a seam's record as it was kept: what `seam-history/{key}.json` held each time
# it was written. Append-only; a row is never changed.
seam_history = sa.Table(
    "seam_history",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("key", sa.String(SEAM_KEY), nullable=False),
    sa.Column("song_a", sa.Integer, nullable=False),
    sa.Column("song_b", sa.Integer, nullable=False),
    sa.Column("status", sa.Text, nullable=False),
    sa.Column("rating", sa.Text, nullable=True),
    sa.Column("record", sa.Text, nullable=False),
    sa.Column("record_hash", sa.String(64), nullable=False),
    sa.Column("recorded_at", sa.Text, nullable=False),
    *_of_two_songs("seam_history"),
)
sa.Index("ix_seam_history_key", seam_history.c.workspace_id, seam_history.c.key)

# Every Good, Bad and cleared verdict a listener gave, oldest first. Append-only.
seam_verdicts = sa.Table(
    "seam_verdicts",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("key", sa.String(SEAM_KEY), nullable=False),
    sa.Column("song_a", sa.Integer, nullable=False),
    sa.Column("song_b", sa.Integer, nullable=False),
    sa.Column("verdict", sa.Text, nullable=False),  # good, bad or none (cleared)
    sa.Column("note", sa.Text, nullable=False, server_default=""),
    sa.Column("rated_at", sa.Float, nullable=False),  # seconds since 1970, as `rated_at` is
    # who: the member's user id in Cloud; `local` on Desktop
    sa.Column("rated_by", sa.String(80), nullable=False),
    sa.CheckConstraint("verdict IN ('good', 'bad', 'none')", name="seam_verdict_kind"),
    *_of_two_songs("seam_verdicts"),
)
sa.Index("ix_seam_verdicts_key", seam_verdicts.c.workspace_id, seam_verdicts.c.key)

SEAM_TABLES = (seams, seam_attestations, seam_history, seam_verdicts)

# The mixes slice (`engine_store.mixes`, docs/engineering/engine-store-mixes.md). On Desktop
# these are the hand-made tables of `db.SCHEMA`, adopted in place by `lib0007mixes`; in Cloud
# they are created by `es0479mix01`. A Desktop library holds one workspace, so its own keys
# (`queue.position`, `preferences.key`) stay unique there; Cloud's include the workspace.

# The current mix: one row per song, in `position` order. `seam` is the JSON settings of the seam
# into this song (null for the first song or Auto); `locked` 1 keeps the song at its place.
queue = sa.Table(
    "queue",
    metadata,
    sa.Column("workspace_id", Id, primary_key=True),
    sa.Column("position", sa.Integer, primary_key=True, autoincrement=False),
    sa.Column("song_id", sa.Integer, nullable=False),
    # `state`, `transition` and `reason` are kept as the command line's planner writes them
    sa.Column("state", sa.Text, nullable=False, server_default="planned"),
    sa.Column("transition", sa.Text, nullable=True),
    sa.Column("reason", sa.Text, nullable=True),
    sa.Column("locked", sa.Integer, nullable=False, server_default="0"),
    sa.Column("seam", sa.Text, nullable=True),
    _of_a_song("queue"),
)

# Every other mix. `items` is a JSON list of [song id, seam settings JSON or null, locked], in
# order; `history` up to `mix.UNDO_DEPTH` earlier versions for Undo; `line` its place in the
# render line (null when not in it). Times are UTC `YYYY-MM-DD HH:MM:SS`, as SQLite wrote them.
# A draft's songs are inside `items`, so Cloud checks them on every write, not by foreign key.
drafts = sa.Table(
    "drafts",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("items", sa.Text, nullable=False, server_default="[]"),
    sa.Column("history", sa.Text, nullable=False, server_default="[]"),
    sa.Column("ready_only", sa.Integer, nullable=False, server_default="0"),
    sa.Column("line", sa.Integer, nullable=True),
    sa.Column("created_at", sa.Text, nullable=True),
    sa.Column("updated_at", sa.Text, nullable=True),
)
sa.Index("ix_drafts_listed", drafts.c.workspace_id, drafts.c.line, drafts.c.updated_at)

# Named JSON values. The store reads and writes only the mix's own (`mixes.MIX_KEYS`: the current
# mix's name and Undo, and the drafts kept aside after a delete); Desktop keeps its other settings
# here too, read on the old path.
preferences = sa.Table(
    "preferences",
    metadata,
    sa.Column("workspace_id", Id, primary_key=True),
    sa.Column("key", sa.String(80), primary_key=True),
    sa.Column("value", sa.Text, nullable=False),
    sa.Column("updated_at", sa.Text, nullable=True),
)

# Cloud only: which recipe or Cloud mix became which draft, so an import runs once per mix
# (`engine_store.mix_import`). Never removed when the draft is, so a deleted draft stays deleted.
mix_imports = sa.Table(
    "mix_imports",
    metadata,
    sa.Column("workspace_id", Id, primary_key=True),
    sa.Column("source", sa.String(16), primary_key=True),  # recipe, cloud_mix or current
    sa.Column("source_id", sa.String(64), primary_key=True),
    sa.Column("draft_id", sa.Integer, nullable=True),
    sa.Column("imported_at", sa.Text, nullable=False),
)

MIX_TABLES = (queue, drafts, preferences, mix_imports)

# The requests slice (`engine_store.requests`, docs/engineering/engine-store-requests.md). On
# Desktop the tables `requests.DDL` made, adopted in place by `lib0008requests`; in Cloud made
# by `es0479req01`. Desktop keeps `request_marks.song_id` as its key (one workspace per file);
# Cloud's key includes the workspace, and its songs are the workspace's catalogue songs.

# A song asked for: `status` is waiting, scheduled (it joined the mix) or cancelled. At most one
# waiting request per song. `created_at` is UTC `YYYY-MM-DD HH:MM:SS`.
song_requests = sa.Table(
    "song_requests",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("song_id", sa.Integer, nullable=False),
    sa.Column("status", sa.Text, nullable=False, server_default="waiting"),
    sa.Column("created_at", sa.Text, nullable=False),
    sa.UniqueConstraint("workspace_id", "id", name="uq_song_requests_workspace_id"),
    _of_a_song("song_requests"),
)
sa.Index(
    "ix_song_requests_one_waiting",
    song_requests.c.workspace_id,
    song_requests.c.song_id,
    unique=True,
    sqlite_where=song_requests.c.status == "waiting",
    postgresql_where=song_requests.c.status == "waiting",
)


def _of_a_request(table: str) -> sa.ForeignKeyConstraint:
    # Cloud only: an answer about a request is that workspace's request's, and goes with it
    return sa.ForeignKeyConstraint(
        ["workspace_id", "request_id"],
        ["song_requests.workspace_id", "song_requests.id"],
        name=f"fk_{table}_request",
        ondelete="CASCADE",
    )


# Yes or no to an extra song for this request: `signature` is "yes" or "no".
request_bridge_approvals = sa.Table(
    "request_bridge_approvals",
    metadata,
    sa.Column("request_id", sa.Integer, primary_key=True, autoincrement=False),
    sa.Column("signature", sa.Text, nullable=False),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    _of_a_request("request_bridge_approvals"),
)

# The exact songs someone agreed to for a request, a JSON list in playing order.
request_routes = sa.Table(
    "request_routes",
    metadata,
    sa.Column("request_id", sa.Integer, primary_key=True, autoincrement=False),
    sa.Column("songs", sa.Text, nullable=False),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    _of_a_request("request_routes"),
)

# A song in the current mix that a request put there: kind "requested", or "bridge" with
# `for_song` the requested song it leads to.
request_marks = sa.Table(
    "request_marks",
    metadata,
    sa.Column("workspace_id", Id, primary_key=True),
    sa.Column("song_id", sa.Integer, primary_key=True, autoincrement=False),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("for_song", sa.Integer, nullable=True),
    _of_a_song("request_marks"),
)

REQUEST_TABLES = (song_requests, request_bridge_approvals, request_routes, request_marks)

# The discovery slice (`engine_store.discovery`, docs/engineering/engine-store-discovery.md). On
# Desktop the hand-made `seam_book` and the sweep's `discovery_comparisons`, adopted in place by
# `lib0009discovery`, keeping their own keys (one workspace per file); Cloud's include it.

# A link found between two songs: a word link, an ordered harmonic sequence or a tonal cousin.
# `payload` is the link's JSON as found; `status` is new, approved or rejected.
seam_book = sa.Table(
    "seam_book",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("song_a", sa.Integer, nullable=False),
    sa.Column("song_b", sa.Integer, nullable=False),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("payload", sa.Text, nullable=False),
    sa.Column("score", sa.Float, nullable=False),
    sa.Column("status", sa.Text, nullable=False, server_default="new"),
    sa.UniqueConstraint(
        "workspace_id", "song_a", "song_b", "kind", "payload", name="uq_seam_book_link"
    ),
    *_of_two_songs("seam_book"),
)
sa.Index("ix_seam_book_kind", seam_book.c.workspace_id, seam_book.c.kind, seam_book.c.score)

# A pair the exhaustive sweep has compared, with both songs' fingerprints when it did, so a pair
# whose features change is compared again. Written in the same write as the pair's links.
discovery_comparisons = sa.Table(
    "discovery_comparisons",
    metadata,
    sa.Column("workspace_id", Id, primary_key=True),
    sa.Column("song_a", sa.Integer, primary_key=True, autoincrement=False),
    sa.Column("song_b", sa.Integer, primary_key=True, autoincrement=False),
    sa.Column("fingerprint_a", sa.Text, nullable=False),
    sa.Column("fingerprint_b", sa.Text, nullable=False),
    *_of_two_songs("discovery_comparisons"),
)

DISCOVERY_TABLES = (seam_book, discovery_comparisons)

ENGINE_TABLES = (
    ratings,
    analysis,
    song_overrides,
    *SEAM_TABLES,
    *MIX_TABLES,
    *REQUEST_TABLES,
    *DISCOVERY_TABLES,
)
"""Every engine table Cloud has, for the migrations and the fail-closed policy."""

library_metadata = sa.MetaData()
"""Desktop's own engine tables: adopted in place by the library chain, never created anywhere."""

# The hand-made table of `db.SCHEMA`, every column, as the scanner writes it
# (`engine_store.library_writes`); `path` is unique there.
songs = sa.Table(
    "songs",
    library_metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("path", sa.Text, nullable=False),
    sa.Column("folder", sa.Text, nullable=False),
    sa.Column("size", sa.Integer, nullable=False),
    sa.Column("mtime", sa.Float, nullable=False),
    sa.Column("duration", sa.Float, nullable=False),
    sa.Column("artist", sa.Text, nullable=True),
    sa.Column("title", sa.Text, nullable=True),
    sa.Column("album", sa.Text, nullable=True),
    sa.Column("genre", sa.Text, nullable=True),
    sa.Column("year", sa.Text, nullable=True),
    sa.Column("bitrate", sa.Integer, nullable=True),
    sa.Column("sample_rate", sa.Integer, nullable=True),
    sa.Column("lossless", sa.Integer, nullable=False, server_default="0"),
    sa.Column("is_music", sa.Integer, nullable=False),
    sa.Column("set_aside_reason", sa.Text, nullable=True),
    # a person's "this is music" (1) or "set it aside" (0); null when they never said
    sa.Column("music_override", sa.Integer, nullable=True),
    sa.Column("processing_priority", sa.Integer, nullable=False, server_default="0"),
    # SHA-256 of the file's bytes, as Cloud's catalogue keys a song. Filled in the background
    # (`engine_store.song_hashes`); not a key on Desktop, where two copies may share it.
    sa.Column("content_hash", sa.String(64), nullable=True),
    # A hash of the audio alone (`library.audio_identity`, docs/engineering/audio-identity.md):
    # the same after a tag edit. Filled beside `content_hash`; null for a format it can't place.
    sa.Column("audio_id", sa.String(67), nullable=True),
    # another file of an earlier song: a version, never a song of its own (`requests` skips it)
    sa.Column("duplicate_of", sa.Integer, nullable=True),
)

lyrics = sa.Table(
    "lyrics",
    library_metadata,
    sa.Column("song_id", sa.Integer, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("status", sa.Text, nullable=False),
    sa.Column("synced", sa.Text, nullable=True),
    sa.Column("plain", sa.Text, nullable=True),
    sa.Column("fetched_at", sa.Text, nullable=True),
)

# What a listener skipped and how far in: Desktop only. It was made by its route on the first skip;
# `lib0007mixes` makes it with the same columns, so the route only writes.
playback_skips = sa.Table(
    "playback_skips",
    library_metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("song_id", sa.Integer, nullable=False),
    sa.Column("heard_seconds", sa.Float, nullable=False),
    sa.Column("source_position", sa.Float, nullable=False),
    sa.Column("created_at", sa.Text, nullable=True),
)

# The listening study (`engine_store.listening`): Desktop only, the owner's own blind A/B tool.
# Made and adopted by `lib0010listening`; `listening.initialise` made them before.

# One blind trial: `mapping` is JSON {"a": condition, "b": condition}, never shown to a listener.
# `ordinal` is the order trials were registered in.
listening_trials = sa.Table(
    "listening_trials",
    library_metadata,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("study", sa.Text, nullable=False),
    sa.Column("pair", sa.Text, nullable=False),
    sa.Column("mapping", sa.Text, nullable=False),
    sa.Column("seed", sa.Integer, nullable=False),
    sa.Column("ordinal", sa.Integer, nullable=True),
)

# A condition's private label: the method and renderer, and the rendered seam it is, if named.
listening_methods = sa.Table(
    "listening_methods",
    library_metadata,
    sa.Column("condition", sa.Text, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("method", sa.Text, nullable=False),
    sa.Column("renderer", sa.Text, nullable=False),
    sa.Column("seam_key", sa.String(SEAM_KEY), nullable=True),
)

# A listener's answer to one trial: a, b, tie or cannot_judge. `updated_at` UTC as SQLite writes.
listening_responses = sa.Table(
    "listening_responses",
    library_metadata,
    sa.Column("trial", sa.Text, primary_key=True),
    sa.Column("listener", sa.Text, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("choice", sa.Text, nullable=False),
    sa.Column("setup", sa.Text, nullable=False),
    sa.Column("updated_at", sa.Text, nullable=True),
)

# A listener's 1 to 5 grade of one option of a trial, with the issues they ticked (JSON list).
listening_quality = sa.Table(
    "listening_quality",
    library_metadata,
    sa.Column("trial", sa.Text, primary_key=True),
    sa.Column("listener", sa.Text, primary_key=True),
    sa.Column("option", sa.Text, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("grade", sa.Integer, nullable=False),
    sa.Column("tags", sa.Text, nullable=False),
)

LISTENING_TABLES = (listening_trials, listening_methods, listening_responses, listening_quality)

LIBRARY_TABLES = (songs, lyrics, playback_skips, *LISTENING_TABLES)

# Lucy's tables on the Desktop (`engine_store.lucy`, docs/engineering/engine-store-lucy.md):
# `lucy.schema.SCHEMA` made them at run time; `lib0011lucy` makes them with those statements and
# adopts them in place. Desktop only: Cloud Lucy has her own tables (`lucy.cloud_schema`). Ids are
# Lucy's opaque text ids; times are `lucy.ids.now_iso` (UTC ISO, milliseconds); JSON is text.


def _lucy(name: str, *columns: sa.Column) -> sa.Table:
    return sa.Table(
        name,
        library_metadata,
        *columns,
        sa.Column("workspace_id", Id, nullable=False, index=True),
    )


lucy_conversations = _lucy(
    "lucy_conversations",
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("title", sa.Text, nullable=False),
    sa.Column("scope", sa.Text, nullable=False, server_default="{}"),
    sa.Column("proposal_id", sa.Text, nullable=True),
    sa.Column("parent_id", sa.Text, nullable=True),
    sa.Column("branched_from", sa.Text, nullable=True),
    sa.Column("archived", sa.Integer, nullable=False, server_default="0"),
    # the next message or turn number; the server's order, not the browser's
    sa.Column("next_seq", sa.Integer, nullable=False, server_default="1"),
    # events up to this id may have been compacted away
    sa.Column("pruned_through", sa.Integer, nullable=False, server_default="0"),
    sa.Column("created_at", sa.Text, nullable=False),
    sa.Column("updated_at", sa.Text, nullable=False),
)

lucy_messages = _lucy(
    "lucy_messages",
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("conversation_id", sa.Text, nullable=False),
    sa.Column("seq", sa.Integer, nullable=False),
    sa.Column("role", sa.Text, nullable=False),  # user, assistant or notice
    sa.Column("turn_id", sa.Text, nullable=True),
    sa.Column("run_id", sa.Text, nullable=True),
    sa.Column("content", sa.Text, nullable=False, server_default=""),
    sa.Column("status", sa.Text, nullable=False, server_default="complete"),
    sa.Column("revision_id", sa.Text, nullable=True),
    sa.Column("meta", sa.Text, nullable=False, server_default="{}"),
    sa.Column("created_at", sa.Text, nullable=False),
)

lucy_turns = _lucy(
    "lucy_turns",
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("conversation_id", sa.Text, nullable=False),
    sa.Column("client_id", sa.Text, nullable=False),  # one send, however often it arrives
    sa.Column("seq", sa.Integer, nullable=False),
    sa.Column("text", sa.Text, nullable=False),
    sa.Column("expected_revision", sa.Text, nullable=True),
    sa.Column("selection", sa.Text, nullable=False, server_default="{}"),
    sa.Column("status", sa.Text, nullable=False, server_default="queued"),
    sa.Column("created_at", sa.Text, nullable=False),
)

lucy_runs = _lucy(
    "lucy_runs",
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("turn_id", sa.Text, nullable=False),
    sa.Column("conversation_id", sa.Text, nullable=False),
    sa.Column("attempt", sa.Integer, nullable=False, server_default="1"),
    sa.Column("state", sa.Text, nullable=False),
    sa.Column("provider", sa.Text, nullable=False),
    sa.Column("cycles", sa.Integer, nullable=False, server_default="0"),
    sa.Column("steps", sa.Integer, nullable=False, server_default="0"),
    sa.Column("tokens_in", sa.Integer, nullable=False, server_default="0"),
    sa.Column("tokens_out", sa.Integer, nullable=False, server_default="0"),
    sa.Column("usage", sa.Text, nullable=False, server_default="{}"),
    sa.Column("limits", sa.Text, nullable=False, server_default="{}"),
    sa.Column("error", sa.Text, nullable=True),
    sa.Column("started_at", sa.Text, nullable=False),
    sa.Column("ended_at", sa.Text, nullable=True),
)

# The ordered log every live view replays; `id` is the global order a client resumes from.
lucy_events = _lucy(
    "lucy_events",
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("conversation_id", sa.Text, nullable=False),
    sa.Column("v", sa.Integer, nullable=False),
    sa.Column("type", sa.Text, nullable=False),
    sa.Column("turn_id", sa.Text, nullable=True),
    sa.Column("run_id", sa.Text, nullable=True),
    sa.Column("plan_id", sa.Text, nullable=True),
    sa.Column("step_id", sa.Text, nullable=True),
    sa.Column("payload", sa.Text, nullable=False, server_default="{}"),
    sa.Column("created_at", sa.Text, nullable=False),
)

lucy_proposals = _lucy(
    "lucy_proposals",
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("conversation_id", sa.Text, nullable=False),
    sa.Column("current_revision", sa.Text, nullable=True),
    sa.Column("created_at", sa.Text, nullable=False),
    sa.Column("updated_at", sa.Text, nullable=False),
)

# An immutable snapshot; `hash` is what an approval binds to.
lucy_revisions = _lucy(
    "lucy_revisions",
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("proposal_id", sa.Text, nullable=False),
    sa.Column("number", sa.Integer, nullable=False),
    sa.Column("parent_id", sa.Text, nullable=True),
    sa.Column("branch", sa.Text, nullable=False, server_default="main"),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("hash", sa.Text, nullable=False),
    sa.Column("snapshot", sa.Text, nullable=False),
    sa.Column("turn_id", sa.Text, nullable=True),
    sa.Column("summary", sa.Text, nullable=False, server_default=""),
    sa.Column("created_at", sa.Text, nullable=False),
)

lucy_approvals = _lucy(
    "lucy_approvals",
    sa.Column("token", sa.Text, primary_key=True),
    sa.Column("revision_id", sa.Text, nullable=False),
    sa.Column("hash", sa.Text, nullable=False),
    sa.Column("action", sa.Text, nullable=False),
    sa.Column("expires_at", sa.Integer, nullable=False),  # seconds since 1970
    sa.Column("used", sa.Integer, nullable=False, server_default="0"),
    sa.Column("created_at", sa.Text, nullable=False),
)

lucy_commits = _lucy(
    "lucy_commits",
    sa.Column("idempotency_key", sa.Text, primary_key=True),
    sa.Column("revision_id", sa.Text, nullable=False),
    sa.Column("hash", sa.Text, nullable=False),
    sa.Column("action", sa.Text, nullable=False),
    sa.Column("status", sa.Text, nullable=False),  # pending, committed or failed
    sa.Column("draft_id", sa.Integer, nullable=True),
    sa.Column("result", sa.Text, nullable=False, server_default="{}"),
    sa.Column("created_at", sa.Text, nullable=False),
    sa.Column("updated_at", sa.Text, nullable=False),
)

lucy_memory = _lucy(
    "lucy_memory",
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("kind", sa.Text, nullable=False),  # explicit, inferred or session
    sa.Column("subject", sa.Text, nullable=False),
    sa.Column("value", sa.Text, nullable=False),
    sa.Column("source", sa.Text, nullable=False, server_default="{}"),
    sa.Column("confidence", sa.Float, nullable=True),
    sa.Column("conversation_id", sa.Text, nullable=True),
    sa.Column("forgotten", sa.Integer, nullable=False, server_default="0"),
    sa.Column("created_at", sa.Text, nullable=False),
    sa.Column("updated_at", sa.Text, nullable=False),
)

lucy_permissions = _lucy(
    "lucy_permissions",
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("conversation_id", sa.Text, nullable=False),
    sa.Column("run_id", sa.Text, nullable=True),
    sa.Column("tier", sa.Text, nullable=False),
    sa.Column("operation", sa.Text, nullable=False),
    sa.Column("arguments", sa.Text, nullable=False),
    sa.Column("status", sa.Text, nullable=False, server_default="pending"),
    sa.Column("created_at", sa.Text, nullable=False),
    sa.Column("decided_at", sa.Text, nullable=True),
)

# What the player really played, kept only while the person has history turned on.
# `created_at` is UTC `YYYY-MM-DD HH:MM:SS`, as SQLite's CURRENT_TIMESTAMP wrote it.
listening_events = _lucy(
    "listening_events",
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("song_id", sa.Integer, nullable=False),
    sa.Column("session", sa.Text, nullable=False),
    sa.Column("source", sa.Text, nullable=False),
    sa.Column("event", sa.Text, nullable=False),
    sa.Column("heard", sa.Float, nullable=False, server_default="0"),
    sa.Column("position", sa.Float, nullable=False, server_default="0"),
    sa.Column("created_at", sa.Text, nullable=True),
)

LUCY_TABLES = (
    lucy_conversations,
    lucy_messages,
    lucy_turns,
    lucy_runs,
    lucy_events,
    lucy_proposals,
    lucy_revisions,
    lucy_approvals,
    lucy_commits,
    lucy_memory,
    lucy_permissions,
    listening_events,
)

__all__ = [
    "DISCOVERY_TABLES",
    "ENGINE_TABLES",
    "LIBRARY_TABLES",
    "LISTENING_TABLES",
    "LUCY_TABLES",
    "MIX_TABLES",
    "REQUEST_TABLES",
    "SEAM_TABLES",
    "analysis",
    "discovery_comparisons",
    "drafts",
    "library_metadata",
    "listening_methods",
    "listening_quality",
    "listening_responses",
    "listening_trials",
    "lyrics",
    "mix_imports",
    "playback_skips",
    "preferences",
    "queue",
    "ratings",
    "request_bridge_approvals",
    "request_marks",
    "request_routes",
    "seam_attestations",
    "seam_book",
    "seam_history",
    "seam_verdicts",
    "seams",
    "song_overrides",
    "song_requests",
    "songs",
]
