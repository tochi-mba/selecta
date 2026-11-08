# ADR-0014: Seam inspector, cues, previews, fallbacks and auditing

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 6
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> The owner accepted this decision on 2026-11-08. Implementation and verification are tracked separately, task by task, in its checklist.

## Context

Transitions are central creative objects, but dense inline controls blur intentional settings and actual rendered output.

## Proposed decision and rationale

- Use Listen, Change, Studio and Details areas for each selected seam.
- Retain style, duration, exact entry/exit cues, word phrase, preview, Good/Bad and audit details.
- Show user-selected intention alongside actual playable fallback if different.
- Keep manual invalid cues flagged rather than silently moved; explain too-soon violations.
- Bind new render results to seam revision so old jobs cannot overwrite choices.

## Compatibility and product invariants

- All current move types and unavailable explanations remain.
- A seam's preview/rating always points to the correct ordered song pair and style.

## Implementation sequence

- Introduce inspector first using existing endpoints; add revision fields and controlled pending states later.

## Required tests and edge cases

- Wrong pair after reorder, failed render, user exact cue, invalid phrase, late result, warn versus fail and repeated style clicks.

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
