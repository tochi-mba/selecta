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

Screenshots (session scratchpad `shots/`), each opened and checked: `d-upload-10.png` (9 of 14 refused), `d2-upload-47.png` (duplicate dialog), `d3-upload-8.png` (resume list and "service isn't answering" on a database lock), `m-bad-upload-5.png` (bad files at 390 px), `d-library.png`, `d-makeamix.png` and `d-mix-7.png` (the browser mixer on raw MP3s), `h1-makeamix.png` (analysis progress), `h4-rendering.png` and `h4-ready.png` (transitions rendering), `h5-ready.png`, `h5-playing.png` (playing, one failed transition shown), `h5-exported.png`, `m-hosted-makeamix.png` (the hosted card at 390 px, no sideways scroll).

## 2. Hosted against the local app

The comparison script (`walk/compare.py`) normalises each song exactly as the worker does (`engine_handlers.normalise`, 44.1 kHz 24-bit FLAC), then runs the local app's analysers (`Analysers.load`: Beat This `small0` and S-KEY) and the cloud analysers (`default_analysers`: the same Beat This, chroma key), and reads the hosted worker's stored `analysis.npz` for the same song.

### 2.1 Analysis, per song

Columns: tempo (local / cloud analysers / hosted worker), beats (same three), grid confidence, key (local S-KEY with its confidence / cloud chroma / hosted), loudness (local / hosted), the largest beat-time difference between the hosted worker's stored grid and a fresh cloud run, and the measured times (seconds, under load).

| Song | Tempo L / C / H | Beats L / C / H | Grid | Key L (conf) | Key C | Key H | LUFS L / H | Beat diff | Local s | Cloud s |
|---|---|---|---|---|---|---|---|---|---|---|
| Last Night | 101.99 / 101.99 / 101.99 | 272 / 272 / 272 | 0.991 | 2A (0.5) | 2B | 2B | -8.38 / -8.38 | 0.0 ms | 276 | 27 |
| Flowers | 118.0 x 3 | 380 x 3 | 0.980 | 8A (1.0) | 8A | 8A | -7.32 / -7.32 | 0.0 ms | 63 | 131 |
| Kill Bill | 88.99 x 3 | 225 x 3 | 0.971 | 4A (0.3) | 6A | 6A | -7.61 / -7.61 | 0.0 ms | 498 | 115 |
| Calm Down | 107.0 x 3 | 417 x 3 | 0.994 | 1B (1.0) | 1B | 1B | -8.04 / -8.04 | 0.0 ms | 276 | 80 |
| I'm Good (Blue) | 127.99 x 3 | 368 x 3 | 0.993 | 6A (1.0) | 6A | 6A | -6.53 / -6.53 | 0.0 ms | 86 | 144 |
| CUFF IT | 115.01 x 3 | 432 x 3 | 0.931 | 9A (1.0) | 10A | 10A | -9.03 / -9.03 | 0.0 ms | 142 | 188 |
| Dance The Night | 110.01 x 3 | 316 x 3 | 0.943 | 10A (1.0) | 10A | 10A | -7.48 / -7.48 | 0.0 ms | 92 | 70 |

Verdicts:
- **Tempo, beat grid, bars, sections, energy, loudness: same.** The hosted worker's stored grid equals a fresh run to the sample (0.0 ms), and local, cloud and hosted agree on every tempo, beat count and LUFS. Same audio path (ffmpeg to 44.1 kHz FLAC), same Beat This `small0` checkpoint.
- **Key: worse.** Hosted uses the chroma fallback because S-KEY is blocked for commercial use. 3 of 7 songs got a different Camelot key from the local app (Last Night 2A to 2B, Kill Bill 4A to 6A, CUFF IT 9A to 10A), and chroma's confidence is a flat 0.2 where S-KEY said 0.3 to 1.0. Harmonic choices (the planner's key penalty, "far keys" refusal at five steps) follow the key, so some pairs the local app would blend are refused or penalised on the server. Owner decision (T-20261125-9e2e).
- **Lyrics: missing.** The local app fetches synced lyrics (LRCLIB) and marks where each line is sung; hosted fetches none (doc 10 §10.5), so `vocals_known` is false for every hosted song.

### 2.2 Stems

| | Local app | Hosted |
|---|---|---|
| Model and settings | Demucs `htdemucs`, CPU, `--shifts 0`, 46 s transition windows only (`stems.separate_window`) | **Refused**: "Cloud mode can't load the model 'demucs.htdemucs': it is marked review." No stems handler exists for the gpu pool |
| Time | 888 s for one 46 s window on this loaded machine (doc 10 says about 120 s CPU on a quiet machine, a few seconds on a T4) | - |
| Output | 4 stems (vocals, drums, bass, other); their sum matches the input to -17.5 dB error (a sound split) | - |

