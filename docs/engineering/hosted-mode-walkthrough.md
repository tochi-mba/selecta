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
| What plays | Each song decoded at its mix level, rendered seam clips between them, scheduled on one clock | The raw MP3 original, mixed in the browser by the lighter engine | Lossless 24-bit FLAC playback files (`play.proxy`, 34 to 64 MB a song, about 6x the MP3) cut at each seam's cue points, the seam clips between them, at mix level, on one AudioContext clock |
| Gapless | Yes | Browser crossfades | Yes (parts scheduled back to back; join alignment measured above) |
| Starts playing | As soon as the first seam is ready | At once | Only when every part is ready or failed (a gap: see section 4) |
| Export | Whole-mix render | Browser export only | `export.render`: one FLAC of the mix. Its transitions are chosen again by `render.setmix`, not the seams heard (T-20261125-4e63). A 12-song export ran for over 18 minutes on this machine (still running when measured; result in section 5) |

### 2.5 Measured times per stage per song (this machine, under load; upper bounds)

| Stage | Per song | Notes |
|---|---|---|
| Upload and probe | 1 to 4 s | 6 to 10 MB MP3s, disk object store |
| `analyse.song` | 1.7 x the song length (median of 14 real songs; range 0.5 to 2.9 x), so about 5 minutes for a 3 minute song here | the load: the same 24 s clip took 19 to 128 s; quiet, the cloud analysers did Last Night (163 s) in 27 s, about 0.17 x |
| `play.proxy` | 15 to 34 s | FLAC 34 to 64 MB |
| `seam.render` | cut 40 to 77 s; blend attempt 326 to 442 s | one over 600 s and failed |
| Demucs window (local only) | 888 s per 46 s window | refused on hosted |
| `export.render` | over 18 minutes for 12 songs | |

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
6. **Export re-chooses its transitions** instead of joining the heard seams.
7. **No rating memory or mix-wide move variety** on the server.
8. **Hosted accounts still see browser-first words** (where music lives) and the browser mixer alongside the server mix.
9. **Queued work has no time limit**: with no worker it waits forever. The card now says so instead of estimating (T-20261125-2b5e).

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
