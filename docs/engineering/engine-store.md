# The engine store

ADR-0479 ("One storage layer for Desktop and Cloud") moves the engine's relational state off raw
`sqlite3` calls onto one layer that Desktop runs on SQLite and Cloud runs on PostgreSQL. This page
says what that layer is, the rules it keeps, and how a slice of state moves onto it. The code is
`src/selecta/engine_store/`; the flag is `core.engine_store` (off by default, both modes).

## What it is

`EngineStore(engine, workspace_id)` is the only door to an engine table. A slice (ratings first)
is a module such as `engine_store/ratings.py` whose functions take a store and nothing else.

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
(`es0479rate01`):

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
start, behind the usual upgrade backup. `work.sqlite` is not backed up yet; see the to-do item
"work.sqlite in backups".

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

## Not moved yet

- Every other hand-made table: `songs`, `analysis`, `lyrics`, `song_overrides`, `preferences`,
  `seam_book`, `drafts`, `queue`.
- A seam's Good and Bad (`POST /api/seams/{key}/rate`, `GET /api/memory/ratings`). They live in
  the seam's record files, not in `ratings`, and move with the seams slice; Cloud has no keyed
  seam records to rate yet, so neither route is mounted in Cloud.
- Whole-file tools that copy rows between library files (`homes.py`, `recovery.py`) and the
  backup's own read-only checks keep using `sqlite3`: they work on files, not on a workspace.
