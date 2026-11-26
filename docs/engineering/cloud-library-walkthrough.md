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

Updated 2026-11-26 for the one brain (section 12).

1. **Blends never survive on the server without lyrics** (no stems, no ears for voices). With `cloud.hosted_brain` on the planner core no longer offers a blend it can't check (so no minutes are spent on renders the audit refuses), and a song whose lyrics a device found now reaches the worker and can earn an 8 or 16 bar blend. Songs with no lyrics still get only a cut, an echo out or a reverb wash. The rest needs a stems handler with a licence-cleared separator (the owner chose a Spleeter-class one; Demucs stays behind its gate): specification in to-do T-20261126-fdde.
2. **Key detection** is chroma, wrong on 3 of 7 songs against S-KEY. Needs a licensed or trained key model.
3. **No stems at all**, so no stem-assisted transitions, no Studio (T-20261126-fdde).
4. **Play waits for the whole mix.** The local app starts as soon as the first transition is ready; the hosted card enables Play only when every part is ready or failed. Progressive play needs the timeline to stay stable while later seams land (a later seam changes where the song before it ends).
5. ~~**Slow blends near the runtime limit** (326 to 442 s of a 600 s limit here; one timed out).~~ With `cloud.hosted_brain` on (section 12): at most 6 renders a seam (5 takes and the cut) against up to 46 on the older path, and no blend is rendered for a pair whose vocals are unknown. Off, unchanged.
6. ~~**Export re-chooses its transitions** instead of joining the heard seams.~~ Fixed (section 9): the export joins the parts the player plays.
7. **Rating memory and move variety on the server**: with `cloud.hosted_brain` the mix's order learns from the account's seams and Good and Bad verdicts (`SeamMemory` from the seam tables), and every rendered hosted seam is now kept in those tables (`cloud.brain`), so verdicts on uploaded-music mixes count. Each seam's own move choice still has no memory (the Desktop's `choose_transition` has none either).
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

### 8.1 The card polished after the staging re-test (2026-11-25, second pass)

**Buttons.** "Make another mix", "Try the straight changes again" and "Export the whole mix" were `quiet` buttons, which `cloud-ui.css` draws with no fill and no edge: plain text. Each state now has one primary action (Make a mix until there is a mix, then the round Play), and everything else is the app's ordinary secondary button (raised fill, edge): Make another mix, Export, Try the straight changes again, Check again, the failed song's Try again and the download link (`a.button`). On a phone the card's actions are full width and every press is at least 44 px under a coarse pointer.

**Names.** `Action` (ui/controls.tsx) kept both labels in the DOM so its width never changes, the one not in use hidden with `aria-hidden` and `visibility: hidden`; anything reading text or a lax accessibility tree heard "Make another mix Planning…". Now only the true label is text; the other keeps its room as CSS generated content from `data-label`, with empty alternative text (`content: attr(data-label) / ''`), so it is never in a name or in the page's text. While busy the button's name is the busy words and it carries `aria-busy`; the card also says what it is doing once in a polite status line ("Planning your mix…", "Exporting the mix on SelectaDJ’s servers.", "The mix is ready to download."). The rows are "Play from Last Night by Morgan Wallen", the failed song's button "Try Kill Bill again", the play button "Play the mix", "Stop the mix" or, after a stop part way, "Carry on playing the mix", and the progress bar's value "1:23 of 18:40" (the visible time beside it is hidden from screen readers, so it is heard once).

**Words from the server, never made up.** Under the transitions' bar: a time only when `estimate_s` is a number; otherwise by `estimate_why`: `no_worker` "Waiting for a SelectaDJ server to start…", `overrunning` "Taking longer than usual, and still going.", `busy` "SelectaDJ’s servers are busy with other mixes; yours is in line." (an older server's `worker_seen: false` still reads as waiting for a server; `estimate_s: null` alone says nothing about time). The export shows a bar from `parts_done` / `parts_total` (or the `progress` pair), "Part 3 of 9" and then "Saving the file" for the upload unit, indeterminate while queued, "Waiting for a SelectaDJ server" with `worker_seen: false`, a time only from `estimate_s`; a refusal shows the server's own sentence; a finished export is a plain download link named with its size ("Download the mix (lossless FLAC, 107 MB)") and a line with its length and size; on a phone a file of 100 MB or more says to download it over Wi-Fi. The link is the signed object URL with `download`, so the browser's own download manager fetches it and can resume it while the link is valid (15 minutes). The export follow stops after 15 minutes (or twice its estimate) and offers Check again (T-20261125-66f1, merged in). Songs that are copies of one recording (`same_recording_as`, `same_file_as`) are counted once: "6 songs analysed, 5 different recordings (a mix plays each recording once)", and Make a mix needs two different recordings. `minutes()` now says "less than a minute", only for a real estimate.

