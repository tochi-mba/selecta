# ADR-0470 - Personal plans without hosted audio and compute quotas

- **Decision:** Accepted by owner (2026-11-13), implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); 2026-11-13; main `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Earlier owners:** ADR-0402, ADR-0403, ADR-0414; historical statuses unchanged, affected hosted-audio assumptions superseded by ADR-0455.
- **Source touchpoints:** `src/selecta/billing/plans.py`, `src/selecta/usage/`, `web/src/cloud/Billing.tsx`, `web/src/cloud/Meters.tsx`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Checklist](selecta-local-first-implementation-checklist.md).

## Context

Charging by uploaded GB, server analysis minutes, render counts or export retention misrepresents device-funded work.

## Accepted decision

1. Version the plan catalogue; remove cloud music storage, upload size, analysis/day, cloud scheduling weight, CPU-minute, stem-preview, render/export quota and cloud-export-retention benefits from new plan versions.
2. Keep genuinely hosted features: cloud recipe sync/history, devices/remote, Rooms, collaboration, hosted Lucy and support where justified. Hardware safety is not a plan entitlement.
3. Keep hosted AI/token and abuse spending safeguards; apply plan gating to features, not raw local DSP operation or file count.
4. Preserve historical subscriptions and consent records; migration requires honest notices, price/benefit approval and compensating paths for existing cloud-storage customers.

## Operational edge cases

Billing webhook from historic plan, account over old quota, downgrade mid-local render, old UI meter, AI allowance depleted, offline local playback.

**Safety interpretation:** never report an action successfully applied before the authoritative local engine has acknowledged execution; never infer playable audio from cloud metadata alone. Where a missing recording or device is involved, preserve the original recipe and current playback.

## Implementation and backward compatibility

Publish v2 plan schema and effective entitlement translator; do not mutate historic v1 semantics until contract migration. Rollout must preserve standalone local mode and existing creative features. Staged dual compatibility is permitted only for metadata/control; audio cannot be sent through a legacy cloud path after the no-hosted-audio gate is enforced.

## Required verification

Stripe webhook/reconciliation, plan version compatibility, old-user notices, no quota regression and removal of obsolete UI meters. Synthetic audio for tests; negative assertions that forbidden media cannot leave the device. Test all relevant cloud roles and responsive UI states. Record source/test evidence and an independent review.

## Rejected alternatives

- Continue hosted-audio transport under a different endpoint name.
- Remove the user-facing feature instead of migrating its implementation.
- Use an expired device heartbeat or title-only match as proof of successful playback.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0470-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of personal plans without hosted audio and compute quotas. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0470-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0470-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0470-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted design; no application implementation is implied by this document.
