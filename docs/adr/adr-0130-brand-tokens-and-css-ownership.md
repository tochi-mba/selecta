# ADR-0130 - Warm editorial design language, independent themes and CSS ownership

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** 5/5 Implemented (2026-11-10).
- **Verification:** No (0/5 tasks independently Verified).
- **Programme/date/baseline:** Experience-first UI/UX; 2026-11-07; `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e`, after merged PR #29.
- **Priority / phase:** P0 / Foundation.
- **Related earlier ADRs:** ADR-0090, ADR-0091, ADR-0079. Historical decisions are preserved, not automatically superseded.
- **Source touchpoints:** `web/src/styles/tokens.css`, `web/src/style.css`, `web/src/main.tsx`, `web/src/styles/polish.css`.

## Context and limits of current evidence

Selecta already has recognizable charcoal, cream, lime, request blue and warning orange. main.tsx imports eight CSS files with overlapping selectors in legacy and modular styles. This is an architectural maintainability concern, not proof of a screenshot defect. Source observations and earlier planning are not proof of user task outcomes, accessible operation or current visual quality.

## Proposed decision

- Keep the distinctive warm palette; reserve electric lime for purposeful major actions, playback and selected states instead of blanket decoration.
- Create semantic typography, spacing, density, motion, focus, surface and layer tokens suited to reading music metadata and precise editing.
- Design dark and light themes as independent, contrast-verified experiences; include focused, selected, disabled, warning, failed and loading states.
- Give each component style an explicit owner; retire legacy overlap only after reviewed render/state parity, not via blind selector deletion.
- Reject gratuitous glassmorphism, fake musical waveform art, invented song covers, hidden hover-only buttons and visual modes without clear user benefit.

## Alternatives and rationale

A full brand replacement loses an asset; retaining the cascade unchanged keeps visual drift risks. Use a measured brand maturation with incremental CSS ownership.

## Consequences and boundaries

Current overlapping selectors do not establish user-facing breakage. Contrast must be checked on actual rendered component states, not only raw token pairs. Preserve old routes, preferences, original media, current/draft/revision identity, single audio owner, Undo, consented atomic bridges, full Studio control, blind study integrity and correct FLAC. No near-term desktop packaging or SaaS migration, no silent backend/audio/API changes or remote telemetry.

## Implementation tasks (all Not started; Verified: No)

1. **EX-0130-01 - Approve semantic color and type contracts**. Acceptance: Both themes have readable hierarchy and status without color alone. Required verification: Contrast, screenshots and control gallery. **Implementation: Implemented; Verified: No. Needs a person: owner approval of colour and type contracts.**
2. **EX-0130-02 - Design song-focused compositions**. Acceptance: Title, artist and musical intent outrank tool chrome. Required verification: Cross-route human visual critique. **Implementation: Implemented; Verified: No. Needs a person: cross-route visual critique.**
3. **EX-0130-03 - Audit and assign CSS ownership**. Acceptance: Legacy style overrides enumerated, no silent regressions. Required verification: CSS selector map and before/after captures. **Implementation: Implemented; Verified: No. Needs a person: before/after capture review.** Evidence: `docs/engineering/css-ownership.md`, `web/src/styles/uf-cascade.test.ts`.
4. **EX-0130-04 - Specify all interactive component states**. Acceptance: Selected/focus/disabled/error/loading clear in dark/light. Required verification: Review fixture and accessibility scan. **Implementation: Implemented; Verified: No.** Open: `web/e2e/mp-0279-component-gallery.e2e.ts` not green on 2026-11-10; needs a person to review the fixture.
5. **EX-0130-05 - Test real-content resilience**. Acceptance: Long/RTL names, system fonts and zoom preserve layout. Required verification: 320px/400% zoom plus screenshots. **Implementation: Implemented; Verified: No.** Open: MP-0298-02 and MP-0279-06 not green on 2026-11-10; needs a person for RTL/system-font screenshots.

## Verification and sources

Test dark/light/system themes, long/RTL metadata, 320–2560px viewports and 200/400% zoom, keyboard/touch/NVDA, reduced motion and async failure/race states. Real media and export must be heard/decoded as applicable. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) · [Playwright visual testing](https://playwright.dev/docs/test-snapshots) · [web.dev INP](https://web.dev/articles/inp). These sources inform design methods, not reported Selecta test results. See [roadmap](selecta-experience-roadmap.md), [checklist](selecta-experience-implementation-checklist.md), [evidence](selecta-experience-evidence.md), [historical reconciliation](selecta-experience-status-reconciliation.md).
