# The engine store

ADR-0479 ("One storage layer for Desktop and Cloud") moves the engine's relational state off raw
`sqlite3` calls onto one layer that Desktop runs on SQLite and Cloud runs on PostgreSQL. This page
says what that layer is, the rules it keeps, and how a slice of state moves onto it. The code is
`src/selecta/engine_store/`; the flag is `core.engine_store` (off by default, both modes).

## What it is

`EngineStore(engine, workspace_id)` is the only door to an engine table. A slice (ratings, then
song facts) is a module such as `engine_store/ratings.py` whose functions take a store and
nothing else.

- Tables are SQLAlchemy Core, declared in `engine_store/schema.py` on the shared `metadata`, each
  with a non-null `workspace_id`.
- `upsert` and `insert_returning_id` are written once, for both databases. A slice never writes
  `INSERT OR REPLACE`, `lastrowid`, `rowid`, a PRAGMA or `sqlite_master`.
- On Desktop, `engine_store.library.store_for(path)` gives the local workspace's store on the
  library file, and `store_of(conn)` the store on the file an old `sqlite3` connection has open.

## The workspace rule

The store refuses a missing or empty workspace (`NoWorkspace`). Desktop always passes
`LOCAL_WORKSPACE` (`"local"`); Cloud passes the signed-in account's workspace. There is no
"every workspace" store: cross-workspace work that needs engine rows must name each workspace.

Every slice query still filters with `store.mine(table)`, because SQLite has no row-level
security. On PostgreSQL the policy below is the second guard.

## Read against write

- `store.write()` is `persistence.transaction(engine, workspace)`: on SQLite it begins
  `IMMEDIATE`, so two writers queue rather than deadlock.
- `store.read()` runs on the same engine with the `selecta_deferred_read` execution option, which
  makes `persistence.make_engine`'s begin hook issue a plain (deferred) `BEGIN`. In WAL mode the
  read sees the last commit, never waits behind a writer, and never blocks one. Callers only read
  inside it. `transaction()` itself is unchanged for every existing caller.

## Fail-closed policy

Engine tables get the `workspace_isolation` policy with no empty-scope branch
(`es0479rate01`, `es0479song01`; each pins and creates only its own tables):

```
workspace_id = current_setting('app.workspace_id', true)
```

A transaction that names no workspace (`transaction(engine, None)`) sees and writes no engine rows.
The older tenant tables keep their policy from `b7e3c91f0a24`, which lets such a system
transaction through; that is unchanged here.

## Two chains, one answer to "upgrade?"

- Cloud's engine tables come from the shared chain (`persistence/migrations`), like every Cloud
  table. That chain refuses to run on a file with a `songs` table.
- A Desktop library file has its own chain (`engine_store/library_migrations`, version table
  `engine_version`), so it never receives Cloud tables or a later Cloud migration.

The library chain starts at a baseline, `lib0001baseline`: the hand-made schema of `db.SCHEMA` at
local schema 3, with no DDL. The rule:

1. `db.connect` runs as it always has: the upgrade backup, the hand-made steps, then
   `PRAGMA user_version`.
2. Only then, with the flag on, `library.bring_forward` stamps an unstamped file at the baseline
   (it must be on local schema 3 or newer) and runs the library chain to head.
3. `local_upgrade.upgrade_needed` is the one answer to "does this file need upgrading": its
   `user_version` is behind, or, with the flag on, its engine stamp is missing or older than
   head. The backup, `db.connect`'s fast path and the migration all ask it.

A stamp this app doesn't know belongs to a newer app and is left alone. `user_version` stays until
every slice has moved; after that the engine chain is the only version.

## Backup and restore

A backup is a copy of the whole library file, so `engine_version` travels with the rows it
describes. With the flag on, a backup stamped by a newer app is refused. After a restore is
activated, `api.create_app` opens the library once, so an older backup is brought forward on
start, behind the usual upgrade backup, and the seam import runs again. `work.sqlite` is never
backed up: it holds jobs and leases, not results ([engine-store-seams.md](engine-store-seams.md)).

## Flags per request and per job

