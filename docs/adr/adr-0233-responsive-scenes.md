# ADR-0233 - Responsive cinematic-to-precision layouts from 320px to wide screens

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started; 2026-11-10).
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

## Implementation checklist - 0/8 Implemented, 0/8 Verified

1. **SF-0233-01 - Specify breakpoint behavior.** **Acceptance:** Every major scene has explicit spatial transformations. **Required verification:** Layout matrix. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0233-02 - Design mobile player and navigation.** **Acceptance:** Safe area and keyboard inset correct. **Required verification:** 320–430 touch E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0233-03 - Make Create panels adaptive.** **Acceptance:** Inspector reachable without shrinking primary actions. **Required verification:** Narrow arrangement test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0233-04 - Ensure Studio editor access.** **Acceptance:** Eight lanes and 64 cells operable at narrow widths. **Required verification:** Touch plus keyboard test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0233-05 - Handle library table reflow.** **Acceptance:** Sorting/filtering and titles accessible at zoom. **Required verification:** 400%/320px tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0233-06 - Support landscape and shallow heights.** **Acceptance:** Sticky layers never cover active controls. **Required verification:** Viewport matrix. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0233-07 - Test text and RTL stress.** **Acceptance:** Long localized metadata does not break grid. **Required verification:** Unicode fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0233-08 - Independently approve each scene.** **Acceptance:** No critical obstruction across named device sizes. **Required verification:** Visual and AT sign-off. **Implementation:** Not started; Needs a person: independent visual and assistive-technology sign-off of each scene across named device sizes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve original local music; intentional Pause and one audio owner; disclosed LRCLIB metadata lookup; exact current/draft revisions and Undo; stable song and seam IDs; atomic bridge joining with explicit consent; eight-lane Studio and local recovery; honest readiness and processing; neutral blind comparison; frozen-revision decodable FLAC. Exercise failures, stale results, missing music, offline and multitab, 320px/high zoom, long/RTL names, keyboard/touch/AT, forced colors, reduced motion and real audio when applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0160/0183/0129; ADR-0198/0199 and cross-cutting UI foundation.
- **Next:** owner decision → prototypes → source-level implementation PR → regression tests → independent visual, access, audio and device evidence → release gate.
- **Now:** Decision Accepted; Implementation 0/8 (2026-11-10); Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
