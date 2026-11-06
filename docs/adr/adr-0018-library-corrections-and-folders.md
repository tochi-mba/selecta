# ADR-0018: Analysis overrides and secure library-source management

- **Decision status:** Proposed
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 9
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Incorrect BPM/key or non-music classification affects planning, while typed folders remain cumbersome.

## Proposed decision and rationale

- Provide reversible and versioned user overrides for tempo, key and music/not-music classification.
- Separate detected values from overrides; reanalysis cannot silently erase corrections.
- Invalidate only derived data dependent on changed analysis fields.
- Show watched folders, scan status and clearly handled missing/unavailable paths.
- Use native folder picker only if host can securely map it to the local server; keep typed path fallback.

## Compatibility and product invariants

- Priority and Never play are separate semantics from overriding nonmusic.
- No original audio deletion and no cross-origin filesystem API exposure.

## Implementation sequence

- Add backend override schema and audit/provenance first; implement UI only after supported validation and migration.

## Required tests and edge cases

- Half/double tempo, invalid BPM, reanalysis conflict, lost folder, Unicode path, duplicate source and undo correction.

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
