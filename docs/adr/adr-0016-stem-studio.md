# ADR-0016: Stem Studio 64-cell creative workstation

- **Decision status:** Proposed
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 8
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Eight lanes (two songs × voice, drums, bass, melody) and eight cells enable powerful rapid audition but create dense interaction.

## Proposed decision and rationale

- Preserve all 64 binary cells, solo, presets, instant Web Audio audition and two-bar grid granularity.
- Use clear song/stem labels, time ruler, active playhead and preview transport.
- Preserve Let Selecta arrange, Fine tune mine, explain changes, Put it back and Use this.
- Use roving keyboard grid focus and mobile lane paging or fixed-label scrolling.
- Retain a recoverable dirty candidate keyed to exact seam revision.

## Compatibility and product invariants

- Cell audition must remain local/instant, not render-on-click.
- Commit creates a new render; a failed render cannot discard the chosen shape.

## Implementation sequence

- Separate stem-audio engine, shape state and view; keep saved data compatibility.

## Required tests and edge cases

- All cells on/off, rapid click, solo, all presets, AI unchanged/error, restore, close dirty, reopen, touch and assistive tech.

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