Verdict: **missing** until the licence decision (T-20261125-c77c). Because the same output (model, settings, windows) is wanted, a hash comparison was not possible: there is nothing on the hosted side to compare.

### 2.3 Transitions

The hosted mix of 12 songs (planned by the local planner from the hosted analyses) asked for 5 blends and 6 cuts. What the server rendered, per hand-off (`seam.render` results, under load):

| Planned | Rendered | Audit | Time | What failed first |
|---|---|---|---|---|
| cut | cut | passed | 77 s | - |
| blend | echo out | passed | 442 s | blend and filter sweep: beat alignment, vocal overlap |
| blend | echo out | passed | 326 s | blend: vocal overlap, entry level; filter sweep: beat alignment, vocal overlap, entry level |
| blend | **failed** | - | over 600 s | "The worker exceeded the job's runtime limit" (seam.render may run 600 s) |
| blend | echo out | passed | 389 s | blend: vocal overlap; filter sweep: beat alignment, vocal overlap |
| cut | cut | passed | 40 s | - |
| blend | echo out | passed | 379 s | blend and filter sweep: beat alignment, vocal overlap |
| cut x 4 | cut x 4 | passed | 45 to 73 s | - |

Joins, measured on all 10 rendered seams against the lossless playback files as the hosted player schedules them (`walk/joins.py`): alignment correlation 0.92 to 1.00 at both ends of every clip (sample-exact cue points), but the clip was 0.46 to 0.70 of the playback file's level, a 3 to 7 dB step in and out of every transition, because the local app plays songs at their mix level (`SongInfo.gain_db`) and the hosted playback files had none. **Fixed** (`e122024d`): every song part now carries its `gain_db`; the level ratio at the joins is now 0.999 to 1.001. Clip peaks are -1.1 to -5.8 dBFS, so no clipping.

Old hosted path against the new one, on the same pairs in local mode (`compare.py`): both chose cuts (old) or echo outs and cuts (new); every check passed both ways; with no vocal information neither could keep a blend.

Verdicts:
- **Transition kinds: worse.** The audit refuses any overlap over 8 s when it doesn't know where the vocals are (`audit/checks.py`, "vocals unknown for one song, so a long overlap isn't safe"). The local app knows from lyrics, or from Demucs ("vocal sense"); hosted has neither, so every blend and filter sweep on the server falls back to an echo out or a cut. 5 of 5 planned blends: 4 echo outs, 1 timed out. The fix is the lyrics and stems decisions, not code.
- **Move choice: same algorithm, less context.** Hosted now uses the local app's own placement and fallback order (`engine_seams.py`); it has no rating memory and doesn't count moves already used in the mix, so it can repeat echo outs where the local app would vary.
- **Rendered audio and alignment: same** (same render engine and checks), and level at the joins now the same.
- **Time: worse under load, a product risk.** A blend that tries three moves at four placements each took 326 to 442 s on this machine, close to the 600 s `seam.render` limit; one went over. On a 4 vCPU Modal worker with no other load it would be several times faster, but the limit should be checked against real worker times.
- **Missing on hosted:** stem moves (vocal ride, strip and land, intertwined stems), word moves (word blend, call and response, phrase roll, word cut), bridges and the Studio. The editor and Seam Inspector are local only (`cloud_mixes.CAPABILITIES`).

### 2.4 Playback and export

| | Local app | Hosted before | Hosted now |
|---|---|---|---|
| What plays | Each song decoded at its mix level, rendered seam clips between them, scheduled on one clock | The raw MP3 original, mixed in the browser by the lighter engine | Lossless 24-bit FLAC playback files (`play.proxy`, 34 to 64 MB a song with version 1 files, about a quarter less with version 2) cut at each seam's cue points, the seam clips between them, at mix level, on one AudioContext clock, read and decoded about 8 seconds at a time (section 8) |
| Gapless | Yes | Browser crossfades | Yes (windows scheduled back to back in whole sample frames; section 8 measures every join) |
| Starts playing | As soon as the first seam is ready | At once | Only when every part is ready or failed (a gap: see section 4) |
| Export | Whole-mix render | Browser export only | `export.render`: one FLAC of the mix. Its transitions are chosen again by `render.setmix`, not the seams heard (T-20261125-4e63). A 12-song export was still rendering after 33 minutes on this loaded machine (all 12 songs fetched, the join running; the export limit is 2 hours), so a finished export file was not verified |

### 2.5 Measured times per stage per song (this machine, under load; upper bounds)

