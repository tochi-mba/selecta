# ADR-0395 - Fair scheduling: lanes and per-account weights by tier

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 4/6 Implemented; 0/6 In progress; 2/6 Not started.
- **Independent verification:** 0/6 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 2. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0394; their statuses are unchanged.
- **Source touchpoints:** `src/selecta/seams.py` (`URGENT…PREPARING` ranks, `give_way_when`); `src/selecta/request_planner.py`; new `src/selecta/scheduling/`; new `tests/sim/`.
- **Proposal chapter:** [docs/saas/04-queue-and-scheduling.md](../saas/04-queue-and-scheduling.md#4a4-scheduling-policy).

## Context and evidence boundary

Paying tiers should get faster processing without anyone being starved, and the musical urgency Selecta already models (the transition about to be heard first) must survive. Fixed tier percentages (10/30/60%) give unstable per-user results as the user mix changes.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Hierarchy: pool, then lane (interactive 4, standard 1, speculative strictly last with a per-tier daily budget), then account, then job.
- Accounts share a lane by start-time fair queuing with virtual time; weight per account by tier (Free 1, Standard 3, Premium 6), charged in estimated compute seconds and corrected by actual use.
- Within an account: server-assigned urgency, then deadline, then the user's render-line order, then age. Clients never choose urgency.
- Deadline boost for playback-critical seams within a per-account allowance; per-account interactive concurrency caps.
- Admission control: lazy workflow materialisation, per-type caps, overload deferral of Free standard work before any refusal; accepted work is never dropped.
- Weights and caps are admin-tunable, versioned, and forecast with the simulator before applying.

## User outcome and acceptance contract

Under load a Premium account gets about six times a Free account's processing rate, every backlogged account keeps moving, and the next transition of a playing mix jumps ahead.

## Rejected alternatives

- Strict priority by tier (starves Free).
- Tier-level percentage shares (unstable per-user ratios).
- Hatchet round-robin concurrency (no weights per tier).

## Implementation checklist - 0/6 Implemented; 0/6 independently Verified

1. **SC-0395-01 - Policy module.** **Acceptance:** `choose(pool, worker_caps, now)` implements the hierarchy; shared by the claim and the simulator. **Required verification:** Unit tests. **Implementation:** Implemented; `scheduling/policy.py` implements pool, lane, account and job selection and is the same code the claim and the simulator call. **Evidence:** `tests/test_cloud_scheduling_policy.py`, `tests/test_cloud_jobs_claim.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
2. **SC-0395-02 - Simulator.** **Acceptance:** Deterministic simulator with virtual clock, invariants after every event, per-tier wait percentiles and share error. **Required verification:** Runs on every PR. **Implementation:** Implemented; `scheduling/simulator.py` runs the policy module with a virtual clock and seeded randomness, checks invariants after every event and reports per-tier waits and share error; it runs in every PR's cloud and Python jobs. **Evidence:** `tests/test_cloud_scheduling_simulator.py::test_invariants_hold_after_every_event_in_long_random_scenarios`, `tests/test_cloud_scheduling_simulator.py::test_the_same_seed_gives_the_same_report`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
3. **SC-0395-03 - Fairness threshold.** **Acceptance:** Under saturation, measured share per backlogged account is within ±15% of weight ratio over 10-minute windows. **Required verification:** Simulator scenarios. **Implementation:** Implemented; under saturation each backlogged account's share stays within 15% of its weight ratio across seeds. **Evidence:** `tests/test_cloud_scheduling_simulator.py::test_different_seeds_still_keep_share_error_within_fifteen_percent`, `tests/test_cloud_scheduling_simulator.py::test_one_premium_and_one_free_on_twenty_slots_split_about_seventeen_to_three`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
4. **SC-0395-04 - No starvation.** **Acceptance:** No backlogged account waits beyond the policy bound in any scenario, including 72 h of Premium demand. **Required verification:** Simulator scenarios. **Implementation:** Implemented; no backlogged account waits beyond its policy bound, including 72 hours of Premium demand. **Evidence:** `tests/test_cloud_scheduling_simulator.py::test_no_backlogged_account_waits_beyond_its_bound_through_72_hours_of_premium_demand`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
5. **SC-0395-05 - Admission control.** **Acceptance:** 10M-job submission keeps the API responsive and materialises work lazily. **Required verification:** Load test L4. **Implementation:** Not started; **Independently Verified:** No.
6. **SC-0395-06 - Rank mapping.** **Acceptance:** Today's six ranks map to lanes and urgency as specified; local mode uses the same policy. **Required verification:** Unit tests plus local listening check. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
