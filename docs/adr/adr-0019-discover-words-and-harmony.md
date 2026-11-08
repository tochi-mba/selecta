# ADR-0019: Word-link discovery and harmonic staged auditions

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 9
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> The owner accepted this decision on 2026-11-08. Implementation and verification are tracked separately, task by task, in its checklist.

## Context

Words includes two distinct musical discovery types, and linked-pair insertion may require several dependent writes.

## Proposed decision and rationale

- Offer Discover with Word connections and Harmonic discoveries while retaining existing results.
- Show shared lyric phrase in both songs, musical route, render status, preview and rating.
- Preserve harmonic four-stage audition with synchronized chords and Yes/No/Skip judgments.
- Allow revisiting judgments and introduce atomic linked-pair insertion scoped to selected mix.
- Use centralized audio focus and never hide a discovery simply because preview fails.

## Compatibility and product invariants

- Preserve seam rating keys, phrase data, four audition steps and existing current-mix entry point until draft-target support exists.

## Implementation sequence

- Split feature modules; implement pair transaction backend contract rather than client-only partial writes.

## Required tests and edge cases

- Missing lyrics, many phrase matches, failed preview, partial pair insertion, draft selection, stage skipping and answer revision.

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