**The reload prompt.** The only `beforeunload` handler in the web app is the import guard (`importSession.ts guardUnload`); the hosted player, the browser mix builder and the mix outbox register none. It asked whenever a resilient import was running and its files were not all read yet, including a folder's import that SelectaDJ started by itself on load (a watched folder's check or an interrupted import carried on with a remembered handle). A folder's import loses nothing on reload (the handle and the journal carry it on next visit), so it no longer asks; only picked or dropped files, which the browser forgets, still ask until every file is read. Not reproduced against staging (no access): staging's prompt is consistent with a folder import carried on at page load.

**Seek reads.** Measured in one Chromium page (Playwright) against a local Range stub with 60 ms per read, a 3:20 24-bit 4096-sample-frame FLAC per song (script and files in the session scratchpad `seek/`); a jump to song 2 and a second jump 40 s into it 1.5 s later, then 18.5 s of playing:

| | Reads | Bytes | First sound after the last jump |
|---|---|---|---|
| Before | 12 (header read again for every jump, 2 probes and a full 8 s window before any sound) | 5.2 MB | 1,038 ms |
| After | 11 (header once per file per session; the probe that finds the frame is the first window) | 5.7 MB (more of it played) | 501 ms |
| Before, 4 jumps 300 ms apart, 400 ms per read | 16, none cancelled: every abandoned seek ran to its end | 4.2 MB | 2,053 ms |
| After, the same | 7 completed, 3 aborted | 3.7 MB | 1,502 ms |

