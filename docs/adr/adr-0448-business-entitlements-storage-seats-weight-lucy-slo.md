# ADR-0448 - Business entitlements: pooled storage, seats, processing weight, Lucy, SLO

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/10 Not started.
- **Independent verification:** 0/10 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P1 / Phase B0 (build, selling off); measured in Phase B1 (scouting). **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0402 (plans and quotas), ADR-0395 (fair scheduling), ADR-0404 (Lucy gateway), ADR-0410 (SLOs), ADR-0442, ADR-0444, ADR-0446; their statuses are unchanged.
- **Source touchpoints:** `src/selecta/billing/plans.py`; `src/selecta/usage/`; `src/selecta/scheduling/policy.py`; Lucy gateway; new `src/selecta/business/entitlements.py`; `src/selecta/flags/cloud.json` (new `business.entitlements`).
- **Proposal chapter:** [docs/saas/19-business-venues.md](../saas/19-business-venues.md#194-unit-economics-per-venue).

## Context and evidence boundary

Individual plans give one account storage, a scheduling weight and Lucy turns. A business has many venues sharing one library, staff who come and go, and venues where silence during opening hours is the worst possible failure. Allowances must therefore pool across the organisation, scale with paid venues, and favour a venue's next transition over every other kind of work while it is open, without starving individual users (ADR-0395's promise stays).

This ADR records a proposed decision. Costs and allowances are estimates from the proposal chapter and must be replaced by scouting measurements.

## Decision

- **Pooled storage:** 250 GB per organisation plus 50 GB per paid venue, decimal GB, counted as in ADR-0402 (originals and kept exports); derived data has its own capped budget (at most 15% of pooled storage). Over quota after a downgrade: read-only for uploads, never deletion.
- **Seats:** 3 staff seats per paid venue, pooled across the organisation; owners and admins free; extra seats billed through ADR-0447. Inviting past the paid seats asks the admin to confirm the extra charge.
- **Zones:** one zone per paid venue plus paid extra zones; starting a zone past the paid count is refused with a plain message.
- **Processing weight:** 8 for the interactive lane of any zone inside its venue's opening hours (plus 30 minutes before opening for render-ahead); 6 outside opening hours. Per-zone interactive concurrency caps keep the weight from being gamed. The weight is admin-tunable like ADR-0395's.
- **Render-ahead budget:** each open zone may keep up to 4 hours of mix rendered ahead (ADR-0446), bounded by a per-zone daily CPU budget; skipped work counts against it.
- **Analysis:** up to 10,000 new songs per day per organisation, priority songs first.
- **Lucy:** a venue programming assistant with a pooled monthly allowance per paid venue (starting point: 300 quick turns, 30 planning turns, 5 deep plans), with ADR-0404 per-turn ceilings. Lucy for business never sees personal workspace data.
- **Business SLO:** playback continuity, meaning no silence attributable to SelectaDJ for 99.9% of scheduled opening minutes per zone per month, measured from kiosk heartbeats and play logs; transition readiness at least 99.5% of transitions ready 60 s before needed. Service credits: 10% of the venue's monthly fee for each full 0.1% below target, capped at 50%, as invoice credit notes. Offline minutes caused by the venue's own internet are excluded only when the kiosk kept playing from its cache.
- **Cost guard:** a per-organisation monthly cost estimate; alerts at 50% and 80% of the venue fee; never silences a venue, only slows speculative work.

## User outcome and acceptance contract

A business gets storage and help that grow with its venues, staff seats that are simple to count, and transitions that are ready in time whenever a venue is open, with an honest monthly continuity figure.

## Edge cases

