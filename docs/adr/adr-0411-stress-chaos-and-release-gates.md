# ADR-0411 - Stress, chaos and release-gate testing

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 1/5 Implemented; 0/5 In progress; 4/5 Not started.
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

## Implementation checklist - 0/5 Implemented; 0/5 independently Verified

1. **SC-0411-01 - Invariant checker.** **Acceptance:** All ten invariants checked automatically after each test run. **Required verification:** CI. **Implementation:** In progress; the cloud_engine, sqlite_engine and postgres_engine fixtures run `selecta.audit.invariants.assert_clean` after every passing test (invariants 1-7 and 9); tests that break one on purpose carry `@pytest.mark.invariants_off(reason)`; invariants 8 and 10 cannot be read from the database and stay with the AI gateway and site tests; a green CI run on the Windows shards and Cloud / PostgreSQL is still needed. **Evidence:** `tests/cloud_db.py`; `tests/conftest.py`; `tests/test_cloud_invariants.py::test_the_engine_fixtures_fail_a_passing_test_that_left_a_violation`. **Independently Verified:** No.
2. **SC-0411-02 - Simulator in CI.** **Acceptance:** Scheduler simulator runs on every PR. **Required verification:** CI. **Implementation:** Implemented; the scheduler simulator's tests are cloud tests, which the Cloud / PostgreSQL job runs on every pull request. **Evidence:** `tests/test_cloud_scheduling_simulator.py` in the `Cloud / PostgreSQL (Linux)` job of `.github/workflows/test.yml`. **Independently Verified:** No.
3. **SC-0411-03 - Linux integration job.** **Acceptance:** Postgres and MinIO integration tests run on Linux in CI. **Required verification:** CI. **Implementation:** In progress; the Linux Cloud / PostgreSQL job now also starts MinIO and runs the object-storage adapter against it (put, get, head, list, delete, presigned GET and PUT with tampered and unsigned URLs refused, multipart complete and abort); the tests skip when no S3 server is configured; waits for its first CI run. **Evidence:** `.github/workflows/test.yml` job cloud (Start MinIO step); `tests/test_cloud_storage_minio.py`. **Independently Verified:** No.
4. **SC-0411-04 - Ladder to L4.** **Acceptance:** L1–L4 pass the thresholds on staging. **Required verification:** Load reports. **Implementation:** Not started; **Independently Verified:** No.
5. **SC-0411-05 - Catastrophe suite.** **Acceptance:** L6 combinations pass with clean reconciliation. **Required verification:** Chaos report. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
