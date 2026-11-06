# ADR-0026: Additive backend contracts, stable identifiers and feature detection

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Delivery phase:** 3–10
- **Scope:** Proposed future implementation; no code changes made by this ADR.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

UI improvements need canonical readiness, stable revisions, pagination and atomic edits, but breaking every old endpoint would make migration dangerous.

## Proposed decision and rationale

- Prefer additive fields/routes and stable IDs for song, seam, mix/draft, request and operation.
- Provide explicit current/draft target for mutations and reason-coded statuses.
- Add pagination, idempotency, conflict revisions, atomic pair insertion and real planner explanations incrementally.
- Feature-detect newer server contracts and handle older local backend gracefully.
- Preserve /api/mix, /api/drafts, /api/requests, /api/seams, /api/status and other existing entry points.

## Compatibility and product invariants

- Worker priorities, stored data and previous clients remain usable through migration.

## Implementation sequence

- Write API schema and backward-compatibility tests before updating the UI.

## Required tests and edge cases

- Old/new payloads, unknown fields, stale revision, duplicate operation, atomic failure and missing backend.

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
