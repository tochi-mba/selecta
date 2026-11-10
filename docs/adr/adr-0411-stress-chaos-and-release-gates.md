# ADR-0411 - Stress, chaos and release-gate testing

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 1/5 Implemented; 4/5 In progress; 0/5 Not started.
- **Independent verification:** 0/5 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 2 onwards. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0390 (flag sweep in CI); their statuses are unchanged.
- **Source touchpoints:** new `tests/sim/`, `tests/integration/`, `tests/load/`, `tests/chaos/`; `.github/workflows/test.yml`.
- **Proposal chapter:** [docs/saas/15-stress-testing.md](../saas/15-stress-testing.md#152-the-ten-invariants-automated-checked-after-every-test).

## Context and evidence boundary

A system that works for 20 users can fail at 2,000 through contention, duplication or unfairness. The owner asked for deliberately exaggerated stress tests.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Ten invariants are checked after every test, followed by a reconciliation audit; drift fails the run.
- A load ladder from L1 (100 active users) to L6 (catastrophe combinations), with synthetic records and simulated workers above L2 and real audio where it teaches something.
- A named scenario catalogue covering queue, workers, uploads, audio, playback, devices, Rooms, billing, AI, database, security, flags and UI.
- Pass/fail thresholds as in the proposal; a schedule from every PR to monthly drills; strict spend caps and synthetic data only.
- Linux CI jobs for cloud mode alongside the existing Windows jobs.

## User outcome and acceptance contract

Every release has evidence that Selecta stays correct and fair under load and failure, not just that it builds.

## Rejected alternatives

- Stress testing only before launch.
- Running load tests against paid AI providers without caps.

## Implementation checklist - 1/5 Implemented; 0/5 independently Verified

1. **SC-0411-01 - Invariant checker.** **Acceptance:** All ten invariants checked automatically after each test run. **Required verification:** CI. **Implementation:** In progress; the cloud_engine, sqlite_engine and postgres_engine fixtures run `selecta.audit.invariants.assert_clean` after every passing test (invariants 1-7 and 9); tests that break one on purpose carry `@pytest.mark.invariants_off(reason)`; invariants 8 and 10 cannot be read from the database and stay with the AI gateway and site tests; a green CI run on the Windows shards and Cloud / PostgreSQL is still needed. **Evidence:** `tests/cloud_db.py`; `tests/conftest.py`; `tests/test_cloud_invariants.py::test_the_engine_fixtures_fail_a_passing_test_that_left_a_violation`. **Independently Verified:** No.
2. **SC-0411-02 - Simulator in CI.** **Acceptance:** Scheduler simulator runs on every PR. **Required verification:** CI. **Implementation:** Implemented; the scheduler simulator's tests are cloud tests, which the Cloud / PostgreSQL job runs on every pull request. **Evidence:** `tests/test_cloud_scheduling_simulator.py` in the `Cloud / PostgreSQL (Linux)` job of `.github/workflows/test.yml`. **Independently Verified:** No.
3. **SC-0411-03 - Linux integration job.** **Acceptance:** Postgres and MinIO integration tests run on Linux in CI. **Required verification:** CI. **Implementation:** In progress; the Linux Cloud / PostgreSQL job now also starts an S3 server and runs the object-storage adapter against it (SeaweedFS `chrislusf/seaweedfs:4.52`, pinned by digest, stands in for MinIO, which stopped publishing images; it checks SigV4 and accepts R2's `auto` region) (put, get, head, list, delete, presigned GET and PUT with tampered and unsigned URLs refused, multipart complete and abort); the tests skip when no S3 server is configured, as on this laptop. Needs CI: S3 server (SeaweedFS) run of `tests/test_cloud_storage_s3.py` in the Cloud / PostgreSQL job. **Evidence:** `.github/workflows/test.yml` job cloud (Start the S3 server (SeaweedFS) step); `tests/test_cloud_storage_s3.py`. **Independently Verified:** No.
4. **SC-0411-04 - Ladder to L4.** **Acceptance:** L1–L4 pass the thresholds on staging. **Required verification:** Load reports. **Implementation:** In progress; the ladder L1 to L4 and the section 15.6 thresholds (routine API p95 under 300 ms, error rate under 0.5% with deliberate 429s excluded, zero duplicate results, cross-tenant successes and lost jobs) live once in `tests/load/ladder.py`, which writes `tests/load/ladder.json` for the k6 staging script `tests/load/k6/ladder.js` (ramping VUs per rung, thresholds as pass/fail) and has its own runner (`python tests/load/ladder.py run --level L1 --base-url ... --tokens ...`) and judge (`check`); a scaled-down L1 (10 synthetic accounts, 100 pending jobs, a cross-tenant probe and a Pause sent twice with one idempotency key) passed the thresholds locally on 2026-11-10 (p95 49 ms, 0 errors, 0 duplicates, 0 cross-tenant successes, 0 lost jobs). Needs staging: run L1 to L4 at full size on staging with synthetic accounts and file the load reports. **Evidence:** `tests/test_load_ladder.py` (12 passed on 2026-11-10, including `test_a_scaled_down_l1_passes_the_thresholds_locally`, `test_k6_reads_the_same_ladder`, `test_the_levels_match_the_proposal_table`); `tests/load/ladder.py`; `tests/load/k6/ladder.js`. **Independently Verified:** No.
5. **SC-0411-05 - Catastrophe suite.** **Acceptance:** L6 combinations pass with clean reconciliation. **Required verification:** Chaos report. **Implementation:** In progress; `tests/test_cloud_catastrophe.py` runs two L6 combinations locally, scaled down, with fault injection into the real services and a reconciliation audit at the end: every worker killed mid-attempt round after round while customers keep submitting and two operators engage the worker drain at the same moment (both answered, one control), then release and finish (75 accepted jobs, none lost, none published twice); and R2 refusing purges while Stripe events arrive late, out of order and five times over under billing safe mode, while the database is restored from before recent deletions and new deletions keep landing (the ledger replay hides them all again, purges retry until done, only deleted songs leave R2, each Stripe event applies once); `invariants.assert_clean` finds no drift. Not in the combinations yet: an AI-provider outage and the launch-day stampede. Needs staging: L6 at L3 load on staging and a filed chaos report. **Evidence:** `tests/test_cloud_catastrophe.py::test_every_worker_dies_while_users_keep_working_and_two_operators_race_a_drain` and `::test_flaky_r2_delayed_stripe_and_a_restore_during_traffic_with_pending_deletions` (2 passed on SQLite on 2026-11-10). **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
