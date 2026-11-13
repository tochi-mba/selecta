# ADR-0463 - Device-local job scheduler and resource safety

- **Decision:** Accepted by owner (2026-11-13); implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); `main` `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Prior decisions:** ADR-0394, ADR-0395, ADR-0396, ADR-0448; conflicting hosted-media assumptions superseded by ADR-0455 and this decision, not historical statuses.
- **Source touchpoints:** `src/selecta/work/`, `src/selecta/workers/local_app.py`, `src/selecta/scheduling/`, `src/selecta/jobs.py`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Implementation checklist](selecta-local-first-implementation-checklist.md).

## Context

Cloud compute weights and worker autoscalers are no longer relevant to DSP, but local rendering still needs urgency and safe resource allocation.

## Decision and invariants

1. Keep durable local job semantics, checkpoints, idempotency, provenance, retry, cancellation and dependency ordering; replace remote claims with local ownership and process supervision.
2. Prioritise active audio and next transition, imminent requests, current horizon, requested editing, analysis, then speculative discovery.
3. Use measured device CPU/RAM/GPU/disk and per-output audio deadlines. No subscriber-specific daily render, analysis, stem-preview or export quotas for local work.
4. Manage simultaneous zones fairly; protect real-time audio from expensive stems; preempt/cooperatively cancel or sandbox and terminate runaway jobs.

## Edge cases and rejection semantics

Five zones on one host, low battery, thermal throttling, GPU OOM, renderer crash, single CPU core, no free disk, shutdown mid-export.

Unknown device readiness, stale metadata, unavailable media, forbidden sources and failed local execution must never be turned into a false successful cloud state. Preserve original media and immutable user work.

## Migration and compatibility

Adapt current work state machine incrementally and retain already-valid local semantics before removing cloud scheduling. Standalone local mode retains all existing guarantees. Do not remove an old route, flag, screen or worker before its functionality is either replaced with verified parity or explicitly retired by a separate approved record.

## Verification requirements

Deterministic scheduler simulations, stress under audio load, recovery, interrupt semantics, no plan-gate tests. Assert no user audio traverses the cloud boundary. Cover successful and failing states, retries, stale command/revision handling, accessibility and device-specific visibility where appropriate. Synthetic recordings only in automated tests.

## Rejected alternatives

- Preserve old cloud-audio assumptions under renamed UI copy.
- Silently weaken existing features to make the new architecture easier to implement.
- Mark a proposed feature implemented based solely on documentation.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0463-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for device-local job scheduler and resource safety. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0463-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0463-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0463-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## Governance

This ADR is an accepted design decision, **not implemented functionality**. All corresponding LF tasks remain Not started until code, tests and required human checks exist.
