# ADR-0233 - Responsive cinematic-to-precision layouts from 320px to wide screens

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (4/8 Implemented, 3/8 In progress, 1/8 Not started or needing a person; updated 2026-11-11).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Cross-cutting.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0160/0183/0129; earlier statuses unchanged.
- **Existing source touchpoints:** web/src/styles/shell.css; web/src/styles/listening.css; web/src/styles/creation.css.

## Context and evidence boundary

Use content-aware responsive compositions, not merely scaled desktop cards, with intact transport, navigation, inspector, Studio and library functions across 320–2560px and zoom. Existing functional code can be reused; this record defines additional visual, interaction and human-outcome acceptance and does not certify its implementation or independent verification.

## Proposed decision

Use content-aware responsive compositions, not merely scaled desktop cards, with intact transport, navigation, inspector, Studio and library functions across 320–2560px and zoom. Favor accessible, truthful, music-first expression. Retain current route functionality and backend truth while enhancing layout, copy, hierarchy and feedback. If a redesign obscures correct status or adds risk, prefer the simpler proven interaction.

## Visual, animation and microinteraction contract

- Clear primary musical object, one intentional primary action and discoverable advanced capability.
- Planned versus prepared versus committed versus playing status and exact object scope must be visible.
- Motion follows cause, actual user action or measured music rather than decorative pseudo-beats and preserves static equivalents.
- Keep interaction available by pointer, touch, keyboard, screen reader, reduced motion, forced colors and high zoom.

## Alternatives, trade-offs and limits

No offscreen focus, trapped horizontal scrolling on basic tasks, tap targets lost in compact mode or mobile player overlay. Do not add accounts, SaaS subscriptions, cloud uploads, telemetry, hardware launchers or new audio sources through this design proposal.

## Implementation checklist - 4/8 Implemented, 0/8 Verified