`flags.on` reads a context variable first. `flags.bound(answers)` holds one account's answers for
a block; outside any block, or for a flag the answers don't name, the process answer applies.
What carries the binding: `await`, tasks started inside the block, `asyncio.to_thread`, Starlette's
thread pool. A plain `threading.Thread` does not; wrap its target in `flags.carry(...)`.

Bound today, with `core.engine_store` on:

- every signed-in Cloud request, in `api_cloud`'s account middleware (`cloud_gate.answers`);
- a job run by `WorkerRunner` whose store can decide a workspace's flags
  (`JobStore.flag_answers`, from `CloudJobFlags.answers`), as the devstack worker's does.

Not bound: the Cloud fleet's workers, which reach the store through the worker gateway; they would
need the gateway to send the workspace's answers with the claim. Desktop binds nothing, so it
reads its process flags as before.

## Moving a slice

1. Find every reader and writer of the table (`grep` the table name in `src/` and `tests/`).
2. Declare the table in `engine_store/schema.py` with `workspace_id`, matching the existing
   columns' meaning exactly.
3. Add a library migration on top of the chain that adopts the table in place (add columns, never
   rewrite rows), safe to meet a half-done earlier state, and a shared-chain migration that creates
   it for Cloud with the fail-closed policy.
4. Write the slice module against `EngineStore` only.
5. Behind `core.engine_store`, point each reader and writer at it; leave the old path exactly as it
   was for the flag off.
6. Tests: flag off leaves the file byte-identical; flag on keeps every old row; running twice
   changes nothing; backup and restore round-trip; PostgreSQL isolation for the new table.

## The song read side

`engine_store/songs.py`: `load_song(store, artifacts, song_id, legacy=...)` and
`load_features(...)` return the same `SongInfo` and arrays as `analysis.song.load_song` and
`analysis.pipeline.load_features`, which delegate to them with the flag on (both build the
`SongInfo` with `analysis.song.build_song`).

Tables (`lib0003songs` on Desktop, `es0479song01` in Cloud):

| Table | Desktop | Cloud |
|---|---|---|
| `analysis`, `song_overrides` | hand-made, adopted in place | created, fail closed, keyed to `local_songs` |
| `songs` | hand-made, adopted, plus nullable `content_hash` | not created: the catalogue's `local_songs` |
| `lyrics` | hand-made, adopted | not created: `local_song_lyrics` |

`songs` and `lyrics` are declared on `schema.library_metadata`, so no Cloud check sees them.
`store.library` (set by `library.store_for`) says which identity a store reads. A Cloud song is
its catalogue row, keyed by (workspace, content hash); its id is the facts' `song_id`. It has no
path: a Cloud `SongInfo.path` is empty, and no path, folder or file handle reaches the server.