| Stage | Per song | Notes |
|---|---|---|
| Upload and probe | 1 to 4 s | 6 to 10 MB MP3s, disk object store |
| `analyse.song` | 1.7 x the song length (median of 14 real songs; range 0.5 to 2.9 x), so about 5 minutes for a 3 minute song here | the load: the same 24 s clip took 19 to 128 s; quiet, the cloud analysers did Last Night (163 s) in 27 s, about 0.17 x |
| `play.proxy` | 15 to 34 s | FLAC 34 to 64 MB |
| `seam.render` | cut 40 to 77 s; blend attempt 326 to 442 s | one over 600 s and failed |
| Demucs window (local only) | 888 s per 46 s window | refused on hosted |
| `export.render` | over 33 minutes for 12 songs, unfinished when measured | the card said "Exporting on the server" with no time once past its estimate |

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

1. **Blends never survive on the server** (no vocal information: no lyrics, no stems). Needs the Demucs and lyrics decisions. With Demucs allowed, the server could run the local app's vocal sense and stem moves; this needs a stems handler for the gpu pool, which does not exist yet.
2. **Key detection** is chroma, wrong on 3 of 7 songs against S-KEY. Needs a licensed or trained key model.
3. **No stems at all**, so no stem-assisted transitions, no Studio.
4. **Play waits for the whole mix.** The local app starts as soon as the first transition is ready; the hosted card enables Play only when every part is ready or failed. Progressive play needs the timeline to stay stable while later seams land (a later seam changes where the song before it ends).
5. **Slow blends near the runtime limit** (326 to 442 s of a 600 s limit here; one timed out).
6. ~~**Export re-chooses its transitions** instead of joining the heard seams.~~ Fixed (section 9): the export joins the parts the player plays.
7. **No rating memory or mix-wide move variety** on the server.
8. ~~Hosted accounts still see browser-first words and the browser mixer alongside the server mix.~~ Fixed (section 8): Make a Mix is the hosted mix, the browser mixer one press away, and the footer says where uploads live.
9. **Queued work has no time limit**: with no worker it waits, by design (nothing a customer paid for is dropped). The status says it is waiting for a worker and gives no estimate, and after 15 minutes operators get a `work.queue_stuck` alert (section 7).

## 5. Staging and production runbook

Staging today: uploads reach R2 (the buckets exist with app-origin CORS) and say "Upload accepted", and nothing processes them, because no worker runs (the console says "Workers (Modal): Not reporting"). With this branch deployed, an upload queues `analyse.song` at once, so the queue fills even with no worker, and the hosted card says honestly "waiting for a worker".

### What must exist for hosted mode to process uploads

| Piece | What | Where it is defined | State on staging |
|---|---|---|---|
| Worker gateway | `selecta gateway` web service: workers register with the bootstrap token, claim jobs, get signed R2 URLs for the `input_ref["objects"]` of each job, and complete with outputs it re-hashes | Render Blueprint; env in `launch-operator-checklist.md` §11 (`SELECTA_GATEWAY_DATABASE_URL`, `SELECTA_GATEWAY_ALLOWED_HOSTS`, `SELECTA_WORKER_TOKEN_SECRET`, `SELECTA_WORKER_BOOTSTRAP_TOKEN`, the R2 credentials and bucket names) | Check it is deployed and reachable from outside |
| Worker app | Modal app `selecta-workers-staging` (`infra/modal/selecta_workers.py`), EU region, functions `cpu_light` (play.proxy), `cpu_heavy` (analyse.song, seam.render), `export` (export.render). `gpu_stems` and `gpu_stems_fallback` must **not** be deployed yet: no handler serves the gpu pool, so they would stop at start | `infra/modal/selecta_workers.py`, `infra/workers/pools.json` | Not deployed |
| Worker image | Debian slim, Python 3.12, ffmpeg and libsndfile, the `uv.lock` runtime closure, `SELECTA_MODE=cloud`. Beat This `small0` weights are baked in at build time from `services/worker/models.lock.json` (SHA-256 pinned, `TORCH_HOME=/opt/models/torch`) and checked again when each function starts; until the next deploy the running image still downloads them on each container's first analysis | same file | - |
| Worker secret | Modal secret `selecta-staging-workers`: `SELECTA_WORKER_GATEWAY_URL`, `SELECTA_WORKER_BOOTSTRAP_TOKEN`, `SELECTA_WORKER_STORAGE_HOSTS` (the R2 host, `ACCOUNT.eu.r2.cloudflarestorage.com`), optional `OTEL_*` | checklist §5 | Not created |
| Queues and pools | Nothing to create: jobs live in PostgreSQL (`jobs`), pools come from the catalogue (`work/catalogue.py`) and `pools.json` | - | Ready |
| R2 buckets | `selecta-staging-originals`, `-derived` (analysis, playback, seam, export files), `-exports`, `-staging`, `-deletion-ledger`, with app-origin CORS on GET/PUT/HEAD | OpenTofu `infra/cloudflare` | Exist |
| Flags | `cloud.hosted_media` granted per account (console storage switch); `cloud.hosted_render` is on in the build and needs no change; `cloud.uploads` and `cloud.stored_media` on | `flags/cloud.json` | Grant per tester account |
| Maintenance | `selecta maintain` reaps leases a dead worker left (the dev stack now does this in its worker) and runs the autoscaler when `SELECTA_MODAL_APP`, `SELECTA_MODAL_TOKEN_ID` and `SELECTA_MODAL_TOKEN_SECRET` are set | checklist §4 and §5 | Without the Modal token, nothing starts containers: set `min_containers=1` for a test, or start functions by hand |
| GPU | None needed until Demucs is allowed | - | - |

