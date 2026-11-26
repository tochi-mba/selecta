# The discovery slice, and the listening study

ADR-0479, Phase 7 step 4. Discovery's links (`seam_book`) and the pairs its exhaustive sweep has
compared (`discovery_comparisons`) move onto the engine store together, on the Desktop (SQLite,
behind `core.engine_store`, off by default) and in Cloud (PostgreSQL, behind `cloud.brain` and the
Desktop owner `discover.harmonic`). The listening study moves on the Desktop only. Code:
`engine_store/discovery.py` and `engine_store/listening.py` (the store side),
`discovery/search.py`, `discovery/sweep.py` and `listening.py` (every rule, and the old path),
`cloud_brain/discovery_routes.py`. Migrations: `lib0009discovery`, `lib0010listening` (library
chain), `es0479disc01` (shared chain). The store's own rules are in [engine-store.md](engine-store.md).

## The tables

| Table | One row is | Desktop | Cloud |
|---|---|---|---|
| `seam_book` | a link between two songs: a word link, an ordered harmonic sequence or a tonal cousin, with its JSON payload, score and status (new, approved, rejected) | hand-made, adopted in place by `lib0009discovery`; UNIQUE(song_a, song_b, kind, payload) stays | created; unique per (workspace, pair, kind, payload); both songs keyed to the workspace's `local_songs` |
| `discovery_comparisons` | a pair the sweep compared, with both songs' fingerprints then | made by `lib0009discovery` with the sweep's own statement when missing, adopted; (song_a, song_b) stays the key | created; keyed (workspace, song_a, song_b) |
| `listening_trials`, `listening_methods`, `listening_responses`, `listening_quality` | the blind study's trials, private labels, answers and 1 to 5 grades | made by `lib0010listening` (it was `listening.initialise`'s DDL), adopted | none: the study is the owner's own tool |

Adopting adds `workspace_id` (default `local`) and its index; no row is copied and no value in a
row changes. `lib0010listening` adds two nullable columns: `listening_trials.ordinal`, filled once
from `rowid` (the old path lists a study's trials in `rowid` order, which the store never names),
and `listening_methods.seam_key`. The old path's positional inserts (`VALUES(?,?,?)` into
`listening_methods`, `listening_trials`, `listening_quality`, `discovery_comparisons`) now name
their columns, so they still work on an adopted table; on a file never adopted they write exactly
what they wrote before.

## Links and their compared mark, one write

Before, the sweep wrote a pair's links (`audio_search` on its own connection) and its compared
mark in one uncommitted transaction, holding the library's write lock while it compared. Moving
either table alone would have split that transaction (to-do T-20261126-bf59).

Now `discovery/search.audio_links` is the search with no database at all: it hands each link it
finds to a callback. Through the store:

- The sweep compares one pair in memory, then `engine_store.discovery.record_pair` writes that
  pair's links (a look then an insert for each, as `INSERT OR IGNORE` did) and its mark (an update,
  else an insert) in one `store.write()`. The write lock is held for a handful of statements,
  never for the comparison; a stop loses at most the pair in hand; a pair can never hold links
  without its mark or a mark without its links. `tests/test_engine_store_discovery.py` stops a
  sweep midway and also cuts one off inside the write, between the links and the mark.
- A search outside the sweep (`selecta discover`, the lyric search) saves its links
  `discovery.BATCH` (50) per write, so a page reading through `store.read()` never waits.

`search.store_of(conn)` picks the path: the store with the flag on, the file past
`lib0009discovery`, and `conn` holding no pending writes; else the old statements, unchanged.
Discover's list, its hear and review routes, and the relink preview's count read through it too.

`db._legacy_kinds_renamed` stays where it is, on the old connection: it runs in `db.connect`
before the stamp on every open, it rewrites only rows whose kind is still `same_melody` or
`harmonic_cousin` (so a second run changes nothing), and it updates by id, which an adopted table
keeps. A test renames a legacy row on an adopted table.

Requests read no discovery table: a request's bridges are `request_routes`, and bridge search
reads songs' arrays (engine-store-requests.md). Nothing about requests moved here.

## Cloud

Discovery needs only stored song facts: the sweep compares per-bar chroma and bar times, and the
fingerprint is built from them, the artist and the duration. `load_songs` gives all of these from
the arrays a device saved. So a Cloud account runs the Desktop's own sweep over the store:

| Method and path | Does |
|---|---|
| `POST /api/discoveries/sweep` | `{song_ids (2 to 40), pair_limit (1 to 200)}`: compare the pairs among those songs not yet compared with the same facts; answers the sweep's `checked`, `cached`, `remaining`, `added`, plus `unmeasured` |
| `GET /api/discoveries?limit=` | the harmonic links, waiting ones spread out first, in Desktop's shape |
| `POST /api/discoveries/{discovery_id}/review` | approved, rejected or new |

Bounded: at most 40 songs loaded and 200 new pairs a call (a pair takes milliseconds), so a long
search is many short calls, each resuming where the last stopped. The routes are plain functions,
so FastAPI runs them off the event loop; the sweep has its own rate limit (`discovery_sweep`, 6 a
minute), a review shares `mix_edits`. Bodies forbid unknown fields; an id in a path is read after
the workspace check; a song of another workspace is simply unmeasured. The account export
carries both tables; account deletion removes their rows with the workspace's id.

Not in Cloud: hearing a discovery (`/hear`) renders a four-step audition from the audio files,
which the server never holds, and the browser does not call the sweep in its spare time.
Both are to-do T-20261126-9a31. Word links in Cloud stay `GET /api/local-media/links`, from the
catalogue's lyrics, which write nothing.

## The listening study

`listening.py` keeps every rule; with the flag on every read and write goes through
`engine_store.listening`: trials made in one write, numbered after the last; an answer and its
grades in one write (replacing that listener's earlier ones); the study summary read at one
moment. `routes/discover.listening_audio` reads a trial's mapping through `trial_mapping`.

Grades and seams: a condition is a rendered seam when it is a `seams.key` itself (a trial made
from the seam cache), or when its manifest names one (`"seam_key"` on a condition, kept in
`listening_methods.seam_key`). `seam_grades` returns each such 1 to 5 grade with its key, which
joins `seams.pair`; `selecta calibrate` counts them beside the Good and Bad clicks (and its JSON
lists them). The gates are still fitted on clicks only. `selecta move-trial` renders in memory
rather than through the seam store, so its conditions name no seam.

## Tests

`tests/test_engine_store_discovery.py` and `tests/test_engine_store_listening.py` build a library
with today's old path (links of every kind, legacy kinds included, compared pairs; trials,
labels, answers and grades), run every operation through the store and through the old path on a
copy, and compare every answer and row (answer times excluded: SQLite's clock against the
store's, both written as `YYYY-MM-DD HH:MM:SS`). They also prove flag off leaves the schema
unchanged, the migrations keep every row and the trial order, and backup and restore carry the
tables. `tests/test_cloud_brain_discovery.py` runs the Cloud routes;
`tests/test_engine_store_discovery_postgres.py` holds the policy and keys on PostgreSQL (CI only).
