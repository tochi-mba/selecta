# ADR-0001: Product contract, scope and no-regression guarantees

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Delivery phase:** 0
- **Scope:** Proposed future implementation; no code changes made by this ADR.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Selecta is a local-first intelligent DJ for the listener's own library. Its planning, rendered transitions, requests, stem editing and discovery distinguish it from an ordinary music player. This overhaul must improve usability without silently changing its nature.

## Proposed decision and rationale

- Prioritize effortless listening and progressively disclosed creation.
- Keep the existing warm-black, cream, electric-lime, request-blue and warning-orange identity.
- Treat every existing user action, stored object and audible outcome as a migration contract.
- Use a feature-parity ledger linked to acceptance tests before any old UI is removed.

## Compatibility and product invariants

- Preserve current/draft isolation, audio scheduler, request bridge approval, explicit user cues, stem previews, discovery and export.
- Never delete or rewrite original music, drafts, preferences, ratings or analyses as a side effect of interface changes.

## Implementation sequence

- Pin the reference revision and capture API traces, screenshots, backend tests and audio behaviour.
- Map each legacy action to a new visible entry point, including edge-case recovery.
- Gate every phase on data and audio integrity, not aesthetic completion.

## Required tests and edge cases

- Run current pytest and frontend tests before migration; establish deterministic audio fixtures.
- Validate novice listening, advanced editing, local privacy, large library and failure recovery.

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
