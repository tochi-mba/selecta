# The mixes slice

ADR-0479, Phase 7 steps 2 and 3. The current mix, the drafts and the mix's own named values move
onto the engine store, on the Desktop (SQLite, behind `core.engine_store`, off by default) and in
Cloud (PostgreSQL, behind `cloud.brain` and `cloud.account_mixes`, on for accounts with the cloud
library). Code:
`engine_store/mixes.py` (the store side), `mix_backend.py` (the old path and the choice between
them), `mix.py` (every rule, unchanged), `cloud_brain/mixes_routes.py`,
`engine_store/mix_import.py`, `web/src/cloud/accountMixes.ts`. Migrations: `lib0007mixes` and
`lib0008requests` (library chain), `es0479mix01` (shared chain). The store's own rules are in
[engine-store.md](engine-store.md).

## The tables

| Table | One row is | Desktop | Cloud |
|---|---|---|---|
| `queue` | one song of the current mix | hand-made, adopted in place | created, keyed (workspace, position), song keyed to `local_songs` |
| `drafts` | one draft, its songs and Undo in JSON | hand-made, adopted | created |
| `preferences` | a named JSON value | hand-made, adopted; the store touches only the mix's keys | created; only the mix's keys |
| `mix_imports` | one recipe or Cloud mix already brought in | not created | created |
| `playback_skips` | a skip and how far in | made by `lib0007mixes` (its route made it on the fly) | not created |
| `song_requests`, `request_bridge_approvals`, `request_marks`, `request_routes` | requests and their bridges | made by `lib0008requests`, adopted | created by `es0479req01` ([engine-store-requests.md](engine-store-requests.md)) |

Adopting in place adds `workspace_id` (default `local`) and its index; no row is copied or
rewritten and every key stays. `queue.position` and `preferences.key` stay the Desktop keys: a
library file holds one workspace, so they stay unique there. Cloud's tables key on the workspace
too, and every query filters with `store.mine(table)`.

Column mapping, all kept with the meaning `mix.py` gives them:

- `queue`: `position` (0 first), `song_id`, `seam` (JSON settings of the seam into this song, or
  null), `locked` (1 keeps the song at its place), and `state`, `transition`, `reason` as the
  command line's planner writes them.
