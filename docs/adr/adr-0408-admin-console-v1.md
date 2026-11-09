# ADR-0408 — Admin console v1

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/4 Implemented; 0/4 In progress; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P1 / Phase 6. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0401, ADR-0414; their statuses are unchanged.
- **Source touchpoints:** new `web/src/admin/`, `src/selecta/admin/`; `web/src/ui/` (data table, charts).
- **Proposal chapter:** [docs/saas/07-identity-rbac-admin.md](../saas/07-identity-rbac-admin.md#75-admin-console-v1-six-pages-before-beta).

## Context and evidence boundary

The owner needs to see and steer the platform (health, queues, workers, accounts, billing, AI routing, security, flags) without dashboards overloading the database.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Admin console as a lazy-loaded `/admin` area of the same React app, shown only to staff and enforced server-side.
- Six pages before beta: Overview, Jobs & workers, Accounts & billing, AI routing, Security, Flags.
- Reads come from metrics and small refreshed aggregates; actions are audited commands through the same transactional services customers use, never direct edits.
- Every number shows its freshness.

## User outcome and acceptance contract

One place answers 'is Selecta working, what's broken, who's affected, what is it costing' and offers safe actions.

## Rejected alternatives

- A separate admin app and design system.
- Dashboards querying the live jobs table.

## Implementation checklist — 0/4 Implemented; 0/4 independently Verified

1. **SC-0408-01 — Six pages.** **Acceptance:** Each page meets its content list in the proposal. **Required verification:** Playwright walkthrough. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0408-02 — Commands not edits.** **Acceptance:** Retry, cancel, quarantine, drain and overrides go through audited commands. **Required verification:** Integration tests. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0408-03 — Read path isolation.** **Acceptance:** Twenty admin viewers don't change customer API latency. **Required verification:** Load test. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0408-04 — Freshness.** **Acceptance:** Stale metrics show their age and an unknown state. **Required verification:** Unit test. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
