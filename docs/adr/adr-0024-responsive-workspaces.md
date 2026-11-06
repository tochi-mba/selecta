# ADR-0024: Mobile, tablet, wide-screen and high-zoom workspace design

- **Decision status:** Proposed
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 2–12
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

No horizontal page overflow does not mean editing and dense grid controls are genuinely usable on a phone.

## Proposed decision and rationale

- Coordinate mobile bottom nav, mini-player and safe-area insets.
- Switch Edit inspector to sheet on phones without burying timeline.
- Provide Studio lane paging or stable labels so every cell remains reachable.
- Use compact Library rows on mobile and wide table on desktop.
- Support continuous responsive layout, long metadata and high browser zoom.

## Compatibility and product invariants

- Every current operation remains accessible on supported viewport sizes and touch devices.

## Implementation sequence

- Design specialized layouts for complex workspaces; never hide whole feature behind hover.

## Required tests and edge cases

- 320,375,390,430,768,1024,1440,1920 and 4K; landscape, virtual keyboard, zoom 400%, long RTL names.

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
