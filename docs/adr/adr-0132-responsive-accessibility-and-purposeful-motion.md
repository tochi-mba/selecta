# ADR-0132 — Responsive compositions, WCAG 2.2 AA and purposeful motion

- **Decision:** Proposed; no owner acceptance is asserted.
- **Implementation:** Not started (0/5 new EX tasks).
- **Verification:** No (0/5 tasks independently Verified).
- **Programme/date/baseline:** Experience-first UI/UX; 2026-11-07; `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e`, after merged PR #29.
- **Priority / phase:** P0 / Quality.
- **Related earlier ADRs:** ADR-0110, ADR-0087. Historical decisions are preserved, not automatically superseded.
- **Source touchpoints:** `web/src/styles/shell.css`, `web/src/styles/listening.css`, `web/src/views/Studio.tsx`, `web/e2e/visual.e2e.ts`.

## Context and limits of current evidence

Selecta includes a responsive navigation rail/bottom bar, virtual keyboard behavior, an interactive Studio grid and many overlays. Synthetic screenshot capture does not prove human screen-reader, zoom or touch success. Source observations and earlier planning are not proof of user task outcomes, accessible operation or current visual quality.

## Proposed decision

- Adopt WCAG 2.2 AA as the release target, with human keyboard and NVDA/Edge acceptance; automation is supporting evidence only.
- Compose each task to function from 320px to large desktop and 200/400% zoom, including safe-area and virtual keyboard occlusion.
- Keep alternatives to drag that work with a single pointer and a keyboard, with visible focus and usable target dimensions.
- Restrict animation to meaningful feedback or music context, offer reduced-motion alternatives and stop expensive hidden visualizers.
- Use WAI-ARIA composite interaction patterns for Studio grid, combobox, tabs, menus and dialogs rather than decorative roles.

## Alternatives and rationale

One stacked layout for everything can destroy useful expert context; desktop-only precision excludes users. Design per-task responsive compositions and test them.

## Consequences and boundaries

24x24px WCAG target-size criterion has exceptions; do not confuse larger in-house target preferences with the standards themselves. Preserve old routes, preferences, original media, current/draft/revision identity, single audio owner, Undo, consented atomic bridges, full Studio control, blind study integrity and correct FLAC. No near-term desktop packaging or SaaS migration, no silent backend/audio/API changes or remote telemetry.

## Implementation tasks (all Not started; Verified: No)

1. **EX-0132-01 — Review mobile/zoom layouts**. Acceptance: Essential controls visible at short heights and virtual keyboard. Required verification: 320/375/430, 200/400% zoom tests. **Implementation: Not started; Verified: No.**
2. **EX-0132-02 — Ensure non-drag equivalents**. Acceptance: Reorder and grid changes possible without drag. Required verification: WCAG 2.5.7 pointer/keyboard checks. **Implementation: Not started; Verified: No.**
3. **EX-0132-03 — Audit composite ARIA behavior**. Acceptance: Focus, navigation and naming correct for all widgets. Required verification: APG pattern testing and NVDA. **Implementation: Not started; Verified: No.**
4. **EX-0132-04 — Specify reduced-motion fidelity**. Acceptance: Same task feedback without decorative animation. Required verification: OS preference and performance tests. **Implementation: Not started; Verified: No.**
5. **EX-0132-05 — Conduct named human AT acceptance**. Acceptance: Essential listener/creator/expert tasks completed accessibly. Required verification: Recorded NVDA/Edge and available AT sessions. **Implementation: Not started; Verified: No.**

## Verification and sources

Test dark/light/system themes, long/RTL metadata, 320–2560px viewports and 200/400% zoom, keyboard/touch/NVDA, reduced motion and async failure/race states. Real media and export must be heard/decoded as applicable. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) · [Playwright visual testing](https://playwright.dev/docs/test-snapshots) · [web.dev INP](https://web.dev/articles/inp). These sources inform design methods, not reported Selecta test results. See [roadmap](selecta-experience-roadmap.md), [checklist](selecta-experience-implementation-checklist.md), [evidence](selecta-experience-evidence.md), [historical reconciliation](selecta-experience-status-reconciliation.md).