No long task in any run. What changed: each file's header is kept for the session (by the link without its signature); every frame position seen is remembered per file, so a later jump starts its bracket from them; once a bracket is real the probe is as long as the first window and that window plays from its bytes; the first window after a start or jump is 3 s rather than 8 s; every read carries an `AbortSignal` that a stop or jump aborts; a jump keeps the audio context running (it used to suspend it, and the suspend could land after the new start's resume). The staging figure of about 45 reads in 20 s was not reproduced here (one jump is 4 to 5 reads); the likeliest causes are repeated presses (each one's seek ran to its end) or the store refusing ranged reads (each read then fetched the file from its start, fixed by the `range` CORS header in `infra/cloudflare/main.tf`, which the owner applies).

**Track.** The player's bar track was `--surface-control` on a `--surface-control` panel: invisible. It is now `color-mix(in srgb, var(--border-strong) 75%, var(--border))`: 4.47:1 against the panel in dark and 3.22:1 in light, and the fill 3.21:1 and 3.68:1 from the track.

**One sound per browser.** The hosted mix now holds the app's own audio lock (`audioTab(workspaceId)`, `selecta-audio:<workspace>`), the same one the browser mix's speaker holds, so a Play on either in any tab stops the other first. A take message carries its page, so a take from the same page (the hosted mix beside the browser mix it has just paused) stops the other player without it claiming "Playing in another tab". When another tab takes the hosted mix's sound the card shows the app's `OtherTabLine` ("Playing in another tab." with Play in this tab instead), and when that tab lets go "The tab that was playing closed." with Carry on here, which carries on from where it stopped. Checked after merging PR #148: the app's playback still claims on a press, releases when it stops speaking and listens with `onTaken`, the same calls the card makes.

**Listen for a hosted account.** With no device with music open, Listen said "None of your devices with music is open right now". A hosted account (`cloud.hosted_render` and stored media) is told "Your uploaded songs are kept in your SelectaDJ storage and play right here in this browser." with Make a mix from them (to `/mixes`); with a device open, Play on it stays and the line under it points at Make a Mix for the uploads. The cutover note stays dismissed after Got it or the close button: the dismissal is kept per account in `localStorage` (`selecta.cutover-notice.<account>`), read before the first draw; it comes back only where storage is refused, by design.

**Phone, here.** At 390 px with touch emulation (Chromium, light and dark, every state): no sideways scroll, every press 44 px or taller, and the page scrolls far enough that the bottom navigation clears the card's foot (the shell pads `.content` by `--bottom-chrome`). A window the browser cannot decode, a decoder that never answers (20 s) and a browser with no Web Audio now stop with plain words ("this browser could not play the mix’s lossless audio. Try it in another browser, or export the mix and play the download.") instead of hanging or retrying; an older Safari's `webkitAudioContext` and callback-only `decodeAudioData` are used when there is nothing newer. Playwright's WebKit on Windows has no Web Audio at all, so nothing about Safari's decoder could be measured here.

**Still to check on a real iPhone (T-20261125-0cce).** Safari has decoded FLAC in `decodeAudioData` since Safari 11 (iOS 11), through the system's decoder; what is not known is how it takes the player's windows:
1. A window is a STREAMINFO block with total samples 0 and no MD5, followed by frames from the middle of the file: does it decode, to the exact frame count, at 24 bits?
2. `new AudioContext({ sampleRate: 44100, latencyHint: 'playback' })` on iOS 14.5 and later: the context's real rate, and whether the joins stay sample-exact when the device runs at 48 kHz (Safari may resample each window).
3. The ring/silent switch: Web Audio is muted by it unless the page sets `navigator.audioSession.type = 'playback'` (Safari 16.4 and later) or plays a media element; the player sets neither today.
4. Playing on with the screen locked or Safari in the background: iOS suspends a Web Audio context in a background tab; does the mix stop, and does Play carry on afterwards?
5. Memory and decode time per window on an older iPhone (a 3 to 8 s window, about 1.1 to 2.9 MB decoded) while scrolling the track list; no long task over 200 ms.
6. The 530 MB export download on iOS: Safari saves it to Files; does a stopped download resume?

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

## 10. Edge cases (2026-11-25, checked against the code)

The owner's 23 edge cases for hosted mode (to-do T-20261125-803e) were reasoned out first and then checked one by one against the code: Handled means the code and a test prove it, Fixed means it was a real gap fixed with a test on branch `hosted/edges`, Filed means it is a real gap that is large or needs a decision and is now its own to-do item. The highest-risk cases came first (account deletion, billing states, storage, caps, hostile files, clipping).

**What could have lost data, leaked music or cost money without limit.** No path was found that shows one customer's music to another: every hosted read is scoped to the caller's workspace (the tenant matrix in section 3), keys are built from ids alone and checked against their workspace before signing, and the account purge refuses to widen past its prefix. Two real gaps were fixed: a deleted song's lossless playback file (a complete copy of the music) was never erased, and hosted exports were never counted against the plan. Money is bounded per pool by each pool's daily spend ceiling and per account by lane concurrency, but not per account per day (filed).

| # | Case | Outcome | Evidence |
|---|---|---|---|
| 1 | Lossless playback on a phone plan (about 700 MB an hour) | Filed | Design for a data saver stream: T-20261125-5dc9 |
| 2 | Storage for derived files and exports; old exports and failed attempts' files | Filed | Handled part: derived data is not charged to the customer and lives under an LRU budget (`storage/eviction.py`; `test_cloud_storage_eviction.py::test_exports_are_never_evicted_and_never_use_the_derived_budget`); exports are charged and expire per plan (`storage/export_expiry.py`; `test_cloud_export_expiry.py::test_publishing_an_export_charges_its_bytes_to_storage`, `::test_each_plan_keeps_exports_for_its_own_retention`). Gap fixed (section 11.1): the derived-files collector deletes failed and superseded attempts' files and idle playback files (`storage/derived_gc.py`; `test_hosted_collector.py`). The derived budget against playback files: T-20261126-0ac7 |
| 3 | Caps on uploads, analysis, repeated mixes and exports | Fixed | Exports take the plan's monthly allowance once (`hosted_export.allow_export`); hosted routes have their own rate limits (`ratelimit.STRICT`: plan 10 a minute, render and export 90, prepare and retry 30); `test_hosted_edges.py` (allowance, route buckets). Uploads were already capped by quota and the `upload_plan` bucket. Fixed too (section 11.2): a song's first analysis takes one of the plan's daily analyses and each new transition takes its measured seconds from a daily transition budget per plan (`hosted_caps.py`; `test_hosted_gaps.py`); the owner confirms the numbers (T-20261126-9223) |
| 4 | An engine version bump invalidates every stored result | Handled | Every hash carries its versions (`hosted_render.analysis_hash`, `seam_hash`, `PROXY_VERSION`, `EXPORT_VERSION`), so nothing old is reused. Nothing re-queues platform-wide: each workspace asks again when its card opens or a mix is asked, within the per-workspace queued caps, fair share and each pool's daily spend ceiling; old rows leave by LRU eviction. `test_hosted_edges.py::test_an_engine_version_bump_changes_every_hosted_hash`. A bump does re-analyse each customer's whole library once: T-20261125-ea6b makes sure that never counts against their allowance |
| 5 | Cancel, downgrade, past due | Fixed | Nothing is deleted; over the new limit the account is read only (`usage/quota.py`; `test_cloud_over_quota.py::test_an_over_quota_workspace_is_named_and_refused_new_uploads`); a shorter export retention runs from the drop (`test_cloud_export_expiry.py::test_a_drop_to_free_gives_free_retention_again_from_the_drop`); jobs read the plan at dispatch (`CloudJobEntitlements.standing_in`); past due keeps the plan for 7 days (`stripe_sync.PAST_DUE_GRACE_SECONDS`). Gap fixed: a hosted export could still grow storage while read only; now refused in plain words (`test_hosted_edges.py::test_no_export_is_made_while_storage_is_over_the_plans_limit`) |
| 6 | Takedown of hosted originals and exports | Filed (owner) | `admin/takedowns.py` hides and purges the original; whether exports containing it go, and how fast derived copies go: T-20261125-7306 |
| 7 | Account deletion removes every hosted object; the ledger records it | Fixed | Account: jobs cancelled, staging uploads aborted, tombstone, then every key under `w/<workspace>/` in originals, derived and exports purged after 30 days and mirrored off-database (`identity/deletion_effects.py`, `storage/maintenance.py`); new `test_cloud_storage_deletion.py::test_purging_an_account_erases_every_hosted_file_and_every_attempts_leftovers` (analysis, playback, seam and export files of winning, failed and superseded attempts). Worker scratch is a per-attempt folder removed after (`workers/context.py`); signed links live 15 minutes and memberships go at once. Gap fixed: deleting one song left its lossless playback file (a full copy of the music), analysis and transition clips for ever; the purge now erases them (`storage/maintenance.song_derivatives`; `test_cloud_storage_deletion.py::test_a_songs_purge_erases_what_was_derived_from_it_once_no_copy_is_left`) |
| 8 | Staff switch hosted storage off | Fixed | Originals stay listed, playable and deletable (`cloud.stored_media`; `test_bf_hosted_jobs.py::test_each_hosted_job_drains_on_revocation_and_resumes_when_granted`). Gap fixed (section 11.4): finished exports are listed with links at `GET /api/stored/exports` under `cloud.stored_media`, and originals download through `GET /api/assets/{id}/playback-url?download=true`, both open without the grant (`test_hosted_gaps.py`, `test_cloud_tenant_isolation_hosted.py::test_stored_exports_list_only_the_callers_own`); the Library's buttons: T-20261126-9d4d |
| 9 | Hostile and odd files reaching ffmpeg | Fixed | Upload sandbox: sniff past tags, header, full decode in a child under a 120 s timeout and memory, CPU and write limits, 2-hour cap, decoded length stored so a lying header is caught (`storage/audio_check.py`; `test_cloud_upload_sandbox.py::test_a_header_that_understates_the_audio_is_stopped_at_the_claim`, `::test_a_decode_bomb_is_stopped_part_way_not_decoded_to_the_end`, `::test_a_hung_child_is_killed_at_the_timeout`). Workers: list arguments (no shell), file-only protocols, a format whitelist, one thread. Gap fixed: the analysis and transition normalise ran ffmpeg with no time bound; now `workers.context.run_tool` stops it at a cancel or the job's runtime limit (`test_hosted_edges.py::test_a_program_that_hangs_is_stopped_when_the_attempt_runs_out_of_time`) |
| 10 | Clipping in the export with positive gain | Fixed | `gain_db` never lifts the sample peak over -1 dBFS and the export clips (never wraps) any 24-bit overshoot. Gap fixed: a near-silent song asked for over 100 dB, which the export refused and the player turned into full-scale hiss; now held to the export's -60 to +24 dB (`hosted_render.GAIN_RANGE_DB`; `test_hosted_edges.py` gain tests) |
| 11 | Music with no steady beat | Handled | Analysis fails it as the song's own failure with "No steady beat was found in this song.", shown on its row and left out of mixes (`workers/engine_handlers.analyse`; `test_hosted_stuck_jobs.py::test_failures_on_our_side_renew_a_few_times_and_a_songs_own_failure_waits_for_try_again`). Tempo changes: Beat This tracks each beat, no constant tempo is assumed |
| 12 | One song, 500 songs, a 20 s clip, a one-hour track | Fixed | One song: the card says a mix needs two different analysed songs and an export refuses. A clip with no exit cue is left out of planning (`plan_mix`). Gap fixed: a library over 60 recordings only ever planned its first 60 uploads; now 60 are picked at random for each plan and the card says so (`hosted_render.planning_pool`, `hostedWords.poolWords`; `test_hosted_edges.py::test_a_large_library_is_sampled_for_each_plan_in_upload_order`, `HostedMix.test.tsx`). Long tracks fixed (section 11.6): songs over 30 minutes get no job and say why at once, job limits follow the song's length, exports stop at 4 hours (`hosted_limits.py`) |
| 13 | Duplicate rule merging clean and explicit, live and studio | Handled | The normaliser only case-folds and collapses spaces (`local_media.versions.name_key`); "(Live)", "(Clean)", "(Explicit)", "(Remix)", "(Acoustic)", "(Instrumental)" stay in the title, so those versions are never merged (`test_hosted_edges.py::test_a_marked_version_is_never_merged_with_the_plain_one`). Two files with identical names within 3 s are still one recording; telling them apart needs tags (T-20261125-b9c3) |
| 14 | A song deleted or replaced during rendering, playing or export | Handled | Every hosted read takes only live songs (`hosted_render._songs`), so the next poll drops it; a part already playing finishes on its 15-minute link; a queued export joins its stored parts, which stay through the recovery window; a re-upload is a new song (`test_hosted_edges.py::test_a_deleted_song_is_never_analysed_listed_or_planned_again`) |
| 15 | Locked phone screen, calls and Bluetooth changes | Filed | 15 s scheduled ahead copes with once-a-second timers; no Media Session or interruption handling: T-20261125-aefa (with T-20261125-0cce, T-20261125-d7a5) |
| 16 | Remotes, room requests and Lucy's Save and play | Filed | The hosted player is not a session speaker: T-20261125-dfa3 |
| 17 | The same song uploaded and on the device | Handled | The catalogue lists each song once; an upload is a fallback matched by content, then exact name, never a guess (`web/src/cloud/hostedMedia.ts`; `hostedMedia.test.ts`). The browser mixer plays the device copy; the hosted mix plays uploads only |
| 18 | Two devices pressing Make a mix or Export at once | Fixed | One live job per idempotency key (`test_cloud_jobs_enqueue.py::test_a_duplicate_idempotency_key_returns_the_same_job`; `test_hosted_stuck_jobs.py::test_a_replacement_that_lost_the_race_returns_the_winners_job`). The new export allowance takes one export for the pair (`test_hosted_edges.py::test_two_devices_pressing_export_at_once_make_one_job_and_pay_once`) |
| 19 | Alerts reaching a person outside the console | Fixed | Operator alert mail (section 11.3, `notify/operator_alerts.py`); the owner sets the address (T-20261126-483a) |
| 20 | Worker and gateway version skew during a deploy | Fixed | The gateway turns away a worker on another engine build and the worker exits (section 11.5, `work/engine_build.py`) |
| 21 | A bulk upload ahead of someone waiting to play | Handled | Fair share per account and lane; a mix's first two transitions are interactive (`hosted_render.mix_state`); `test_cloud_scheduling_simulator.py::test_saturation_with_default_caps_shares_the_pool_by_capped_fair_share`, `::test_no_backlogged_account_waits_beyond_its_bound_through_72_hours_of_premium_demand`, `test_cloud_scheduling_policy.py::test_interactive_gets_about_four_fifths_and_standard_is_never_starved` |
| 22 | Modal or the model host down | Handled | Queued work is never dropped, the card says it is waiting for a SelectaDJ server with no estimate, and operators get `work.queue_stuck` (`test_work_queue_health.py::test_a_stuck_pool_raises_one_alert_an_hour_and_nothing_is_dropped`, `test_hosted_stuck_jobs.py::test_the_status_never_estimates_when_nothing_moves`); the beat model is baked into the image (T-20261125-0c2b). The alert reaching a person: T-20261125-29a0 |
| 23 | Hosted transitions worse than the browser's until stems | Filed (owner) | T-20261125-c77c |

### 10.1 The real gaps, case by case

Section 11 (2026-11-26) closes the gaps filed below for cases 2, 3, 8, 12, 19 and 20; the paragraphs keep what was found.

**(2) Files of failed and superseded attempts.** A worker writes its outputs under its own attempt folder before it completes, and the artifact row names only the winner. A failed attempt, a lost lease or a republish leaves the other files behind, and the garbage collector two modules refer to does not exist, so they cost storage until the account is deleted. The derived budget is also small next to hosted playback files (about 40 MB a song against 15 % of plan storage), so a large library's playback files will be evicted and remade often. Filed with a sweep design (T-20261125-7e14).

**(3) Per-account caps.** The plan's export allowance was shown on the meter and never taken; hosted exports now take one per new export (never for asking again, a second device's press, or a retry after our failure) and are refused while storage is over the limit. The planning, mix and export routes now have their own rate-limit buckets sized for the card's 3-second poll. The daily analysis allowance is still never taken, and transitions have no per-account daily budget: filed with the rule that a re-analysis after our version bump must never count (T-20261125-ea6b).

