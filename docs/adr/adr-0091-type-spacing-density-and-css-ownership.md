# ADR-0091: Typography, spacing, density, icons, visual hierarchy and CSS ownership

- **Decision status:** Proposed (owner acceptance required)
- **Implementation status:** Not started (0/10 implemented)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 1 Foundations
- **Extends, does not automatically supersede:** ADR-0034, ADR-0050, ADR-0070, ADR-0079
- **Source surfaces to reconcile:** `web/src/styles/{foundation,shell,polish,listening,creation,operations}.css`; `web/src/ui/Icon.tsx`
- **Tasks:** S4-0091-01 through S4-0091-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

A design overhaul cannot succeed when headings, numeric metadata, spacing, CSS overrides and interactive density are locally improvised.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Adopt a constrained typographic and spatial system with explicit role ownership, responsive type sizes, tested text overflow, consistent icons and maintainable cascade layers; preserve readability in expert dense views.

## Experience, frontend and interaction specification

- Use display type sparingly for music and page identity; compact operational labels should remain legible.
- Tabular numerals for BPM, bar positions, timestamps, duration and analysis progress; distinguish title/artist/status/action consistently.
- Four-pixel base spacing, documented control heights, restrained radius and three purposeful surface levels.
- Keep CSS owner boundaries and avoid accidental DOM-structure selectors or blanket !important patches.

## Detailed implementation work — all Not started

1. **S4-0091-01 — Define display, H1-H3, body and caption role scale with responsive limits.** Acceptance: Long metadata cannot force primary controls offscreen. Required verification: Long/mixed-direction fixture in all breakpoints. **Implementation: Not started; Verified: No.**
2. **S4-0091-02 — Define tabular-numeral and bidi-isolation rules.** Acceptance: Times, BPM and keys remain aligned with RTL song metadata. Required verification: Numeric alignment, Arabic/Hebrew/CJK fixture tests. **Implementation: Not started; Verified: No.**
3. **S4-0091-03 — Publish spacing, radius, border, depth and control-size tokens.** Acceptance: Related actions group consistently across pages. Required verification: Review component states at normal/compact density. **Implementation: Not started; Verified: No.**
4. **S4-0091-04 — Audit CSS duplication, specificity and source ownership.** Acceptance: Proposed canonical owner for each shared/layout/page rule. Required verification: Selector-collision inventory and style regression review. **Implementation: Not started; Verified: No.**
5. **S4-0091-05 — Standardize song identity, transition identity and status order.** Acceptance: User learns same title/artist/facts/status/action order in every view. Required verification: Cross-page snapshots and screen reader reading order. **Implementation: Not started; Verified: No.**
6. **S4-0091-06 — Standardize SVG icon sizing and text/icon alignment.** Acceptance: No clipped glyph, uneven baseline or icon-only mystery action. Required verification: Browser/platform font fallback checks. **Implementation: Not started; Verified: No.**
7. **S4-0091-07 — Define truncation and full-text retrieval conventions.** Acceptance: Critical names and errors can always be read fully. Required verification: 200/400% zoom, long/unbroken/emoji fixture. **Implementation: Not started; Verified: No.**
8. **S4-0091-08 — Define readable disabled/secondary/tiny-caption constraints.** Acceptance: No important content disappears under compact mode. Required verification: Contrast, touch and text-enlargement tests. **Implementation: Not started; Verified: No.**
9. **S4-0091-09 — Reconcile shared CSS breakpoints and page-local responsive rules.** Acceptance: Studio adjustments do not unexpectedly break Library. Required verification: CSS dependency tests and screenshot pairs. **Implementation: Not started; Verified: No.**
10. **S4-0091-10 — Create development-only component/typography review surfaces.** Acceptance: Every variant can be inspected in dark/light and focused states. Required verification: Reviewed gallery and screenshot coverage. **Implementation: Not started; Verified: No.**

## Required negative cases and regression strategy

- Extremely long filenames, duplicate titles, bidi isolation, CJK, combining marks and no-space titles.
- Font fallback changes glyph metrics on Windows, causing layout shift.
- Compact density must not reduce essential touch targets below approved policy.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

A strong typographic hierarchy reduces density more safely than simply enlarging all padding.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0091 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
