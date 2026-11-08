# ADR-0005: Typed API state, revisions and optimistic mutation consistency

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 3
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> The owner accepted this decision on 2026-11-08. Implementation and verification are tracked separately, task by task, in its checklist.

## Context

Requests, mixes, drafts, storage and rendering are asynchronous. Multiple component polling loops can cause older results to replace newer user intent.

## Proposed decision and rationale

- Backend remains source of truth for persisted music state; Web Audio owns immediate audible time.
- Use typed domain queries, cache invalidation, cancellation and explicit mutation state.
- Add stable resource revisions and operation IDs for race-prone writes and renders.
- Reconcile optimistic requests by client mutation ID and rollback only the failed operation.

## Compatibility and product invariants

- Do not let a draft mutation affect current mix or an old seam result replace a new user selection.
- Keep old endpoints compatible while new fields are added.

## Implementation sequence

- Introduce contracts and adapters under existing views first.
- Specify conflict recovery and idempotency at both client and server boundaries.

## Required tests and edge cases

- Stale polls, rapid double clicks, concurrent requests, render out of order, multi-tab edits, connection recovery, canceled mutation and storage slider racing.

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
