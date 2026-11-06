# ADR-0008: Listen composition, waveform and next-transition clarity

- **Decision status:** Proposed
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 4
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

The main listening view currently mixes a spectrum, timing details, lyrics, steering and technical statuses with similar visual weight.

## Proposed decision and rationale

- Lead with current song, artist, mix, musical waveform, transport, up-next and more/less/different steering.
- Retain the live spectrum as an optional ambient view, not the only musical visualization.
- Show planned versus ready versus fallback seam and concise information about what the listener will actually hear.
- Move timing diagnostics, Why this song and audit into secondary panels without hiding them.

## Compatibility and product invariants

- Beat/bar countdown, lyrics, seam rating, spectrum, jump-to-seam and immediate steering stay available.
- Do not render a seekable-looking waveform until safe seek exists.

## Implementation sequence

- Build small display components using current player models.
- Use an animation loop that does not drive whole React tree every frame.

## Required tests and edge cases

- Long titles, no next song, missing waveform, failed render, lyric line/word timing, pending requests, Stage and reduced motion.

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
