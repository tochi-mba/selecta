# ADR-0458 - Canonical recording identity and local media bindings

- **Decision:** Accepted by owner (2026-11-13); implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); `main` `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Prior decisions:** ADR-0418, ADR-0393, ADR-0397, ADR-0421; conflicting hosted-media assumptions superseded by ADR-0455 and this decision, not historical statuses.
- **Source touchpoints:** `src/selecta/cloud_mixes.py`, `src/selecta/mix_contract.py`, `src/selecta/library/`, `src/selecta/db.py`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Implementation checklist](selecta-local-first-implementation-checklist.md).

## Context

Current cloud mix contracts resolve to cloud asset IDs and hashes. Local files are different on each device and filenames are unreliable identifiers.

## Decision and invariants

1. Separate workspace-scoped canonical recording refs, stable mix-occurrence IDs, and device-local media instances; a recording identity must never embed a path, R2 key or user-supplied SHA.
2. Exact verified bytes, locally verified equivalent encoding, candidate metadata/ISRC, missing and policy-blocked are distinct matches; candidate substitutions require approval.
3. Local bindings carry content revisions, permissions, source IDs, last verification and dependent analysis/render versions; treat device availability as expiring information.
4. Optional aggregate catalogue metadata does not imply any venue has the audio. Prevent cross-tenant enumeration and privacy-leaking global hash lookup.

## Edge cases and rejection semantics

Two masters, clean/explicit edits, duplicate titles, different album versions, moved drives, changed content at same path, ISRC collisions.

Unknown device readiness, stale metadata, unavailable media, forbidden sources and failed local execution must never be turned into a false successful cloud state. Preserve original media and immutable user work.

## Migration and compatibility

Migrate existing cloud mix asset references to canonical IDs and retain unresolved legacy references with recoverable mappings. Standalone local mode retains all existing guarantees. Do not remove an old route, flag, screen or worker before its functionality is either replaced with verified parity or explicitly retired by a separate approved record.

## Verification requirements

Exact-match and false-positive fixtures, version invalidation, privacy/cross-tenant tests, multi-device synthetic library scenario. Assert no user audio traverses the cloud boundary. Cover successful and failing states, retries, stale command/revision handling, accessibility and device-specific visibility where appropriate. Synthetic recordings only in automated tests.

## Rejected alternatives

- Preserve old cloud-audio assumptions under renamed UI copy.
- Silently weaken existing features to make the new architecture easier to implement.
- Mark a proposed feature implemented based solely on documentation.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0458-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for canonical recording identity and local media bindings. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0458-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0458-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0458-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## Governance

This ADR is an accepted design decision, **not implemented functionality**. All corresponding LF tasks remain Not started until code, tests and required human checks exist.
