# ADR-0017: Library scale, filters and canonical mix readiness

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Implemented ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 9
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> The owner accepted this decision on 2026-11-08. Implementation and verification are tracked separately, task by task, in its checklist.

## Context

Analysis completion can differ from planner-ready eligibility, and fixed row caps limit large collections.

## Proposed decision and rationale

- Use canonical statuses for mix-ready, analysed-incomplete, queued, processing, needs attention, set aside and missing.
- Show explicit reasons from backend rather than using the analysed boolean as ready.
- Support server pagination/cursors and stable sorting, filters and optional virtualization when measured.
- Use desktop table/mobile rows plus song-details view.
- Preserve priority, Never, Add, Play next, Start mix and current filters.

## Compatibility and product invariants

- No song hidden because it is beyond the first 200; exclusion and priority meanings remain.

## Implementation sequence

- Define readiness API contract and migrate result list with focus/scroll preservation.

## Required tests and edge cases

- 20k songs, 200+ search results, duplicate titles, Unicode, search races, background arrival, corrupted metadata and file deletion.

## Alternatives and trade-offs

Retaining the old UI permanently would avoid immediate migration risk but preserve the documented usability problems. A single simultaneous rewrite would be faster to describe but harder to verify and roll back. Implement this ADR incrementally, preserve the backend/audio contracts, and reject any proposal that cannot meet the stated invariants.

## Acceptance and status update

Implementation may move to **In progress** only when a linked implementation PR exists; to **Implemented** only when the intended behaviour and associated tests are merged; and to **Verified** only with relevant automated, browser, accessibility, audio and migration evidence recorded. The [feature-parity matrix](feature-parity.md) and [test plan](test-coverage-matrix.md) must be updated alongside it.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Documentation-only plan |
| 2026-11-06 | Proposed | Implemented | [#22](https://github.com/tochi-mba/selecta/pull/22), with evidence in [implementation-evidence.md](implementation-evidence.md) |
| 2026-11-08 | Accepted | Implemented | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [ADR index](README.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Existing acceptance ledger](../acceptance.md)
- [Existing UI/UX research](../research/ui-ux.md)
