# ADR-0050: Preserved palette with a rebuilt visual system, typography and density

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 7 of 8 tasks implemented with automated evidence on 2026-11-10; 1 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 2 - Foundations
- **Extends existing decisions:** ADR-0003, ADR-0034, ADR-0044
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

The existing warm-black #100f0c, cream #f4f0e4, lime #e8ff3a, blue #6fd3ff and warning orange #ff7a4d are a strong, recognizable identity. Presentation still risks inconsistent typography, gaps, radii, borders, icons and per-screen CSS overrides.

## Decision proposed

Keep the brand palette and expressive display personality; replace ad-hoc styling with a layered semantic design system and purpose-specific density. Use restrained lime for primary choices and selected/playback states, blue for requests, green for readiness and orange for warnings or failures.

## Experience and frontend architecture

- Create raw palette, semantic color, component role, type, space, radius, elevation, z-index and motion layers. Scope dark/light variants explicitly and document accessible contrast decisions; color never acts as the only status signal.

- Specify display/page/section/body/label/metadata/mono roles with tabular numerals and robust system fallbacks. Comfortable density is default; optional compact density applies to dense Library/Editor/Drafts only when targets and focus remain adequate.

- Use a single local SVG icon vocabulary with optical sizing and accessible button labels. Long Unicode/RTL metadata and missing artwork are first-class fixtures. Unexplained one-off CSS values require review.

## Detailed implementation work

1. **S3-0050-01 - Implemented.** Lock the raw brand colors and define all semantic status, focus, selected and overlay roles in dark/light themes. **Evidence:** raw brand colours and semantic roles in web/src/styles/tokens.css for both themes; web/e2e/pages.e2e.ts 'every page passes the automatic accessibility checks in dark' and 'every page passes the automatic accessibility checks in light'; web/e2e/finishing.e2e.ts 'a manual theme and browser chrome agree before app JavaScript, even when the OS disagrees' (passed 2026-11-10).
2. **S3-0050-02 - Implemented.** Publish a typography scale including display, headings, song identity, metadata, explanatory copy and tabular counters. **Evidence:** type scale in web/src/styles/tokens.css; web/src/styles/typography.test.ts (whole file) (passed 2026-11-10).
3. **S3-0050-03 - Implemented.** Specify responsive gutters, widths, panel hierarchy, radii, separators, shadow and optical alignment. **Evidence:** docs/engineering/spacing-token-map.md and web/src/styles/tokens.css; web/src/styles/spacing-tokens.test.ts and web/src/styles/optical-alignment.test.ts (whole files) (passed 2026-11-10).
4. **S3-0050-04 - Needs a person.** Develop and compare comfortable/compact density prototypes for Library, timeline and drafts; retain equivalent functionality. **Status:** Needs a person: comfortable and compact densities exist for Library, timeline and drafts (prefs.density in web/src/state/prefs.ts, .density rules in web/src/styles/tokens.css) and web/src/views/Library.test.tsx 'preserves the same song actions, readiness reason and list while switching layouts' passes; comparing the two and choosing is a design review.
5. **S3-0050-05 - Implemented.** Unify vector icons and destructive action semantics; never use close X as a substitute for Delete. **Evidence:** one icon set in web/src/ui/Icon.tsx; Delete and Remove use the trash icon with words, the close X only closes or dismisses: web/src/ui/destructiveIcons.test.ts 'never pairs the close X with Delete or Remove', 'gives every iconned Delete or Remove the trash can and a visible word' and 'labels the close X as closing or dismissing, never as deleting' (passed 2026-11-10).
6. **S3-0050-06 - Implemented.** Test text wrapping/truncation, full accessible names, RTL/BiDi, emoji and uncommon scripts. **Evidence:** docs/adr/selecta-3-accessibility.md; web/e2e/finishing.e2e.ts 'long, right-to-left and duplicate names stay readable and whole at the smallest size'; web/src/views/Mix.test.tsx 'keeps duplicate, RTL and CJK song names readable and occurrence-scoped'; web/src/views/Links.test.tsx 'shows the whole phrase in its own direction, and a search shows only what matches'; tests/test_library_edges.py test_any_name_comes_back_exactly_as_it_is_and_can_be_searched_for (passed 2026-11-10).
7. **S3-0050-07 - Implemented.** Define restrained motion and reduced-motion fallbacks; avoid unnecessary animation during processing. **Evidence:** docs/adr/selecta-3-glossary.md motion rules; web/src/ui/useReducedMotion.test.tsx 'lets Still disable visual effects without changing the OS preference' and 'honours the operating system even when Expressive is selected'; web/e2e/finishing.e2e.ts 'with reduced motion nothing keeps moving by itself, on any page' (passed 2026-11-10).
8. **S3-0050-08 - Implemented.** Create deterministic design-system fixtures and contrast audit evidence for both themes. **Evidence:** deterministic synthetic library from tests/e2e_server.py; axe colour-contrast in both themes at 1440 and 375: web/e2e/pages.e2e.ts 'every page passes the automatic accessibility checks in dark' and 'every page passes the automatic accessibility checks in light' (passed 2026-11-10).

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Automated and measured contrast review including disabled/status/selection boundaries, not only ordinary text.
- Fuzz metadata lengths, no spaces, RTL isolation and Unicode; ensure controls never disappear.
- Compare dark/light and density states under 200/400% zoom and font scaling; validate focus visibility.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

A complete rebrand was considered but does not solve task complexity and conflicts with the desired palette. A one-time global CSS search-and-replace is cheap but brittle; migrate by role and component.

## Acceptance and evidence

All production surfaces consume approved semantic roles, and reviewed dark/light screenshots plus actual contrast measurements show a coherent hierarchy.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (7/8) | Task-by-task evidence on each item; 1 need a person, 0 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
