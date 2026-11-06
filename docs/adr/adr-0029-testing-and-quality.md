# ADR-0029: Regression strategy, real audio fixtures and release quality gates

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Delivery phase:** 0–13
- **Scope:** Proposed future implementation; no code changes made by this ADR.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Backend pytest and frontend tests exist, but a complete redesign requires browser, a11y, real audio, integration and visual evidence.

## Proposed decision and rationale

- Preserve current behaviour assertions in existing App/Mixes/Now/Mix/Library/Links/Requests/Drafts/Studio/Workshop/Listening/player tests.
- Add typed-state unit tests, API contract tests, Playwright journeys and visual snapshots, accessible component checks and real Web Audio fixtures.
- Use original/licensed test audio and deterministic scenarios for success, failure, slow render and bridge concurrency.
- Never weaken an assertion merely because text or layout changed.
- Keep human blind listening separate from technical pass.

## Compatibility and product invariants

- Current CI Ruff, pytest with 70% minimum, pnpm test and build remains an initial gate.

## Implementation sequence

- Map every parity row to automated/manual evidence; phase gates require explicit regression review.

## Required tests and edge cases

- Long libraries, 100-song timeline, missing metadata, concurrent requests, late seam, full disk, keyboard, 400% zoom and export decode.

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
