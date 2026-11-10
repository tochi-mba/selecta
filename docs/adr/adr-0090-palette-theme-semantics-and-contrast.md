# ADR-0090: Preserve lime/cream/charcoal identity with an independently polished dark and light theme

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** 4/10 Implemented, 5 In progress, 1 Not started (per-task source and test reconciliation 2026-11-10)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 1 Foundations
- **Extends, does not automatically supersede:** ADR-0003, ADR-0050, ADR-0077, ADR-0079
- **Source surfaces to reconcile:** `web/src/styles/tokens.css`; `web/src/styles/foundation.css`; `web/src/state/prefs.ts`
- **Tasks:** S4-0090-01 through S4-0090-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Selecta's warm near-black, electric-lime and cream palette is distinctive. Directly mirroring dark colours into light theme makes borders, warnings, selection, lime text and focus unreliable.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Keep the existing core brand palette (#100f0c, #f4f0e4, #e8ff3a, request blue #6fd3ff and caution orange #ff7a4d). Introduce documented semantic tokens with independently calibrated dark/light states, preserving explicit Light/Dark/System choice.

## Experience, frontend and interaction specification

- Prefer warm charcoal canvas and raised brown-black surfaces in dark; warm cream and off-white surfaces in light.
- Use bright lime primarily as filled primary emphasis with dark ink, not low-contrast thin light-theme text.
- Semantic roles cover canvas, surface, raised surface, text tiers, border, hover, selected, focus, success, request, warning, error, offline and disabled.
- Root theme must apply before first paint, update browser theme-color, and redraw canvas visualization without restarting playback.

## Detailed implementation work

1. **S4-0090-01 - Audit every current token consumer and hard-coded colour.** Acceptance: Semantic role registry covers all page/overlay/chart surfaces. Required verification: Static scan plus visual spot checks in both themes. **Implementation: In progress (2026-11-10). Evidence: colours come from `web/src/styles/tokens.css` roles; `web/src/styles/spacing-tokens.test.ts` and `typography.test.ts` guard tokens, but no static scan yet rejects hard-coded colours in every stylesheet. Verified: No. Needs a person: visual spot checks in both themes.**
2. **S4-0090-02 - Approve theme palettes, contrast pairings and lime usage.** Acceptance: Text, control boundaries and focus meet WCAG 2.2 AA targets. Required verification: Contrast report for rendered foreground/background pairs. **Implementation: Implemented (2026-11-10). Evidence: `web/e2e/fp-theme-boundaries.e2e.ts` 'functional edges reach 3:1 against their real surfaces in Light and Dark'; `web/e2e/pages.e2e.ts` 'every page passes the automatic accessibility checks' (axe colour contrast) in light and dark, run 2026-11-10. Verified: No. Needs a person: owner approval of the palettes and lime usage.**
3. **S4-0090-03 - Implement semantic background, text, border and action roles.** Acceptance: No view independently overrides core brand meanings. Required verification: Component-gallery light/dark snapshots. **Implementation: In progress (2026-11-10). Evidence: semantic background, text, border and action roles in `web/src/styles/tokens.css`; `web/e2e/paired-theme.e2e.ts` captures matched light/dark states; per-role assertions are in MP-0276 work still in flight. Verified: No. Needs a person: component-gallery light/dark snapshot review.**
4. **S4-0090-04 - Define states for selection, hover, pressed, focus and disabled.** Acceptance: No state relies on colour alone and focus is distinct from selection. Required verification: Keyboard and forced-colours screenshots. **Implementation: Implemented (2026-11-10). Evidence: `web/src/ui/controls.test.tsx` 'never rely on colour alone'; `web/e2e/mp-0287-editor-rows.e2e.ts` 'selected, focused, locked, playing and pending each have their own mark', run 2026-11-10. Verified: No. Needs a person: keyboard and forced-colours screenshot review.**
5. **S4-0090-05 - Calibrate request blue, warning orange, error and success per theme.** Acceptance: Status remains readable and semantically distinct on both themes. Required verification: Contrast and status-interpretation checks. **Implementation: In progress (2026-11-10). Evidence: request/warning/error/success tokens per theme in `web/src/styles/tokens.css`; covered by axe contrast in `web/e2e/pages.e2e.ts`; the per-status interpretation check belongs to MP-0276-05, still in flight. Verified: No. Needs a person: status-interpretation check.**
6. **S4-0090-06 - Preserve explicit system/light/dark preference and first-paint behaviour.** Acceptance: Reload and system preference changes do not flash or override saved choice. Required verification: Theme migration and reload E2E. **Implementation: Implemented (2026-11-10). Evidence: `web/src/state/prefs.test.ts` theme truth table; `web/e2e/finishing.e2e.ts` 'a manual theme and browser chrome agree before app JavaScript, even when the OS disagrees', run 2026-11-10. Verified: No.**
7. **S4-0090-07 - Ensure spectrum/waveform/lyrics charts use semantic colours.** Acceptance: Visualizations adapt live without audio interruption. Required verification: Theme switch while playing with screenshot and audio checks. **Implementation: Implemented (2026-11-10). Evidence: `web/e2e/finishing.e2e.ts` 'changing the theme while playing starts nothing again, and the title bar follows'; `web/src/views/spectrumVisuals.test.ts`, run 2026-11-10. Verified: No. Needs a person: listening check while switching theme.**
8. **S4-0090-08 - Review dialogs, menus, mini-player, editor and grid in each theme.** Acceptance: Depth and hierarchy are visible even with subtle borders. Required verification: Golden screenshot paired review. **Implementation: In progress (2026-11-10). Evidence: `web/e2e/paired-theme.e2e.ts` captures matched Light/Dark states for dialogs, menus, mini-player, editor and grid. Verified: No. Needs a person: paired golden screenshot review.**
9. **S4-0090-09 - Support forced-colours/high-contrast and disabled styling.** Acceptance: Critical borders, toggles and statuses survive system overrides. Required verification: Windows forced-colours and keyboard run. **Implementation: In progress (2026-11-10). Evidence: 21 `forced-colors` rules across `web/src/styles/*.css`; an automated forced-colours spec is still being written in another section. Verified: No. Needs a person: Windows forced-colours and keyboard run.**
10. **S4-0090-10 - Record approved contrast exceptions and owner review.** Acceptance: No unmeasured light-mode fallback or invisible control. Required verification: Documented pair table in evidence ledger. **Implementation: Not started (2026-11-10). Verified: No. Needs a person: contrast pair table and owner review of any exception.**

## Required negative cases and regression strategy

- Light-theme lime text on cream may fail contrast; fill with dark label is preferable.
- Theme switch must not remount or pause player.
- OS high-contrast can discard CSS decorative fills; use icons/text and system-colour fallbacks.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Semantic calibration creates more tokens but prevents each screen reinventing light mode.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0090 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | 4/10 Implemented, 5 In progress, 1 Not started | Not verified | Per-task source and test reconciliation; each task names the automated checks run on 2026-11-10 and any check that needs a person |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
