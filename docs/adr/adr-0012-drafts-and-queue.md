# ADR-0012: My Mixes projects, draft operations and render queue

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Implemented ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 6
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> The owner accepted this decision on 2026-11-08. Implementation and verification are tracked separately, task by task, in its checklist.

## Context

Drafts are separate musical objects, but they're visually subordinate and queue controls can be hard to understand.

## Proposed decision and rationale

- Create My Mixes project cards with current/draft identity, readiness, duration, render progress and blocker.
- Preserve save-current, create, copy, rename, delete, restore, play/swap and own undo history.
- Expose Move earlier/later and Remove from render queue in addition to any pointer affordance.
- Explain storage-blocked preparation with route to Workshop.

## Compatibility and product invariants

- Draft edits do not mutate live mix; playing a draft keeps the current defined swap semantics.
- Queue priorities must match actual backend scheduling.

## Implementation sequence

- Key all operations by stable draft ID and keep rename validation local.
- Keep delete recovery accessible after toast replacement.

## Required tests and edge cases

- Many drafts, duplicate names, queue reorder, undo wrong context, storage full, delete/restore, switching while rendering and stale data.

## Alternatives and trade-offs

Retaining the old UI permanently would avoid immediate migration risk but preserve the documented usability problems. A single simultaneous rewrite would be faster to describe but harder to verify and roll back. Implement this ADR incrementally, preserve the backend/audio contracts, and reject any proposal that cannot meet the stated invariants.

## Acceptance and status update

Implementation may move to **In progress** only when a linked implementation PR exists; to **Implemented** only when the intended behaviour and associated tests are merged; and to **Verified** only with relevant automated, browser, accessibility, audio and migration evidence recorded. The [feature-parity matrix](feature-parity.md) and [test plan](test-coverage-matrix.md) must be updated alongside it.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Documentation-only plan |
| 2026-11-06 | Proposed | Implemented | [#22](https://github.com/tochi-mba/selecta/pull/22), with evidence in [implementation-evidence.md](implementation-evidence.md) |
| 2026-11-08 | Accepted | Implemented | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [ADR index](README.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Existing acceptance ledger](../acceptance.md)
- [Existing UI/UX research](../research/ui-ux.md)
