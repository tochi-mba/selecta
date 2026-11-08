# ADR-0003: Semantic design system retaining Selecta's colours

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 1
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> The owner accepted this decision on 2026-11-08. Implementation and verification are tracked separately, task by task, in its checklist.

## Context

The visual palette is distinctive, but global CSS collisions, ad hoc spacing and low-contrast control boundaries inhibit consistency.

## Proposed decision and rationale

- Keep warm-black, cream, lime, blue and orange; refine semantics, not branding.
- Define surface, text, border, focus, request, warning, success and disabled tokens for dark and light themes.
- Define typography, spacing, radii, z-index and state scales.
- Move feature CSS into scoped modules; keep global CSS for reset and tokens only.

## Compatibility and product invariants

- Existing accent meanings persist; no remote fonts or external styling service become required.
- Visual affordances must remain readable under contrast and zoom requirements.

## Implementation sequence

- Inventory old CSS and map values into tokens without a one-shot style rewrite.
- Create a component state gallery; migrate components incrementally.

## Required tests and edge cases

- Dark/light screenshots, long Unicode metadata, 320px width, 400% zoom, contrast, reduced motion, and regression for conflicting handoff styles.

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
