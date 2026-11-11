# ADR-0209 - Transport hierarchy, persistent audio focus and media session

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (7/8 Implemented, 0/8 In progress, 1/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Shell.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0140/0093/0167; no historical status is changed.
- **Existing source touchpoints:** web/src/player.ts; web/src/audio/focus.ts; web/src/shell/Shell.tsx.

## Context and evidence boundary

Keep the authoritative player alive while redesigning song progress, transport and responsive mini-player. Coordinate preview/Studio and multitab audio focus. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Keep the authoritative player alive while redesigning song progress, transport and responsive mini-player. Coordinate preview/Studio and multitab audio focus. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

No player duplication, auto-resume after manual Pause or false playing visualization. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist - 7/8 Implemented, 0/8 Verified

1. **SF-0209-01 - Model all player states.** **Acceptance:** Idle/loading/playing/paused/seam/failure mapped. **Required verification:** State tests. **Implementation:** Implemented; player state is idle, loading, playing or paused, with seam, readiness and failure notice fields, each tested; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/player.ts` NowState; `web/src/player.test.ts` (32 tests incl. 'stops and says why when the last song won't load', 'never claims sound started when the context is closed'); run 2026-11-10.
2. **SF-0209-02 - Redesign desktop transport.** **Acceptance:** Primary controls and identity coherent. **Required verification:** Wide/shallow visual review. **Implementation:** Not started; Needs a person: a wide and shallow visual review of the desktop transport; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0209-03 - Redesign mobile mini-player.** **Acceptance:** Safe area, nav and keyboard insets work. **Required verification:** 320–430 touch E2E. **Implementation:** Implemented; the mini-player respects the safe area, the tab bar and the software keyboard from 320 to 430 wide; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/finishing.e2e.ts` 'the mini-player and bottom bar never overlap' (320-430 and landscape); `web/e2e/overlay-arbitration.e2e.ts` 'software keyboard makes notification chrome yield without removing notices or the mini-player'; run 2026-11-10.
4. **SF-0209-04 - Use authentic playback clock.** **Acceptance:** Progress and transition match actual sound. **Required verification:** Audio/video sync study. **Implementation:** Implemented; progress reads the audio context clock and transitions are scheduled on it; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/listen.e2e.ts` 'Play makes real sound, on a clock that really moves', 'a transition takes over exactly where it was planned, with no gap'; `web/src/player.test.ts` 'never shows a time past the end of the song'; run 2026-11-10.
5. **SF-0209-05 - Guarantee single owner.** **Acceptance:** Preview/Studio/Listen cannot overlap unexpectedly. **Required verification:** Focus race test. **Implementation:** Implemented; one sound at a time: previews take and return the sound, and only one tab plays; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/audio/focus.test.tsx` (13 tests); `web/e2e/listen.e2e.ts` 'a preview takes the sound, and gives it back when it's done', 'only one tab plays at a time'; run 2026-11-10.
6. **SF-0209-06 - Preserve intentional Pause.** **Acceptance:** Theme, navigation, failure never restart sound. **Required verification:** Pause/route E2E. **Implementation:** Implemented; theme, navigation and failures never restart paused sound; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/finishing.e2e.ts` 'changing the theme while playing starts nothing again'; `web/e2e/listen.e2e.ts` 'moving around the app leaves the music alone'; `web/src/audio/focus.test.tsx` 'does not revive a mix after the listener pauses while a slow suspension is pending'; run 2026-11-10.
7. **SF-0209-07 - Verify supported media keys.** **Acceptance:** OS controls reflect actual session. **Required verification:** Windows/Edge device test. **Implementation:** Implemented; the media session follows the current song and refuses seeks during a seam; the Windows device check is the independent part; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/audio/mediaSession.test.ts` (3 tests); `web/e2e/listen.e2e.ts` 'media keys do what they say'; run 2026-11-10.
8. **SF-0209-08 - Audit accessible transport.** **Acceptance:** Control names and state announcements work. **Required verification:** Keyboard and NVDA review. **Implementation:** Implemented; transport controls are named and the song is announced once, never the clock; the NVDA session is the independent part; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/finishing.e2e.ts` 'playing doesn't flood a screen reader: the song is said once, and the clock never is'; `web/e2e/listen.e2e.ts` 'the keyboard works the player'; `web/e2e/pages.e2e.ts` axe; run 2026-11-10.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0140/0093/0167 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation 7/8 (2026-11-10); Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
