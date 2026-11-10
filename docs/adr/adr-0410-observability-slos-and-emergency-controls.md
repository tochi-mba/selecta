# ADR-0410 - Observability, SLOs and emergency controls

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/4 Implemented; 1/4 In progress; 3/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P1 / Phase 7. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0409; their statuses are unchanged.
- **Source touchpoints:** new `docs/operations/`; OpenTelemetry instrumentation across `src/selecta/`.
- **Proposal chapter:** [docs/saas/14-operations.md](../saas/14-operations.md).

## Context and evidence boundary

A solo operator needs to know quickly when something breaks and have safe, rehearsed actions.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- OpenTelemetry traces across API, gateway and workers with job ids as span attributes; low-cardinality metrics.
- Beta SLOs: API availability 99.5%, routine p95 under 300 ms, interactive seam start p95 under 10 s when capacity exists, zero lost accepted jobs, webhook-to-entitlement p95 under 60 s.
- Phone alerts for the listed conditions, each with a runbook.
- Emergency controls are declarative states (pause uploads, pause a pool, drain, disable speculative work, disable Lucy or a deployment, billing safe mode, read-only app, close sign-ups), not scripts.
- A status page on separate infrastructure.

## User outcome and acceptance contract

Incidents are noticed in minutes and handled with known-safe steps.

## Rejected alternatives

- High-cardinality labels (user or job ids) on metrics.
- Emergency scripts run from a browser.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **SC-0410-01 - Tracing.** **Acceptance:** One trace follows a job from API to worker to storage. **Required verification:** Staging trace review. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0410-02 - SLO dashboards and alerts.** **Acceptance:** Each SLO has a dashboard and burn alert. **Required verification:** Alert test. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0410-03 - Runbooks.** **Acceptance:** Every alert links to a runbook. **Required verification:** Doc review. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0410-04 - Emergency controls.** **Acceptance:** Each control works and is audited; recovery restores normal state. **Required verification:** Game-day drill. **Implementation:** In progress; typed engage/recover controls, durable state, audit records and alerts have focused integration coverage; a game-day drill remains. **Evidence:** `src/selecta/admin/emergency.py`; `tests/test_cloud_admin_backend.py`. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
