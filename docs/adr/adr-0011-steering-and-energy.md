# ADR-0011: Energy curve, duration, transition feel and destination scope

- **Decision status:** Proposed
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 5
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

The five-value energy curve and saved transition preferences have global persistence semantics that customization can obscure.

## Proposed decision and rationale

- Keep five control points and reset, with keyboard sliders and optional visual curve dragging.
- Show requested energy separately from energy actually realized by selected songs.
- Keep Smooth/Punchy, Never/Sometimes/Often and global default storage.
- Clearly distinguish use-for-this-mix from save-as-default if per-mix override is supported.
- Keep the final song destination and clear operation explicit.

## Compatibility and product invariants

- Never silently overwrite global settings when user intended one draft; don't pretend exact duration or curve fulfillment.

## Implementation sequence

- Add per-mix payloads only with compatible backend support; otherwise clearly label current global scope.
- Debounce with last-intent-wins persistence.

## Required tests and edge cases

- Curve extremes, rapid changes, reset, keyboard editing, invalid destination, library constraints and old preference migration.

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