1. **SF-0233-01 - Specify breakpoint behavior.** **Acceptance:** Every major scene has explicit spatial transformations. **Required verification:** Layout matrix. **Implementation:** Implemented; each scene's spatial change at 1040, 760 and 620px and at short heights is written down with its owning stylesheet, and the media queries it relies on are checked to exist; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/engineering/flow-cross-cutting.md` Breakpoint behaviour per scene; `tests/test_flow_cross_cutting.py` 'test_the_breakpoint_matrix_names_real_media_queries' (passed 2026-11-11); `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` 'MP-0298-01 every page holds from 320 to 3840px, at both sides of 620 and 760, and in short landscape' (passed 2026-11-11).
2. **SF-0233-02 - Design mobile player and navigation.** **Acceptance:** Safe area and keyboard inset correct. **Required verification:** 320–430 touch E2E. **Implementation:** In progress; Needs a person: safe-area insets on a real notched phone (Chromium cannot emulate them). Automated part passed 2026-11-11: `web/e2e/flow-narrow.e2e.ts` (2 tests, 320px touch), `web/e2e/overlay-arbitration.e2e.ts` 'software keyboard makes notification chrome yield without removing notices or the mini-player', `web/e2e/mi-0141-first-screen-zoom.e2e.ts` MI-0141-07 (320x568 and 375x667 touch phones), `web/e2e/mp-0295-overlays-and-toasts.e2e.ts` 'MP-0295-07 an open software keyboard leaves the dialog action reachable and pushes chrome aside'; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0233-03 - Make Create panels adaptive.** **Acceptance:** Inspector reachable without shrinking primary actions. **Required verification:** Narrow arrangement test. **Implementation:** Implemented; at 320px the seam inspector is reachable alongside the mini-player while music plays, without shrinking the primary actions; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/flow-narrow.e2e.ts` 'at 320px the inspector and the mini-player are both reachable while the music plays' (passed 2026-11-11); `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` 'MP-0298-03 every target meets 24px or a WCAG exception, and primary touch targets reach 44px' (passed 2026-11-11).
4. **SF-0233-04 - Ensure Studio editor access.** **Acceptance:** Eight lanes and 64 cells operable at narrow widths. **Required verification:** Touch plus keyboard test. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r3j; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/e2e/sf-studio-stress.e2e.ts` 'SF-0233-04 at 320px every one of the 64 squares can be tapped, and the keyboard reaches the far end' (passed 2026-11-11, dist-r3j).
5. **SF-0233-05 - Handle library table reflow.** **Acceptance:** Sorting/filtering and titles accessible at zoom. **Required verification:** 400%/320px tests. **Implementation:** Implemented; sorting, filters and titles stay usable at 320px and 400% zoom; **Verified:** No; **Owner:** Claude agent r4a; **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** `web/e2e/lx-library.e2e.ts` 'LX-0341-04 LX-0344-06 LX-0345-05 LX-0351-01 LX-0351-02 List view / Card view fits 320 to 1440 and 400% zoom with identity, readiness and an action on every row' and 'LX-0343-02 LX-0351-03 filters show their state without colour, wrap at 320px and work by keyboard and touch' passed (CI run 43119473767, Edge E2E (shard 1/2) job 130857753346, head f851f2b, recorded 2026-11-12); `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` 'MP-0298-02 200% and 400% zoom keep every page actionable, and the Studio has its list form' passed (CI run 43119473767, Edge E2E (shard 2/2) job 130857753267, head f851f2b, recorded 2026-11-12); all four also rerun locally 2026-11-12 under the slot lock (Edge, web/dist-r6e).
6. **SF-0233-06 - Support landscape and shallow heights.** **Acceptance:** Sticky layers never cover active controls. **Required verification:** Viewport matrix. **Implementation:** Implemented; short landscape and shallow windows keep every page usable, and dialog actions and notices stay above the fixed bars and mini-player; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` 'MP-0298-01 every page holds from 320 to 3840px, at both sides of 620 and 760, and in short landscape'; `web/e2e/overlay-arbitration.e2e.ts` 'dialog actions remain exposed above secondary chrome at' 320x568, 375x667 and 1280x600; `web/e2e/mp-0295-overlays-and-toasts.e2e.ts` 'MP-0295-02 primary, cancel and destructive choices fit short windows at one height', 'MP-0295-04 notices never cover the bars, the mini-player or a dialog action'; all passed 2026-11-11.
7. **SF-0233-07 - Test text and RTL stress.** **Acceptance:** Long localized metadata does not break grid. **Required verification:** Unicode fixtures. **Implementation:** Implemented; long, right-to-left, CJK and duplicate metadata keep the grid whole; **Verified:** No; **Owner:** Claude agent r4a; **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** `web/e2e/finishing.e2e.ts` 'long, right-to-left and duplicate names stay readable and whole at the smallest size' and `web/e2e/mp-0275-typography.e2e.ts` 'MP-0275-08 RTL, CJK, emoji, accents and mixed-script punctuation keep their meaning' passed (CI run 43119473767, Edge E2E (shard 1/2) job 130857753346, head f851f2b, recorded 2026-11-12; MP-0275-08 also rerun locally 2026-11-12 under the slot lock (Edge, web/dist-r6e)); `web/src/views/Mix.test.tsx` 'keeps duplicate, RTL and CJK song names readable and occurrence-scoped' (vitest 2026-11-11).
8. **SF-0233-08 - Independently approve each scene.** **Acceptance:** No critical obstruction across named device sizes. **Required verification:** Visual and AT sign-off. **Implementation:** Not started; Needs a person: independent visual and assistive-technology sign-off of each scene across named device sizes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve original local music; intentional Pause and one audio owner; disclosed LRCLIB metadata lookup; exact current/draft revisions and Undo; stable song and seam IDs; atomic bridge joining with explicit consent; eight-lane Studio and local recovery; honest readiness and processing; neutral blind comparison; frozen-revision decodable FLAC. Exercise failures, stale results, missing music, offline and multitab, 320px/high zoom, long/RTL names, keyboard/touch/AT, forced colors, reduced motion and real audio when applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0160/0183/0129; ADR-0198/0199 and cross-cutting UI foundation.
- **Next:** owner decision → prototypes → source-level implementation PR → regression tests → independent visual, access, audio and device evidence → release gate.
- **Now:** Decision Accepted; Implementation 4/8 (2026-11-11); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
