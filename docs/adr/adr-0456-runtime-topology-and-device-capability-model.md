# ADR-0456 - Runtime topology and device capability model

- **Decision:** Accepted by owner (2026-11-13); implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); `main` `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Prior decisions:** ADR-0392, ADR-0390, ADR-0414; conflicting hosted-media assumptions superseded by ADR-0455 and this decision, not historical statuses.
- **Source touchpoints:** `src/selecta/modes/core.py`, `src/selecta/api_cloud.py`, `web/src/RuntimeApp.tsx`, `web/src/devices/`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Implementation checklist](selecta-local-first-implementation-checklist.md).

## Context

A binary local/cloud execution mode cannot describe a connected PC that processes audio locally, a remote-control-only phone or an offline venue player.

## Decision and invariants

1. Model independent dimensions: audio execution (local engine/controller-only), connectivity (offline/connecting/online/degraded), workspace (standalone/personal/business), and role/capability.
2. Keep the public cloud API as a stateless control plane, never as an alternate DSP runner. Existing standalone local mode stays account-free.
3. Capability negotiation is typed and versioned: supported codecs, analysis, stems, outputs, runtime version, background operation, storage and supported control actions. A capability claim is not evidence of media readiness.
4. Unsupported device capabilities are reported with an actionable reason and never silently downgraded to fake success.

## Edge cases and rejection semantics

A controller cannot open local files, a venue device may be offline, and a browser may have no filesystem permission. Mode and feature flags must not conflate these states.

Unknown device readiness, stale metadata, unavailable media, forbidden sources and failed local execution must never be turned into a false successful cloud state. Preserve original media and immutable user work.

## Migration and compatibility

Introduce a compatibility adapter while older clients use SELECTA_MODE; never rewrite existing local-mode settings. Standalone local mode retains all existing guarantees. Do not remove an old route, flag, screen or worker before its functionality is either replaced with verified parity or explicitly retired by a separate approved record.

## Verification requirements

Integration matrix for Windows/Linux/macOS/controller-only, offline start, feature flags and cloud app startup. Assert no user audio traverses the cloud boundary. Cover successful and failing states, retries, stale command/revision handling, accessibility and device-specific visibility where appropriate. Synthetic recordings only in automated tests.

## Rejected alternatives

- Preserve old cloud-audio assumptions under renamed UI copy.
- Silently weaken existing features to make the new architecture easier to implement.
- Mark a proposed feature implemented based solely on documentation.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0456-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for runtime topology and device capability model. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0456-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0456-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0456-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## Governance

This ADR is an accepted design decision, **not implemented functionality**. All corresponding LF tasks remain Not started until code, tests and required human checks exist.
