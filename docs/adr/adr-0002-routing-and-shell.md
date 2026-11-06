# ADR-0002: Contextual navigation, routing and persistent player shell

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Delivery phase:** 2
- **Scope:** Proposed future implementation; no code changes made by this ADR.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

State-only view switches hide browser history and current/draft context. A mobile nav requiring sideways scrolling is technically compact but not discoverable.

## Proposed decision and rationale

- Use Listen, Mixes, Library, Discover and Workshop as main destinations.
- Make Edit contextual to /mix/current/edit or /mixes/drafts/:id/edit; identify all resources by stable IDs.
- Use desktop rail, mobile bottom navigation and coordinated persistent mini-player.
- Add real URLs with browser history, focus restoration and explicit deleted-resource recovery.

## Compatibility and product invariants

- Never restart playback on navigation or accidentally edit current while a draft is selected.
- Existing views remain reachable during staged migration.

## Implementation sequence

- Mount legacy views in the new shell before rewriting features.
- Limit SPA fallback to frontend paths; do not swallow API or asset errors.
- Persist useful URL filter and selection context without saving stale temporary operations.

## Required tests and edge cases

- Back/forward, reload on deep link, invalid draft, open modal, same playback across routes, narrow phone, keyboard and standalone PWA.

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
