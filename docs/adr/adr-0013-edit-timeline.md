# ADR-0013: Song/seam arrangement timeline and stable edit scope

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Delivery phase:** 6
- **Scope:** Proposed future implementation; no code changes made by this ADR.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

The one-column editor mixes song rows, seam rows, pending request ghosts and complex inline panels. Positional state can refer to the wrong pair after reorder.

## Proposed decision and rationale

- Build wide timeline + inspector on desktop and timeline + sheet on mobile.
- Represent songs, seams and pending content distinctly; pending rows are not playable.
- Keep insert, ranked suggestion, Analyse, lock, move, remove, drag and keyboard Up/Down actions.
- Use stable selected song/seam identity and revision-aware mutations, not list index alone.
- Rollback failed optimistic reorder and honor audio commitment boundary.

## Compatibility and product invariants

- Never edit the wrong current/draft mix; preserve existing undo and lock semantics.
- Requests must remain pending until their transition audio is ready.

## Implementation sequence

- Lift business operations into scoped hooks; keep old editor backend and tests through migration.

## Required tests and edge cases

- First/middle/last insert, remove playing song, rapid reorder, locked constraint, draft swap, pending insertion and stale poll.

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