- Downgrade from 10 venues to 3 drops pooled storage from 750 GB to 400 GB: uploads read-only until under the limit; nothing deleted; the owner sees what to remove.
- One venue's library hog: storage is pooled by design; per-venue usage is shown so the owner can manage it.
- Seat removed while the staff member is logged in at the bar: their sessions end at the next request (ADR-0452 offboarding), playback continues.
- Twenty venues all opening at 09:00: render-ahead from 08:30 is staggered; the simulator must show individual users still progress.
- A venue with no opening hours set: treated as always open for weight only after the owner confirms, otherwise weight 6.
- Lucy pool used up mid-month: planning still works without Lucy; Lucy says plainly when the pool resets.
- SLO measurement during a kiosk power cut: minutes without a heartbeat and without a play log are counted as unknown, shown separately, and not claimed as uptime.

## Rejected alternatives

- Per-venue storage silos (forces duplicate uploads of the same library).
- Unlimited weight for businesses (would starve individual users and break ADR-0395).
- Charging for SLO credits automatically as refunds (credits on invoices are simpler and auditable).

## Implementation checklist - 0/10 Not started; 0/10 independently Verified

1. **BZ-0448-01 - Pooled storage.** **Acceptance:** Limit = 250 GB + 50 GB per paid venue, recomputed on any venue change; per-venue usage shown; over quota is read-only, never deletion; flag `business.entitlements` registered (default off). **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0448-02 - Seats.** **Acceptance:** 3 staff seats per paid venue, pooled; owners and admins free; inviting past the count asks for confirmation and updates the ADR-0447 seat quantity; removing a seat revokes sessions. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0448-03 - Zone entitlement.** **Acceptance:** Starting a zone beyond the paid count is refused in the API and explained in the UI; paused zones keep their settings. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0448-04 - Opening-hours processing weight.** **Acceptance:** Interactive work of an open zone runs at weight 8 (from 30 minutes before opening) and 6 otherwise; in the scheduler simulator an open venue's next transition is never behind bulk work, and Free, Standard and Premium accounts still get their ADR-0395 shares. **Required verification:** Scheduler simulator tests. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0448-05 - Render-ahead budget.** **Acceptance:** Each open zone keeps up to 4 hours rendered ahead within a per-zone daily CPU budget; skipped renders count; staggered starts when many venues open together. **Required verification:** Integration and simulator tests. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0448-06 - Analysis allowance.** **Acceptance:** Up to 10,000 new songs per day per organisation, priority songs first, reset at the organisation's local midnight. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0448-07 - Lucy venue pool.** **Acceptance:** Pooled monthly turns per paid venue by model class with per-turn ceilings; business Lucy cannot read personal workspace data; plain message when the pool is used up. **Required verification:** Integration tests including a cross-workspace isolation test. **Implementation:** Not started. **Independently Verified:** No.
8. **BZ-0448-08 - Business usage meters.** **Acceptance:** `GET /api/business/usage` returns organisation and per-venue meters (storage, seats, zones, analysis, Lucy, render budget) read from the rows the server enforces with; manager devices show them, staff do not. **Required verification:** Integration tests plus a Playwright test. **Implementation:** Not started. **Independently Verified:** No.
9. **BZ-0448-09 - Business SLO and service credits.** **Acceptance:** Continuity and readiness are computed per zone per month from heartbeats and play logs, unknown minutes shown separately, a dashboard shows them, and credits are proposed per the policy as invoice credit notes for staff approval; cost-guard alerts at 50% and 80% never silence a venue. **Required verification:** Unit tests on synthetic heartbeat and play-log data plus integration tests. **Implementation:** Not started. **Independently Verified:** No.
10. **BZ-0448-10 - Replace estimates with scouting measurements.** **Acceptance:** Storage, render, Lucy and support cost per pilot venue are measured over the scouting phase and the allowances and unit economics in the chapter are updated. **Required verification:** Measurement report. **Implementation:** Not started. Needs a person: real pilot venues running for at least 4 weeks (BZ-0441-07). **Independently Verified:** No.

## Governance

Proposed on 2026-11-12 for the owner's decision. Older ADRs keep their statuses; this one only links to them.
