# ADR-0482 - Local-first testing and release verification matrix

- **Decision:** Accepted by owner (2026-11-13); not implemented.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); main `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Earlier decisions:** ADR-0391 through ADR-0454 retain their historical statuses; ADR-0455 and this ADR supersede relevant hosted-user-audio assumptions only.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md), [Implementation checklist](selecta-local-first-implementation-checklist.md), [Parity mapping](selecta-local-first-overlap-and-parity.md).

## Context

Existing CI checks uploads, worker pools and signed URLs; passing through skips would hide loss of functionality.

## Decision

1. Inventory each old Python, Playwright and infrastructure test and map to retained or replacement behaviour; do not silently remove coverage.
2. Run two or more synthetic local agents with divergent source libraries against cloud control service and exercise missing-media, takeover, offline and tenant isolation.
3. Test forbidden media ingress/egress through payloads, AI, logs, metrics, storage and error paths; test local API authentication and unsafe file paths.
4. Separate cloud fleet load from six-hour hardware playback, low disk, GPU overload, source disconnect, power cut and real audio output verification.

## Edge cases and failure outcomes

Host with 5 of 8 songs, lost command ACK, duplicate takeover, clean-version substitution, 1,500 zones reconnect, screen reader, 400% zoom.

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

1. **LF-0482-01 - Source and contract map.** **Acceptance:** map exact old/new schema, routes, UI ownership, capability parity and failure states. **Required verification:** independent source review. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0482-02 - Implementation.** **Acceptance:** implement all decisions while retaining existing local and connected user capabilities. **Required verification:** unit and integration suites. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0482-03 - Negative and edge coverage.** **Acceptance:** exercise every named failure and prohibit cloud transfer of audio. **Required verification:** security, E2E and fault tests. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0482-04 - Migration and release evidence.** **Acceptance:** demonstrate compatibility, rollback and independent operational/legal sign-off as applicable. **Required verification:** checked release ledger. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted design decision only. All LF implementation tasks are Not started.
