# ADR-0459 - Portable mix recipes and missing-media reconciliation

- **Decision:** Accepted by owner (2026-11-13); implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); `main` `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Prior decisions:** ADR-0418, ADR-0419, ADR-0423, ADR-0458; conflicting hosted-media assumptions superseded by ADR-0455 and this decision, not historical statuses.
- **Source touchpoints:** `src/selecta/cloud_mixes.py`, `src/selecta/routes/cloud_mixes.py`, `web/src/cloud/MakeCloudMix.tsx`, `web/src/cloud/Library.tsx`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Implementation checklist](selecta-local-first-implementation-checklist.md).

## Context

A saved cloud recipe is only a portable instruction set, not an entitlement or proof that its audio exists on another device.

## Decision and invariants

1. Preflight each target device: exact track availability, recording revision, analysis, transition readiness, current policy, output capability and required compute. Distinguish unknown/offline from missing.
2. States: ready, needs_analysis, candidate_match, missing, source_disconnected, permission_required, unsupported, version_mismatch, policy_blocked, engine_offline, unknown, cache_invalid.
3. Offer control original device, locate file, approve equivalent, create temporary playable variation, or edit as new immutable revision. Preserve the original mix and explain skipped/unavailable content.
4. Only enable Play Here after local preflight. Auto-replacement is permitted for venues only under preapproved explicit policies, never for blocked or mismatched media.

## Edge cases and rejection semantics

Song B has a shorter radio edit; both title and artist match but cue positions do not; current recording missing after a drive removal; future song disappears during playback.

Unknown device readiness, stale metadata, unavailable media, forbidden sources and failed local execution must never be turned into a false successful cloud state. Preserve original media and immutable user work.

## Migration and compatibility

Introduce read-only legacy mix viewing first; device-specific binding and repair next; leave old revisions untouched. Standalone local mode retains all existing guarantees. Do not remove an old route, flag, screen or worker before its functionality is either replaced with verified parity or explicitly retired by a separate approved record.

## Verification requirements

Two isolated simulated devices, partial availability 5/8, stale state, mismatched masters, changed media, offline/permissions and blocked-clean tests. Assert no user audio traverses the cloud boundary. Cover successful and failing states, retries, stale command/revision handling, accessibility and device-specific visibility where appropriate. Synthetic recordings only in automated tests.

## Rejected alternatives

- Preserve old cloud-audio assumptions under renamed UI copy.
- Silently weaken existing features to make the new architecture easier to implement.
- Mark a proposed feature implemented based solely on documentation.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0459-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for portable mix recipes and missing-media reconciliation. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0459-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0459-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0459-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## Governance

This ADR is an accepted design decision, **not implemented functionality**. All corresponding LF tasks remain Not started until code, tests and required human checks exist.
