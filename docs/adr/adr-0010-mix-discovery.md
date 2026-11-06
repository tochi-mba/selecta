# ADR-0010: Vibe discovery, featured choice and build preparation

- **Decision status:** Proposed
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 5
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Mixes currently combines presets, current mix, global preferences, destination controls and drafts, which obscures the first action.

## Proposed decision and rationale

- Separate Continue/Featured, Browse presets and My Mixes.
- Preserve Selecta's Pick and all sixteen presets across moment, mood, sound and journey.
- Make Play primary and Customize secondary; move long settings into a focused step.
- Keep approximate 30m/1h/2h labels honest while backend maps them to 12/24/48 songs.
- Explain why unavailable presets lack enough mix-ready songs.

## Compatibility and product invariants

- Saving a draft cannot alter what is playing; Play now is clearly a current-mix replacement.
- Preset keys, eligibility logic and current planner outputs remain intact.

## Implementation sequence

- Move presentation without rewriting the planner; later add honest build progress when backend exposes it.

## Required tests and edge cases

- All vibe keys, library below minimum, repeated build, ineligible destination, build error, current playing versus draft and refresh.

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
