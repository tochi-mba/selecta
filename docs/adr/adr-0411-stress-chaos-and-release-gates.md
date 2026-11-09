# ADR-0411 - Stress, chaos and release-gate testing

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/5 Implemented; 0/5 In progress; 5/5 Not started.
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

1. **SC-0411-01 - Invariant checker.** **Acceptance:** All ten invariants checked automatically after each test run. **Required verification:** CI. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0411-02 - Simulator in CI.** **Acceptance:** Scheduler simulator runs on every PR. **Required verification:** CI. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0411-03 - Linux integration job.** **Acceptance:** Postgres and MinIO integration tests run on Linux in CI. **Required verification:** CI. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0411-04 - Ladder to L4.** **Acceptance:** L1–L4 pass the thresholds on staging. **Required verification:** Load reports. **Implementation:** Not started; **Independently Verified:** No.
5. **SC-0411-05 - Catastrophe suite.** **Acceptance:** L6 combinations pass with clean reconciliation. **Required verification:** Chaos report. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
