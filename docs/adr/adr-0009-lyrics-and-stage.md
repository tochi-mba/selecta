# ADR-0009: Synchronized lyrics, lyric focus and fullscreen Stage

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Delivery phase:** 4
- **Scope:** Proposed future implementation; no code changes made by this ADR.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Line-synced versus word-synced lyrics have different precision. Fullscreen presentation must work when no lyrics are available.

## Proposed decision and rationale

- Offer Standard, Lyrics focus and Stage modes with the same authoritative playhead.
- Show highlighted words only for usable word timing; show line emphasis for line-only timing.
- Give instrumental, missing, loading and untimed lyrics stable layouts.
- Recover from denied/closed fullscreen and avoid excessive live announcements.

## Compatibility and product invariants

- Existing word focus and stage fullscreen behaviour remain.
- Do not claim timing precision beyond what analysis supports.

## Implementation sequence

- Separate lyric timing calculations from UI mode; reuse output in each presentation.

## Required tests and edge cases

- Only line timing, word timing, no lyrics, instrumental song, long lines, RTL scripts, fullscreen Escape and browser unsupported APIs.

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
