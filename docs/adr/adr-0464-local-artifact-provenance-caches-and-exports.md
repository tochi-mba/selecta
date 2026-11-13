# ADR-0464 - Local artifact provenance, caches and exports

- **Decision:** Accepted by owner (2026-11-13); implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); `main` `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Prior decisions:** ADR-0397, ADR-0399, ADR-0108, ADR-0127; conflicting hosted-media assumptions superseded by ADR-0455 and this decision, not historical statuses.
- **Source touchpoints:** `src/selecta/work/provenance.py`, `src/selecta/analysis/`, `src/selecta/seams.py`, `src/selecta/routes/exports.py`, `src/selecta/stems.py`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Implementation checklist](selecta-local-first-implementation-checklist.md).

## Context

The cloud artifact model records useful provenance but publishes outputs to remote object storage; all derived recordings must remain local.

## Decision and invariants

1. Store analysis, preview, stems, transitions and exports locally with checksums, input revisions, settings and renderer/model versions.
2. Separate evictable cache from user-chosen exports; local source files are never deleted by index removal, account deletion or cache cleaning.
3. Use atomic temporary writes, validation, retry and safe disk-reserve policies; never expose direct paths or audio bytes in cloud manifests.
4. Remote UI may show that an export exists on a named authorised device, but must never offer a cloud download of that file.

## Edge cases and rejection semantics

Corrupt cache, same path new bytes, disk fills during FLAC, interrupted partial file, deletion of cloud account, export attempted from controller-only phone.

Unknown device readiness, stale metadata, unavailable media, forbidden sources and failed local execution must never be turned into a false successful cloud state. Preserve original media and immutable user work.

## Migration and compatibility

Replace hosted artifact keys only after a working local-artifact lookup and migration strategy exists. Standalone local mode retains all existing guarantees. Do not remove an old route, flag, screen or worker before its functionality is either replaced with verified parity or explicitly retired by a separate approved record.

## Verification requirements

FLAC validation, atomic-rename, cache eviction, provenance mismatch, export-isolation and cloud no-audio tests. Assert no user audio traverses the cloud boundary. Cover successful and failing states, retries, stale command/revision handling, accessibility and device-specific visibility where appropriate. Synthetic recordings only in automated tests.

## Rejected alternatives

- Preserve old cloud-audio assumptions under renamed UI copy.
- Silently weaken existing features to make the new architecture easier to implement.
- Mark a proposed feature implemented based solely on documentation.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0464-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for local artifact provenance, caches and exports. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0464-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0464-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0464-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## Governance

This ADR is an accepted design decision, **not implemented functionality**. All corresponding LF tasks remain Not started until code, tests and required human checks exist.
