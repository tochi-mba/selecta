# ADR-0034: Precise visual foundations, typography and coherent iconography

- **Decision status:** Accepted (owner requested implementation in PR #23)
- **Implementation status:** In progress: 9/10 tasks Implemented with evidence on 2026-11-10 (P0011-P0018, P0020); P0019 needs an independent contrast and font audit. See [the polish evidence ledger](polish-implementation-evidence.md).
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 1 - Visual foundations and language
- **Extends:** [ADR-0003](adr-0003-design-tokens-and-brand.md); does not silently supersede their behavioural contracts.
- **Dependencies:** ADR-0033 baseline and inventory.
- **Checklist:** P0011–P0020 in [polish implementation checklist](polish-implementation-checklist.md).

> The owner requested implementation in PR #23 after the planning review. Functionality is written first; verification follows. Checkboxes require actual evidence, including any remaining human checks.

## Context and evidence boundary

Semantic theme tokens exist, but style.css still includes many independent spacing/type values and Shell.tsx combines Unicode symbols with emoji. These are source observations; actual visual severity must be established in the baseline review.

## Proposed decision and rationale

Retain warm black, cream and restrained lime, with request blue and warning orange. Define complete role-based typography, spacing, surfaces, icon, motion and density specifications before migrating screens. Use local assets and one coherent vector icon system.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0011:** Specify display/page/section/body/label/metadata/numeric typography, line heights, weights and fallback fonts; reserve oversized display type for appropriate screens.
2. **P0012:** Define tabular time/count numerals and consistent units, number formats and baseline alignment.
3. **P0013:** Map page gutters, row padding, section spacing, label gaps and action groups to a documented spacing scale, with explicit exceptions.
4. **P0014:** Define listening, browsing and editing content-width/density rules and responsive transitions.
5. **P0015:** Define semantic surface, border, text, selected, focus, playback, working, warning and error treatments in both themes.
6. **P0016:** Replace mixed emoji/Unicode UI icons with a consistent local vector family, sizing, stroke, optical alignment and accessible-label rules.
7. **P0017:** Specify radii, separators, overlays and stacking; inspect overlay, player, navigation and notification intersections.
8. **P0018:** Define long-title wrapping, truncation with accessible full text, unknown metadata, Unicode/RTL and missing-artwork treatment without invented assets.
9. **P0019:** Audit actual text/control contrast and fallback-font rendering independently in dark and light themes; record measurements and screenshots.
10. **P0020:** Migrate feature styles incrementally, check selector collisions and remove unexplained one-off values without changing audio or domain logic.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

A new brand would increase scope without resolving interaction problems. Applying global CSS substitutions is faster but risks accidental layout changes; migrate roles and components incrementally.

## Acceptance and status update

The state gallery and representative screens use documented visual roles consistently, with measured contrast and reviewed typography/alignment in both themes.

The owner accepted proceeding with implementation in PR #23. Implementation progresses Not started → In progress → Implemented → Verified using linked evidence. Only implemented and verified work can satisfy runtime tasks. Record partial work and unperformed human checks in [the polish evidence ledger](polish-implementation-evidence.md); do not infer success from a checkbox in the previous programme.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Original documentation-only proposal |
| 2026-11-06 | Accepted | In progress | Owner requested full implementation and merge after green CI in PR #23; verification pending |
| 2026-11-10 | Accepted | In progress (9/10) | Reconciled against current code; P0011-P0018, P0020 ticked with tests run that day; independent verification still pending |

## References

- [Polish programme and roadmap](polish-roadmap.md)
- [Polish implementation checklist](polish-implementation-checklist.md)
- [Research and source-inspection notes](../research/ui-ux-polish.md)
- [Existing feature parity](feature-parity.md)
- [Existing test coverage](test-coverage-matrix.md)