**(5) Over quota.** Downgrades, cancellations and failed payments never delete music: the account turns read only. A hosted export grew storage even then; it is now refused with the reason in plain words.

**(6) Takedown.** Acting on a notice hides and purges the original. Whether exports that contain the song must also go, and whether its derived copies must be erased at once rather than after the 30-day window, are legal decisions for the owner (T-20261125-7306).

**(7) Deleting one song.** The account purge was complete (a new test covers every hosted kind and the files of failed and superseded attempts). Deleting one song erased only its original: its lossless playback file, analysis and transition clips stayed for good. The song's purge now erases every derived file whose provenance names its bytes, unless another live upload has the same bytes; exports stay, because they are the customer's own files and leave by plan retention.

**(8) Grant removed.** Originals stay listed and playable; a finished export can't be reached until the grant returns, and there is no Download original (T-20261125-d37b).

**(9) Hostile files.** The upload sandbox already decodes every file under time and memory limits and catches a header that lies. On the worker, the playback file's ffmpeg was bounded by the attempt, but the normalise step before analysis and transitions ran ffmpeg with no time bound, so a file that made it hang held a worker until the container died. Both now run through `workers.context.run_tool`, which stops the program at a cancel or the job's runtime limit. Worker memory is bounded only by the container (8 GB on cpu-heavy).

