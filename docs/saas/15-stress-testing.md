*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

> **Accepted local-first target (2026-11-13; not implemented).** Preserve rigorous tenant, fault and scalability testing but split hosted control-plane/device reconnect load from real local DSP/venue six-hour playback reliability. Do not waive old checks without a verified successor. See ADR-0482. The following historic hosted-media plan and implementation evidence are preserved for reference. [Current architecture](20-local-first-cloud-architecture.md) · [Transition](22-local-first-transition.md).


## 15. Stress testing and verification

This chapter covers load, chaos and release gates. Module-by-module correctness and security tests, with every edge case, are in [§18](18-test-plan.md#18-test-plan-every-edge-case-every-layer).

### 15.1 What must be proven

1. Selecta stays usable with many users online.
2. The scheduler is fair and predictable when demand exceeds capacity.
3. Adding workers raises throughput until a documented bottleneck, without duplicates or corruption.
4. When anything fails, jobs recover and no user loses music or mixes.

### 15.2 The ten invariants (automated, checked after every test)

1. No durably accepted job disappears.
2. No stale attempt publishes over a newer one.
3. No cross-tenant read, write or listing succeeds.
4. Quota usage never exceeds the limit through concurrency.
5. Every published artifact matches its declared inputs and revision.
6. Duplicate requests, webhooks and retries cause one logical effect.
7. No account exceeds its effective plan permissions.
8. AI output never authorises an action or bypasses limits.
9. Component failures never corrupt the database or stored files.
10. The UI never shows "done" without a verified result.

Every run ends with a **reconciliation audit**: stuck jobs, unreleased reservations, orphaned objects, ledger vs inventory drift, entitlement vs Stripe drift. A run that "looked fine" but leaves drift fails.

**The checker today.** `selecta.audit.invariants` checks, from the database, invariants 1 to 7 and 9 after a test or a scenario: `check(connection, accepted=..., store=...)` returns every `Violation` with its invariant number, and `assert_clean(engine)` raises listing them all. It reads jobs, attempts, dependencies, fair-share heads, artifacts (and, given an `ArtifactStore`, the stored objects), assets, quota rows, reservations, the storage ledger and entitlement overrides. Invariants 8 and 10 can't be read from the database (`invariants.NOT_CHECKED`); their registered tests are checked after each run instead (below). The job state-machine test checks every invariant when each random history ends, and every race test checks them after its race (`tests/test_cloud_jobs_stateful.py`, `tests/test_cloud_jobs_races.py`); `tests/test_cloud_invariants.py` plants a violation for each check. Every cloud test now ends with the same check: the `cloud_engine`, `sqlite_engine` and `postgres_engine` fixtures (`tests/cloud_db.py`) run `assert_clean` on their database after each test that passed, so a test that leaves drift fails in every CI job that runs it (the Windows shards on SQLite, the Linux `Cloud / PostgreSQL` job on both); a test that breaks an invariant on purpose says so with `@pytest.mark.invariants_off(reason)`. Ledger-against-rollup drift is the usage reconciler's (`usage.reconcile`, §5.3).

**Invariants 8 and 10.** These leave nothing in the database to read, so their proof is a fixed set of tests, registered by exact ID in `selecta.audit.invariant_proofs`: `PYTHON` maps each to pytest node IDs (for 8: Lucy's tool-call, injection, tier, budget and approval tests and the AI router's and spend guard's tier and cost caps; for 10: Lucy's truthful-failure, supersede, crashed-commit and ready-only tests and "only a completed upload can be accepted"), and `SITE` maps each to vitest and Playwright tests in `web/` (for 8: Lucy's approval confirmations and `LX-0362-03`; for 10: billing and checkout confirmed from the server, upload failures, Lucy's truthful run states and verified transitions, batch and removal reports only after the answer, `MI-0138-08` and `MP-0290-06`). After each run, `tests/invariant_gate.py` (registered by `tests/conftest.py`) checks the Python half: in any pytest run that collects the whole cloud set (every `tests/test_cloud_*.py`, as the Windows full suite and the `Cloud / PostgreSQL` job do), each registered test from a collected module that belongs to this `SELECTA_TEST_SHARD` must run and pass; one that `-k` or `-m` deselected, or that was skipped, failed or never ran, fails the session with a line per test. Narrow runs of a few files are left alone. The site half runs in the site's own CI jobs, which fail on any failing test. So the registry can't rot, `tests/test_cloud_invariant_proofs.py` collects every registered node ID and checks every named spec still holds a test of that exact name.

### 15.3 Tools

| Tool | Used for |
|---|---|
| Deterministic scheduler simulator (`tests/sim/`) | Millions of decisions per run; fairness, starvation, admission, plan changes; every PR |
| pytest + Hypothesis stateful tests | Job state machine, quota ledger, entitlement state machine, upload sessions |
| Postgres integration (Linux CI) | 500 concurrent claimers on one queue, lease expiry races, fencing, outbox delivery |
| toxiproxy + kill loops | DB/R2 latency and partitions, `kill -9` workers mid-attempt, API restarts mid-transaction |
| k6 | API load, upload initiation bursts, SSE connection counts, thresholds as pass/fail |
| Locust | Multi-step user journeys per tier (sign in → upload → mix → play → export → Lucy) |
| Playwright (existing) | UI state matrix, slow/flaky network, session expiry, two tabs, plan change mid-session |
| Real-audio harness (reusing `tests/e2e_server.py`, `tests/scale_server.py`, `tests/synth.py`) | Throughput and output correctness: silence, tempo changes, mono, 96 kHz, corrupt frames, very long files; clicks/gaps/clipping checks |
| Fake AI provider | Lucy load and failure injection without paying for tokens |

### 15.4 The ladder (synthetic records and simulated workers above L2; real audio only where it teaches something)

| Level | Load | Purpose |
|---|---|---|
| L1 Normal | 100 active users, 1,000 pending jobs | Baseline and regressions |
| L2 Busy | 1,000 active, 50,000 pending | Beta headroom ×10 |
| L3 Heavy | 10,000 active, 500,000 pending | Sustained overload behaviour |
| L4 Extreme | 100,000 simulated sessions, 10M jobs | Control-plane limits: claim latency, index health, SSE fan-out |
| L5 Absurd | 1M accounts, 100M historical jobs | Partitioning, query plans, admin aggregates |
| L6 Catastrophe | L3 load plus combined failures | Recovery and correctness under chaos |

**The ladder and the catastrophe suite today.** `tests/load/ladder.py` holds the rungs L1 to L4 and the §15.6 thresholds once, as data, writes `tests/load/ladder.json` for the k6 staging script `tests/load/k6/ladder.js`, runs a rung against any base URL (`python tests/load/ladder.py run --level L1 --base-url ... --tokens ...`) and judges a saved report (`check`); `tests/test_load_ladder.py` keeps the numbers in step with the tables here and runs a scaled-down L1 against the real cloud app. `tests/load/k6/rooms.js` is the Rooms stampede, vote-rate and code-guessing run for staging. `tests/test_cloud_catastrophe.py` runs L6 combinations locally, scaled down, with fault injection into the real services and the reconciliation audit at the end. The full-size rungs and L6 at L3 load need staging.

### 15.5 Scenario catalogue (each becomes a named automated test)

**Queue and scheduling**: 10M Free jobs arrive at once (bounded admission, API responsive) · 100k Premium jobs land on a busy Free backlog (shares converge to weights, nothing starves) · Premium demand constant for 72 h (every backlogged Free account still progresses) · one account submits 99% of Premium jobs (other Premium accounts unaffected) · every user marks work urgent (server-assigned urgency, per-account interactive caps hold) · one user clicks Render 500 times (one job) · 50 claimers race for one job (one lease) · dispatcher/API dies before and after commit (no phantom lease, nothing lost) · estimates 60× too high and 60× too low (virtual-time correction keeps shares within tolerance) · cycle in dependencies (rejected) · prerequisite cancelled (dependents blocked) · no GPU workers for an hour (jobs wait with "waiting for stem capacity", CPU fallback used if configured) · upgrade and downgrade while queued (next dispatch uses the new weight) · cancel at 99% (deterministic winner) · 10M finished jobs in history (claim p95 unchanged) · idle workers while jobs queue (alert fires).

**Workers**: kill after claim, mid-Demucs, mid-upload, after upload before complete, after complete before ack · kill all 500 workers, then restart all at once (connection storm controlled) · DB reachable but R2 not, and vice versa · heartbeat stalls while computing (zombie can't publish) · worker clock 6 hours wrong (server time rules) · GPU OOM (retry on larger class or fail clearly) · disk full (fail safely, scratch cleaned) · old engine version during deploy (never takes incompatible jobs) · worker reports completion for a job it doesn't lease (rejected) · 1,000 workers register in one second.

**Uploads and storage**: 100k concurrent upload sessions · 50,000 files in one folder drop (batched planning, bounded memory) · zero-byte, fake extension, truncated MP3, decode bomb, 10-hour silence, 8-channel 192 kHz · two tabs upload the same file · 1,000 uploads race for the last 1 GB (no oversubscription) · connection drops at 99% and after the final part (resume; idempotent completion) · presigned URL expires mid-part (refresh) · logout, plan change, account suspension mid-upload · delete during finalisation (tombstone wins) · R2 5xx storms and a multi-hour R2 outage (uploads pause; nothing accepted is lost) · 20,000-character and `../` filenames · metadata with HTML/script/prompt-injection.

**Audio engine**: silence, sub-second files, multi-hour files, VBR MP3, mono, 6-channel, very high/low sample rates, damaged tags, tempo drift, no beat, long silent intro, clipping, NaN/Inf samples · user corrects BPM/key while seams render (stale artifacts not used) · engine upgrade mid-library (versioned artifacts) · same song twice in a mix · one stem window shared by 1,000 transitions (rendered once) · transition fails all checks (unavailable, never fabricated) · cache evicted while a revision plays (protected).

**Playback**: next hand-off not ready in time (cheaper ready move or honest pause) · signed URL expires mid-session · CDN/R2 returns partial body · seek into an unprepared region · three tabs, two devices · network drop and return after an hour (resync without stale commands) · next song deleted mid-play (revision pinned) · 100k listeners replaying finished mixes (served by R2, zero worker load).

**Billing**: 10k checkouts at once · same event 100× · cancel arrives before create · user returns before webhook · payment needs 3-D Secure · renewal fails then succeeds on retry · rapid upgrade/downgrade/cancel/reactivate · downgrade with 90 GB stored · subscription lapses mid-upload · Stripe down for a day · forged webhook · database restored to before recent Stripe events (nightly and on-restore reconciliation fixes it).

**AI**: 10k simultaneous Lucy turns (per-account and provider limits hold) · provider outage and rate limiting per tier (fallback chain, Lucy reduced, app unaffected) · malformed or unknown tool calls (rejected) · disconnect mid-stream (incomplete state, no duplicate side effects) · model swapped while 1,000 runs active (each run pinned) · Free user requests a Premium model id (ignored) · runaway tool loop (cycle and cost ceilings) · prompt injection in song titles · user deletes conversation mid-run · one account tries to burn the monthly AI budget.

**Database**: 1,000 workers' worth of claims through the gateway (pool limits hold) · a worker storm on the gateway while customers browse (customer API p95 unchanged, because the gateway is a separate service) · the direct `LISTEN` connection drops for a minute (listeners catch up from the outbox by id; no missed job or SSE event) · the maintenance leader's connection drops mid-task (standby takes over; the old term's task stops; nothing done twice) · connection budget at the maximum instance count (stays under the database limit) · `fair_heads` counts deliberately corrupted (reconciler repairs and alerts; claims stay correct) · long transaction holding job rows (bounded waits) · deadlocks (retried) · failover during claim and during publication · commit acknowledged but connection lost (idempotent retry finds the outcome) · migration interrupted (forward-fix path) · hot-row contention on a popular workspace head.

**Security**: guess other users' asset/job/mix/conversation ids across every endpoint · tamper `workspace_id` in bodies · reuse an upload URL for another key · oversized/deeply nested JSON · admin endpoints from a customer session · stale admin form submits old config (version conflict) · staff role revoked mid-session · compromised-admin drill (attempt content access, grant escalation, audit tampering, bulk export; all blocked, alerted).

**UI**: thousands of songs uploading (virtualised lists) · 5,000 activity events in a minute (coalesced) · job finishes while its page is closed (Activity shows it) · refresh mid-upload · mutation commits but response lost (unknown-outcome UX, safe retry) · two tabs edit one mix (revision conflict) · plan changes while on Library · deploy while edits are unsaved · screen reader with hundreds of progress events (rate-limited announcements).

**Devices**: three devices press play in the same second (one active, two told why) · transfer while a seam is mid-crossfade · speaker laptop lid closed mid-song, then reopened after someone pressed "Play here" (it fades out, no double audio) · network flaps every 30 s for an hour on the speaker (music continues from buffer; lease renews) · 50 remotes sending commands on one session (sequence check, no lost or duplicated skips) · server clock offset estimation with 300 ms jitter · password change while playing (stops within 30 s with message) · iPhone as speaker with screen locked (honest warning, documented limitation).

**Rooms**: 1,000 guests scan the QR code within 10 s (join stays fast; room snapshot served from memory) · 300 guests request at once (per-guest limits, round-robin, no duplicate rows) · 10,000 votes a minute · one guest scripting requests from many IPs (room and per-IP limits, host ban) · brute-forcing room codes with 1M attempts (rate limits; no room found) · 500 rooms open at once with 100 guests each (SSE fan-out within targets) · speaker device offline for an hour mid-party (room says paused; requests wait; nothing lost) · host bans a guest who has pending requests (their requests withdrawn) · host closes the room while request renders run (renders finish into the host's mix or are cancelled per policy; guests see "Room closed") · host downgrades mid-party (room continues to its end) · same song requested by 40 guests (one request, 40 votes) · requested song deleted by the host (request withdrawn with reason) · display paired to a room that then rotates its code (display stays paired).

**Flags**: kill switch under L3 load (enforced everywhere within 5 s) · rule targeting 1M accounts (decision stays O(rules), no per-account rows) · rollout raised 10% → 50% (no account loses the feature) · flag flipped 20 times in a minute (stable; warnings; jobs consistent) · flag off mid-upload, mid-render, mid-export, mid-Lucy-turn, mid-Room · old site with new flags, new site with old server · rule referencing a flag removed from the registry (CI fails) · attempt to grant a Premium feature to Free via a rule (refused by the resolver).

**Catastrophe combinations**: launch-day stampede (signups + uploads + upgrades + mix requests) · every worker dies with 500k jobs queued while users keep working · R2 flaky + Anthropic down + Stripe webhooks delayed at once · database restore during active traffic with pending deletions · emergency pause and resume raced by two operators during a deploy.

### 15.6 Pass/fail thresholds (normal supported load)

| Metric | Threshold |
|---|---|
| Routine API p95 | < 300 ms (excluding uploads, SSE, Lucy streams) |
| Routine API error rate | < 0.5% (excluding deliberate throttling) |
| Duplicate published results | 0 |
| Cross-tenant successes | 0 |
| Accepted jobs lost | 0 |
| Expired leases recovered | 100% within lease + reaper interval |
| Quota oversubscription | 0 bytes |
| Fairness | Under saturation, each tier's measured share per backlogged account within ±15% of weight ratio over 10-minute windows |
| Starvation | No backlogged account waits longer than the policy bound |
| Worker scale-out | Throughput rises monotonically to a documented bottleneck |
| Spend | 0 admissions past hard AI/compute ceilings |
| UI truth | 0 "complete" states without a verified artifact |

### 15.7 When tests run

| When | What |
|---|---|
| Every PR | Unit, simulator (fixed seeds + a random seed), state-machine properties, migration check, file-length rule |
| Merge to `main` | Linux integration (Postgres, an S3 server such as SeaweedFS), worker image smoke, Playwright on both modes |
| Nightly (staging) | L1–L2 load, lease races, chaos subset, reconciliation audit |
| Weekly | L3 + catastrophe subset, real-audio benchmark, cost report |
| Before releases | Full ladder to L4, security suite, DR drill, Lucy evaluation |
| Monthly | Restore drill, L5 data-scale run |

All stress environments run with Stripe test mode, a fake or hard-capped AI provider, synthetic users and audio, and a per-run spend cap; tests can never touch production data.

---

[← 14-operations.md](14-operations.md) · [Contents](README.md#chapters) · [16-edge-cases.md →](16-edge-cases.md)
