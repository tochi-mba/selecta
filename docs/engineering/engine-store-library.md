# The library slice

ADR-0479, Phase 7 step 5. The code that scans music folders, writes and updates song rows,
relinks a moved folder, serves the Library routes and looks after caches, and the single library
reads scattered through routes, analysis, planning and the command line, move onto the engine
store on the Desktop (SQLite, behind `core.engine_store`, off by default). With the flag off every
statement is the one it was. Code: `engine_store/library_writes.py` (the song writes, Core),
`engine_store/library_reads.py` (small named reads, Core), `engine_store/library_rows.py` (the
library's own statements on a store connection). The store's rules are in
[engine-store.md](engine-store.md).

## Tables

No migration: every table this slice touches was already adopted (`songs`, `analysis`, `lyrics`,
`song_overrides` by `lib0003songs`, `songs.audio_id` by `lib0004audioid`, `preferences`, `queue`,
`playback_skips` and `drafts` by `lib0007mixes`). The library chain's head is still
`lib0010listening` (one head). `schema.songs` and `schema.lyrics` now declare every hand-made
column, so the scanner can write a whole row; they stay on `library_metadata`, so Cloud sees
neither. The search cache (`library/search_cache.py`) keeps its rankings in memory and its hits
in a per-connection `temp` table; cache care owns files, not tables.

## Which path

`library_rows.store_path(conn)` decides, once per unit of work: the store when the flag is on,
the file is past `lib0007mixes` (`library.includes`), and `conn` holds no writes of its own (a
store read would not see them and a store write would wait behind them). Otherwise `conn`, as
before. `reading(conn)` and `writing(conn)` give a `Rows`, a store connection that answers like
the library's `sqlite3` connection (rows by name and place, `rowcount`, `lastrowid`, and the
`sqlite3` errors themselves, so a watcher that catches `sqlite3.Error` keeps watching). Its
`commit()` and `rollback()` do nothing: the block is the transaction.

- Long SQLite-only reads over Desktop-only tables (the Library page and its search, the relink
  preview, the planner's library list, estimates) keep their statements and run on `reading()`.
- A route's read-modify-write is one `writing()` block or one `library_writes` call: priority,
  never play, a Library batch (the store begins it immediate), a correction, remembering a
  folder, a relink commit (re-checked inside the write, as before).
- A module that reads one value calls a named read (`library_reads`: song fields, counts,
  music ids, analysis errors, failed songs, priority files, analysed ids).
- `db`'s helpers dispatch themselves: `preference`, `set_preference`, `save_analysis`,
  `save_lyrics` go through `library_writes`; `known_files`, `song_by_id`, `is_analysed`,
  `songs_needing_analysis` read through `reading()`. `upsert_song` stays the old path's.

## The scan

`scan._scan` reads first, writes last, as before; with the store:

- Unchanged files are listed during the read and their rows read together after it, in one read
  (not a read per file).
- Rows are written `SCAN_BATCH` (50) per store write (`save_scanned`); checkpoint batches too
  (`upsert_songs`). Fifty upserts take a few milliseconds, so a page reading through
  `store.read()` never waits on a scan; a stop or crash loses at most the batch in hand, and the
  next scan finds the saved files unchanged and carries on. Never one transaction for a scan.
- An unchanged file keeps its row's priority and hashes (other writers own them), and a person's
  music choice is read inside the write that saves the row, so one made during the scan is kept.
  An unchanged file whose row would be written back exactly as it is is skipped.
- The upsert is `db.upsert_song`'s rule in Core: a file whose size or time changed loses
  `content_hash` and `audio_id`; the hash job or the next analysis fills them again.
- Removals are 50 per write, each as `_forget_song`: the song leaves the current mix and the gap
  closes, its skips go, and a song something still points at (a rating) is kept, set aside as
  gone (a savepoint undoes only its own removal). Duplicate marks are cleared and set in one
  write, so a page never sees them half done.

## Analysis, hash and features together

`analysis.pipeline` hashes the file before decoding it, writes the features file, publishes it
under its content (or audio) key, and only then calls `_save`: with the store,
`library_writes.save_analysis` writes the song's `content_hash`, `audio_id` and the analysis row
in ONE write, so the row naming the version and the hashes that key its features land together
or not at all. Before, the hashes were updated on the caller's connection and committed by
`save_analysis`; the old path still does exactly that.

## Speed

T-20261125-ecd7: with NullPool every store read opened the file, which on Windows cost
milliseconds, paid per song. Now the library engine keeps up to four idle connections (a nested
read takes another, never the one in use); one `EngineStore` per file is made once; a plan's
changed songs are read in one transaction (`planner.reel._load_together`, `songs.load_songs`);
the scan's upsert is built once per shape of row. `backup.activate_pending_restore` calls
`library.forget` first, which closes them, so the file can be replaced (a test proves Windows
refuses otherwise). A raw copy of the file must call `forget` too, or recent commits stay in the
write-ahead log beside it; the app copies with SQLite's backup API, which includes them.

Synthetic data, flag off against on (best of three, this laptop): a 500-song plan load 1.48 s
and 1.40 s; a first scan of 1,000 files 3.15 s and 1.73 s (the off run reads the files cold); an
unchanged rescan 0.46 s and 0.32 s; 200 `song_by_id` calls 0.008 s and 0.14 s (each decides its
path and takes a pooled connection: under a millisecond, and nothing calls it in a long loop).

## Cloud

No Cloud scanner and no Cloud scan tables: a Cloud song arrives through the catalogue's own
registration (`local_media`). The shared shell's Library calls in Cloud
(`web/src/cloud/localFirstRequest.ts`) cover `GET /api/library`, `GET /api/status`, a tempo and
key correction, never play and the never/allow batch. These Library routes have no Cloud
equivalent (to-do T-20261126-ed4c): `GET /api/songs`, `GET /api/songs/{id}` (details: peaks,
bars, sections, lines), `/api/songs/{id}/audio` and `/art`, `POST /api/songs/{id}/analyse`,
`POST /api/songs/{id}/priority` and the priority batches, a correction's set-aside
(`is_music`), `/api/library/interrupted`, `/api/library/lyrics/again`, `/api/library/check`,
`/api/analysis/start` and `/stop`, `/api/scan` and `/api/scan/cancel` (by design), and the
folder routes in `routes/system.py` (`/api/folders`, relink, check, stop watching).

## Tests

`tests/test_engine_store_library_writes.py`: flag off leaves the schema unchanged; a scan of a
synthetic folder (added, changed, re-tagged with the same audio, removed, moved files) gives the
same rows through the store as the old path on a copy, with and without checkpoints; a scan
stopped midway, and one cut off inside a write, keeps whole songs and carries on; analysis and
its hashes land together or not at all; song writes, settings, corrections and priority match;
backup and restore carry the rows, and a restore closes the pool first.
`tests/test_engine_store_library_routes.py`: every Library call made with the flag on and off
answers alike and leaves the same rows, through a store connection; the named reads and a
relink match.
