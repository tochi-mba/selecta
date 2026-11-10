# ADR-0402 - Plans, entitlements, quotas and allowances

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 4/4 Implemented; 0/4 In progress; 0/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 4. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0398, ADR-0395, ADR-0414; their statuses are unchanged.
- **Source touchpoints:** new `src/selecta/billing/plans.py`, `src/selecta/usage/`; `web/src/billing/`.
- **Proposal chapter:** [docs/saas/02-plans-and-economics.md](../saas/02-plans-and-economics.md#31-plan-catalogue-starting-values-all-admin-tunable-and-versioned).

## Context and evidence boundary

Storage is the headline limit (10/50/100 GB), but processing and AI are the real costs, so plans need more than a storage number.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- A versioned plan catalogue in code lists storage, scheduling weight, concurrency, daily analysis, speculative budget, exports, file limits, Lucy allowances, Rooms and the flag ids each plan includes.
- Storage counts originals and kept exports only; system-managed data has its own capped budget.
- An append-only usage ledger with daily rollups backs every meter; allowances reset at the account's local midnight.
- Over quota after a downgrade: read-only for storage-growing actions, never deletion; retention policy published from day one.

## User outcome and acceptance contract

Users see plain meters and specific limits; Selecta's costs stay bounded per plan.

## Rejected alternatives

- Storage-only plans (unbounded processing and AI cost).
- Token or CPU-second meters shown to users.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **SC-0402-01 - Plan catalogue.** **Acceptance:** Plans validate against the flag registry; changes are versioned. **Required verification:** Unit test plus CI check. **Implementation:** Implemented; the versioned plan catalogue validates against the flag registry before the API and gateway start. **Evidence:** `tests/test_cloud_plans.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
2. **SC-0402-02 - Usage ledger.** **Acceptance:** Ledger totals match rollups and storage inventory. **Required verification:** Reconciliation test. **Implementation:** Implemented; the reconciler compares ledger totals with rollups, committed bytes and stored originals, and reports drift without fixing it. **Evidence:** `tests/test_cloud_usage_reconcile.py` (8 tests), passing on SQLite and PostgreSQL. **Independently Verified:** No.
3. **SC-0402-03 - Over-quota state.** **Acceptance:** Uploads and exports are blocked, playback and downloads work, nothing is deleted. **Required verification:** Integration and Playwright tests. **Implementation:** Implemented; over quota, uploads and exports wait, playback and downloads keep working, and nothing is deleted. **Evidence:** `tests/test_cloud_over_quota.py` and `web/e2e-cloud/storage.cloud.ts` 'over quota: the banner names the overage, uploads wait, listening and downloads still work', passing. **Independently Verified:** No.
4. **SC-0402-04 - Meters.** **Acceptance:** Plan & billing shows storage, analysis today, Lucy turns and exports. **Required verification:** Playwright test. **Implementation:** Implemented; Plan & billing shows storage, analysis today, Lucy turns and exports with their resets. **Evidence:** `web/e2e-cloud/billing.cloud.ts` 'Plan & billing shows storage, analysis today, Lucy turns and exports, with resets' and `tests/test_cloud_account_meters.py`, passing. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
