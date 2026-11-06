# ADR-0021: Blind A/B evaluation protocols and reliable submission

- **Decision status:** Proposed
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 10
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Listening studies collect actual musical quality, not only renderer technical correctness. A new interface must preserve study blindness and response meaning.

## Proposed decision and rationale

- Keep A/B clips blind, separate audio ownership, five-point rating, issue tags, A/B/No preference/Cannot judge and study progress.
- Replace inaccessible native multi-select issue tags with clear accessible multi-select/check boxes.
- Persist exact underlying scale and tags; failed save keeps trial state.
- Do not change 'heard' threshold without a separately versioned protocol decision.
- Prevent duplicate durable responses.

## Compatibility and product invariants

- Evaluation identifiers and stored data are unchanged; neither clip is revealed early.

## Implementation sequence

- Capture original protocol and fixture before UI migration; idempotent submission is additive.

## Required tests and edge cases

- Audio unavailable, save fails, refresh mid-trial, duplicate submit, screen reader, last trial and invalid study.

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
