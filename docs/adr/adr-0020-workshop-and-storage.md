# ADR-0020: Workshop, background processing, queue and cache transparency

- **Decision status:** Proposed
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 10
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Operational information combines analysis, rendering, source management, storage and learning. Cache budget and total disk space can be confused.

## Proposed decision and rationale

- Separate Overview, Analysis, Storage, Sources and Learning/Listening sections.
- Show real job queue stage, pause/priority/preemption, failure and ETA with uncertainty.
- Display cache-used versus cache-budget separately from total free disk.
- Explain protected priority data and original-file safety.
- Use revision-aware debounced storage control with proposed versus persisted value.

## Compatibility and product invariants

- Actual worker priority, pause, new-song watcher and cache behaviour remain.
- Never fabricate progress.

## Implementation sequence

- Model backend statuses first; use consistent shared job component and validation.

## Required tests and edge cases

- Cache full, low disk, preempted analysis, missing source, stale storage update, absent ETA and worker crash.

## Alternatives and trade-offs

Retaining the old UI permanently would avoid immediate migration risk but preserve the documented usability problems. A single simultaneous rewrite would be faster to describe but harder to verify and roll back. Implement this ADR incrementally, preserve the backend/audio contracts, and reject any proposal that cannot meet the stated invariants.

## Acceptance and status update

Implementation may move to **In progress** only when a linked implementation PR exists; to **Implemented** only when the intended behaviour and associated tests are merged; and to **Verified** only with relevant automated, browser, accessibility, audio and migration evidence recorded. The [feature-parity matrix](feature-parity.md) and [test plan](test-coverage-matrix.md) must be updated alongside it.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Documentation-only plan |
| 2026-11-06 | Proposed | In progress | [#22](https://github.com/tochi-mba/selecta/pull/22), with evidence in [implementation-evidence.md](implementation-evidence.md) |

## References

- [ADR index](README.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Existing acceptance ledger](../acceptance.md)
- [Existing UI/UX research](../research/ui-ux.md)
