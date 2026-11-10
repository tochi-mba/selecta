*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 10. The audio engine in the cloud

### 10.1 Storage abstraction for the engine

The engine keeps working on local files. A worker downloads inputs to a scratch directory, runs the existing functions (`analysis/pipeline.py`, `seam_making.py`, `stems.py`, `mix.py`), and uploads outputs through an `ArtifactStore` interface (`open_input(asset)`, `publish(attempt, path, kind)`, `verify`). Local mode's implementation is "the file is already here". This minimises changes to the DSP code.

**Current implementation.** A handler gets the interface on its job context (`workers/context.py`): `ctx.open_input(key)` gives a local path for the length of a `with` block, `ctx.publish(kind, input_hash, path, name)` stores the file at the attempt's own key `w/{workspace}/{kind}/{input_hash}/attempts/{attempt}/{name}` and queues its manifest row with the size and SHA-256 the store measured, and `ctx.verify(key, size, sha256)` checks a stored object. Every key is checked against the job's own workspace first. `WorkerRunner(..., artifact_store=...)` chooses the store: `LocalArtifactStore` (the file is already in the local folder) or `R2ArtifactStore` (downloads to a private temporary folder) from `storage/artifacts.py`. A gateway worker holds no storage credentials, so the same calls go through its claim's signed URLs. `StoredOutputs(store)` is the job store's output check: before `complete` marks a job succeeded, each output must be a derived key under its workspace's `{kind}/{input_hash}/attempts/` prefix with the reported size and hash. Tests: `tests/test_cloud_worker_artifacts.py`.

### 10.2 CPU vs GPU

| Stage | Where | Reason |
|---|---|---|
| Validate, proxy, tags, hashes | cpu-light | I/O bound |
| Beat This, features, loudness, key | cpu-heavy | Already CPU; small model; warm workers amortise ~15 s load |
| Lyric alignment (wav2vec2) | cpu-heavy (GPU later if profiling says so) | |
| Demucs stem windows | **GPU** (T4/L4 on Modal), CPU fallback | ~120 s CPU vs a few seconds GPU per window |
| Transition render, export join/encode/validate | cpu-heavy | DSP, pedalboard, Rubber Band |

Workers are Linux images with models baked in at build time (pinned hashes), so no worker downloads weights at runtime. Model checkpoints and engine versions are part of artifact provenance.

### 10.3 Model licences (release blocker)

| Model | Use | Licence status | Action |
|---|---|---|---|
| **S-KEY** (Deezer) | Key detection | **Non-commercial research only** | **Replace before any paid plan.** Options, in order: (1) train a small key classifier on data you have rights to, (2) a classical chroma/profile method (no weights; already the fallback in `analysis/key.py`) tuned and benchmarked against S-KEY on your library, (3) license S-KEY commercially from Deezer if they offer it. Avoid Essentia (AGPL) and madmom models (non-commercial). |
| Beat This (CPJKU) | Beats | MIT code and weights per the project | Confirm the LICENSE and model card; record in a licence register |
| Demucs htdemucs | Stems | Code MIT; weights licence not stated; trained partly on research datasets | Legal review; widely used commercially, but get advice |
| wav2vec2 (torchaudio) | Lyric alignment | Code MIT, training data CC BY | Record attribution |
| pedalboard, Rubber Band | DSP | GPL (Rubber Band also sells commercial licences) | Server-side use isn't distribution; the local edition stays GPL |

A [`docs/saas/licence-register.md`](licence-register.md) lists every model and dependency, its licence, and whether it's allowed in cloud mode. In cloud mode every model loader calls `selecta.modes.models.require_model(id)` before reading weights, and it raises `ModelNotAllowed` unless the register's allowlist (`src/selecta/modes/model_allowlist.json`) marks the model `allowed`; S-KEY is blocked, so cloud analysis uses the chroma fallback, and Demucs is under review, so stems don't run in cloud mode yet. A test fails when the register and the allowlist disagree. Checking the worker images themselves is still to do.

### 10.4 Discovery and spare-time work under budgets

- `discover --exhaustive` (all N(N−1)/2 pairs, re-walked every run) is disabled in cloud mode.
- Sampled discovery (~80·N) runs as speculative slices with persisted cursors, resumable, within the tier's speculative budget.
- Spare-time transition preparation (±8% tempo, top 2 partners) is driven by "likely to be played soon" signals (current mix, recent drafts, requests) and the daily budget, never by library size alone.
- Library-scale jobs never materialise millions of rows: workflows page through candidates.

### 10.5 Lyrics in cloud mode (needs a decision)

Today each song triggers an LRCLIB lookup (artist, title, album, duration), and synced lyrics feed wordplay features, alignment and the Listen page's lyric display. In a paid cloud product: (a) one service making lookups for every user's library will hit LRCLIB's informal ~1 request/second guidance and its terms; (b) displaying lyrics commercially normally needs a licence from publishers via a lyrics licensor (LyricFind, Musixmatch). Recommendation for beta: lyrics lookups queued and rate-limited globally, lyric *display* off in cloud mode unless licensed, wordplay features shown as "connections" without quoting lines, and a written enquiry to LRCLIB's operators. Decide properly in Phase 0 with legal advice.

**The global rate limit today.** In cloud mode every LRCLIB request takes a token from one database-backed token bucket (`usage/rate_limit.py`, table `rate_buckets`, row `lrclib`) before it goes out, so every API instance, worker and account together stay under `SELECTA_LRCLIB_RATE_PER_S` (default 1 a second) with a burst of `SELECTA_LRCLIB_BURST` (default 1). Taking a token locks the bucket row with a waiting `FOR UPDATE` and tops it up by the database's clock, so processes on different machines agree; a caller with no token sleeps until one is due. A cloud process with `SELECTA_DATABASE_URL` installs the bucket before its first lookup; local mode never uses it. `tests/test_cloud_lyrics_rate_limit.py` runs twelve callers on four engines against PostgreSQL and checks no one-second window carries more than the rate allows. The rate itself is to be agreed with LRCLIB's operators (SC-0406-01).

### 10.6 Versioning and cache reuse

Artifacts record input asset hashes, analysis version (`ANALYSIS_VERSION`), render version (`RENDER_VERSION`), model checkpoints and settings hash. A new engine version doesn't invalidate exported revisions; new requests use new versions; old artifacts are evicted by normal budgets. Mixed-version workers during a deploy are safe because jobs declare the engine version they need.

---

[← 09-lucy-ai-gateway.md](09-lucy-ai-gateway.md) · [Contents](README.md#chapters) · [11-ui-ux.md →](11-ui-ux.md)
