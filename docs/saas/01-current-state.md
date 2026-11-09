*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 2. What exists today (verified in the code)

### 2.1 Backend facts that drive the design

| Area | Today | File evidence | Cloud consequence |
|---|---|---|---|
| Binding | `uvicorn` on `127.0.0.1:8733`; middleware rejects any Host not in `{127.0.0.1, localhost, testserver}` and non-local Origins on writes | `cli.py:417-444`, `api.py:198-206`, `api_common.py:22` | Cloud mode swaps this for auth, CORS, trusted hosts, rate limits |
| Home | Everything under `SELECTA_HOME` (`~/.selecta`); old homes merged on start | `config.py:14-18`, `homes.py` | Becomes a storage interface; `homes.py` is local-only |
| Music references | Absolute file paths, `songs.path TEXT UNIQUE`; ffmpeg decode per call | `db.py:18`, `audio.py:24-47` | Asset IDs pointing at object keys; worker scratch dirs |
| Database | SQLite WAL, schema re-run on every connect, ad hoc `ALTER TABLE`, no version table, other modules create tables lazily | `db.py:159-203` | Real migrations (Alembic) for both SQLite and Postgres |
| "queue" table | The current playback mix, not a job queue | `mix.py:49-57` | Keep the name for the mix; new `jobs` tables for work |
| Seam work | API launches `python -m selecta.seam_worker`, sends JSON lines over stdin, reads results from `renders/seams/{key}/seam.json` | `seams.py:348-418`, `seam_worker.py:186-215` | Replaced by durable jobs; worker becomes a job runner |
| Priorities | `URGENT, REQUEST, MIX, LINE, LATER, PREPARING = range(6)` | `seams.py:140` (confirmed) | Map to lanes and urgency ([§4A.5](04-queue-and-scheduling.md#4a5-mapping-todays-ranks-onto-the-new-policy)) |
| Preemption | Cooperative: `jobs.check_in()` raises `Interrupted`; Demucs process tree killed; interrupted job re-queued | `jobs.py:24-44`, `stems.py:163-178`, `seams.py:629-638` | Keep; becomes "safe checkpoint" cancellation |
| Cross-process coordination | `rendering-mix` sign file renewed every 30 s | `jobs.py:95-115` | Replaced by lanes and leases |
| Analysis | Subprocess `selecta.cli analyse --from-app`; ~0.15 s per second of audio + ~15 s model load; ~1 GB RAM | `api_common.py:317-350`, `eta.py:76-77` | `analyse` pool; warm workers amortise model load |
| Analysis steps | ffmpeg → resample → Beat This (CPU) → librosa features → S-KEY key → pyloudnorm | `analysis/pipeline.py:95-201` | S-KEY must be replaced ([§10.3](10-audio-engine-in-cloud.md#103-model-licences-release-blocker)) |
| Stems | Demucs `htdemucs -d cpu` per ~46 s transition window, ~120 s each on the laptop; cached by path+mtime | `stems.py:146-270`, `eta.py:90-112` | `stems` pool on GPU; key by content hash |
| Export jobs | JSON files in `exports/jobs/`, "running" tracked in a process dict; unknown jobs rewritten as interrupted on read | `routes/exports.py:75-141` | Another instance would mark live jobs interrupted: move to `jobs` |
| Export path | Freeze snapshot (song ids + seam keys + revision hash) → wait for seams → join → FLAC `.part` → validate every frame → rename | `routes/exports.py:143-268`, `mix.py:355-409`, `export_validation.py` | Excellent model for immutable revisions; becomes a job with dependencies |
| Idempotency | `x-operation-id` replays first answer from an in-memory dict; `x-mix-order` rejects stale edits | `api.py:102-193` | Move to a Postgres table; keep the stale-edit check |
| Cache keys | Seam key = sha256 of request (local song ids + versions); stem key = sha256(path, mtime, start, dur) | `seam_kinds.py:117-124`, `stems.py:198-202` | Re-key on asset content hashes scoped to the workspace |
| Startup side effects | `forget_unfinished()` deletes every "rendering" seam.json; restore swaps DB file; watcher, warm-up and worker threads start | `api.py:53-67,208-221` | Must not run in cloud API; would wipe other instances' work |
| Lucy | Provider kinds builtin/anthropic/openai; default `claude-opus-5-5`; API keys in plaintext `lucy-secrets.json`; budgets per run; `Semaphore(2)` | `lucy/settings.py`, `lucy/providers.py`, `lucy/agent.py:39,113` | Cloud: server-owned routing and secrets; per-account concurrency |
| Discovery | `--exhaustive` walks all N(N−1)/2 pairs every run; sampled search ~80·N; spare-time prep ±8% tempo, top 2 partners | `discovery/sweep.py:29-74`, `planner/prepare.py:90-133` | Must be budgeted per account; exhaustive mode disabled in cloud |
| Lyrics | LRCLIB lookup per song; wav2vec2 alignment on CPU | `lyrics/lrclib.py:23`, `lyrics/align.py:235-260` | Rate limits and licensing ([§10.5](10-audio-engine-in-cloud.md#105-lyrics-in-cloud-mode-needs-a-decision)) |
| Routes | ~125 endpoints in 9 modules (largest: Lucy 32, edit 19, mixes 17, system 18) | `routes/` | Each gets tenant scoping; system/diagnostics split into user vs admin |

### 2.2 Frontend facts

- **Navigation** (`web/src/shell/manifest.ts`): Listen `/listen`, Make a Mix `/mixes`, My Mixes `/mixes/mine`, Library `/library`, Workspace `/workshop` (tabs: Overview, Analysis, Sources, Storage, Learning, Diagnostics). Hand-rolled router in `web/src/router.ts`; the only gate is "no songs → first-run screen".
- **First run** (`views/Start.tsx`, `views/Setup.tsx`): asks for a Windows folder path pasted from File Explorer; steps "Connect music → Prepare library → Start listening"; mixes unlock at 6 ready songs.
- **Machine-specific settings** to remove or move in cloud mode: cache budget slider and "free on this drive", local backup/restore ("Restart Selecta"), watched folders and relink, analysis copy about "keep using your PC", Diagnostics (python, platform, worker), Lucy provider/model/base URL/API key/spend limit.
- **27 strings** say "this PC", "this computer" or "File Explorer"; several say "Restart Selecta".
- **Updates are polling** (`useVisiblePoll`): `/status` 4 s, `/mix` 1.5 s while busy, `/jobs` 5 s, exports 1.5 s, drafts 4 s, plus one SSE stream for Lucy. At 1,000 online users that's several hundred requests per second of mostly-unchanged answers.
- **Player** (`web/src/player.ts`): fetches whole files from `/api/songs/:id/audio` and `/api/seams/:key/clip`, `decodeAudioData`, schedules with 30 ms crossfades; no Range requests, same-origin, no auth headers. Audio focus rules in `web/src/audio/focus.ts`; single-tab playback via `BroadcastChannel`.
- **Lucy UI** stores token usage and cost per run but never shows it.
- **PWA**: manifest only, no service worker.
- **Tests**: 36 Vitest files, 11 Playwright specs on Edge with axe-core accessibility checks at 1440/375 px in both themes. One test asserts "the page only ever talks to this computer"; it must become mode-aware.
- **Design system**: three-layer tokens in `web/src/styles/tokens.css`, solid primitives (`Status`, `Dialog`, `Drawer`, `Tabs`, `Field`, skeletons). Missing for admin: a data table, charts.

### 2.3 Process and docs facts

- 390 ADRs (`docs/adr/adr-NNNN-kebab-title.md`, later format has Decision / Implementation / Independent verification header bullets and a numbered checklist). ADR-0390 (feature flags, merged in PR #42/#43 today) is the newest; next free number: **ADR-0391**. Index is `docs/adr/README.md` (programme summaries, newest first).
- Feature flags: a registry of ~90 flags in `src/selecta/flags/*.json`, read once per process from `SELECTA_FLAGS`, enforced on routes (403 `flag_off`) and at background-work sources, mirrored in the site with a reflow sweep. Developer-only by decision; no per-user context yet ([§11B](11b-feature-flags.md#11b-feature-flags-and-targeting)).
- CI: one workflow (`.github/workflows/test.yml`): Python on Windows in 2 shards with ruff and the file-length rule, web unit + build on Ubuntu, Playwright on Windows in 2 shards, coverage gate 70%. Full Python suite historically ~18 minutes.
- **No file may exceed 1,000 lines** (`tests/test_file_length.py`), docs included. This proposal is split into chapters for that reason.
- No Docker, compose or deploy config exists yet.
- Licensing: GPL-3.0-or-later (pedalboard, Rubber Band). Model weights: S-KEY non-commercial; Beat This MIT code and weights per the project; Demucs code MIT (weights licence not stated, training data includes research datasets); wav2vec2 via torchaudio.

### 2.4 Where the brainstorm was right, and where it needs correcting

**Right and kept:** Postgres as the authority for jobs; leases with fencing; at-least-once execution with exactly-once publication; dependency graphs instead of mega-jobs; separate CPU and GPU pools; direct-to-storage uploads with atomic quota reservations; over-quota read-only on downgrade; webhooks verified and reconciled against Stripe; server-owned model routing; staff roles separate from subscription tiers; deny-by-default authorization with RLS as backup; audit logs; stress tests with invariants and post-run reconciliation.

**Corrected or added here:**

| Brainstorm said | Correction |
|---|---|
| Tier-level shares 10/30/60% | Per-account weights 1/3/6 (stable per-user promise); see [§4A.4](04-queue-and-scheduling.md#4a4-scheduling-policy) |
| Fly.io for GPU | Withdrawn Aug 2026; use Modal (or Runpod) for GPU |
| Presigned upload with size limits | R2 has no POST policies; enforce size at server-side multipart completion |
| Generic "Lucy settings" cleanup | Concrete split per mode; local keeps bring-your-own-key |
| Model licensing as a footnote | S-KEY is non-commercial: a hard blocker with a replacement plan |
| Silent on lyrics | LRCLIB usage and lyric display need a decision and likely a licence |
| Silent on playback format | Whole-WAV playback can't ship; playback proxies and lossy-codec priming are real design problems ([§5.8](05-storage-uploads-playback.md#58-playback-in-the-cloud-a-real-design-problem)) |
| Silent on UK specifics | UK VAT + EU VAT for digital services, ICO fee, UK GDPR transfers, consumer cancellation rights, Children's Code, no UK private-copying exception ([§12](12-security-privacy-legal.md#12-security-privacy-and-legal)) |
| "Add workers" | Workers must not hold DB credentials; a worker gateway API hands out jobs and signed URLs ([§4A.6](04-queue-and-scheduling.md#4a6-workers-and-the-claim-protocol)) |
| Silent on existing non-goals | 212 ADRs forbid SaaS; supersede for cloud mode only |
| Feature flags as a generic admin page | The repo already has a strong developer flag registry; extend it with layered, context-aware decisions instead of adding a second system ([§11B](11b-feature-flags.md#11b-feature-flags-and-targeting)) |
| Silent on devices | One playback session per account with a device lease, remotes and transfer ([§11A.1](11a-devices-and-rooms.md#11a1-devices-and-the-playback-session)) |

---

[← README.md](README.md) · [Contents](README.md#chapters) · [02-plans-and-economics.md →](02-plans-and-economics.md)
