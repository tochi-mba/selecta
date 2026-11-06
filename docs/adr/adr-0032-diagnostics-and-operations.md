# ADR-0032: Privacy-safe diagnostics and truthful background-job feedback

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Delivery phase:** 10–13
- **Scope:** Proposed future implementation; no code changes made by this ADR.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Background jobs need understandable status and support diagnostics, without turning the listening experience into a developer dashboard.

## Proposed decision and rationale

- Provide optional diagnostics for local server connection, current jobs, recent failures and version.
- Correlate client mutation and backend operation IDs if available, with no remote telemetry.
- Distinguish running, paused, queued, blocked and failed accurately and label estimated time as an estimate.
- Redact private paths/song metadata by default; export only with explicit user action.

## Compatibility and product invariants

- Current transition-memory and Workshop ETA values remain; no extra CPU-heavy monitoring while audio plays.

## Implementation sequence

- Start with existing statuses then add structured local error schema only when needed.

## Required tests and edge cases

- Offline, worker crash, stale ETA, storage block, privacy redaction and low-end machine render contention.

## Alternatives and trade-offs

Retaining the old UI permanently would avoid immediate migration risk but preserve the documented usability problems. A single simultaneous rewrite would be faster to describe but harder to verify and roll back. Implement this ADR incrementally, preserve the backend/audio contracts, and reject any proposal that cannot meet the stated invariants.

## Acceptance and status update

Implementation may move to **In progress** only when a linked implementation PR exists; to **Implemented** only when the intended behaviour and associated tests are merged; and to **Verified** only with relevant automated, browser, accessibility, audio and migration evidence recorded. The [feature-parity matrix](feature-parity.md) and [test plan](test-coverage-matrix.md) must be updated alongside it.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Documentation-only plan |

## References

- [ADR index](README.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Existing acceptance ledger](../acceptance.md)
- [Existing UI/UX research](../research/ui-ux.md)