Features are reached through the `ArtifactStore` port by
`features_key(workspace, content_hash, analysis.version)`: a derived key of kind `features`,
one slot (`current`), file `features.npz`. On Desktop the store is `library.artifacts_for` (the
home's `artifacts/` folder). A Desktop song without a hash or artifact is read from
`features/{song_id}.npz`, which is never deleted.

The content hash is the SHA-256 of the file's bytes, as Cloud's catalogue keys a song. With the
flag on, analysis hashes the file before decoding it, publishes the features under that key as
well as the old file, and records the hash with the analysis. `engine_store.song_hashes` fills
the hash for songs analysed before: one gentle pass on a daemon thread from `api.create_app`
(flag on, Desktop app only), a few songs per batch, each hash its own write, and only where the
row still has the file's size and time and no hash. It never analyses and never touches another
column. `db.upsert_song` clears a hash when its file's size or time changes, whenever the column
exists, so a hash never outlives its bytes. The job skips a file the system marks as not on this
computer (a cloud placeholder that reading would download) and any file it can't read, leaving it
for a later pass.

Song identity by audio (`library.audio_identity`, docs/engineering/audio-identity.md): the file
hash changes with every tag edit, so a song also gets an audio id, a hash of its audio alone
(`songs.audio_id`, `lib0004audioid`; `local_songs.audio_id` in Cloud). The job and analysis fill
it in the same read as the file hash, and features of a song that has one are stored and read
first under `audio_features_key`, so a re-tagged file finds them again. In Cloud a new file hash
whose audio id matches exactly one song is recorded as that song's (`local_song_hashes`), never a
new song. Sharing measurements across accounts keeps the file hash.

Reads and writes on the old connection: the store reads the last commit through its own
connection. `analysis.song.load_song` reads through the caller's own connection when that
connection has writes pending (`conn.in_transaction`), exactly as before, so a caller that writes
then reads in one transaction still sees its writes.

These writers still use the raw library connection (to-do item "Song facts writers on Desktop
still use the raw library connection"): `db.save_analysis`, `db.save_lyrics`, `db.upsert_song`,
the correction route and the scan. Safe: same file, and each commits before a store read can see
it. In Cloud a device saves a song's facts through `engine_store.facts_store.save`, with their
provenance (`analysis.implementation`, `analysis.source`), and `load_songs` reads many songs in
one transaction (docs/engineering/cloud-planning.md).

## Slices moved, and what is still on raw `sqlite3`

Moved (each with its own page): ratings and song facts (above); seams, Phase 7 step 1
([engine-store-seams.md](engine-store-seams.md)); mixes, steps 2 and 3
([engine-store-mixes.md](engine-store-mixes.md)); requests, step 3
([engine-store-requests.md](engine-store-requests.md)); discovery with its links (`seam_book`) and
the listening study, step 4 ([engine-store-discovery.md](engine-store-discovery.md)). Each keeps
its old path, statement for statement, for the flag off; these calls are that path, not work
left: `requests.py` (its `_sqlite_` bodies, 28), `mix_backend.SqliteMixes` (25), `listening.py`
(16), `discovery/sweep.py` (5), `routes/discover.py` (3 of 4), `discovery/search.py` (1 of 2),
`library/relink.py`'s discoveries count (1), `eval/ratings.py` (2).

Still on the library's raw connection on 2026-11-26, the remaining work of Phase 7. Counts are
`.execute`/`.executemany` lines in modules that import `sqlite3`, plus Desktop routes handed the
library connection; Cloud modules' SQLAlchemy calls are not counted.

| Area | Modules (calls) |
|---|---|
| Hand-made schema and start-up steps (including `_legacy_kinds_renamed`, kept on purpose) | `db.py` (26), `local_upgrade.py` (4) |
| Library scan, search and files | `library/scan.py` (16), `library/relink.py` (7), `library/search_cache.py` (4), `routes/library.py` (23), `cache_care.py` (12) |
| Reading songs and lyrics for discovery | `discovery/search.lyric_links` (1), `routes/discover.py`'s `/api/links` names (1) |
| Reading rated seams across data folders | `eval/feedback.py` (1, read-only) |
| Lucy's tables on the Desktop | `lucy/conversations.py` (31), `lucy/memory.py` (17), `lucy/commit.py` (15), `lucy/proposals.py` (12), `lucy/permissions.py` (7), `lucy/events.py` (6), `lucy/schema.py`, `lucy/readiness.py` (2 each), `lucy/context.py`, `lucy/catalog.py` (1 each), `routes/lucy.py` (12), `lucy/agent.py` (10) |
| Mix and request routes' own reads | `routes/helpers.py` (5), `routes/mixes.py` (2), `routes/edit.py` (3), `routes/system.py` (4), `session.py` (1) |
| Analysis, planning and workers reading songs | `analysis/pipeline.py` (3), `analysis/song.py` (3), `eta.py` (3), `planner/wordreel.py` (2), `planner/ready.py`, `planner/reel.py`, `planner/gridcheck.py`, `stems.py`, `lyrics/lrclib.py`, `workers/local_seams.py`, `workers/local_analysis.py`, `api.py` (1 each) |
| Whole-file tools (work on files, not a workspace) | `homes.py` (14), `recovery.py` (9), `backup.py` (8) |
| Development only | `devstack/identity_store.py` (31) |

`preferences` beyond the mix's own keys is read on the old path too.
