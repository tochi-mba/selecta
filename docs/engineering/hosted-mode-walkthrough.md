# Hosted Cloud mode: walkthrough, comparison with the local app, and the staging runbook

Written 2026-11-25 on branch `hosted/render`. Hosted mode is the `cloud.hosted_media` staff grant (ADR-0455, ADR-0456): songs are uploaded to object storage and workers run the engine. The owner's bar: it should render as well as the **local app**, because the server runs the same engine.

How it was tested: a local Cloud stack (`dev.cmd cloud` with its own ports and data folder: SQLite, disk object store, one dev worker process running every pool), the seeded `dev@selectadj.test` account given the grant the way the console's storage switch does (`admin.account_config._with` and `flag_rules.save`), and 14 full songs copied from `Music\Billboard Year End Charts Hot 100 Songs 2023` (country, pop, R&B, afrobeats, EDM, regional Mexican, K-pop; 65 to 174 BPM). Playwright drove the site at 1440x900 and 390x844. Scripts and screenshots are in the session scratchpad (`walk/`, `shots/`); the paths below name the screenshots.

**Machine load.** The machine was at 100 % CPU from other work for most of the run (8 cores shared with other stacks and test runs), so every time below is an upper bound. The same synthetic 24 s clip took 19 s on a quiet core and 128 s under load.

## 1. Walkthrough: what really happened (before the fixes)

| Stage | What the docs promise | What happened | Evidence | Gap |
|---|---|---|---|---|
| Upload (multipart) | Signed multipart PUT straight to R2, resumable (doc 05) | Works: plan, 1 to 2 parts per song, complete. 14 songs (104 MB) in about 45 s locally | `d-upload-*.png`, network log in `walk/d*.log` | none |
| Probe and validation | The sandbox sniffs the bytes, reads the header, decodes it all (doc 05, `storage/audio_check.py`) | **9 of 14 real MP3s refused** as "This file isn't a supported audio format, whatever its name says." Their ID3v2 tags (cover art) were 100 to 180 KiB and the sniff read only the first 64 KiB | `d-upload-10.png`; `ID3` sizes from the file headers | **Broken. Fixed** (`e69e6bdd`) |
| Resume | Choose the same file again to carry on | Works ("Unfinished uploads ... carries on from where it stopped") | `d3-upload-8.png` | The list keeps files later skipped as duplicates (to-do T-20261125-3d9f) |
| Duplicates | Asks before keeping a second copy | Works: "Keep another copy of ...? / Skip this file" | `d2-upload-47.png` | none |
| A bad file | Refused with a reason | Works: a text file "isn't a supported audio format", a cut MP3 "is cut short" | `m-bad-upload-5.png` | At 390 px the Add music card is wider than the screen (to-do T-20261125-3d9f) |
| Analysis (tempo, key, grid, cues, energy) | Worker `analyse.song` on the cpu-heavy pool (doc 10) | **Nothing ran.** No code queued `analyse.song` for an upload (only the business kiosk horizon did). On the dev stack the worker could not have run it anyway: every claim deadlocked SQLite (below) | DB: 0 jobs, 0 artifacts after 14 accepted uploads (`walk/state.py`) | **Missing. Fixed**: queued at upload, plus `POST /api/hosted/songs/prepare` |
| Stems | Demucs on the GPU pool, CPU fallback (doc 10 §10.2) | **Nothing.** No stems handler exists for any pool (`stems.window` is in the catalogue only); the Modal `gpu_stems` function would stop at start with "no handlers for the gpu pool"; and `require_model("demucs.htdemucs")` refuses in cloud mode because the licence register marks Demucs "review" | `workers/cloud.py`, `modes/model_allowlist.json`, compare run below | **Missing; owner and legal decision** (to-do T-20261125-c77c) |
| Transition planning and rendering | `seam.render` on cpu-heavy with the local engine | **Nothing for hosted accounts.** Make a Mix ran the browser engine ("Your songs, in your browser. Each transition is worked out as it plays"), on the raw MP3 originals. `cloud_mixes.CAPABILITIES` said so: rendered seams "not_yet" | `d-makeamix.png`, `d-mix-*.png` | **Missing. Fixed**: server mix (below) |
| Playback | The rendered seams and a lossless playback file | The browser fetched the raw MP3 original through `/api/assets/{id}/playback-url` and mixed it in the browser | network log in `walk/d-tour.log` | **Fixed** for the server mix: lossless `play.proxy` files and rendered seams, played gaplessly |
| Export | A rendered file of the whole mix | No hosted export; only the browser export | - | **Fixed**: `export.render` from the server mix |
| What the customer saw while waiting | Honest progress | "Upload accepted" and then nothing, forever; Listen said "None of your devices with music is open right now"; the footer said "Your music files stay on your devices" | `d-mix-7.png` | Progress **fixed** on the hosted card; the browser-first words remain (to-do T-20261125-a502) |
| The dev worker itself | `dev.cmd cloud` runs a real worker | **It never claimed a Cloud job.** The claim holds a write transaction, then `CloudJobEntitlements.standing` and `CloudJobFlags.is_on` opened a second connection: on SQLite that waits 30 s and fails ("database is locked"); completion (`lifecycle.free_slot`) did the same. With no maintenance loop in dev, leases left by a stopped worker were never reaped, so they held the plan's lane cap | `stack*.log` tracebacks | **Fixed** (`standing_in`, `is_on_in`, `snapshot_for(conn)`, dev worker reaps leases) |
| Business horizon jobs | Kiosk seams render on the same worker | Its `analyse.song` and `seam.render` jobs named no `input_ref["objects"]`, which is what the gateway signs and the dev worker reads, so they could never fetch their inputs | `business/horizon.py` | **Fixed** |