**(10) Levels.** A song's level never lifts its loudest sample over -1 dBFS, so positive gain does not clip, and the export clips rather than wraps any overshoot. A near-silent song asked for over 100 dB of gain: the export refused the whole mix as an impossible level and the player would have turned its noise into full-scale hiss. The level is now held to the export's -60 to +24 dB.

**(12) Extremes.** A library over 60 recordings only ever planned its first 60 uploads, so most of a large library never reached a mix. Each plan now picks 60 at random and the card says "Planned from 60 of your 500 analysed songs, picked at random. Make another mix picks again." Long tracks against the fixed job runtime limits, and the size of a long mix's export, are filed (T-20261125-4c09).

**(13) Versions.** The duplicate rule keeps "(Live)", "(Clean)" and the other markers in the title, so marked versions are never merged. Two files with exactly the same name within 3 seconds still count as one recording; only tags can tell those apart (T-20261125-b9c3).

**(15, 16) Devices.** The player keeps 15 seconds scheduled, which survives once-a-second timers, but it has no Media Session and does not notice an iOS interruption or a Bluetooth change (T-20261125-aefa); it is not a session speaker, so remotes, room requests and Lucy's Save and play can't reach it (T-20261125-dfa3).

**(19, 20) Operations.** Operator alerts are rows nobody is sent (T-20261125-29a0). Workers compute output hashes from their own engine versions and nothing keeps an old worker off new jobs, so a deploy with mixed versions fails jobs until the workers match (T-20261125-184c).

