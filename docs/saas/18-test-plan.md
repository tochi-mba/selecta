*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 18. Test plan: every edge case, every layer

This chapter is the specification for the Selecta Cloud test suite. [§15](15-stress-testing.md#15-stress-testing-and-verification) covers load, chaos and the release ladder; this chapter covers correctness and security of the code itself, module by module. Each case names the checklist task it proves (`SC-xxxx-nn` in the [implementation checklist](../adr/selecta-cloud-implementation-checklist.md)). A checklist box is ticked only when the tests listed for it exist and pass in CI.

### 18.1 Rules every test follows

- **Tests prove behaviour, not lines.** Each test states the rule it checks in its name (`test_a_stale_fencing_token_cannot_publish`), in the plain voice the rest of the suite uses.
- **Deterministic.** No real sleeps for timing logic: time comes from a `clock` fixture that drives `selecta.persistence.db_now` on SQLite; randomness is seeded; Hypothesis runs with a fixed seed in CI and prints the seed of any failure.
- **Both databases.** Every store test runs on SQLite. The same tests run on PostgreSQL when `SELECTA_TEST_POSTGRES_URL` is set (always in the Linux CI job). Tests that need real row locks, `SKIP LOCKED`, `LISTEN/NOTIFY`, advisory locks or row-level security run only on PostgreSQL and say so.
- **No network.** HTTP goes through `httpx.MockTransport`; Stripe, AuthKit JWKS, R2 and Anthropic are fakes with the same shapes.
- **Isolated.** Each test gets a fresh database (SQLite file in `tmp_path`, or a fresh PostgreSQL schema dropped afterwards). No test reads or writes the real `~/.selecta`.
- **Every bug gets a regression test** before the fix lands.
- **No em dashes** in test names, messages or comments.

### 18.2 Layers

| Layer | What it proves | Tooling |
|---|---|---|
| Unit | Pure functions and small classes | pytest |
| Property | Rules that must hold for all inputs (fairness, monotonic rollouts, never granting beyond a plan) | Hypothesis |
| Stateful | Long random sequences of operations keep every invariant (job lifecycle, quotas, entitlements, playback sessions, rooms) | Hypothesis `RuleBasedStateMachine` |
| Store integration | Real SQL on SQLite and PostgreSQL | pytest fixtures over `selecta.persistence` |
| Concurrency | Races resolve correctly with many threads and connections | threads + PostgreSQL in CI |
| Simulation | Scheduling fairness and starvation over millions of decisions | `selecta.scheduling.simulator` |
| Migration | Schema upgrades on both databases; the original SQLite tables are never touched | Alembic via `selecta.persistence.migrate` |
| Contract | Our outputs match what the other side expects (Lucy provider settings, Stripe event shapes, S3 XML) | pytest with recorded shapes |
| Security | Isolation, token handling, signatures, injection, secrets in logs | pytest, Hypothesis fuzzing |
| Mutation (nightly) | Tests actually catch wrong code in the most critical modules | mutmut on Linux |

### 18.3 Coverage gates

| Scope | Line | Branch | Mutation score (nightly) |
|---|---|---|---|
| Whole repository (unchanged) | 70% | - | - |
| Every new cloud package (`persistence`, `scheduling`, `work`, `workers`, `flags/targeting`, `billing`, `usage`, `authz`, `identity`, `playback`, `rooms`, `ai`, `modes`, `storage`) | 95% | 90% | - |
| Critical modules: scheduling policy, job claim/complete/fail/reap, quota reservations, flag decisions, `authz.check`, `authz.delayed`, `identity.tokens`, Stripe signature and snapshot, SigV4, upload completion, room codes and request limits, playback lease | 100% | 100% | 85% |

A script (`tests/cloud/coverage_gate.py`) reads `coverage.json` after the cloud job and fails CI per package, naming the uncovered lines. Lines that are genuinely unreachable are marked `# pragma: no cover` only with a reason comment, and the script counts those.

### 18.4 Shared fixtures and fakes (`tests/cloud/`)

- `engine` (parametrised `sqlite` / `postgres`), `connection`, `tables` (all declared tables created via migrations, not `create_all`, so migrations are tested on every run).
- `clock`: freezes and advances database time on SQLite; on PostgreSQL, tests that need time to pass use short durations and the store's injectable durations.
- `workspace`, `user`, `staff` factories.
- Fakes: `FakeStripe` (subscriptions, event replay, signature generation), `FakeJwks` (RSA keys generated per session, rotation), `FakeS3` (in-memory R2 implementing multipart rules: equal part sizes, 5 MiB minimum except last, 10,000 parts, ListParts pagination, strong consistency), `FakeSongCatalog`, `FakeRequestPlanner`, `FakeSpeaker`, `FakeHealth`, `FakeSecrets`, `RecordingNotifier`.
- Hypothesis profiles: `dev` (50 examples), `ci` (300), `nightly` (5,000, plus stateful runs of 200 steps).

### 18.5 Persistence and migrations (SC-0393)

- `new_id()`: valid UUIDv7 (version 7, RFC variant); ids sort by creation millisecond; 100,000 ids are unique.
- SQLite engine: WAL on, foreign keys on, busy timeout set; two threads writing at once queue without "database is locked"; a failed transaction rolls back completely.
- `transaction(engine, workspace)`: commits on success, rolls back on error; on PostgreSQL the workspace setting is visible inside the transaction and gone after it; `None` sets nothing.
- `db_now`: PostgreSQL uses the server clock (differs from a skewed client clock); SQLite follows the `clock` fixture.
- `lock_rows`: on PostgreSQL a second connection skips a locked row; on SQLite the query is unchanged.
- Migrations: upgrade an empty database to head on both dialects; a second upgrade is a no-op; `pending_changes()` is empty at head (fails CI when someone changes a table without a migration); downgrade to base and up again works.
- **The original SQLite tables are never touched:** build a copy of a real local schema with rows (`songs`, `analysis`, `queue`, `lucy_*`...), run the upgrade, and assert those tables' schema and rows are byte-identical.
- Registry: every module that declares tables is in `TABLE_MODULES`; no new table name collides with an original table name; every tenant table has an indexed, non-null `workspace_id`.

### 18.6 Scheduling policy and admission (SC-0395)

Fair share:
- Becoming backlogged sets `V = max(V, G)`; an idle account can't bank credit.
- Charge and correction: estimates too low and too high are corrected; correction is clamped.
- Rebase keeps order and differences.
- Worked examples from [§4A.4](04-queue-and-scheduling.md#4a4-scheduling-policy): 1 Premium + 1 Free on 20 slots gives about 17/3; 10 Premium + 1,000 Free gives Premium about 5.7% in total and 6x per account.
- Property: for any set of backlogged accounts and weights, over many equal-cost dispatches each account's share is within the lag bound (one maximum job cost divided by its weight).
- Ties break by oldest waiting job.

Lanes and headroom:
- Interactive and standard both backlogged: about 80% / 20% of compute time; standard is never starved.
- Speculative runs only when the other lanes have nothing eligible.
- **A one-slot pool still runs speculative work when idle**, and it gives way at the next `check_in()` when other work arrives.
- Pools of 2 or more keep `max(1, 10%)` slots free of speculative work.
- Cross-account preemption picks the youngest speculative attempt; never interactive or standard work; nothing to preempt returns none.

Ordering and eligibility:
- In-account order: urgency, then deadline (missing deadlines last), then render-line position, then age.
- Each eligibility filter alone blocks a job: unmet dependency, `not_before` in the future, concurrency cap reached, engine version, GPU memory, scratch disk, entitlement, flag off, suspended account, paused pool.
- Deadline boost: triggers below 1.5x slack; allowance of 3 per 10 minutes; exhausted allowance falls back to normal order.
- Priority inheritance gives lane and urgency, never weight; stops when the parent is cancelled.
- Old ranks map exactly as in [§4A.5](04-queue-and-scheduling.md#4a5-mapping-todays-ranks-onto-the-new-policy).
- Config: zero or negative weights rejected; versions recorded; an upgrade read at dispatch speeds up already-queued work.

Admission:
- Queued caps per type; lazy materialisation in pages of 500; the next page appears as the previous drains.
- Speculative budget per tier per day (10/60/240 CPU-minutes); resets at midnight; nothing speculative is created after it's spent.
- Overload defers only Free standard work; interactive work is never deferred; accepted work is never dropped.

Simulator:
- Same seed, same report; different seeds still meet thresholds.
- Invariants hold after every event over long random scenarios (no lost job, no double lease, caps kept).
- Saturation share error within ±15% over 10-minute windows; no backlogged account waits beyond the bound, including 72 hours of Premium demand.
- 100,000 decisions in CI under 10 seconds; 1,000,000 nightly under 60 seconds.

### 18.7 Durable jobs, leases and the runner (SC-0394, SC-0396)

Enqueue:
- Duplicate idempotency key returns the same job; after the job is terminal, the same key creates a new job.
- Dependency cycles rejected (self, two-job, long chain); unknown dependency rejected; jobs with unmet dependencies start `waiting_deps`.
- `fair_heads` counts change in the same transaction (a forced rollback leaves both unchanged).

Claim:
- Picks per policy; respects caps; returns nothing when nothing is eligible; skips capability mismatches; the retry over the next K heads is bounded.
- Fencing token increments by one per claim; the lease expiry comes from database time; an outbox event is written.
- **PostgreSQL race:** 50 threads claiming 1,000 jobs: every job claimed exactly once, no deadlock, share error within threshold.
- **SQLite race:** 8 threads: serialised, no lock errors, every job once.

Heartbeat and progress:
- Extends only the attempt row (the `jobs` row's update count doesn't change).
- Stale token refused; returns `cancel_requested` after a cancel; after a reap, the old attempt's heartbeat is refused.

Complete:
- Results applied by the job type's applier inside the same transaction; an applier that raises rolls back everything and the job stays unfinished.
- Artifacts recorded; dependents released only when all prerequisites succeeded.
- Repeating `complete` for an already-succeeded attempt returns the same success.
- Stale token, cancelled job, and a job re-queued by the reaper each refuse publication (`StaleLease`).
- Payload over the cap refused; virtual time corrected.

Fail and retry:
- Each error class follows its policy; backoff within the jittered bounds; attempts exhausted gives `failed`.
- Three different workers crashing on one job gives `quarantined`.
- Permanent failure blocks dependents; retrying the prerequisite unblocks them.

Cancel:
- Queued job cancelled at once; running job gets `cancel_requested`; terminal job unchanged.
- Cancel and complete racing on two connections: exactly one wins and the loser sees why.

Reaper and maintenance:
- Expired leases return to queued with a new lease generation; exhausted attempts fail; unexpired attempts untouched.
- `reconcile_heads` repairs deliberately corrupted counts and reports them.
- Leader election on PostgreSQL: two contenders, one leader; killing the leader's connection lets the standby take over with a higher term; a task from the old term stops. SQLite is always leader.

Stateful test (the most important one in this chapter):
- Random sequences of enqueue, claim, heartbeat, progress, complete, fail, cancel, reap and clock advance, with random worker crashes.
- After every step:
  - no job has two live attempts;
  - terminal jobs never change;
  - the number of jobs is conserved;
  - `fair_heads` matches the jobs table;
  - every transition left one outbox event;
  - no artifact belongs to a stale attempt.

Runner:
- Runs a handler and completes it; scratch directory removed afterwards, even on error.
- Exception mapping: `Interrupted` from cancel gives cancelled; from preemption gives re-queued; `MemoryError` gives resource; `InputInvalid` gives input_invalid; anything else gives engine_bug.
- Engine code that calls `selecta.jobs.check_in()` stops when the attempt is cancelled; the previous `give_way_when` hook is restored afterwards, even when the handler raises.
- Heartbeats happen while the handler runs.
- The watchdog stops a job past its maximum run time or with no progress, and stops heart-beating.
- Graceful shutdown finishes in-flight work and claims nothing new; several threads never run the same job.

### 18.8 Feature-flag targeting and plans (SC-0414, SC-0402)

- The existing flag tests still pass unchanged; `docs/flags.md` still matches `markdown()`.
- New registry fields: defaults keep today's behaviour; invalid values (unknown scope, mode, kind; bad date) are reported by `problems()`.
- Each layer alone decides: build off, mode off, plan locked (teaser vs hide), rule off, `needs:<flag>`, user off.
- Core flags stay on even under a kill rule; saving a rule for a core or untargetable flag is refused.
- Rule kinds:
  - kill switch;
  - user and workspace lists;
  - segments: plan, staff, account age at exactly the threshold, country, device kind;
  - client version compared as versions (1.10 is newer than 1.9);
  - schedules: start inclusive, end exclusive, UTC.
- Percentage rollout:
  - bucket stable across processes and machines;
  - raising the percentage only adds accounts (property);
  - the right id is hashed for each scope;
  - changing the salt reshuffles.
- `requires` cascade under rules, with cycle protection.
- **Property: a decision is never on when the plan doesn't include the feature.**
- `explain()` shows each layer; impact preview counts only changed contexts, by plan.
- Rule versions immutable; rollback restores the exact earlier set; `RulesCache` refreshes only to a newer version.
- Local mode: decisions equal today's `resolve()` for every flag.
- Plans:
  - every value matches [§3.1](02-plans-and-economics.md#31-plan-catalogue-starting-values-all-admin-tunable-and-versioned);
  - unknown plan or version raises;
  - `problems()` is empty;
  - planned SaaS flags accepted only from the `PLANNED_FLAGS` list;
  - `plan_gated_flags()` is correct.

### 18.9 Usage, quotas and allowances (SC-0402, SC-0398)

- Reserve: within limit succeeds; exactly at the limit succeeds; one byte over is refused; zero or negative bytes refused.
- **PostgreSQL race:** 200 reservations for the last gigabyte from many threads never exceed the limit by one byte.
- Commit moves reserved bytes to committed; commit and release are idempotent; a released reservation can't be committed.
- Expired reservations are released; deletions release bytes at once.
- Over-quota read-only when committed exceeds the limit after a downgrade; clears when usage falls back.
- Allowances:
  - daily reset at the account's local midnight;
  - Europe/London spring-forward and fall-back days handled;
  - an unknown timezone falls back to UTC;
  - monthly reset;
  - concurrent `try_consume` never goes below zero.
- Ledger append-only; daily rollup idempotent.

### 18.10 Authorization, audit and identity (SC-0401, SC-0400)

Roles and checks:
- Every role's permissions exist; no role holds `storage.content.read`; Support can't request content access alone at launch.
- Deny by default: no assignment means denied, and the deny is audited.
- Scopes cover exactly what they say (`platform:*`, `platform:operations`, `workspace:id`, `support_case:id`).
- Expired and revoked assignments are denied.
- Staff sessions:
  - a session that didn't start with MFA gives `StepUpRequired`;
  - a session longer than an hour is denied;
  - a session issued before the last revocation is denied;
  - dangerous permissions need MFA within 5 minutes, and a caller can only make that window tighter.
- Self-assignment refused and audited; Owner and Admin only at `platform:*`; assigning or revoking a role revokes the target's sessions.
- The last Owner can't be revoked or deleted; `bootstrap_owner` works only while no Owner exists.

Delayed dangerous actions:
- Running before it's due is refused; running after it's due works; cancelled and expired actions never run; actions expire 24 hours after falling due.
- A changed payload is refused (hash check); approvers must pass the hash they saw.
- The proposer losing the permission, being deleted, or having sessions revoked makes the action fail when it runs.
- One operator: the 15-minute delay applies. Two operators: a different approver is required and the action can run when approved. A second staff member appearing after a proposal makes approval required.
- An executor that raises gives a `failed` outcome, while the status row and audit row still commit.

Audit:
- Records allows of sensitive permissions and all denies.
- Secrets, signed URLs, prompts and lyrics in metadata are scrubbed.
- On PostgreSQL, a deny audit survives the request's rollback; the app role can insert but not update, delete or truncate `audit_events`, even through the table owner, for rows under 2 years old.
- `export_day` gives one JSON line per event for exactly that UTC day.

Tokens (all with a locally generated RSA key and `FakeJwks`):
- valid token accepted;
- expired, not-yet-valid and future-`iat` beyond leeway refused;
- wrong issuer refused; wrong audience refused when an audience is configured;
- `alg: none` refused; HS256 signed with the public key as the secret refused (algorithm confusion); RS256 signed by another key refused;
- unknown `kid` triggers one refetch, rate-limited to once a minute; a JWKS outage gives `JwksUnavailable`, not a crash; key rotation works;
- malformed base64, huge tokens and missing claims are refused cleanly.

Accounts:
- First sign-in creates the user, personal workspace and owner membership; a second call changes nothing.
- No age confirmation is refused.
- Two concurrent first sign-ins for one subject create one user (PostgreSQL race).
- Revocation cut-off never moves backwards; a token issued before it is refused.
- `resolve_principal` for a workspace the user doesn't belong to is refused; deleted users are refused.
- Account deletion returns the right plan (30-day erase, 60-day backups) and refuses for the last Owner.

### 18.11 Playback devices and sessions (SC-0415)

- The 11th signed-in device signs out the oldest and reports it; renaming and sign-out work; an iOS home-screen app gets the speaker warning.
- Heartbeat:
  - renews only for the lease holder;
  - takes an expired lease only when no one else holds it;
  - positions from non-active devices are ignored.
- Take-over moves the lease, increments `seq` and names the previous holder; two simultaneous take-overs leave exactly one winner (PostgreSQL race).
- Commands:
  - a stale `based_on_seq` is refused with the current state;
  - the same idempotency key replays the same result;
  - every command kind changes state as specified.
- Position extrapolates while playing and is frozen while paused.
- Reconnect gives `continue` when nobody took over and `stop_moved` when someone did.
- Revoking a user stops playback within the lease; only the active device reports listening events.

### 18.12 Rooms (SC-0416)

- Codes:
  - 8 characters from the 30-character alphabet;
  - input normalised (lower case, spaces, dashes); characters outside the alphabet refused;
  - stored only as an HMAC with the pepper, and a different pepper gives a different hash;
  - no reuse within 30 days of a room closing;
  - the generator draws from `secrets` (statistical spread check over 100,000 codes).
- Lifecycle:
  - only Premium can open a room; one open room per workspace;
  - a host with no mix-ready songs is refused with the reason;
  - lock and unlock; rotating the code makes the old code fail and optionally removes everyone;
  - rooms end after 12 hours, or 60 minutes with no speaker;
  - a downgrade mid-room lets it finish but blocks new rooms.
- Joining:
  - each join mode (anyone, approve, locked);
  - bans by guest and by IP hash; the guest cap is enforced;
  - nicknames come only from the generated list;
  - guest tokens are stored only as hashes.
- Requests:
  - only requestable songs;
  - 1 pending and 3 an hour per guest; the 60-minute cooldown after a song plays; 20 pending per room;
  - a duplicate pending request becomes one vote, and a guest votes at most once per request;
  - with votes off nothing reorders.
- Moderation: approve and pass; banning withdraws the guest's pending requests.
- **Property: in the accepted order, no guest gets a second spot while another guest has an accepted request waiting.**
- The render cap holds at 60 an hour.
- Display pairing: wrong or expired codes refused; display tokens can only read.
- `guest_view` never contains host identity; guest data purged 30 days after the room ends.

### 18.13 AI gateway (SC-0404)

- Routing per tier and request class matches [§9.1](09-lucy-ai-gateway.md#91-routing-model).
- **Property: no tier ever receives a deployment above its allowed set.**
- Rollout by stable workspace hash; disabled or unhealthy deployments skipped along the fallback chain, ending at the built-in planner; deployments lacking a needed capability never chosen.
- Routing versions immutable; activating one deactivates the previous.
- Allowances:
  - consume per class; a turn already started finishes at the limit;
  - monthly reset; concurrent starts never overspend.
- Spend:
  - estimates reserved and reconciled;
  - per-turn cycle, time and cost caps;
  - account concurrency leases expire;
  - circuit breaker goes closed, then open after failures, then half-open probe, then closed again;
  - platform daily and monthly caps refuse admission exactly at the cap;
  - emergency disable honoured.
- A run pinned at its start keeps its deployment after routing changes.
- **Contract:** `provider_settings_for()` produces settings that `selecta.lucy.providers` accepts to build a provider (no network), and secrets come only from the secret lookup.

### 18.14 Stripe billing (SC-0403)

- Signature:
  - valid header accepted; tampered body refused;
  - timestamps older than 300 s or too far in the future refused;
  - several `v1` values, one valid, accepted; missing or malformed header refused; wrong secret refused;
  - comparison uses `hmac.compare_digest` (checked by reading the code).
- Events:
  - stored once; the same event twice is ignored;
  - processing re-fetches the subscription.
- **Property: any shuffled, duplicated or delayed replay of a subscription's events ends at the snapshot its final Stripe state implies.**
- Snapshot rules:
  - active and trialing give the plan; `cancel_at_period_end` keeps it until period end;
  - past_due keeps it for exactly 7 days (checked at 7 days minus 1 second and plus 1 second), then Free;
  - canceled, unpaid, incomplete and incomplete_expired give Free;
  - an unknown price id gives Free with an alert;
  - snapshot versions only increase.
- Overrides: active ones apply; expired and revoked ones are ignored; they never change the stored subscription.
- Outage: the last verified snapshot holds for 72 hours.
- Reconcile reports and fixes drift.
- Checkout consent recorded with the text version.

### 18.15 Modes, storage, uploads and deletion (SC-0392, SC-0397, SC-0398, SC-0412)

- Modes: default local; an invalid `SELECTA_MODE` names the choices; adapters resolve per mode; `require_mode` refuses the other mode; `available_in_mode` follows the flag field.
- Keys:
  - never contain user text;
  - the validator refuses `..`, leading slashes, backslashes, control characters, NUL and Unicode look-alikes;
  - `input_hash` ignores key order, differs per workspace and changes with any version.
- SigV4:
  - reproduces AWS's published presigned-URL example exactly, and the header-signed example;
  - keys with spaces, `+`, `~`, Unicode and slashes encode as S3 expects;
  - query parameters sorted; expiry capped at 7 days.
- R2 client (via `MockTransport`):
  - 5xx and 429 retryable, 4xx not;
  - `ListParts` reads every page;
  - `copy_object` over 5 GB refused;
  - XML with entity expansion or external entities is rejected or harmless;
  - signed URLs never appear in logs or exception text.
- Uploads:
  - batches over 500 refused; each file checked against plan limits;
  - zero-byte files refused;
  - part size fixed at 8 MiB; more than 10,000 parts refused; a file smaller than one part is one part;
  - duplicates flagged.
- Completing an upload:
  - correct parts complete;
  - a total that differs from the declared size, unequal middle parts, a last part larger than the others, a missing part number, or a gap each abort and release the reservation;
  - completing twice gives the same outcome; an expired session can't complete.
- Accepting and rejecting:
  - accept copies to originals, deletes staging, creates the asset and commits the reservation;
  - reject deletes and releases;
  - display names are sanitised (NUL, right-to-left override U+202E, very long names, emoji, NFC).
- Artifacts:
  - local publish returns size and sha256; verify catches a mismatch;
  - a missing input gives a clear error;
  - no key can escape the root folder.
- Deletion:
  - a tombstone hides the item at once and returns the bytes to release;
  - physical deletion is due 30 days later;
  - backups clear by 60 days;
  - replay after restore re-applies every deletion.

### 18.16 Cross-cutting security suite

- **Tenant isolation matrix:** for every table with `workspace_id`, a transaction scoped to workspace A can't read, update or delete workspace B's rows. On PostgreSQL this is proven with row-level security active and a deliberately unfiltered query. On SQLite it's proven through the repository functions.
- **Injection:** every text input that reaches SQL is fuzzed with injection payloads, quotes, NUL and very long strings; all queries stay parameterised and data stays intact.
- **Secrets never leak:** captured logs and exception messages from every module are scanned for tokens, signed URLs, API keys, Stripe secrets, room codes and guest tokens.
- **Guest and display tokens** can't reach any route outside their room (asserted again at the API layer when routes are wired).
- **Static checks:** ruff's security rules (`S`, from flake8-bandit) run on the new packages; findings are fixed or justified inline.
- **Dependencies:** `pip-audit` runs nightly and fails on known vulnerabilities in runtime dependencies.

### 18.17 CI wiring

- **Linux `cloud` job** (new): PostgreSQL 16 service container, `SELECTA_TEST_POSTGRES_URL` set, runs `tests/cloud` with coverage, then `coverage_gate.py`; Hypothesis `ci` profile.
- **Windows Python shards** (existing) also collect `tests/cloud` and run its SQLite half, so local mode stays covered on the platform it ships on.
- **Nightly workflow** (new): Hypothesis `nightly` profile, the 1,000,000-decision simulator run, mutmut on the critical modules, `pip-audit`, and PostgreSQL scale checks (claim latency with 1,000,000 history rows).
- The checklist evidence job keeps rejecting ticked boxes without evidence.

### 18.18 What tests can't prove

Some acceptance criteria need people or real systems, and stay unticked until they happen:
- the owner's listening check after the job system replaces the seam worker;
- real phones for the guest page and the iPhone speaker warning;
- Stripe test mode end to end on staging;
- AuthKit with a real tenant;
- legal reviews;
- the restore drill;
- load tests beyond what CI can run.

Tests make those steps safe to try; they don't replace them.

---

[← 17-roadmap-and-risks.md](17-roadmap-and-risks.md) · [Contents](README.md#chapters) · [sources.md →](sources.md)