### Cost (the repo's rates: `pools.json`, doc 13; measured times from section 2)

Rates: cpu-heavy 4 vCPU at $0.24 an hour, cpu-light 1 vCPU at $0.06, export 4 vCPU at $0.24, T4 GPU at $0.59; R2 at $0.015 per GB-month, egress free; Modal bills per second and scales to zero.

Times on a 4 vCPU worker with nothing else running are estimated from the quiet measurements (analysis about 0.17 to 0.5 x the song length; a cut about 40 s; a blend attempt about a third of the loaded 330 to 440 s); the loaded figures from section 2.5 are the upper bound.

| Item | Per song or per unit | Cost |
|---|---|---|
| Idle, all worker pools | scale to zero (`min_containers=0`) | $0 a month; the gateway is a Render web service already in the plan (doc 13: Render Pro $25 a month flat plus instances) |
| Analysis (cpu-heavy) | 30 to 90 s for a 3 to 4 minute song | $0.002 to $0.006 a song |
| Playback file (cpu-light) | 15 to 35 s | about $0.0005 a song played in a mix |
| Transition (cpu-heavy) | cut about 40 s; blend attempt 100 to 150 s | $0.003 to $0.01 a hand-off |
| Export (export pool) | a 12-song mix ran over 18 minutes loaded; perhaps 5 to 8 minutes quiet | $0.02 to $0.07 a mix |
| Storage (R2) | original 6 to 10 MB, playback file 34 to 64 MB (evictable, remade on demand), analysis about 0.1 MB, seam clip about 3 MB | about $0.001 a song a month, mostly the playback file; $0.015 per GB-month, egress free |
| Stems, if Demucs is allowed (not built) | two 46 s windows per hand-off; T4 a few seconds each, CPU fallback about 120 s each quiet (888 s loaded) | GPU about $0.001 a hand-off; CPU fallback about $0.03; storage about 20 MB a window (4 stems, 24-bit FLAC) |
| Whole-song stems (an alternative) | 4 x about 25 MB per song | $0.0015 a song a month to keep |

For one hosted customer with 1,000 songs and 10 mixes a month: analysis about $4 once, then about $0.50 a month of transitions, exports and playback files, and about $1 a month of storage.

### The cheapest honest way to get one worker running on staging for testing

1. Confirm the gateway is deployed on Render and reachable (`GET /api/ready` on its host), and read its bootstrap token from the Render dashboard (the operator does this; it is a secret).
2. Create the Modal secret `selecta-staging-workers` with the three values above, then `modal deploy infra/modal/selecta_workers.py --env staging` with the `gpu_stems` functions left out, and run one `cpu_heavy` and one `cpu_light` container with `modal run` (or set `min_containers=1` for the test hour and back to 0 after). Staging already caps `cpu_heavy` at 2 containers.
3. Grant hosted media to one tester account, upload three songs, and watch the hosted card: analysis, then a server mix, then Play and Export.

Idle cost is zero with `min_containers=0`. A test of 15 songs and one 12-song mix is about 45 cpu-heavy minutes, under $0.20 at the repo's rate. A free alternative for a single test is to run `python -m selecta.workers.cloud` on a developer machine with the same three environment variables and `SELECTA_WORKER_POOL=cpu-heavy` (and a second one with `cpu-light`); it needs the bootstrap token on that machine, so only the owner should do it.

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

## 7. Jobs that can never finish, and work with no worker (2026-11-25, after the first Modal run)

**What happened on staging.** The first real Modal worker analysed songs and then had every upload slot refused (`invalid_output_slots`): jobs queued before `31b88a2d` declared no `input_ref["output"]`. Two such `analyse.song` jobs sat in `retry_scheduled`, and because a job's idempotency key is the analysis hash, no fresh job could be made for those songs. The card said "2 of 5 songs done, 3 to go. About 1 minute left." indefinitely.

