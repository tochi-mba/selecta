# ADR-0027: Truthful AI explanations and musical feedback

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Delivery phase:** 4–10
- **Scope:** Proposed future implementation; no code changes made by this ADR.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Selecta should explain why it chose music without inventing musical facts or overwhelming passive listening.

## Proposed decision and rationale

- Use short music-first copy by default with optional planner-factor and renderer-audit details.
- Clearly separate user intent, proposed plan, queued processing and actually playable result.
- Preserve lightweight Good/Bad seam feedback and access to previously rated results.
- Never claim exact energy compliance, lyric accuracy or flawless harmonic fit without evidence.
- Keep status wording consistent across features.

## Compatibility and product invariants

- Existing rating identity and meaning must persist; explanations cannot delay audio.

## Implementation sequence

- Source explanations from actual planner/audit fields; copy review with novice and advanced listeners.

## Required tests and edge cases

- Missing factor data, failed fallback, low-confidence match, late ETA, stale rating and accessibility announcements.

## Alternatives and trade-offs

Retaining the old UI permanently would avoid immediate migration risk but preserve the documented usability problems. A single simultaneous rewrite would be faster to describe but harder to verify and roll back. Implement this ADR incrementally, preserve the backend/audio contracts, and reject any proposal that cannot meet the stated invariants.

## Acceptance and status update

Implementation may move to **In progress** only when a linked implementation PR exists; to **Implemented** only when the intended behaviour and associated tests are merged; and to **Verified** only with relevant automated, browser, accessibility, audio and migration evidence recorded. The [feature-parity matrix](feature-parity.md) and [test plan](test-coverage-matrix.md) must be updated alongside it.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Documentation-only plan |

## References

- [ADR index](README.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Existing acceptance ledger](../acceptance.md)
- [Existing UI/UX research](../research/ui-ux.md)
