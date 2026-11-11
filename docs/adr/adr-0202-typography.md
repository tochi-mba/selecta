# ADR-0202 - Editorial display type and precision numeric typography

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 0/8 In progress, 3/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Visual system.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0091/0130/0160; no historical status is changed.
- **Existing source touchpoints:** web/src/styles/tokens.css; web/src/views/Now.tsx; web/src/views/Library.tsx.

## Context and evidence boundary

Introduce distinct typography for artist/song identity, UI explanations and technical music time. Preserve Unicode and reflow. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Introduce distinct typography for artist/song identity, UI explanations and technical music time. Preserve Unicode and reflow. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

No font that causes unacceptable layout shift, clipped titles or obscure cue controls. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0202-01 - Choose display/editorial/interface/technical roles.** **Acceptance:** Type functions and sizes explicit. **Required verification:** Specimen review. **Implementation:** Implemented; display, page, section, song, meta, caption and counter roles are tokens in tokens.css, step down in size, and every role a sheet uses is defined; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/styles/typography.test.ts` (MP-0275, passed 2026-11-10).
2. **SF-0202-02 - Define responsive scale.** **Acceptance:** Titles legible across widths and zoom. **Required verification:** 320–2560 and 400% screenshots. **Implementation:** Implemented; type uses clamp() roles with floors; nothing overflows from 320 to 3840 wide, in landscape, or at 400% zoom; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/styles/typography.test.ts`; `web/e2e/pages.e2e.ts` 'nothing goes wider than the window, from the smallest phone to 4K', 'nothing goes wider than the window in landscape, or zoomed in as far as browsers go'; run 2026-11-10.
3. **SF-0202-03 - Specify tabular numeric rules.** **Acceptance:** Times/BPM/bars align and show units. **Required verification:** Numeric regression fixture. **Implementation:** Implemented; time, BPM, percentage and count surfaces are tabular, and the clock reserves its widest reading; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/styles/typography.test.ts` 'time, BPM, percentage and count surfaces are tabular'; `web/src/styles/optical-alignment.test.ts`; run 2026-11-10.
4. **SF-0202-04 - Stress long and RTL metadata.** **Acceptance:** Controls never occluded by names. **Required verification:** Unicode content tests. **Implementation:** Implemented; long, right-to-left, CJK and duplicate names wrap and resolve their own direction without covering controls; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/finishing.e2e.ts` 'long, right-to-left and duplicate names stay readable and whole at the smallest size'; `web/src/styles/typography.test.ts` 'Library and editor song names resolve their own direction'; run 2026-11-10.
5. **SF-0202-05 - Document truncation behavior.** **Acceptance:** Full identity available by keyboard and touch. **Required verification:** AT and interaction checks. **Implementation:** Not started; Needs a person: an AT and touch check that a truncated name is fully available. Automated part: truncated song names carry the full name as their title and accessible name (`web/src/views/Mix.test.tsx`, passed 2026-11-10); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0202-06 - Minimise font-loading cost.** **Acceptance:** Offline fallbacks stable. **Required verification:** Cold-load trace. **Implementation:** Implemented; only installed system font stacks with generic fallbacks; no web font is bundled or fetched, so cold and offline loads are identical; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/styles/flow-fonts.test.ts` (2 passed); `web/e2e/pages.e2e.ts` 'the page only ever talks to this computer'; run 2026-11-10.
7. **SF-0202-07 - Refine line height and rhythm.** **Acceptance:** Dialog and information copy comfortable. **Required verification:** Reading study. **Implementation:** Not started; Needs a person: a reading study of dialog and information copy; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0202-08 - Approve both-theme type consistency.** **Acceptance:** Typography remains expressive and accessible. **Required verification:** Design sign-off. **Implementation:** Not started; Needs a person: design sign-off of type in both themes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0091/0130/0160 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation 5/8 (2026-11-10); Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
