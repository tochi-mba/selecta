# The seams slice

ADR-0479, Phase 7 step 1. Each rendered transition's record, who rendered its clip, its history
and the listener's Good and Bad move from files and process memory into the engine store, on the
Desktop (SQLite, behind `core.engine_store`, off by default) and in Cloud (PostgreSQL, behind
`cloud.brain`). Code: `engine_store/seams.py` (the slice), `engine_store/seam_import.py` (the
file import), `seam_mirror.py` (Desktop's second writer), `cloud_brain/seams_routes.py`,
`engine_store/hosted_seams.py`. Migrations: `lib0006seams` (library chain), `es0479seam01`
(shared chain). The rules of the store itself are in [engine-store.md](engine-store.md).

## The tables

Every table has `workspace_id`; Cloud's have the fail-closed `workspace_isolation` policy and
workspace-scoped foreign keys to `local_songs` (Desktop's are created without them).

| Table | One row is | Written |
|---|---|---|
| `seams` | a seam's current record, keyed by (workspace, key) | replaced when the record changes |
| `seam_attestations` | a studio that rendered the seam's clip (one per studio and seam) | upserted |
| `seam_history` | one version of a record, as a `seam-history` file held it | append-only |
| `seam_verdicts` | one Good, Bad or cleared click, with who and when | append-only |

`ratings` (the 1 to 5 grades) gains `seam_key`, nullable, so a grade given to a rendered seam can
be joined to that seam's facts; `eval.ratings.save_rating(..., seam_key=)` fills it with the flag
on. Nothing that gives grades knows a seam key yet (to-do T-20261126-5a66).

## Field by field

`seams.record` is the record exactly as `seam.json` holds it (`json.dumps` of the same dict), so
nothing is lost in translation and every reader gets back the dict it read from the file. The
named columns are copies, written from the record in one place (`seams.row_of`):

| `seam.json` field | Column | Notes |
|---|---|---|
| `key` (else the file's name) | `key` | |
| `request.a`, `request.b` | `song_a`, `song_b` | 0 when an older record has no request |
| `request.move` | `asked` | the whole `request` stays in `record` |
| `status` | `status` | `ready` or `failed`; `queued` and `rendering` are never kept |
| `style` | `style` | the move rendered |
| `bars`, `exit_bar`, `entry_bar` | same names | the cue bars |
| `a_source_start`, `b_source_end`, `duration` | same names | seconds |
| `rules` | `rules` | `RULES_VERSION` |
| (Cloud: the planner's answer) | `fingerprint` | null on Desktop |
| `passed`, `near_miss`, `fell_back` | same names | |
| `pair` | `pair` | JSON |
| `checks` | `checks` | JSON: the audit report as the record says it |
| `error` | `error` | why it failed |
| `rating`, `rated_at`, `note` | same names | the verdict on this version |
| `label`, `why`, `tried`, `placed_bars`, `shape_used`, `arc`, `switch_at`, `preview_seam`, `untimed_song`, studio-session fields | in `record` only | |
| (who wrote it) | `source` | `desktop`, `device` or `worker` |

`seam_history` keeps `key`, the songs, `status`, `rating` and the whole `record` with its hash.
`seam_verdicts` keeps `verdict` (`good`, `bad`, `none`), `note`, `rated_at` (seconds since 1970,
as the record has it) and `rated_by` (`local` on Desktop, the member's user id in Cloud).
`seam_attestations` keeps `studio`, `studio_id` (`desktop`, a worker's id, a playback device's
id), `implementation` (`python-render-2`, `web-render-1+wsola-stretch-v1`), `clip_sha256`,
`clip_seconds` and when.

## What "ready" means now

A seam is ready for a reader when a ready `seams` row has an attestation from a studio that
reader can play from. The clip stays a file (or stays on its device); the database never holds
audio.

- Desktop, flag on: `planner/ready.ready_inventory` takes the seams the `desktop` studio attested
  (`seam_mirror.ready`) and still opens each `clip.flac` in the render folder and checks it
  decodes, as before. A Desktop attestation's hash is the SHA-256 of `clip.flac`.
- Cloud: `GET /api/seams` lists who rendered each seam and `playable_here` only for an
  attestation by the asking device. A device clip may be played only by the device that made it:
  the server never has its audio, and another device renders its own and adds its own
  attestation to the same key.

## The import and the two writers

While the owner proves the flag on a copy of their library, the files stay the truth.

- **Live writes.** `SeamStore` writes `seam.json` and `seam-history/{key}.json` exactly as
  before; only then `_remember` hands the same record to `seam_mirror.kept`, which keeps it in
  the tables (and, for a fresh render, attests the clip). `forget_song` removes the same seams'
  rows (`seam_history` too; the verdict log is kept). A mirror write that fails is logged and
  never stops a render.
- **The import** (`seam_import.import_home`) runs once per start with the flag on, on a daemon
  thread after the library is brought forward, so also after a restore. A key's current record
  is its `seam.json` when finished, else its history file (the order every file reader uses);
  both versions go to `seam_history`, every verdict found to `seam_verdicts`. Unreadable files
  are skipped and counted; a seam in flight is counted, not kept. Each key is its own write, so a
  pass cut off part way loses nothing. It never deletes, moves or rewrites a file.
- **Files win.** A record that differs from its row replaces the row. A Desktop row whose key has
  no file left is dropped from `seams` (history and verdicts stay), only when both folders were
  listed and the row is older than the pass.
- **Turning the flag off** loses nothing: every record was written to its files first, and the
  tables are not read. Turning it on again re-runs the import, which brings the tables in step.

`tests/test_engine_store_seams.py` proves this on a synthetic home of 37 records (older shapes, a
corrupt file, a half-written folder, one rendering): nothing lost, every verdict kept, the folder
hashed the same before and after, and a second run changes nothing.

## What stays in memory

In-flight state is the worker's: `SeamStore._states` (queued asks), the worker pipe, and with
`core.durable_local_jobs` the durable job store's jobs and leases (`LiveSeams`). None of it is
copied into the tables. `work.sqlite` is never backed up: it holds jobs and leases, not results.

## Cloud routes

| Route | Flag | Does |
|---|---|---|
| `PUT /api/seams/{key}` | `cloud.brain` | a device reports a clip it made: pair, option, move, audit, implementation, clip length and hash. 64 kB cap, path words refused, the key must be `device_seam_key(a, b, fingerprint, option)`, songs and device must be the workspace's. The first report makes the record; later ones only attest |
| `GET /api/seams?a=&b=` or `?keys=` | `cloud.brain` | the seams known, who rendered each, `playable_here` for `device_id` |
| `POST /api/seams/{key}/rate` | `ratings`, and `cloud.brain` | Good, Bad or cleared, into the record and the verdict log |
| `GET /api/memory/ratings` | `learning.memory`, and `cloud.brain` | Desktop's shape (`eval.feedback.rated_from`) |

`POST /api/planning/order` now builds `SeamMemory` from the workspace's seams. The browser reports
each clip its studio accepts (`web/src/cloud/seamReports.ts`, behind `cloud.device_render` and
`cloud.brain`), once per key, in the background. The account export carries all four tables;
account deletion removes them with every workspace row.

## Still on the old path

- `SeamStore.status`, the clip and preview routes and `discover` read `seam.json`.
- `GET /api/memory/ratings` on Desktop and `selecta ratings` read the files of every home.
- The hosted renderer's seams: `hosted_seams.record_worker_seam` is written and tested, not yet
  called (to-do "Hosted seams should also be kept in the seam tables").
