# ADR-0015: Live Requests, route consent and atomic bridge joining

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Delivery phase:** 7
- **Scope:** Proposed future implementation; no code changes made by this ADR.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Requests include complicated valid states and multi-song route planning that should feel like asking a DJ, not managing a job scheduler.

## Proposed decision and rationale

- Create a listening-context drawer with debounced search and immediate optimistic request feedback.
- Group statuses under Finding a place, Getting ready, Needs your choice, Coming up, Needs attention while retaining detailed reasons.
- Show bridge as ordered route with each intermediate song, audition and explicit approval.
- Retain user Play anyway override with truthful rough-transition warning.
- Join a prepared approved bridge atomically only after all required seam audio is ready.

## Compatibility and product invariants

- Requests never reuse a song, steal another request's reserved spot or appear playable before commit.
- Cancel, replan and stale polling must remain correct.

## Implementation sequence

- Extract request state machine and reconciliation before moving presentation; support backend idempotency and route revisions.

## Required tests and edge cases

- Two rapid submissions, cancel during render, approve/cancel race, missing bridge, multiple bridging options, late playhead and partial failure.

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