**The fifth song.** The card counted it as "to go" (queued or running), which it can only do when a live job exists for that song's analysis hash, so it had a job, just not one of its own: the most likely cause is that it was a second copy of the same file (the upload dialog offers "Keep another copy"), and copies share one analysis hash, one job and one analysis. The job rows name the first copy's `source_key`, so a lookup of jobs by asset id finds nothing for the second copy. Not checked against staging's database (no access from here). The status now says it: copies name each other in `same_file_as` and show the same `job_id`. If it was not a copy, the other path to "no job" is an admission refusal (an operator's admission pause), which `prepare` now counts as `refused` and the song shows as waiting, "Not started yet.".

**Repair (`hosted_status.needs_new`, `JobStore.replace`).** Every `prepare` (the card calls it on load), every mix render and every export request checks the latest job for each piece of work. A live job whose declared output is missing or wrong is cancelled and a fresh one queued in the same transaction, under a lock on the old row, so two tabs, a retry falling due or a claim racing it still end with one live job (the live idempotency index backs this up). A job a worker holds is asked to stop, and replaced on the next call once it has. Cancelled jobs and jobs whose file was evicted get a fresh one. Analysis failures on our side (not `input_invalid` or `poison`) get a fresh job until three of that song's jobs have ended unsuccessfully; after that, and for a song's own failure, the customer's Try again (`POST /api/hosted/songs/{asset_id}/retry`, or `prepare` with `retry`) does it. Transitions and exports are renewed only for a broken contract; a failed transition still waits for Try again (it plays as a plain change meanwhile).

