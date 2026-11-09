*Part of the [Selecta Cloud proposal](README.md). Proposed, for owner review.*

## 4A. The processing and queue system (the core)

This is where most of the engineering care goes. The rules below are written so they can be implemented, simulated and tested exactly.

### 4A.1 Vocabulary

- **Job**: one unit of work with typed inputs and outputs (e.g. "analyse asset X with analysis v4").
- **Pool**: a class of worker capability (CPU light, CPU heavy, GPU). A job targets one pool.
- **Lane**: interactive, standard or speculative; decides how urgently a job competes inside its pool.
- **Attempt**: one execution try; holds a **lease** with a **fencing token**.
- **Workflow**: a parent grouping (e.g. "prepare mix revision R") whose jobs form a dependency graph.
- **Artifact**: an output object plus a manifest row recording provenance.

### 4A.2 Job catalogue (v1)

| Job type | Pool | Typical cost | Default lane | Depends on | Output |
|---|---|---|---|---|---|
| `ingest.validate` | cpu-light | 1–5 s | standard | upload complete | probe JSON, content hash, tags |
| `play.proxy` | cpu-light | 3–10 s | inherits from the mix that needs it | validate | playback FLAC (system-managed, evictable). Created lazily when a song enters a mix revision or a preview, never for the whole library; skipped when the original is already lossless at the analysis sample rate ([§5.8](05-storage-uploads-playback.md#58-playback-in-the-cloud-a-real-design-problem)) |
| `analyse.song` | cpu-heavy | ~0.15× duration + warm model | standard (interactive if user tapped "Analyse") | validate | features `.npz`, analysis row |
| `lyrics.fetch` | cpu-light (network) | <1 s | standard | validate | lyrics row (subject to [§10.5](10-audio-engine-in-cloud.md#105-lyrics-in-cloud-mode-needs-a-decision)) |
| `lyrics.align` | cpu-heavy | 10–40 s | standard | lyrics, analyse | alignment |
| `stems.window` | gpu (cpu fallback) | 3–5 s GPU / ~120 s CPU | inherits from parent | analyse | 4–5 stem WAV/FLAC |
| `seam.render` | cpu-heavy | 5–80 s | interactive / standard / speculative by context | analyse ×2, stems (optional) | clip, preview, seam manifest |
| `mix.prepare` (workflow) | — | — | — | — | marks revision playable |
| `export.render` | cpu-heavy + scratch disk | minutes | standard | all seams of frozen revision | FLAC export, validated |
| `discover.sweep` | cpu-heavy | bounded slices | speculative | analyses | comparisons, links |
| `maintenance.*` | internal | — | — | — | GC, reconcile (not tenant-visible) |

Room requests ([§11A.2](11a-devices-and-rooms.md#11a2-rooms-premium)) add no new job type: they enter the existing request planner and produce `seam.render` jobs in the host's interactive lane. Every job type names the feature flag that owns it ([§11B.4](11b-feature-flags.md#11b4-enforcement-in-the-cloud)).

Every job row stores: `id`, `workspace_id`, `type`, `pool`, `lane`, `urgency` (0–5, server-assigned), `needed_by` (optional deadline), `input_ref` (typed JSON), `idempotency_key` (unique per workspace+type), `est_cost_s`, `actual_cost_s`, `state`, `attempt_count`, `max_attempts`, `not_before`, `engine_version_required`, `entitlement_version`, `created_by`, timestamps.

**No duplicate work.** A partial unique index on `(workspace_id, type, idempotency_key) WHERE state is not terminal` means two requests for the same work (two tabs, a retried click, a producer racing itself) create one job; a failed job can still be retried as a new one. Before creating a seam or stem job, the producer checks for an existing artifact with the same input hash and reuses it.

**Workers never write to the database.** A job's results (analysis summaries, seam reports, lyrics rows) travel in the `complete` call and are applied by the API inside the same fenced transaction that marks the job succeeded ([§4A.6](#4a6-workers-and-the-claim-protocol)). Large results are artifacts; the `complete` payload is capped (e.g. 1 MB).

### 4A.3 Lifecycle

```
 created ─► waiting_deps ─► queued ─► leased ─► running ─► validating ─► succeeded
                │              ▲         │          │            │
                │              │         └─lease expired/worker lost──► queued (attempt++) or failed
                │              └──── retry_scheduled ◄── retryable error
                ├─► blocked (prerequisite failed/cancelled; may be retried by user)
 any non-terminal ─► cancel_requested ─► cancelled   (running work stops at next safe checkpoint)
 failed (terminal): permanent error or attempts exhausted → visible reason, retry button if allowed
 quarantined: poison input (crashed N workers) → admin review
```

Rules: state changes only through one module (`selecta/jobs/state.py`) inside transactions; each transition writes an `outbox_events` row (feeds SSE and metrics) in the same transaction; terminal states are immutable; "progress" is a separate field fed by real work units, never by elapsed time.

### 4A.4 Scheduling policy

The policy is hierarchical: **pool → lane → account → job**.

**Lanes inside a pool.**
- *Interactive*: work a person is actively waiting on: the next transition of the mix that is playing (old `URGENT`), a song someone requested mid-mix (`REQUEST`), a preview they clicked, a single song they tapped "Analyse" on.
- *Standard*: everything a user asked for that isn't being waited on this second: the rest of the current mix (`MIX`), drafts in the render line in the user's order (`LINE`), library analysis, exports, other requests (`LATER`).
- *Speculative*: spare-time preparation (`PREPARING`) and discovery sweeps; runs only when the pool would otherwise idle and the account has speculative budget left.

Lane weights: interactive 4, standard 1, speculative strictly last. Lanes are chosen by the same virtual-time rule as accounts, charged in estimated compute seconds, so when both are backlogged interactive gets about 80% of the pool's compute time and standard at least 20%: the weights *are* the floor that stops a flood of interactive work from freezing imports and exports. Raising standard's weight to 2 makes its floor 33%.

**Headroom for interactive work.** Speculative attempts may never occupy the last free slot of a pool (at least one slot, or 10% of slots, whichever is larger, stays free of speculative work), and they are the one kind of work that may be preempted across accounts ([§4A.5](#4a5-mapping-todays-ranks-onto-the-new-policy)).

**Accounts inside a lane: weighted fair share with virtual time** (start-time fair queuing).
- Each `(pool, lane, workspace)` with waiting work has a virtual time `V`.
- When a workspace becomes backlogged after being idle: `V = max(V, G)` where `G` is the pool-lane's current minimum `V` among backlogged workspaces. No hoarding credit while idle.
- Dispatch picks the eligible workspace with the smallest `V` (ties: oldest waiting job).
- On dispatch: `V += est_cost_s / weight(tier)`. On finish: `V += (actual_cost_s − est_cost_s) / weight` (clamped), so wrong estimates self-correct.
- Weights: Free 1, Standard 3, Premium 6 (admin-tunable, versioned, simulated before apply).
- Guarantee: every backlogged workspace receives service proportional to its weight, with lag bounded by one maximum job cost divided by its weight. No starvation by construction.

How it's kept correct in practice:
- **Heads table.** `fair_heads(pool, lane, workspace_id, V, queued_count, running_count)` is updated in the same transaction as every job state change that affects it (enqueue, dependency release, claim, finish), so it can't drift by design; a reconciler recomputes it from `jobs` every minute anyway and alerts on any difference. The claim treats the jobs table as the truth: if a head says work is queued but none is found, the claim fixes the count and moves on.
- **Costs are normalised per pool.** `est_cost_s` is expressed for the pool's reference worker; a faster worker class reports actual seconds scaled by its speed factor, so a workspace isn't charged less for landing on a faster machine.
- **Virtual times stay small.** When the minimum `V` in a pool-lane passes a threshold, all `V`s in it are rebased by subtracting that minimum (one statement), so numbers never grow without bound.
- **Contention costs a little precision, not correctness.** With many claimers, `SKIP LOCKED` may skip a head another claimer holds and serve the next-smallest `V`. The integration test with 50 concurrent claimers must keep share error inside the same ±15% threshold as the simulator.

Worked example, one pool of 20 identical slots, 60 s jobs, all backlogged:
- 1 Premium + 1 Free account: Premium ≈ 17 slots, Free ≈ 3.
- 10 Premium + 1,000 Free: each Premium ≈ 6× each Free; Premium accounts together get ≈ 5.7% (they're a small group), and every Free account still moves.
- With tier-level 10/30/60 splits instead, the same 10 Premium accounts would each get 600× a Free account, and the ratio would swing wildly as signups change. That's why per-account weights are recommended.

**Jobs inside an account**, ordered by: urgency (server-assigned) → `needed_by` (earliest first) → render-line position (the user's own draft order) → age.

**Deadlines for playback.** A seam needed by the mix that is playing carries `needed_by = now + time until that hand-off`. If its slack (time left minus estimated run time) drops under 1.5× the estimate, it gets a deadline boost: considered before other interactive work in its pool, up to a per-account boost allowance (e.g. 3 boosts per 10 minutes) so it can't be abused. If a hand-off can't be ready in time, the planner picks a cheaper, already-ready move (the existing fallback order) instead of leaving silence; the UI never pretends.

**Eligibility filters** applied before picking: dependencies satisfied; `not_before` passed; workspace under its per-pool concurrency cap; worker capabilities match (`engine_version_required`, GPU memory, scratch disk); entitlement allows the job type right now; the job's owning feature flag is on for that workspace ([§11B.4](11b-feature-flags.md#11b4-enforcement-in-the-cloud)); account not suspended; pool not paused.

**Urgency is never client-chosen.** The server derives lane and urgency from job type and context (is this mix playing? is the seam within the next two hand-offs? did a person click?). Clients can reorder their own render line, which only affects order *within* their account.

**Admission control** (to stay healthy under overload):
- Per-workspace caps on queued jobs per type (e.g. 50,000 analysis jobs; 2,000 seam jobs) beyond which new work is accepted as *planned* but materialised in batches.
- Workflows materialise children lazily (a 20,000-song import creates analysis jobs in pages of 500 as earlier pages drain).
- Speculative work draws from a daily CPU-minute budget per tier; when empty, nothing speculative is created.
- Global overload: when estimated backlog drain time for a pool exceeds a threshold, standard work for Free is deferred (accepted, shown as "waiting for capacity") before anything is refused; interactive work is never deferred by admission control.
- Accepted work is durable; under overload the system slows down and says so; it never silently drops.

**Priority inheritance through dependencies.** If an interactive seam depends on an unfinished analysis, that analysis temporarily runs in the interactive lane *of the same account* (it inherits urgency, not extra weight). Inheritance stops when the parent is cancelled or finishes.

**Plan changes while queued.** Weight and caps are read at dispatch time from the current entitlement, so an upgrade speeds up already-queued work immediately and a downgrade slows it, without touching running attempts.

### 4A.5 Mapping today's ranks onto the new policy

| Today (`seams.py:140`) | Lane | Urgency | Notes |
|---|---|---|---|
| `URGENT` (about to be heard) | interactive | 0 | Carries `needed_by` |
| `REQUEST` (asked for mid-mix) | interactive | 1 | Ordered oldest first as now |
| `MIX` (rest of current mix) | standard | 2 | |
| `LINE` (drafts in render line) | standard | 3 | Ordered by the user's line position |
| `LATER` (other requests) | standard | 4 | |
| `PREPARING` (spare time) | speculative | 5 | Budgeted |

The existing `give_way_when` preemption maps to "interactive work arrives → running speculative attempts stop at their next `check_in()` and re-queue". Speculative work is optional by definition, so this applies **across accounts**: when a pool has interactive work waiting and no free slot, the gateway sets `cancel_requested` on the youngest speculative attempt, which gives way within a heartbeat. Interactive and standard work are never preempted across accounts: a slot frees when a job finishes, and short jobs keep that wait small. Very long jobs (exports) go to a separate pool so they never sit in front of seams.

### 4A.6 Workers and the claim protocol

**Workers hold no database or storage credentials.** They talk to the worker gateway with a short-lived worker token (minted per pool, rotated, scoped to `claim/heartbeat/complete/fail`) and touch storage only through the signed URLs a claim hands them. Benefits: no connection-pool explosion when you add 500 workers; one place to enforce fencing; a stolen worker token reaches only the jobs it claims; workers can live on any provider.

**The gateway is its own service.** It runs from the same image as the API but as a separate deployment (`gateway`), so a storm of worker long-polls or completions can never starve customer requests, and each can scale on its own.

Endpoints (`/internal/workers/…`):
- `POST /register` → capabilities (pool, engine version, CPU, RAM, GPU type/VRAM, scratch disk, region) → `worker_id`.
- `POST /claim` (long-poll up to 20 s) → `{attempt_id, job, lease_expires_at, fencing_token, inputs: [signed GET URLs], outputs: [signed PUT/multipart slots under attempt prefix]}` or 204.
- `POST /attempts/{id}/heartbeat` (every 10 s; lease 45 s) → extends lease, returns `{cancel_requested}`.
- `POST /attempts/{id}/progress` (throttled to 1 per 5 s) → work units done.
- `POST /attempts/{id}/complete` with output manifest + checksums.
- `POST /attempts/{id}/fail` with error class and detail.

Claim transaction (Python, one Postgres transaction, policy code shared with the simulator):
1. Pick lane by lane virtual time (tiny table, row-locked).
2. Read the top K workspace heads for `(pool, lane)` ordered by `V`, `FOR UPDATE SKIP LOCKED`.
3. Apply the eligibility function in Python; choose the first eligible head.
4. Lock that workspace's best job `FOR UPDATE SKIP LOCKED` using the in-account order.
5. Insert `job_attempts` row with `fencing_token = job.lease_generation + 1`, set job `leased`, update `V`, write outbox event, commit.

Indexes keep this fast with millions of rows: a partial index on `jobs (pool, workspace_id, urgency, needed_by, created_at) WHERE state = 'queued'`; finished jobs move to a partitioned history table monthly.

**Waiting without holding the database.** A long-poll holds an HTTP request, never a database connection: the gateway waits on an in-process signal and only opens a short transaction to claim when woken. Wake-ups come from Postgres `LISTEN/NOTIFY` per pool. `LISTEN` doesn't work through a transaction-mode pooler (Render's built-in PgBouncer is transaction mode), so each gateway and API instance keeps **one direct connection** just for listening, and does all other work through the pooler. A notification wakes a small random subset of waiters with jitter, not all of them, so one new job doesn't trigger hundreds of claim attempts. A periodic 5 s re-check covers missed notifications.

**Heartbeats are cheap.** A heartbeat updates only the small `job_attempts` row (`lease_expires_at`), never the `jobs` row, so a thousand workers heart-beating every 10 s cause ~100 small updates a second and little table bloat. `job_attempts` and the outbox use lower fillfactor and tuned autovacuum.

**Stuck work is caught.** The heartbeat runs on its own thread, so it would keep beating even if the work itself hung. Each job type therefore has a maximum run time (about 3× its measured p99, learned by `eta.py`); the worker's watchdog stops heart-beating and reports a resource error when a job exceeds it or reports no progress for too long, and the reaper enforces the same limit server-side.

**Publication is fenced.** `complete` succeeds only if the attempt's fencing token equals the job's current `lease_generation` and the job isn't cancelled. Outputs were written under `…/attempts/{attempt_id}/…`; completion verifies object existence, size and checksum, applies the job's results to the database, then writes the artifact manifest pointing at that attempt's keys, all in the same transaction that marks the job `succeeded`. A late zombie worker gets `409 stale lease`; its objects are garbage-collected later. Repeating `complete` for an attempt that already succeeded returns the same success, so a worker that lost the response can safely retry. R2's one-write-per-second limit on a single key never bites because no two attempts share a key.

**Lease reaper** (maintenance leader): every 5 s, attempts with expired leases → job back to `queued` (or `failed` when attempts are exhausted), lease generation bumped, outbox event. Worker clocks are never trusted; all times come from Postgres `now()`.

**The maintenance leader** holds a session-level advisory lock on its own direct connection (session locks also don't survive a transaction-mode pooler). If that connection drops, the lock is released and a standby can take over while the old process may still be finishing a task, so every maintenance task is idempotent and records the leader's term number; a task started under an older term stops when it sees a newer one.

**Outbox delivery.** Each state change inserts an `outbox_events` row and calls `pg_notify` in the same transaction (Postgres delivers notifications only on commit). Listeners read events by increasing id, so a missed notification is caught up on the next read; consumers dedupe by event id (at-least-once delivery). Outbox rows are kept 7 days, partitioned by day.

### 4A.7 Retries and error classes

| Class | Examples | Behaviour |
|---|---|---|
| Transient | network, R2 5xx, 429 from LRCLIB | Retry with exponential backoff + jitter (5 s → 10 min), max 6 |
| Resource | OOM, GPU OOM, scratch disk full | Retry on a larger worker class if one exists, else fail with "too large" |
| Input invalid | corrupt audio, unsupported codec, decode bomb | Fail permanently with a plain reason; no retry |
| Dependency | prerequisite failed/cancelled | `blocked`; resumes if the prerequisite is retried successfully |
| Poison | same job crashed 3 different workers | `quarantined`; admin alert |
| Engine bug | exception in our code | Retry once, then fail and report to Sentry with job id |

### 4A.8 Dependencies, workflows and immutable revisions

- Dependencies form a DAG stored in `job_dependencies`; cycles are rejected at creation.
- The maintenance leader (and the completing transaction itself) releases dependents when prerequisites succeed.
- Exports keep today's best idea: freeze the mix revision (song asset versions + seam keys + revision hash) and depend on exactly those seam artifacts. Editing the mix afterwards creates a new revision; the running export keeps rendering the frozen one.
- A seam artifact is keyed by a hash of its *inputs*: both songs' content hashes, analysis versions, render version, move and settings. Re-requesting identical inputs reuses the artifact instantly (per workspace, see [§5.6](05-storage-uploads-playback.md#56-no-cross-account-deduplication)).

### 4A.9 Cancellation and preemption

- Cancelling a queued job is immediate. Cancelling a running one sets `cancel_requested`; the worker sees it on the next heartbeat and stops at its next `check_in()` (Demucs: kill the process tree as today).
- Cancel vs complete race: whichever transaction commits first wins; a cancelled job never publishes, a succeeded job is never retroactively cancelled (the user can delete the artifact instead).
- Deleting a song cancels its pending jobs and marks dependents blocked; running attempts finish but fail publication because input validation re-checks the asset tombstone.

### 4A.10 Capacity and autoscaling

- **Where workers run is decided by data transfer as much as compute.** Workers download inputs from R2 for free (R2 has no egress fees) but every output they upload (playback proxies, stems, clips, exports) is outbound traffic from the worker's host. Render includes only 25 GB a month on its Pro plan and charges $0.15/GB beyond, so **workers don't run on Render**. Modal includes a monthly egress allowance and charges about $0.04/GiB beyond it (since 1 Oct 2026); Hetzner servers include large traffic allowances.
- **Beta: all workers on Modal** (CPU pools and GPU stems), pinned to EU regions: no servers to manage, scale to zero, per-second billing. A small reserved CPU pool on Hetzner shared-vCPU servers is added when steady utilisation makes it cheaper; both pull from the same queue through the gateway, so nothing else changes.
- **How Modal workers start**: the autoscaler (maintenance leader) spawns worker functions for a pool when it has backlog; each runs the claim loop and exits after 60 s idle. Per-pool function timeouts are set above the longest allowed job (exports included).
- **Scaling signal**: per pool, outstanding estimated work-seconds ÷ target drain time, plus p95 queue wait vs target. Raw job count is misleading (10,000 five-second jobs ≠ 10,000 GPU jobs).
- **Guards**: per-pool min/max workers, a daily spend ceiling per pool, cold-start awareness (model loading ≈ 15 s; keep 1 warm worker in the seam and stems pools while any playback session is active, scaling to zero when nobody is listening; its cost is in the worker line of [§13.4](13-hosting-and-cost.md#134-monthly-cost-estimate)), and alerts when scaling hits a ceiling.
- **Adding a worker** = start a container with the pool env vars and a worker credential. It registers, claims, and contributes. No job reassignment, no restarts, no config edits.

### 4A.11 Build versus buy

| Option | Fit | Verdict |
|---|---|---|
| Own Postgres scheduler (above) | Exact policy, testable in a simulator, no new infrastructure | **Recommended** |
| Temporal (priority + weighted fairness keys, GA 2026) | Strong match on fairness; heavy to run, large conceptual surface for a solo dev | Escape hatch if we outgrow ours: fairness key = workspace, weight = tier weight maps directly |
| Hatchet (Postgres-based, round-robin concurrency keys) | Good durable runs and dashboard; fairness is round-robin, not weighted per tier | Not chosen |
| Procrastinate / PgQueuer | Solid queue primitives on Postgres; no fairness | Could underpin the claim if we wanted, but our claim is small enough to own |
| Celery + Redis | Weak durability semantics, no fairness | No |

The policy module has a narrow interface (`choose(pool, worker_caps, now) → job`) so swapping the engine later doesn't touch producers or workers.

### 4A.12 The simulator (built before the real scheduler is trusted)

A deterministic, event-driven simulator (`tests/sim/`) runs the exact policy module against an in-memory repository with a virtual clock and seeded randomness. It models arrivals per tier and job type, cost estimates vs actuals, worker counts, worker crashes, lease expiry, plan changes and cancellations. It checks invariants after every event and reports per-tier and per-account p50/p95/p99 waits, share-vs-weight error, and starvation (max wait of any backlogged account). It runs millions of decisions in seconds, so it's part of every CI run, and the admin "policy editor" uses the same code to forecast a weight change against recent real workload before applying it.

### 4A.13 How today's code moves

| Today | Becomes |
|---|---|
| `SeamStore.submit/keep_requested` (`seams.py:348-400`) | Job producer: creates/cancels `seam.render` jobs with lane/urgency |
| `seam_worker.py` + `SeamStore.run_forever/_next_job` | Generic job runner loop (`selecta/workers/runner.py`) calling the existing render functions |
| `seam.json` status files | `jobs` + `artifacts` rows; status served from DB |
| `jobs.check_in()`/`Interrupted` | Kept; wired to heartbeat `cancel_requested` |
| `rendering-mix` sign file | Removed; lanes replace it |
| Analysis subprocess + asked-for line (`api_common.py:317-350`) | `analyse.song` jobs; "asked for" = interactive lane |
| Export JSON jobs (`routes/exports.py`) | `export.render` jobs with frozen-revision dependencies |
| `eta.py` `JobClock` | Feeds `est_cost_s` per job type and engine version, learned from `actual_cost_s` |
| `recovery.py`, `forget_unfinished()` | Replaced by lease expiry and reconciliation |
| `PairBook` JSON files | Table keyed by workspace + planner version |

In local mode the same tables live in SQLite and an in-process runner (a few threads) claims with a simple lock instead of `SKIP LOCKED`.

---

[← 03-architecture.md](03-architecture.md) · [Contents](README.md#chapters) · [05-storage-uploads-playback.md →](05-storage-uploads-playback.md)
