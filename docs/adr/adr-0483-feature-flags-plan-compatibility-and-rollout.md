# ADR-0483 - Feature flags, plan compatibility and rollout

- **Decision:** Accepted by owner (2026-11-13); not implemented.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); main `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Earlier decisions:** ADR-0391 through ADR-0454 retain their historical statuses; ADR-0455 and this ADR supersede relevant hosted-user-audio assumptions only.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md), [Implementation checklist](selecta-local-first-implementation-checklist.md), [Parity mapping](selecta-local-first-overlap-and-parity.md).

## Context

New execution ownership means former cloud.uploads and worker flags must not become misleading feature controls.

## Decision

1. Separate feature flags, plan entitlement, user permission, device capability, local media readiness and hard venue policy; return stable refusal reasons.
2. Retire hosted-audio flags and routes only after UI/new API parity and migration proof; preserve unrelated Rooms, Lucy, business, local engine and editor features.
3. Version the plan/flag contract so legacy clients fail safely; feature on does not imply a track is present or a local engine online.
4. Regenerate docs/flags.md and route ownership indexes when code changes, not as part of this docs-only PR.

## Edge cases and failure outcomes

Old signed-in device with deprecated client; plan downgrade while rendering locally; feature on with no source; flag off while music plays.

Device-local audio truth and the existing user-facing creative capabilities must always be preserved. A cloud-accepted request or a saved recipe is not proof that a local player can execute it; missing, stale or forbidden media requires an explicit refusal or safe fallback.

## Compatibility and migration

Changes are staged with historical versions and source inventories; legacy hosted-media operations must not remain active as an accidental backdoor. Do not delete user recordings, edit historical acceptance evidence or mark incomplete code as implemented. Every affected UI state must explain the real execution location and available recovery.

## Required verification

Use synthetic media for automated tests, negative cloud-audio-egress assertions, appropriate role/tenant checks and both local and connected-mode parity. Record independent test evidence and a rollback decision before deleting an old contract.

## Rejected alternatives

- Keep the hosted media pipeline under renamed URLs or an undocumented transport.
- Silently lose a music/editor/venue capability to simplify implementation.
- Treat docs-only acceptance as source-code implementation.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0483-01 - Source and contract map.** **Acceptance:** map exact old/new schema, routes, UI ownership, capability parity and failure states. **Required verification:** independent source review. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0483-02 - Implementation.** **Acceptance:** implement all decisions while retaining existing local and connected user capabilities. **Required verification:** unit and integration suites. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0483-03 - Negative and edge coverage.** **Acceptance:** exercise every named failure and prohibit cloud transfer of audio. **Required verification:** security, E2E and fault tests. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0483-04 - Migration and release evidence.** **Acceptance:** demonstrate compatibility, rollback and independent operational/legal sign-off as applicable. **Required verification:** checked release ledger. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted design decision only. All LF implementation tasks are Not started.
