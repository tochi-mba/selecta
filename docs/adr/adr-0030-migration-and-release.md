# ADR-0030: Incremental migration, rollback and ADR status governance

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Implemented ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 0–13
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> The owner accepted this decision on 2026-11-08. Implementation and verification are tracked separately, task by task, in its checklist.

## Context

A simultaneous rewrite of router, UI, playback, API and workers would create avoidable risk and make failures difficult to diagnose.

## Proposed decision and rationale

- Sequence baseline → tokens → shell → domain API → audio/Listen → Mixes → Edit/drafts → Requests → Studio → Library/Discover → Workshop → cross-feature QA → release.
- Keep legacy components available behind adapter during migration, remove only after parity proof.
- Update each ADR's decision and implementation status with evidence in implementation PRs.
- Keep rollback and backups for schema/data changes; docs-only merge never means code implemented.
- Block release for data loss, wrong mix mutations, bad audio, incomplete bridge commits, critical accessibility or corrupt export.

## Compatibility and product invariants

- Source music, drafts, ratings, preferences and user intent survive each phase.

## Implementation sequence

- Rehearse rollback, validate compatibility, use small PRs with focused test gates.

## Required tests and edge cases

- Cross-feature playback/edit/request/studio sequence, old data migration, PWA routing, CI, a11y, security and manual listening.

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
