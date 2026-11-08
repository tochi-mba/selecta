# ADR-0032: Privacy-safe diagnostics and truthful background-job feedback

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 10–13
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> The owner accepted this decision on 2026-11-08. Implementation and verification are tracked separately, task by task, in its checklist.

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
| 2026-11-06 | Proposed | In progress | [#22](https://github.com/tochi-mba/selecta/pull/22), with evidence in [implementation-evidence.md](implementation-evidence.md) |
| 2026-11-08 | Accepted | In progress | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [ADR index](README.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Existing acceptance ledger](../acceptance.md)
- [Existing UI/UX research](../research/ui-ux.md)
