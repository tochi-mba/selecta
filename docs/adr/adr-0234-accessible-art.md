# ADR-0234 - Accessibility as an artistic constraint, WCAG 2.2 AA and semantic parity

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (4/8 Implemented, 2/8 In progress, 2/8 Not started or needing a person; updated 2026-11-11).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Quality.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0161/0183/0023; previous task/status evidence remains unchanged.
- **Existing source touchpoints:** web/src/ui/controls.tsx; web/src/views/Studio.tsx; web/src/styles/tokens.css.

## Context and evidence boundary

The expressive redesign must retain keyboard-only access and complete screen-reader semantics, non-color state, generous targets, readable text and low-sensory alternatives. No artsy view may make its information exclusively graphical. Source-level capabilities, this planning decision, code tests and independent acceptance are separate. Historical evidence remains at its original snapshot until separately reconciled against a future implementation SHA.

## Proposed decision

The expressive redesign must retain keyboard-only access and complete screen-reader semantics, non-color state, generous targets, readable text and low-sensory alternatives. No artsy view may make its information exclusively graphical. Keep one coherent audio-state truth and intentional user control. Require explicit source provenance and measurable acceptance for every interactive, accessibility and visual change.

## Visual, animation and microinteraction contract

- Every critical action remains discoverable, keyboard/touch operable and reversible where the backend permits.
- Planned versus prepared versus committed versus playing or failed states remain distinct with static and assistive-tech equivalents.
- All motion is causal, optional and non-blocking; the player and exact edit revisions win over display rendering.
- Design for both themes, high zoom, forced colors, reduced motion, long/RTL names, offline and slow/failed requests.

## Alternatives and trade-offs

No focus trap, unlabeled transport, auto-playing animated lyric chatter or essential information inside canvas only. A new artistic effect is rejected if it reduces musical accuracy, accessibility, local privacy, performance or intelligible recovery. No production code or SaaS capability is authorized by a documentation-only ADR.

## Implementation checklist - 4/8 Implemented, 0/8 Verified

1. **SF-0234-01 - Map focus and reading order.** **Acceptance:** Each scene has correct semantic structure. **Required verification:** Keyboard and DOM audit. **Implementation:** Implemented; browser check pending (built `web/e2e/sf-0234-reading-order.e2e.ts`: 'SF-0234-01 <page> has one main, one page heading, headings in order and a skip link first' for every page in PAGES, and 'SF-0234-01 inside the page, Tab goes down the page in the order things are drawn'; listed 15 tests, not run); the scene-by-scene map is `docs/engineering/flow-cross-cutting.md` Focus and reading order (SF-0234-01), checked by `tests/test_flow_cross_cutting.py` (13 passed 2026-11-11); **Verified:** No; **Owner:** Claude agent r4a; **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** -.
2. **SF-0234-02 - Validate all core journeys by AT.** **Acceptance:** Listen, Explore, Create, Studio, Requests and Export operable. **Required verification:** NVDA/Edge session. **Implementation:** Not started; Needs a person: an NVDA with Edge session through Listen, Explore, Create, Studio, Requests and Export; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0234-03 - Enforce 2.2 AA contrast and target sizing.** **Acceptance:** Text and essential indicators pass applicable criteria. **Required verification:** Measured contrast and touch-target report. **Implementation:** Implemented; text, large text and field edges are measured against WCAG 2.2 AA in both themes, and every target meets 24px or a WCAG exception with primary touch targets at 44px; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` 'MP-0298-03 every target meets 24px or a WCAG exception, and primary touch targets reach 44px', 'MP-0298-05 text meets 4.5:1, large text 3:1 and field edges 3:1 in both themes' (passed 2026-11-11).
4. **SF-0234-04 - Protect focus under overlays.** **Acceptance:** Nav, toasts, modals and dialogs restore focus correctly. **Required verification:** Dialog Escape/Return E2E. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r3j; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/e2e/flows.e2e.ts` 'keyboard alone gets from the top of the page to the content, and dialogs give focus back' (nav drawer, Escape); `web/e2e/lx-library.e2e.ts` 'LX-0348-05 LX-0348-07 the song sheet corrects with focus on errors, and closing returns to the exact row, scroll and address' (passed 2026-11-11, dist-r3j); toasts and dialogs: `web/src/ui/controls.test.tsx` 'restores focus to the active page after a confirmed Undo removes its button', `web/src/views/ufSeamInspector.test.tsx` 'gives focus back to the exact transition it was opened from when closed', `web/src/views/LibraryLx.test.tsx` 'cancelling the confirmation returns focus to the action that opened it', `web/src/ui/sfPaletteFocus.test.tsx` (vitest 2026-11-11).
5. **SF-0234-05 - Define live announcement budget.** **Acceptance:** Lyric ticks and meters do not chatter. **Required verification:** Screen reader listening study. **Implementation:** In progress; Needs a person: a screen-reader listening study of lyric ticks and meters. Automated part: `web/e2e/finishing.e2e.ts` 'playing doesn’t flood a screen reader: the song is said once, and the clock never is'; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0234-06 - Ensure full motion parity.** **Acceptance:** Still and reduced-motion show all data. **Required verification:** Motion emulator review. **Implementation:** Implemented; Still and OS reduced motion remove decorative movement while every piece of music data keeps updating; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/mp-0296-motion.e2e.ts` 'MP-0296-06 Still and reduced motion remove decorative movement while the music data keeps updating' (motion emulated; passed 2026-11-11).
7. **SF-0234-07 - Validate 320px and 400% zoom.** **Acceptance:** No hidden or clipped critical action. **Required verification:** Reflow matrix. **Implementation:** Implemented; every page stays actionable at 320px and at 200% and 400% zoom, with no clipped critical action; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` 'MP-0298-01 every page holds from 320 to 3840px, at both sides of 620 and 760, and in short landscape', 'MP-0298-02 200% and 400% zoom keep every page actionable, and the Studio has its list form'; `web/e2e/mi-0141-first-screen-zoom.e2e.ts` MI-0141-07 at 200% and 400% zoom; all passed 2026-11-11.
8. **SF-0234-08 - Record independent access sign-off.** **Acceptance:** Named reviewer and SHA with blockers resolved. **Required verification:** AT evidence report. **Implementation:** Not started; Needs a person: a named access reviewer signing the exact SHA with blockers resolved; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Single player and intentional Pause; unchanged local music and explicit LRCLIB metadata disclosure; exact current/draft revisions and scoped Undo; stable song and seam IDs; consented atomic bridges; all eight stem lanes and 8–64 cells with recovery; truthful Library readiness; neutral blind research; and exact frozen-revision decodable FLAC remain protected. Verify slow/stale/offline/failure cases, multi-tab, touch, 320–2560px, 400% zoom, forced colors, reduced motion, NVDA/Edge and real-audio operation as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0161/0183/0023; new ADR-0198/0199 and previous programme acceptance records.
- **Next:** dated owner decision → design specimens → small code/test PR → separate independent human/AT/audio/performance report → explicit release gate.
- **Now:** Decision Accepted; Implementation 4/8 (2026-11-11); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
