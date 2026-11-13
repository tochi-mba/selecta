# ADR-0211 - Audio-clock Handoff Scene and truthful transition choreography

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 0/8 In progress, 3/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Listen.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0147/0170/0182; prior statuses unchanged.
- **Existing source touchpoints:** web/src/views/Now.tsx; web/src/player.ts; web/src/ui/seam.ts.

## Context and evidence boundary

Celebrate confirmed outgoing-to-incoming handoffs with technique-specific visuals derived from real player events, not simulated beats. These are new design acceptance criteria, not proof that similar functionality does not already exist. Source-level implementation, automated tests, independent human review and musical acceptance remain distinct.

## Proposed decision

Celebrate confirmed outgoing-to-incoming handoffs with technique-specific visuals derived from real player events, not simulated beats. Preserve a reliable, local-first instrument underneath any new art direction. Keep current versus draft context, exact song/seam IDs, authoritative analysis, single player ownership and transparent pending operations.

## Visual, animation and microinteraction contract

- Music leads; one obvious primary object/action with discoverable precision controls.
- Distinguish decorative visuals, requested intentions, measured states, render-complete artifacts and actual playback.
- Causal, optional, interruptible motion with reduced-motion and textual equivalents; never delay Pause, cancel or Undo.
- Every state has keyboard, touch, focus, high-contrast and screen-reader affordances where meaningful.

## Alternatives and trade-offs

Never infer overlap, shared lyrics or rendered move from an unconfirmed plan. Reject spectacle when it costs accessibility, audio continuity or task comprehension. This ADR approves no new SaaS, login, account, cloud upload, telemetry, audio engine rewrite or code change by itself.

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0211-01 - Model real handoff phases.** **Acceptance:** Enter, overlap, takeover and done follow player events. **Required verification:** Audio-clock unit tests. **Implementation:** Implemented; the hand-off shows preparing, countdown, in progress (from switch_at on the audio clock) and done, driven by player events; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/player.test.ts` 'transition readiness deadlines' (5 tests); `web/src/views/Now.test.tsx` 'beat-grid transition countdown', 'uses chronological seconds when the next handoff has no valid beat grid'; run 2026-11-10.
2. **SF-0211-02 - Design technique families.** **Acceptance:** Cut, blend, wordplay and stem treatments are truthful. **Required verification:** DJ audio review. **Implementation:** Not started; Needs a person: a DJ audio review of cut, blend, wordplay and stem treatments; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0211-03 - Bind exact track identities.** **Acceptance:** Duplicate occurrence and pair revision safe. **Required verification:** Pair-key tests. **Implementation:** Implemented; seams are keyed by their exact pair and occurrence, and a rating goes to the pair that was heard; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/player.test.ts` 'keeps the later occurrence when the same recording appears twice', 'asks for the next seam once'; `web/src/views/Now.test.tsx`; run 2026-11-10.
4. **SF-0211-04 - Synchronize visuals to sound.** **Acceptance:** Graphics follow actual handoff timing. **Required verification:** Audio-video correlation. **Implementation:** Implemented; hand-off graphics read the song time and the render's switch point, both on the audio clock; the audio/video correlation is the independent part; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/listen.e2e.ts` 'a transition takes over exactly where it was planned, with no gap'; `web/src/views/Now.test.tsx` beat-grid countdown tests; run 2026-11-10.
5. **SF-0211-05 - Represent fallback state.** **Acceptance:** Changed move and failed render not hidden. **Required verification:** Failure fixtures. **Implementation:** Implemented; a changed move and a failed render are said, never hidden; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/MusicObjects.test.tsx` 'uses the rendered move rather than disguising a fallback as the selected technique'; `web/e2e/listen.e2e.ts` 'a transition that isn't ready doesn't stop the music'; run 2026-11-10.
6. **SF-0211-06 - Allow interrupted handoff.** **Acceptance:** Seek, skip and Pause settle safely. **Required verification:** Lifecycle E2E. **Implementation:** Implemented; seek, skip and Pause during or around a hand-off settle safely; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/player.test.ts` 'a transition already sounding can't be taken back', 'ignores a failed fallback download after the listener seeks elsewhere', 'seeking while paused stays paused'; `web/e2e/listen.e2e.ts` 'seeking past the way out still gets to the next song'; run 2026-11-10.
7. **SF-0211-07 - Offer still and AT equivalents.** **Acceptance:** Essential details spoken or written without motion. **Required verification:** NVDA test. **Implementation:** Not started; Needs a person: an NVDA test of the hand-off's written and spoken equivalents. Automated part: `web/src/views/sfFlowListenParts.test.tsx` 'while it plays, a still page names the region, both songs and what is happening in words' and 'before it starts, the wait is said in words, and in minutes and seconds without a beat grid' pass (vitest, 2026-11-12); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0211-08 - Assess artistic payoff.** **Acceptance:** Delight rises without distraction. **Required verification:** Counterbalanced listener study. **Implementation:** Not started; Needs a person: a counterbalanced listener study of artistic payoff; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Preserve one audio owner and intentional Pause, original local music and LRCLIB metadata disclosure, revision-guarded current and draft and scoped Undo, consented atomic request bridges, eight-lane/8–64-cell Studio with recovery, truthful Library states, neutral blind evaluation and frozen-revision decodable FLAC. Test absent, stale, offline, failed and slow data, duplicate/RTL titles, 320px to wide, 400% zoom, forced colors, reduced motion and actual playback as applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0147/0170/0182, ADR-0198 and ADR-0199. Reconcile previous code per task rather than reimplementing blindly.
- **Sequence:** owner decision → design specimens → scoped code/test PR → independent audio/visual/AT/performance review → recorded GO/NO-GO.
- **Now:** Decision Accepted; Implementation 5/8 (2026-11-10); Independently Verified No; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