**Status shape (`GET /api/hosted/songs`, also returned by `prepare`).** Per song a `status` of `waiting`, `running`, `done` or `failed`, with a `reason` written for the customer (a failure in plain words, never a worker's traceback; what a waiting song waits for), its `job_id` and `can_retry`; `totals` of each; `moving` and `waiting_for` (`worker` when no analysis worker checked in within 3 minutes, `retry` when everything unfinished waits on a backoff or a hold). `estimate_s` is null whenever nothing is moving. The first shape (`analysis`, `counts`, `worker_seen`, `seconds_each`, `total`) is unchanged, and its `why` is now the same plain reason. Full shape in the `songs_status` docstring.

**Contract test.** `tests/test_hosted_gateway_contract.py` drives `analyse.song`, `play.proxy`, `seam.render` and `export.render` from the real producers through the real gateway app (`create_gateway_app`, with `cloud_ports` signing inputs and output slots and re-hashing outputs) and the real `RemoteWorkerClient` under the real runner, with object storage faked only at its HTTP edge and the handlers' audio work stubbed. It also replays the staging failure (a job with no declared output fails with `invalid_output_slots`) and its repair. The dev worker (`devstack/worker.py`) still publishes to disk, because the gateway needs PostgreSQL and `dev.cmd cloud` runs SQLite, but it now applies the gateway's rule: no upload outside the job's declared namespace (`ContractBroken`, "invalid_output_slots"). The kiosk horizon's `analyse.song` and `seam.render` jobs had the same gap and now declare their outputs.

**Queued work with no worker (`work.queue_health`).** Nothing expires or is dropped. The maintenance leader's `queue_watch` task (every minute) raises one `work.queue_stuck` platform alert per pool per hour when the pool's oldest queued job has waited over 15 minutes, saying how many are queued and when a worker last checked in. Staff read the numbers at `GET /api/admin/work/queue` (flag `admin.console`, admin session and `workers.read`): per pool `queued`, `retry_scheduled`, `retry_overdue` (retries more than 5 minutes past their backoff: maintenance isn't running), `running`, `oldest_wait_s`, `oldest_job_type`, `workers_seen`, `slots_seen`, `last_heartbeat_at`, `last_heartbeat_age_s`, `stuck`, plus the last day's `work.queue_stuck` alerts.

## 8. Hosted playback in the browser, and one Make a Mix (2026-11-25, after the staging freeze)

**What staging showed.** A 2-song hosted mix reached "Ready", Play said "Playing Akon - Benjamin.mp3 (loading the next part)", and within about a minute the tab stopped answering and Chrome dropped it. The browser mix on the same page showed "Play Building..." at the same time.

**Reproduced locally** (own stack, the 12-song set from section 2, full Chromium driven by Playwright, one browser at a time, scripts in the session scratchpad `pl/`). The 2-minute hang itself did not happen on this machine (the page always answered within 0.9 s), but every ingredient of it did:

| Measured with the old player | 2 songs, no throttling | 12 songs, CPU 4x slower, 20 Mbit/s |
|---|---|---|
| What it decoded | each part's whole file: 63 MB, 5 MB and 92 MB of decoded audio held at once (decoded at the device's 48 kHz) | the same, plus 68 MB more as the mix went on |
| Time to first sound | about 5.8 s (2.5 s fetch of a 44 MB file, 3.3 s decode) | 39.3 s |
| Part scheduled more than once | not reached in the run | yes: a 12.5 s transition scheduled 5 times and the next song scheduled **52 times**, back to back out to 2,966 s ahead, all within 10 ms. Every 250 ms tick started another `fill()` while a slow decode was pending, and each one scheduled the same part when it landed; Stop could not reach the earlier copies (`sources[index]` kept only the last) |
| The browser mix at the same time | pressing the browser mix's Play and then the hosted Play: both played at once, 300 MB of decoded audio held between them | - |

Two more facts behind the size: the `play.proxy` FLAC files were written with **47-sample frames** (ffmpeg took its frame size from the first decoded MP3 frame), so a 3.5 minute song was 150,000+ frames and a quarter bigger than with normal frames (43.9 MB against 32.6 MB for Last Night); and a whole-file decode cost 3.3 to 9.9 s per song before a note played. On a laptop with other tabs, several hundred MB of decoded audio, decodes queued behind each other and dozens of duplicate schedules is the most likely way the staging tab died; the exact staging hang was not reproduced here (a staging re-test is on the to-do list).

**What changed.**
- `timelinePlayer.ts` with `partReader.ts` and `flacFrames.ts`: each part is read about 8 seconds at a time with Range reads of its signed link. The reader finds the FLAC frames in those bytes (frame headers carry their position and a CRC-8, and each is trusted only when the next one follows on), hands the browser's decoder a tiny FLAC of the file's STREAMINFO and those whole frames, trims the first and last window of a part to its exact samples, and schedules every window straight after the one before in whole sample frames on one AudioContext running at the engine's 44.1 kHz (so nothing is resampled). About 15 s is kept scheduled ahead; each window is let go once it has played. A seek into a part brackets the frame (one known before the target, one after), so loud and quiet passages of different density are found in a few small reads. One pump runs at a time, so a part is never scheduled twice. A file that is not FLAC (an original played as is) is still read whole.
- Signed links: the player asks the server for fresh ones when its links are older than 10 minutes or a read is refused (403), so a mix longer than the 15-minute link life carries on. If the store's CORS rules refuse a ranged read, it falls back to whole-body reads cut in the browser (slow, but it plays); `infra/cloudflare/main.tf` now allows the `range` request header (the owner applies it).
- A read that fails is tried again up to 4 times, 1, 2 and 4 s apart; then the card says plainly "The mix stopped: ..." with Try again, which carries on from the same place. Stop silences everything and lets every window go; the silent context is kept for the next Play (making one can hold the page for most of a second); leaving the page closes it.
- One thing plays at once: starting the hosted mix pauses the browser mix in this tab, the browser mix starting stops the hosted mix, and a second tab's hosted Play stops the first through a Web Lock of its own (`audioTab(..., { lock: 'selecta-hosted-audio' })`, ADR-0475 F). The hosted mix against the browser mix in another tab is not covered yet (to-do).
- `play.proxy` writes 4096-sample frames (`PROXY_VERSION` 2 in `work/proxies.py` and `workers/audio_handlers.py`). Version 1 files are not read any more: each mix asks for version 2 files and the worker remakes them on demand (15 to 34 s a song, section 2.5).

**After** (same runs, same machine):

| | 2 songs, no throttling | 12 songs, CPU 4x slower, 20 Mbit/s |
|---|---|---|
| Time to first sound | 2.5 s | 4.6 s |
| Decoded audio held | at most about 8 MB (15 s ahead plus one window); each window 1.9 to 2.9 MB | the same |
| Decode per window | 87 to 222 ms, off the main thread | up to 967 ms, off the main thread |
| Longest main-thread task from the player | under 60 ms; the one long task at the press is the browser making its first AudioContext (measured alone: 973 ms for a fresh browser's first context, 63 ms after) | frame scan about 17 ms a window on a 47-sample-frame file and 3 ms on a version 2 file, unthrottled (35 to 80 ms before it used `indexOf`); the 0.8 to 1.0 s long tasks in this run are the page itself: with nothing playing, the same page under the same throttle has 0.55 to 0.72 s long tasks every few seconds (dev build; to-do) |
| Page answer time (worst) | 103 ms | 903 ms (841 ms before; see the line above) |
| Scheduled twice | never (and a unit test ticks 50 times during a slow decode) | never |

**Joins as the new player plays them.** `pl/joins.mjs` renders each join through the real `TimelinePlayer` into an OfflineAudioContext and compares it with whole-file decodes cut at the same samples, at each part's level. 12-song mix (version 1 files), 21 joins: 17 equal the reference to within 6e-8 (correlation 1.00000, level 1.0000 on both sides); at 4 transition-to-song joins the server's clip length (`seconds`, rounded to 4 decimals) is 1 to 2 samples longer than the clip file, so the player plays the clip's real last sample and then the song from its cue, and a reference built from `seconds` sits 1 sample off (to-do). The section 2.3 measure at each join, clip edge against the song file at its cue: alignment 0.919 to 1.000, level 0.999 to 1.001, as before. 6-song rerun on version 2 files: the same values at every join, including a straight change after a failed transition (which found the seek fault fixed above).

**The card.** Make a Mix for a hosted account (`coexisting` and `cloud.hosted_render`) is one page: the hosted card (`HostedMakeAMix.tsx`), with "Mix it in this browser instead" at its foot for music kept on a device; with the flag off the page is the browser mixer exactly as before. Songs show title and artist as an import reads a file name ("001. Morgan Wallen - Last Night.mp3" is Last Night by Morgan Wallen; `displayNames` now drops a leading track number from the artist too), or the server's `title` and `artist` when it sends them. Analysis and rendering use the shared Meter; a time is shown only while the server says the work is moving (`moving`, or with the first shape a worker seen and a song finished in the last 5 minutes); each failed song is its own row with its reason and Try again (`POST /api/hosted/songs/{id}/retry`, shown when `can_retry`; `prepare` with `retry` on an older server). The player is a play button, the song or transition playing now, elapsed and total time and a progress bar; the track list reuses the Listen queue's rows (press one to play from it) with each hand-off under its song. The footer for a hosted account says where uploads live (`footerWords`). Screenshots at 390 and 1440 px, light and dark: session scratchpad `shots2/`.

**Not verified.** A phone (iOS Safari decoding a STREAMINFO-only FLAC window); staging itself (no access from here); a mix played for longer than 15 minutes in real time (the link refresh is covered by a unit test with a moved clock).

## 9. Export joins the mix as it plays; one copy of a song per mix; an honest time left (2026-11-25, after the staging re-test)

**What staging showed.** A 5-song hosted mix (7:56 long) planned, rendered 4 transitions in about 4 minutes and played correctly. Its export was still running 15 minutes after Export was pressed, on a 4 vCPU export worker doing nothing else (T-20261125-59d7); the card said "about 4 minutes left", then nothing. The mix used "Call on Me" twice because the customer had uploaded two copies (T-20261125-ed08). While transitions rendered the card said "Under a minute left" for several minutes (T-20261125-3985, part 1).

**Where the old export's time went (measured).** `export.render` (version 1) fetched every original, normalised it with ffmpeg, then called `render.setmix.render_set`, which chose every transition again: for each hand-off it rendered and audited candidates in order until one passed. Timed stage by stage on this machine (`measure_old_export.py` in the session scratchpad; 3 songs cut to 90 s, so a 4.5-minute mix with 2 hand-offs):

| Stage | Time | Share |
|---|---|---|
| Render a candidate transition (12 candidates for 2 hand-offs: 6 tried per hand-off before one passed its audit) | 82.4 s (6.9 s each) | 74 % |
| Audit a candidate (12) | 16.7 s (1.4 s each) | 15 % |
| Normalise the originals (ffmpeg, 3) | 8.9 s | 8 % |
| Write the 16-bit FLAC, join and limit, checksums, load analyses | 1.6 s | 1 % |
| **Total** | **112 s** | |

So nine tenths of the time was choosing and rendering transitions the customer had already heard rendered once. With no vocal information most candidates fail the audit (section 2.3), so on full-length songs each hand-off tries more and longer candidates; that is where staging's 15 minutes went. The file was also not what played: different transitions, a limiter over the whole mix and 16-bit output.

**The new export (`workers/export_join.py`, `EXPORT_VERSION` 2).** It renders nothing. `POST /api/hosted/mixes/export` takes the same order and moves as `mixes/render` and asks `mix_state` for the same timeline the player plays; once every part is ready or failed it queues one `export.render` job whose input names that timeline exactly: each part's file (object key and SHA-256: the lossless playback file, a lossless original played as is, or the seam clip), its cut (`from_s`, `seconds`) and each song's mix level (`gain_db`). Its idempotency key and declared output are `export_hash(timeline)` (file contents, cuts and levels, not object keys), so asking twice makes one job, an export already stored is handed back at once, and a later change of plan cannot change one already asked for. The worker fetches the parts (three ahead of the writer, each checked against its SHA-256 and deleted once written) and writes them one after another into one 24-bit 44.1 kHz FLAC, 65,536 frames at a time, cutting and levelling as the player does:

- a part starts at sample `round(from_s x rate)` and runs `round(seconds x rate)` samples, rounding half up like JavaScript's `Math.round`, never past the file's last sample (`partReader.ts`);
- samples are decoded as the browser decodes them (the 24-bit integer / 2^23, exact in float32), a song part is multiplied by the float32 gain `10 ** (gain_db / 20)` (the GainNode), a seam clip by 1;
- a hand-off whose render failed is already two song parts back to back in the timeline, so it exports as the straight change it plays as;
- a mono playback file is put on both channels (Web Audio plays a mono buffer on both speakers).

**Measured** (`measure_new_export.py`, scratchpad): 5 real chart songs as `play.proxy` makes them (24-bit FLAC, 4096-sample frames) and 4 clips of 16.0123 s, a 9:07 timeline with fractional cue points and levels from -4.1 to 0 dB: **7.3 s** on this machine, from local files, about 75 times faster than real time. On a worker add the downloads: about 40 MB per song from R2, fetched three at a time while the writer works. The file was 107 MB (24-bit FLAC, about 11.7 MB a minute), so a 12-song mix of about 45 minutes is about 530 MB; the old export wrote 16-bit, about half that, but 16-bit is not what played.

**Joins checked against the player's arithmetic.** An independent reference (whole-file decodes, cut with `Math.round` semantics, levelled by the float32 gain, concatenated) against the exported file: the same length to the sample; the largest difference anywhere in the 9-minute mix 5.96e-8, exactly half a 24-bit step (the rounding of a levelled sample to 24 bits), and the same within 4,096 samples either side of all 8 joins; the seam clips are copied bit for bit. `tests/test_hosted_export_join.py` checks the same in integers on small synthetic files (every join, a failed hand-off, a clip shorter than its rounded `seconds`, mono, progress, a bad checksum, old inputs refused). A playback file not at 44.1 kHz (`play.proxy` keeps the upload's rate, for example 48 kHz) is resampled with soxr; the browser resamples it with its own resampler, so such a part is the same music but not the same samples (to-do).

**Progress and time.** The job reports parts written out of parts plus one (the last unit is the upload). `GET /api/hosted/exports/{id}` answers `progress` as before plus `parts_done`, `parts_total` and `worker_seen`, and gives `estimate_s` only while the job is running and has written a part, from its own pace (`elapsed x parts left / parts done`); no fixed guess. A finished export also says `seconds` (its length) beside `size_bytes`. Old version 1 export jobs still queued fail with "This export was asked for before exports were joined from the mix as it plays. Ask for the export again." The `export.render` runtime limit is now 30 minutes (was 2 hours); the export pool's 4 vCPU and 8 GB are more than it needs (to-do).

**One copy of a song per mix (`hosted_render.one_per_recording`).** The planner gets the first upload of each recording, by the local catalogue's duplicate rule (ADR-0469 amendment 2, `local_media.versions.name_key` and `same_length`): identical bytes are always one recording; another file is the same recording when its normalised title and artist match and its length is within 3 s (a remix or extended mix is longer and stays its own song). Hosted uploads have no tags in the database, so title and artist come from the file name as an import reads it ("001. Eric Prydz - Call on Me.mp3"), and a name without an artist never groups (two "Untitled" files stay two songs). `GET /api/hosted/songs` adds `same_recording_as` (every other upload of the same recording) beside `same_file_as`, so the Library can say so.

**The time left while a mix renders (`hosted_estimate.mix_estimate`).** Per job type and per planned move: a transition's expected time is this workspace's median for that move, then for any move, then a first guess by kind (a cut 40 s, any other move 150 s: staging's blend attempts took 1.5 to 2 minutes). Every live analysis and transition job of the workspace is laid onto the cpu-heavy slots seen in the last 3 minutes in the order they were made, a running job holding its slot for what it has left, and hand-offs still waiting for analysis are added as transitions to come; the estimate is when the last ends. There is no estimate when it would be a guess already proved wrong: no worker (`estimate_why` `no_worker`), a running job past its expected time (`overrunning`), or nothing of this workspace running while its oldest queued job has waited more than twice the longest expected job (`busy`). `mixes/render` now also answers `estimate_why` and `work` (`queued`, `running`, `slots`); `estimate_s` keeps its meaning (null means no honest number). Jobs of other accounts sharing the pool are not counted (the database's row security scopes the query to the workspace); the `busy` rule is what catches a pool full of other work.

**Not verified.** A real worker export (no staging access from here: the download time from R2 is not measured); the export of a mix with a playback file at a rate other than 44.1 kHz in a browser; the card's words for the new fields (another agent owns the card).