- `drafts`: `id`, `name`, `items` (JSON list of `[song, seam JSON or null, locked]`), `history`
  (up to `mix.UNDO_DEPTH` earlier versions), `ready_only`, `line` (render line place or null),
  `created_at`, `updated_at` (UTC `YYYY-MM-DD HH:MM:SS`, as SQLite's CURRENT_TIMESTAMP).
- `preferences` (`mixes.MIX_KEYS`): `mix_name`, `mix_undo` (the current mix's Undo),
  `deleted_drafts` and `last_deleted_draft` (what Undo of a delete brings back).

A draft's songs live inside `items`, so Cloud checks them against the workspace's catalogue on
every write (`mixes_routes._ours`); the current mix's songs are a foreign key.

## One edit, one write

`mix.py` reads and writes only through a `Mixes`. Each public function is decorated: `_writes`
opens one store write transaction, `_reads` one deferred read, and a `Mixes` passed in goes
straight through, so an operation made of others (playing a draft makes a draft, writes the
queue and remembers Undo) stays one transaction. `mix.editing(conn)` holds one write for several
calls; the Desktop routes use it to remember a mix for Undo and change it together, which on the
old path is the same statements on the same connection.

- Flag off: `SqliteMixes`, the very statements and commits `mix.py` ran before.
- Flag on: `StoreMixes` over `library.store_of(conn)`, SQLAlchemy Core only (no `INSERT OR
  REPLACE`, `lastrowid`, PRAGMA or `json_array_length`; a put-back deletes and inserts).
- A caller with uncommitted writes on its own connection (`conn.in_transaction`) stays on the old
  path for that call: a store read would not see its writes and a store write would wait behind
  its lock. `lucy.commit` and the scan's queue renumbering write the same tables raw and commit;
  they are on the same file, so the store reads their commits. `requests.insert_ready` writes
  the queue through `StoreMixes` in its own store write with the flag on.
- `settle_chain` reads, and writes only a seam that must change, each as its own write, as before.

`tests/test_engine_store_mixes.py` runs every operation on a synthetic library (a current mix, a
draft from the legacy saved-mix step, an empty draft, a draft whose song was deleted) through the
store and through the old path on a copy, and compares every answer and every row.

## Runtime DDL removed

- `routes/mixes.py` created `playback_skips` on each skip. With the flag on, `lib0007mixes` made
  it and the route only inserts (`mixes.record_skip`).
- `requests.initialise` created four tables and an index on every call. With the flag on and the
  file's stamp past `lib0008requests` (`library.includes`), it runs no DDL.
- `db.connect`'s `_saved_mixes_become_drafts` and `_legacy_kinds_renamed` stay as they are: they
  run before the stamp, are idempotent, and the upgrade backup covers them.

## Cloud routes

Each keeps its Desktop flag as owner (`drafts`, `editor`, `core.playback`...) and also needs
`cloud.brain` and `cloud.account_mixes` for the account; `PUT /api/mix/order` is owned by
`cloud.account_mixes`. Shapes are Desktop's, without what only Desktop has (an estimate, a render
line place, request marks). A seam's state is `none` with the browser's words: nothing is
rendered ahead on the server.

| Method and path | Does |
|---|---|
| `GET /api/mix?draft=` | the current mix or a draft |
| `GET /api/drafts`, `GET /api/drafts/names` | every draft, Desktop's summary shape |
| `POST /api/drafts`, `/restore`, `/{draft}/name`, `/{draft}/duplicate`, `/{draft}/play`; `DELETE /api/drafts/{draft}` | make, bring back, rename, copy, play, delete |
| `POST /api/mix/songs`, `DELETE /api/mix/songs/{position}`, `POST /api/mix/move`, `POST /api/mix/{position}/seam`, `/lock`, `POST /api/mix/undo`, `POST /api/mix/clear` | the edits, `?draft=` for a draft |
| `PUT /api/mix/order?draft=` | the whole order at once, a seam kept where it still joins the same two songs |

Bodies forbid unknown fields; a mix holds at most 200 songs and an account 500 drafts; `x-mix-order`
is checked inside the write; edits share the `mix_edits` rate limit; the account export carries
the four tables; account deletion removes them with every workspace row.

## The current mix on every device

A route that changes which mix is current sends `mix.current` on the workspace's event stream,
inside its own write (`cloud_brain/mix_current.py`): `PUT /api/mix/order` without `?draft=`,
`POST /api/drafts/{draft}/play`, `POST /api/mix/undo` of the current mix when it undid something,
and `POST /api/mix/clear`. A draft's edits, making, naming, copying, deleting and bringing back a
draft, and edits to the current mix's songs send nothing. The event is the recipe event's topic
marked `account: true`, with `order` (the song ids, as `GET /api/mix` reads them back), `songs`,
`name`, `updated_at` and `updated_by_device_name` (the device named by `?device_id=`, when it is
one of the workspace's signed-in devices); `mix_id` is null and `revision` 0, so an older browser
reads it as no recipe chosen.

The browser (`useAccountMix.tsx`) passes over an event older than one it has heard (the stream
replays its history to a device that has just connected). A device already showing that order
does nothing; another reads `GET /mix` again; a device making the sound keeps playing and shows
"{device} made a new mix" with Play it now. Two devices: the last change stands, and Undo on
either brings the one before back to both.

## Recipes fold in

The first use of these routes in a workspace runs `mix_import.import_recipes`: each recipe's
latest revision becomes a draft (same name, numbered when taken; a chosen move kept as the seam's
`{"move": ...}`), and the current recipe becomes the current mix once, only when it is empty.
`mix_imports` records each, so it runs once per recipe and a deleted draft stays deleted. No
recipe is changed or removed; the recipe API and the browser's own storage stay as they were.

The browser (`accountMixes.ts`) answers the shell's mix and draft calls from these routes only
when `flagListed('cloud.brain')` and `flagListed('cloud.account_mixes')`, so an older server
never switches it on. A new mix from Make a Mix is `PUT /mix/order` (or a new draft and its
order). A song added must still play on this device; one added in a draft's editor goes to that
draft. Offline, a server fault or `flag_off` falls back to the recipe path; any other refusal is
the account's answer.

With it on, My Mixes is the Desktop's: the current mix and the drafts list (`views/Drafts.tsx`),
whose open, play, rename, copy, delete and bring back are the routes above, and playing a draft
offers Undo (`cloud/AccountDrafts.tsx`). `/mixes/drafts/{id}/edit` opens a draft in the editor
through `?draft=`. With it off, My Mixes lists the saved browser mixes and a draft's editor says
it is the app's, as before. A saved browser mix made current (`recipeAsCurrent`) becomes the
account's current mix before `GET /mix` is read, so the mix chosen is the one shown and played.

## What `/cloud-mixes` still does

Uploaded-music mixes stay `mix_revision` artifacts read by the hosted session; nothing changed.
On the first use of the account mix routes, `import_cloud_mixes` brings each one in as a draft,
once, mapping each file to the catalogue song with the same hash and leaving out a file with none;
an account with recipes and Cloud mixes ends with every one of them as a draft and its current
recipe as the current mix (`tests/test_cloud_brain_mix_current.py`). Moving the hosted session
itself onto the account's mixes is to-do T-20261126-1105. Of `cloud_mixes.CAPABILITIES`, this
makes "revisions" (Undo and drafts) the Desktop's model in Cloud too, and "seam_tools" a step
closer (the editor's own routes answer), without changing either row here.

## Who has it

`cloud.account_mixes` is on for every account with the cloud library and off for every other
(owner decision, 2026-11-26). The build ships it on, and it `requires` `cloud.hosted_media` and
`cloud.brain`; a requirement is decided per account (`flags/targeting.py`, the cascade runs on
each account's own decisions, as `cloud.move_to_cloud` needs the grant), so an account without
the grant has it off with `needs:cloud.hosted_media`, and the grant taken away takes account
mixes with it. It can still be switched off: a kill switch or a per-account switch on the flag,
or `-cloud.account_mixes` in `SELECTA_FLAGS`. `tests/test_flag_follows_rule.py` proves each.

## Still on the old path

- Requests moved in their own slice: [engine-store-requests.md](engine-store-requests.md).
  `seam_book` (discovery links) moves with discovery (to-do T-20261126-bf59).
- Other readers of these tables keep raw `sqlite3`: `session.py`, `lucy`, `library/relink.py`,
  `library/scan.py`, `cli.py`, `backup.py`'s checks. They read the same tables on the same file.
