# The requests slice

ADR-0479, Phase 7 step 3. Song requests, the bridges agreed to and the marks a request leaves on
the mix move onto the engine store, on the Desktop (SQLite, behind `core.engine_store`, off by
default) and in Cloud (PostgreSQL, behind `cloud.brain` and `cloud.account_mixes`, off). Code:
`engine_store/requests.py` (the store side), `requests.py` (every rule, and the old path),
`cloud_brain/requests_routes.py`, `cloud_brain/request_planning.py`,
`web/src/cloud/accountRequests.ts`. Migrations: `lib0008requests` (library chain),
`es0479req01` (shared chain). The store's own rules are in [engine-store.md](engine-store.md);
the mixes slice, which this one edits, is [engine-store-mixes.md](engine-store-mixes.md).

## The tables

| Table | One row is | Desktop | Cloud |
|---|---|---|---|
| `song_requests` | a song asked for: waiting, scheduled or cancelled | made by `lib0008requests` (it was `requests.initialise`'s DDL), adopted | created; song keyed to `local_songs`; one waiting per (workspace, song) |
| `request_bridge_approvals` | yes or no to an extra song, per request | adopted | created; keyed to the workspace's request |
| `request_routes` | the exact songs agreed to, JSON in playing order | adopted | created; keyed to the workspace's request |
| `request_marks` | a song of the current mix a request put there (`requested`, or `bridge` with `for_song`) | adopted; `song_id` stays the key | created; keyed (workspace, song), song keyed to `local_songs` |

Adopting in place adds `workspace_id` (default `local`) and its index; no row is copied or
rewritten and every key stays. A library file holds one workspace, so `request_marks.song_id` and
the partial unique index on waiting songs stay correct there; Cloud's keys include the workspace.
The old path's positional inserts now name their columns, so they still work on an adopted table.

## One operation, one write

Every function in `requests.py` takes the library connection, a `Mixes`, or an `EngineStore`, and
`_opened` picks the path:

- Flag off (or the file not past `lib0008requests`): the `_sqlite_` bodies, the very statements
  and commits as before.
- Flag on: one `StoreRequests` transaction through `library.store_of(conn)`, SQLAlchemy Core only
  (a replace is a delete and an insert; `INSERT OR IGNORE` is a look then an insert in the same
  write).
- A `StoreMixes` passed in shares its transaction. This is how a request and the mix edit it makes
  are one write: `routes/song_requests.add_request_anyway` holds `mix.editing(conn)` around
  Undo, the song, its seam and `mark_added`; `insert_ready` writes the queue and its Undo through
  `StoreMixes` on the same connection as the request's status and marks.
- A caller with uncommitted writes on its own connection stays on the old path for that call.

`insert_ready`'s checks are one function, `placed`, used by both paths in the same order, so a
refusal reads the same either way. `marks_for` reads, and writes only when a mark must go.

`tests/test_engine_store_requests.py` builds a library with today's code holding requests in every
state (waiting; a bridge agreed with its route; a bridge refused; scheduled with its mark;
cancelled; a bridge mark; a stale mark), runs every operation through the store and through the
old path on a copy, and compares every answer and every row; it also proves flag off leaves the
schema unchanged, a request joining the mix lands whole or not at all, and backup and restore
carry the tables. `tests/test_engine_store_requests_postgres.py` holds the policy and the keys on
PostgreSQL (CI only).

## Cloud routes

Each keeps its Desktop flag as owner (`requests`, `requests.bridges`) and also needs `cloud.brain`
and `cloud.account_mixes`: requests edit the account's mix. Shapes are Desktop's. Bodies forbid
unknown fields; an account keeps at most 200 waiting requests; a request id in a path is read
after the workspace check; `consider` and `insert` share the `planning` rate limit, the rest
`mix_edits`; the account export carries the four tables; account deletion removes their rows.

| Method and path | Does |
|---|---|
| `GET /api/requests` | the waiting requests, with `never`, `bridge_choice`, `picked` |
| `POST /api/requests`, `DELETE /api/requests/{request_id}` | ask (a catalogue song of this workspace), cancel |
| `POST /api/requests/{request_id}/bridge` | yes or no to an extra song, held to the songs named |
| `POST /api/requests/{request_id}/add` | put it in now, as Desktop places it: one write with Undo |
| `POST /api/requests/consider?device_id=` | settle what is in the mix, plan the rest from song facts |
| `POST /api/requests/insert?device_id=` | put a ready placement in, against the exact mix |

Searching every song for a bridge (`POST /api/requests/{request_id}/bridges`) is
`cloud_brain/bridge_routes.py`: the Desktop's `request_planner.bridge_options` over the account's
measured songs, at most 250 a search (those nearest the request's tempo when there are more, said
as `capped`), arrays read 100 at a time, 6 searches a minute; a browser names the songs that play
on it. Hearing a handover ahead (`/hear`) stays Desktop's: it renders on the server, and in Cloud
the device makes a bridge's transitions once it is chosen.

## What "ready" means in Cloud

On the Desktop a request becomes insertable only when every handover its placement needs is
rendered and has passed its audit by the Desktop's own render worker (`request_audio_ready`); the
look submits those renders. In Cloud nothing renders on the server, and a clip may only be played
by the device that made it (`playable_here`). So:

1. `consider` plans with the same planner (`request_planner.proposals`) over the stored facts of
   the mix's next 40 songs and the requested songs (`request_planning.WINDOW`), with nothing
   rendered (every seam state `none`) and the workspace's seam memory.
2. Each placement lists `seams_needed` (pair and the planner's settings) and `transitions`.
3. The device that will play the mix renders those seams and reports them (`PUT /api/seams/{key}`).
4. A placement is `ready` for a device when that device holds a passing or nearly passing seam
   for every pair (`request_planning.ready_pairs`, from its attestations). Another device must make
   its own.
5. `insert` makes the same look again: the offer must still name the same placement against the
   same mix (a hash of the mix, the request and the plan, since Cloud keeps no offers in memory).

The browser does this (web/src/cloud/accountPlacements.ts, T-20261126-a246): with
`cloud.device_render` too, its request look is the account's, with this device's id; the device
studio makes each `seams_needed` pair after the mix's own (`DeviceStudio.prepareFor`, the songs
decoded by id through the playing context) and reports it; a ready placement joins through
`insert`, and Add next still works. Worker-rendered seams for uploaded music count only when the
hosted session's studio id is the one asked about.

## The browser

`accountRequests.ts`: with `flagListed('cloud.brain')` and `flagListed('cloud.account_mixes')`,
the member's own requests are asked for (`POST /requests`), listed (`GET /requests`) and let go
(`DELETE /requests/{id}`) on the account, so they wait on every device. Rows keep this browser's
numbering beside the room's (`saved.account`). Add next still goes in right after the playing
song through the mix routes (the account's, with the same flags), then the request is let go: the
row's own words promise that place, which `/add`'s Desktop place (one later) would break. Any
failure keeps the request in this browser as before. Sent: a catalogue song id and a request id,
never audio, a path or a name (`deviceToAccount.egress.test.ts`).

## Discovery's links (`seam_book`)

`seam_book` holds discovery's links, not a request's bridge, and no request code reads it. It
moved with the discovery slice, together with `discovery_comparisons`, so a compared pair's
links and its mark are one store write ([engine-store-discovery.md](engine-store-discovery.md)).