## 2. Hosted against the local app

The comparison script (`walk/compare.py`) normalises each song exactly as the worker does (`engine_handlers.normalise`, 44.1 kHz 24-bit FLAC), then runs the local app's analysers (`Analysers.load`: Beat This `small0` and S-KEY) and the cloud analysers (`default_analysers`: the same Beat This, chroma key), and reads the hosted worker's stored `analysis.npz` for the same song.

COMPARISON_TABLES

## 3. What was fixed (this branch)

| Commit | What |
|---|---|
| `e69e6bdd` | Upload sniff reads past ID3v2 tags (`audio_check.read_head`); 9 of 14 real MP3s were refused |
| `31019650` | `cloud.hosted_render`: analysis queued at upload, song status with measured estimates, server mix (local planner order and moves), seams rendered the local app's way (`workers/engine_seams.py`), lossless playback files, a cue-cut timeline played gaplessly in the browser (`web/src/cloud/hosted/`), export. The claim path stopped opening a second database connection |
| `6d31b197`, `fc8250ee` | The rest of the dev-worker deadlock (rule snapshot, completion), the dev worker reaps dead leases, business horizon jobs name their stored inputs, to-do items |
| `3f44ce0f` | Tenant matrix and a cross-tenant test for every hosted route (it found a 500 on another tenant's id, fixed), guard registrations, side-effect map, flags doc |
| `2f1fb131` | The planner starts from songs that have an exit and an entry cue (a 24 s clip stopped every plan at one song) |

What the customer now sees on Make a Mix > Your hosted mix: "Analysing on SelectaDJ's servers: 19 of 22 songs done, 3 to go, about 12 minutes left (working on 1 now)", failures listed with the worker's reason and a Try again; then "Rendering transitions: 1 of 11 ready, 4 of 12 lossless playback files ready, about 13 minutes left"; each hand-off says its move and whether it passed its checks; Play stays off until every part is ready. Screenshots `h4-*.png`.

## 4. Still worse than the local app, and why

STILL_WORSE

## 5. Staging and production runbook

Staging today: uploads reach R2 (the buckets exist with app-origin CORS) and say "Upload accepted", and nothing processes them, because no worker runs (the console says "Workers (Modal): Not reporting"). With this branch deployed, an upload queues `analyse.song` at once, so the queue fills even with no worker, and the hosted card says honestly "waiting for a worker".

### What must exist for hosted mode to process uploads

| Piece | What | Where it is defined | State on staging |
|---|---|---|---|
| Worker gateway | `selecta gateway` web service: workers register with the bootstrap token, claim jobs, get signed R2 URLs for the `input_ref["objects"]` of each job, and complete with outputs it re-hashes | Render Blueprint; env in `launch-operator-checklist.md` §11 (`SELECTA_GATEWAY_DATABASE_URL`, `SELECTA_GATEWAY_ALLOWED_HOSTS`, `SELECTA_WORKER_TOKEN_SECRET`, `SELECTA_WORKER_BOOTSTRAP_TOKEN`, the R2 credentials and bucket names) | Check it is deployed and reachable from outside |
| Worker app | Modal app `selecta-workers-staging` (`infra/modal/selecta_workers.py`), EU region, functions `cpu_light` (play.proxy), `cpu_heavy` (analyse.song, seam.render), `export` (export.render). `gpu_stems` and `gpu_stems_fallback` must **not** be deployed yet: no handler serves the gpu pool, so they would stop at start | `infra/modal/selecta_workers.py`, `infra/workers/pools.json` | Not deployed |
| Worker image | Debian slim, Python 3.12, ffmpeg and libsndfile, the `uv.lock` runtime closure, `SELECTA_MODE=cloud`. Beat This weights are **not** baked in: the first analysis in each container downloads the `small0` checkpoint (a few MB) from the Beat This release. Bake it into the image before production (doc 10 §10.2 says weights are baked) | same file | - |
| Worker secret | Modal secret `selecta-staging-workers`: `SELECTA_WORKER_GATEWAY_URL`, `SELECTA_WORKER_BOOTSTRAP_TOKEN`, `SELECTA_WORKER_STORAGE_HOSTS` (the R2 host, `ACCOUNT.eu.r2.cloudflarestorage.com`), optional `OTEL_*` | checklist §5 | Not created |
| Queues and pools | Nothing to create: jobs live in PostgreSQL (`jobs`), pools come from the catalogue (`work/catalogue.py`) and `pools.json` | - | Ready |
| R2 buckets | `selecta-staging-originals`, `-derived` (analysis, playback, seam, export files), `-exports`, `-staging`, `-deletion-ledger`, with app-origin CORS on GET/PUT/HEAD | OpenTofu `infra/cloudflare` | Exist |
| Flags | `cloud.hosted_media` granted per account (console storage switch); `cloud.hosted_render` is on in the build and needs no change; `cloud.uploads` and `cloud.stored_media` on | `flags/cloud.json` | Grant per tester account |
| Maintenance | `selecta maintain` reaps leases a dead worker left (the dev stack now does this in its worker) and runs the autoscaler when `SELECTA_MODAL_APP`, `SELECTA_MODAL_TOKEN_ID` and `SELECTA_MODAL_TOKEN_SECRET` are set | checklist §4 and §5 | Without the Modal token, nothing starts containers: set `min_containers=1` for a test, or start functions by hand |
| GPU | None needed until Demucs is allowed | - | - |

### Cost (the repo's rates: `pools.json`, doc 13; measured times from section 2)

Rates: cpu-heavy 4 vCPU at $0.24 an hour, cpu-light 1 vCPU at $0.06, export 4 vCPU at $0.24, T4 GPU at $0.59; R2 at $0.015 per GB-month, egress free; Modal bills per second and scales to zero.

COSTS

### The cheapest honest way to get one worker running on staging for testing

1. Confirm the gateway is deployed on Render and reachable (`GET /api/ready` on its host), and read its bootstrap token from the Render dashboard (the operator does this; it is a secret).
2. Create the Modal secret `selecta-staging-workers` with the three values above, then `modal deploy infra/modal/selecta_workers.py --env staging` with the `gpu_stems` functions left out, and run one `cpu_heavy` and one `cpu_light` container with `modal run` (or set `min_containers=1` for the test hour and back to 0 after). Staging already caps `cpu_heavy` at 2 containers.
3. Grant hosted media to one tester account, upload three songs, and watch the hosted card: analysis, then a server mix, then Play and Export.

Idle cost is zero with `min_containers=0`. A test of 15 songs and one 12-song mix is about NN cpu-heavy minutes, under $0.20 at the repo's rate. A free alternative for a single test is to run `python -m selecta.workers.cloud` on a developer machine with the same three environment variables and `SELECTA_WORKER_POOL=cpu-heavy` (and a second one with `cpu-light`); it needs the bootstrap token on that machine, so only the owner should do it.

Nothing here was set up: no deploy, no secret, no spend.

## 6. Decisions for the owner

| Decision | Why it is yours | Numbers | To-do |
|---|---|---|---|
| May Demucs (htdemucs) run in hosted Cloud? | Licence register says "review"; legal advice needed. Without it, no stem moves on the server | See stems row in section 2 | T-20261125-c77c |
| Which key detector for hosted? | S-KEY is non-commercial; chroma disagrees with it on these songs (section 2) | See key column | T-20261125-9e2e |
| Lyrics for hosted processing? | Licence (doc 10 §10.5); word moves and vocal rides need synced lyrics | - | T-20261125-9d62 |
| Run one worker on staging, and where | Spend and a secret | Section 5 | T-20261124-8d51 |
| GPU for stems, if Demucs is allowed | Spend per song | Section 5 costs | with c77c |
| Storage for stems per song, if made | Each 4-stem FLAC set of a 3.5 minute song is about 4 x 25 MB; the local app splits only 46 s windows (about 4 x 6 MB per hand-off) | Section 5 costs | with c77c |
| Hosted export: reuse the heard seams | Engineering, no spend; listed so it isn't forgotten | - | T-20261125-4e63 |
