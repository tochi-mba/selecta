# ADR-0023: WCAG 2.2 AA, screen readers and keyboard conventions

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Delivery phase:** 1–12
- **Scope:** Proposed future implementation; no code changes made by this ADR.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

A visual redesign must not exclude users from complicated editing, requesting or Studio operations.

## Proposed decision and rationale

- Target WCAG 2.2 AA in supported flows and maintain documented exceptions/evidence.
- Every drag-only operation has a non-drag alternative.
- Use correct dialog, combobox, menu and grid patterns, including roving Studio focus.
- Keep visible focus clear of sticky bars; use descriptive labels, noncolour state and restrained announcements.
- Preserve existing keyboard shortcuts without triggering while typing.

## Compatibility and product invariants

- All essential actions available without pointer and without hearing UI narration over music unnecessarily.

## Implementation sequence

- Audit primitives first and manually test complete browser journeys with assistive technology.

## Required tests and edge cases

- NVDA, VoiceOver, keyboard-only, high contrast, 200/400% zoom, reduced motion, touch sizes and ARIA grid.

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