**(1, 23)** A data saver stream is designed in T-20261125-5dc9; better transitions wait on the stems decision (T-20261125-c77c).

**Not verified here.** Nothing ran on staging, Modal, Cloudflare or a real phone. The PostgreSQL variants of the new database tests run in CI only; locally they ran on SQLite.

## 11. Storage that only grew, per-account caps, alerts that reach a person (2026-11-26)

Branch `hosted/gaps`, from the gaps section 10 filed. Nothing here ran against staging, Modal, R2 or a mailbox (no access from here); every check below is a unit or route test on SQLite with a fake object store, a fake mail sender and a fake gateway.

### 11.1 The derived-files collector (T-20261125-7e14)

`storage/derived_gc.py`, the maintenance task `derived_gc` (hourly, `maintain_hosted.py`), flag `cloud.derived_gc` (off by default: the task then runs dry and only reports), and `selecta storage gc [--apply] [--workspace ID]` for an operator to read a dry run first.

An object under a workspace's derived prefix is deleted only when all hold: it is a valid derived key of that same workspace; no `artifacts` row and no live job's `input_ref` of the workspace names it (a queued export names playback files by key); its attempt folder is a `job_attempts` row of the workspace (anything else, such as the `features` arrays under the fixed folder `current`, is kept); that attempt ended more than **6 hours** ago; the object was written more than 6 hours ago; and when it was superseded, the attempt that replaced it also ended over 6 hours ago (a player may hold a 15-minute link to the old file). Why 6 hours: the longest job runtime limit is 36 minutes (a 30-minute song's analysis, section 11.6; `export.render` is 30), an upload link lives 15 minutes, and an ended attempt can't complete afterwards (completion is fenced), so a running attempt, or one that finished minutes ago with its row about to be written, never loses a file.

Bounded per run: 1,000 deletes, 20,000 listed objects, 2 minutes, then the next run carries on (a round robin over workspaces with ended attempts). Deletes are idempotent, so two runs, or a run beside an upload, are safe. Each workspace's deletions are one `storage.derived_gc` audit event (counts per kind, bytes, the attempt folders emptied); the run's totals go to the console's read model, which the Workers page reads as `pieces.collector`.

**Idle playback files.** Playback files are about 40 MB a song and remade on demand by `work.proxies.prepare` (15 to 35 s of cpu-light, about $0.0005). Keeping one a month costs about $0.0006 at R2's $0.015 per GB-month, the same as remaking it once, so files **unused for 30 days** (`PLAYBACK_IDLE_DAYS`) are expired: the row first, then the file, never one a playing or frozen revision, a kiosk horizon or a live job uses.

Tests (`tests/test_hosted_collector.py`): a live artifact's file survives, a failed attempt's files go, a running attempt's and a just-finished attempt's files survive, a superseded file waits for its replacement to age, a file a queued job names stays, another workspace's files are untouched (also when a faulty listing returns its keys), a dry run deletes nothing, a bounded run carries on, an idle playback file goes and a used one stays.

### 11.2 Per-account daily caps (T-20261125-ea6b)

`hosted_caps.py` (the numbers are at its top), flag `cloud.hosted_caps`.

- **Analysis** takes one of the plan's daily `analysis_song` allowance (Free 150, Standard 1,500, Premium 5,000), the counter the Plan & billing meter already shows, for a song's first analysis only: never for a re-analysis after our version bump, a renewal after our failure, Try again, or another copy of the same bytes (a ledger entry `hosted-analysis:<asset>` or any earlier `analyse.song` job for those bytes says it is paid). A song refused for the day waits with "Today's 150 song analyses on your plan are used. The rest start after midnight, or at once on a plan with more; nothing is lost." on its row; `GET /api/hosted/songs` also answers `allowance_used`.
- **Transitions** take processing seconds from a new daily `transition_cpu_seconds` allowance: this account's measured median for the planned move (`hosted_estimate.Durations`), else 40 s for a cut and 150 s for any other move. A hand-off that already has a job takes nothing.

| Plan | Transitions a day | At most a day at $0.24 an hour | About |
|---|---|---|---|
| Free | 20 minutes | $0.08 | one 12-song mix of blends |
| Standard | 60 minutes | $0.24 | three |
| Premium | 3 hours | $0.72 | nine |

A refused hand-off plays as a straight change with "Today's 60 minutes of transition rendering on your plan are used, so this hand-off plays as a straight change for now. It renders after midnight, or at once on a plan with more." as its `why`, and `mixes/render` answers `allowance_used`; the card's next render after midnight or an upgrade makes the job. Taking is atomic and happens before the job is made; if no new job results (another tab, a retried request, admission) it is given back. The owner confirms the numbers: T-20261126-9223. `work.queue_health` and the admin read models are unchanged.

### 11.3 Operator alerts by email (T-20261125-29a0)

`notify/operator_alerts.py`, the maintenance task `operator_alerts` (every minute), flag `cloud.operator_alerts`, address `SELECTA_ALERT_EMAIL` on the maintenance service (the owner sets it: T-20261126-483a), through the existing Postmark or Resend sender. Conditions: a pool's queued work waiting over 15 minutes (the `work.queue_stuck` rule), the worker gateway's `/api/ready` not answering, not ready or on another schema (needs `SELECTA_WORKER_GATEWAY_URL` on the maintenance service), the autoscaler's last pass failing on Modal, and a pool held at its daily spend ceiling. One mail per condition per hour, a "Resolved" mail when it clears, kept in the read model so a restart neither repeats nor forgets. Each mail says what is wrong, what it means and what to do in the Workers page's words, with counts and times only. With no address nothing is sent and the console's setup checklist shows "Operator alerts reach you by email" open.

### 11.4 The grant switched off (T-20261125-d37b)

The grant gates new processing, not a customer's files. `GET /api/stored/exports` (under `cloud.stored_media`, open without the grant) lists finished exports with 15-minute download links and when each expires; originals already download through `GET /api/assets/{id}/playback-url?download=true` under the same flag. Tenant rules unchanged: the route reads only the caller's workspace (`test_stored_exports_list_only_the_callers_own`). The Library's list and Download original buttons are the web's: T-20261126-9d4d.

### 11.5 Engine builds during a deploy (T-20261125-184c)

`work/engine_build.py`: `a<analysis>.r<render>.p<proxy>.x<export>`. Workers report it at registration; the gateway turns away a worker on another build with HTTP 409 `engine_build_mismatch` (at registration, and at its next claim or token refresh after the gateway is redeployed), records it for the Workers page (`pieces.gateway.refused_builds`), and the worker exits (`WorkerOutdated`, a `SystemExit`) so Modal starts it on the deployed image. Its jobs wait, they don't fail. The deploy order is in the operator checklist section 5. A worker image built before this rule reports no build and is let through.

### 11.6 Long tracks (T-20261125-4c09)

`hosted_limits.py`: a song over 30 minutes never gets a job; its row says at once "This song is 1 hour 2 minutes long. SelectaDJ's servers prepare songs of up to 30 minutes for mixes, so it stays in your library and plays on its own, but can't join a server mix." with no Try again. Within the limit, analysis may run 1.2 times the song's length (never under 1,200 s) and a playback file 0.3 times (never under 180 s); an export over 4 hours (about 2.8 GB) is refused before any job. A real 60-minute track on a real worker was not run.
## 12. Uploaded music on the one brain (2026-11-26, ADR-0479 Phase 6)

Branch `feat/one-brain-8`. Everything here ran as unit and route tests on SQLite with synthetic numbers (no audio rendered, no real worker, no upload, no PostgreSQL); listening is in `one-brain-listening.md`.

**Facts (`hosted_facts`, `cloud.brain`, default on).** A worker has no database, so the analysis handler now saves what the facts need and the server writes them: the analysis file carries the drum pattern pair (`pattern_bars`, `swing_bars`) beside the other arrays, and the job result carries the stored original's audio id when `library.audio_identity` is on. The first time `plan_mix` or `mix_state` reads a finished analysis whose catalogue song (an upload joins the catalogue under its own hash, `storage.catalogue_link`) has no facts, it calls `engine_store.facts_store.record_worker_analysis` with provenance `worker`, so `engine_store.songs.load_song` reads the upload like any other song. The same call is the backfill for older uploads: lazy, one query to find the songs without facts, at most 60 analysis files read per call and the rest on the next, nothing analysed again. A new job type was not used: catalogue jobs are claimed by workers, and workers have no database.

**Planning (`cloud.hosted_brain`, default off).** With the flag on:
- the order is `cloud_brain.planning.order`, the function `POST /api/planning/order` calls, over the songs' stored facts, with the account's seam memory and Never play; with fewer songs than an idea needs (6) it keeps the older order (`planner.beam.plan_set`);
- each `seam.render` job says `"brain": "core"` and carries each side's tempo and key correction and lyrics from the engine store; its hash adds those, so it is a new seam and a correction makes another;
- the worker (`workers.engine_core`) builds each song with `analysis.song.build_song`, the engine store's own builder, and runs `planner.choose.choose_transition`: `enumerate_candidates`, render, audit, `repair.next_step`, at most 5 takes, then the fallback cut, one decoded copy of each song shared by every take. `analysis.vocal_sense` is bound off for the loop, because no separator runs in Cloud.

With the flag off every job, hash and answer is the older one (`tests/test_hosted_brain.py` checks the job against the worker's hash written out). The business kiosk is unchanged: its horizon seams carry no mark and keep `workers.engine_seams`. Neither the kiosk nor the hosted path ever called `mix_contract.plan_seam`; that to-do (T-20261126-b1c6) now says only contracts' own seams use it.

**Renders per seam, worst case.** Older path (`engine_seams.best_seam`): 5 moves x 4 placements x (a take and a beat-tightening re-render), then the cut's own loop of up to 6: 46. Core path: 6.

**Which moves hosted can play.** No lyrics (most uploads): cut on one, echo out, reverb wash, ranked by the core. Lyrics known through a device: also bass swap and filter sweep blends of 8 or 16 bars, and the delay throw. Never on the server: stem moves (vocal ride, strip and land, intertwined stems), word moves, the Studio, bridges that need stems. What a stems handler must provide for the rest: to-do T-20261126-fdde (inputs, outputs, artifact keys).

**Seams kept (`hosted_brain.keep_seams`, `cloud.brain`).** Each rendered hosted seam, either path, goes into the seam tables once with a worker attestation (the attempt's worker id, the clip's hash and length, the audit verdict the artifact already carries), so Good and Bad, seam memory and the calibration report include uploaded-music mixes.

**Mixes (`cloud.account_mixes`, default off).** The account mix routes bring each `/cloud-mixes` mix in as a draft on first use, once, as recipes are; no revision is changed. The browser still reads `/cloud-mixes`: its calls are inline in `MakeCloudMix.tsx`, so the switch waits for one data module (T-20261126-555d).

**The local versus Cloud map** (`GET /api/cloud-mixes/capabilities`) is computed from the account's flags; no row says "not yet": the Studio lanes are Desktop only and Cloud needs sign-in, both said as decisions.

**Not run here.** PostgreSQL (row security on the facts and seam writes is the engine store's, already tested in CI), a real worker rendering a core seam, a real upload, the dev cloud stack.
