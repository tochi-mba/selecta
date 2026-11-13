# ADR-0471 - Business billing, zones, seats and locally provisioned media

- **Decision:** Accepted by owner (2026-11-13), implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); 2026-11-13; main `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Earlier owners:** ADR-0441, ADR-0447, ADR-0448; historical statuses unchanged, affected hosted-audio assumptions superseded by ADR-0455.
- **Source touchpoints:** `src/selecta/business/billing.py`, `src/selecta/business/entitlements.py`, `web/src/business/console/BillingPage.tsx`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Checklist](selecta-local-first-implementation-checklist.md).

## Context

Organisation library storage and render-ahead compute weights are no longer central cost drivers; a venue subscription is for managed operations.

## Accepted decision

1. Price and entitle venues, independently audible zones, staff seats, managed devices, scheduling/Rooms, licensed AI, service/support and optionally support commitments.
2. Remove pooled music GB, per-org daily analysis and render-ahead CPU budgets as purchased quantities; show local disk, source and cache health under device management only.
3. Retain Stripe, payment lifecycle, enterprise contracts, zone-seat quantity reconciliation, service credits where legally agreed and hosted AI allowances.
4. An organisation-wide programme is metadata; every venue independently proves local media ownership, policy eligibility and readiness before activation.

## Operational edge cases

Venue loses disk during paid service, organisation reduces zones, employee is removed, existing contract lists storage, multi-venue catalogue with only one ready branch.

**Safety interpretation:** never report an action successfully applied before the authoritative local engine has acknowledged execution; never infer playable audio from cloud metadata alone. Where a missing recording or device is involved, preserve the original recipe and current playback.

## Implementation and backward compatibility

Version business catalogue and commercial terms separately; don't silently remove purchased hosted-storage rights. Rollout must preserve standalone local mode and existing creative features. Staged dual compatibility is permitted only for metadata/control; audio cannot be sent through a legacy cloud path after the no-hosted-audio gate is enforced.

## Required verification

Venue/zone quantity tests, billing grace and continued local playback, upgrade/downgrade, contract notices and HQ readiness. Synthetic audio for tests; negative assertions that forbidden media cannot leave the device. Test all relevant cloud roles and responsive UI states. Record source/test evidence and an independent review.

## Rejected alternatives

- Continue hosted-audio transport under a different endpoint name.
- Remove the user-facing feature instead of migrating its implementation.
- Use an expired device heartbeat or title-only match as proof of successful playback.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0471-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of business billing, zones, seats and locally provisioned media. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0471-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0471-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0471-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted design; no application implementation is implied by this document.
