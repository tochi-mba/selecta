# ADR-0351 - Library mobile/tablet presentation, high zoom and accessible retrieval

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Library responsive. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0233, ADR-0234, ADR-0298, ADR-0291; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Library.tsx`; `web/src/styles/operations.css`; `web/src/ui/controls.tsx`.

## Context and source/evidence boundary

Desktop grid headers are already hidden at narrow widths and row actions wrap. A complete redesign must account for responsive hierarchy rather than shrinking desktop columns. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Specify content-led responsive modes: full aligned list where readable, stacked track cards on narrow screens and accessible selection/action surfaces that never overlap sticky player/navigation.

## User outcome and interaction contract

The same real recording can be found, inspected, selected and added on keyboard, touch and screen reader at 320px or 400% zoom.

**Required negative cases:** Short landscape, 320px, 400% zoom, external keyboard, RTL/CJK names, PWA, player chrome, forced colors and reduced motion.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LX-0351-01 - Define content-driven breakpoints.** **Acceptance:** Breakpoints respond to available pane space and text, not device model alone. **Required verification:** Responsive grid geometry matrix. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **LX-0351-02 - Retain identity on narrow rows.** **Acceptance:** Title, artist, readiness and one useful action remain visible without horizontal overflow. **Required verification:** 320px and zoom screenshot tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **LX-0351-03 - Keep filter interaction reachable.** **Acceptance:** Wrapping/scrolling filters retain labels, active state and keyboard order. **Required verification:** Touch and keyboard filter task. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **LX-0351-04 - Protect selection rail.** **Acceptance:** Selection count, Cancel and safe actions remain accessible above bottom chrome. **Required verification:** Occlusion and keyboard-inset E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **LX-0351-05 - Design details sheet on mobile.** **Acceptance:** Song inspector opens and closes without hidden Save or trapped focus. **Required verification:** iOS/Android sheet and AT review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **LX-0351-06 - Enforce contrast and targets.** **Acceptance:** WCAG 2.2 AA plus practical 44px primary touch targets, with documented exceptions. **Required verification:** Measured contrast/hitbox and forced-colors audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **LX-0351-07 - Test assistive technology.** **Acceptance:** ARIA labels, lists, selected state, headings and status updates are coherent. **Required verification:** NVDA, VoiceOver and TalkBack task scripts. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **LX-0351-08 - Validate complete mobile journey.** **Acceptance:** User completes search to exact song to action without desktop requirement. **Required verification:** Uncoached one-handed task study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Target and contrast exceptions (LX-0351-06, 2026-11-10)

Measured by `web/e2e/lx-library.e2e.ts` "LX-0344-02 LX-0344-05 LX-0351-06" in light and dark, both densities.

- **Comfortable density (the default):** Start a mix, More actions and the selection checkbox's label are at least 44 x 44 px. Song, artist, tempo/key/length, readiness, counts and the readiness help reach 4.5:1 against their background.
- **Compact density (a chosen desktop density):** the same controls shrink but stay at least 24 x 24 px, the WCAG 2.2 AA minimum (2.5.8). This is the documented exception.
- **Filter chips:** at least 24 px tall at every width, normally the 44 px control height.
- **Song title link:** the title opens the song sheet; it is text inside the row, so the row's own Start/More buttons carry the 44 px primary targets.
- **Forced colours:** the chosen filter keeps a Highlight border, so its state never depends on colour alone.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
