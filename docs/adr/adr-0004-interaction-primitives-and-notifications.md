# ADR-0004: Reusable controls, overlays, status and undo

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 1
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> The owner accepted this decision on 2026-11-08. Implementation and verification are tracked separately, task by task, in its checklist.

## Context

Inconsistent buttons, local loading indicators and a single transient toast can misattribute pending operations or erase Undo.

## Proposed decision and rationale

- Build accessible buttons, search comboboxes, sliders, forms, dialogs, drawers, menus, preview controls and status indicators.
- Bind loading to each actual mutation rather than a recent-click heuristic.
- Adopt planned/queued/working/ready/warning/failed/needs-action/unavailable status language.
- Prevent unrelated notifications from erasing destructive recovery actions; use durable recovery when possible.

## Compatibility and product invariants

- Existing Undo actions and all backend mutation semantics remain.
- No client success display until server-confirmed success.

## Implementation sequence

- Separate presentational primitives from domain operations; build them with keyboard and focus contracts.
- Migrate old controls flow by flow.

## Required tests and edge cases

- Focus trap/restoration, Escape, overlapping dialogs, text validation, toast priority, retry, disabled/selected states and mobile hit targets.

## Alternatives and trade-offs

Retaining the old UI permanently would avoid immediate migration risk but preserve the documented usability problems. A single simultaneous rewrite would be faster to describe but harder to verify and roll back. Implement this ADR incrementally, preserve the backend/audio contracts, and reject any proposal that cannot meet the stated invariants.

## Acceptance and status update

Implementation may move to **In progress** only when a linked implementation PR exists; to **Implemented** only when the intended behaviour and associated tests are merged; and to **Verified** only with relevant automated, browser, accessibility, audio and migration evidence recorded. The [feature-parity matrix](feature-parity.md) and [test plan](test-coverage-matrix.md) must be updated alongside it.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Documentation-only plan |
| 2026-11-06 | Proposed | In progress | [#22](https://github.com/tochi-mba/selecta/pull/22), with evidence in [implementation-evidence.md](implementation-evidence.md) |
| 2026-11-08 | Accepted | In progress | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [ADR index](README.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Existing acceptance ledger](../acceptance.md)
- [Existing UI/UX research](../research/ui-ux.md)
