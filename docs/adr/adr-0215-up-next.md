# ADR-0215 - Up Next as musical anticipation with safe steering

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (4/8 Implemented, 0/8 In progress, 4/8 Not started or needing a person; updated 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Listen.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0147/0175/0116; prior statuses unchanged.
- **Existing source touchpoints:** web/src/views/Now.tsx; web/src/views/Requests.tsx.

## Context and evidence boundary

Present real upcoming song and transition status, optional steering, and calm end-of-set discovery. These are new design acceptance criteria, not proof that similar functionality does not already exist. Source-level implementation, automated tests, independent human review and musical acceptance remain distinct.

## Proposed decision

Present real upcoming song and transition status, optional steering, and calm end-of-set discovery. Preserve a reliable, local-first instrument underneath any new art direction. Keep current versus draft context, exact song/seam IDs, authoritative analysis, single player ownership and transparent pending operations.

## Visual, animation and microinteraction contract

- Music leads; one obvious primary object/action with discoverable precision controls.
- Distinguish decorative visuals, requested intentions, measured states, render-complete artifacts and actual playback.
- Causal, optional, interruptible motion with reduced-motion and textual equivalents; never delay Pause, cancel or Undo.
- Every state has keyboard, touch, focus, high-contrast and screen-reader affordances where meaningful.

## Alternatives and trade-offs

No ghost next track, invented countdown, stealth mutation or playing claim for a queued request. Reject spectacle when it costs accessibility, audio continuity or task comprehension. This ADR approves no new SaaS, login, account, cloud upload, telemetry, audio engine rewrite or code change by itself.

## Implementation checklist - 4/8 Implemented, 0/8 Verified

1. **SF-0215-01 - Design next-song hierarchy.** **Acceptance:** Future identity understood immediately. **Required verification:** First-glance task. **Implementation:** Needs a person: first-glance task with listeners. Automated part: `web/src/views/UpNext.test.tsx` 'SF-0215-01 names the next song and artist first' passes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0215-02 - Show seam readiness.** **Acceptance:** Planned, ready and failed distinct. **Required verification:** Readiness tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/UpNext.test.tsx` 'SF-0215-02 keeps planned, ready and failed transitions visibly distinct' (TransitionTruth in `web/src/views/Now.tsx`) (2026-11-10).
3. **SF-0215-03 - Refine steering actions.** **Acceptance:** Requested change scope is explicit. **Required verification:** Revision E2E. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/UpNext.test.tsx` 'SF-0215-03 says steering changes only the next song, and guards it with the mix it saw' (x-mix-order); `web/src/views/Now.test.tsx` 'blocks overlapping steering presses'; `web/e2e/flows.e2e.ts` 'a change to a mix that's moved on stops, says so, and touches nothing' (2026-11-10).
4. **SF-0215-04 - Integrate request entry.** **Acceptance:** Request lifecycle distinguished from steering. **Required verification:** Usability test. **Implementation:** Needs a person: usability test separating request lifecycle from steering. Automated part: request entry sits apart in DJ controls (`web/src/views/Now.tsx`), lifecycle covered by `web/src/views/RequestsJoining.test.tsx`; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0215-05 - Design end-of-set scene.** **Acceptance:** No phantom next track and clear closure. **Required verification:** Player end-state test. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/UpNext.test.tsx` 'SF-0215-05 ends the set with no phantom next track'; `web/e2e/listen.e2e.ts` 'the end of the mix comes to a stop, and it can be played again' (2026-11-10).
6. **SF-0215-06 - Adapt responsive panel.** **Acceptance:** Mobile and desktop maintain actions. **Required verification:** 320px and 400% zoom. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/e2e/pages.e2e.ts` 'nothing goes wider than the window in landscape, or zoomed in as far as browsers go' and 'on a phone, Listen keeps display options after the song identity and transport reachable' (2026-11-10).
7. **SF-0215-07 - Reduce announcement noise.** **Acceptance:** Single essential updates only. **Required verification:** NVDA review. **Implementation:** Needs a person: NVDA review of Up Next announcements. Automated part: `web/e2e/finishing.e2e.ts` 'playing doesn't flood a screen reader' passes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0215-08 - Evaluate listening attention.** **Acceptance:** No secondary panel dominates music. **Required verification:** Participant listening study. **Implementation:** Needs a person: participant listening study on attention; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Preserve one audio owner and intentional Pause, original local music and LRCLIB metadata disclosure, revision-guarded current and draft and scoped Undo, consented atomic request bridges, eight-lane/8–64-cell Studio with recovery, truthful Library states, neutral blind evaluation and frozen-revision decodable FLAC. Test absent, stale, offline, failed and slow data, duplicate/RTL titles, 320px to wide, 400% zoom, forced colors, reduced motion and actual playback as applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0147/0175/0116, ADR-0198 and ADR-0199. Reconcile previous code per task rather than reimplementing blindly.
- **Sequence:** owner decision → design specimens → scoped code/test PR → independent audio/visual/AT/performance review → recorded GO/NO-GO.
- **Now:** Decision Accepted; Implementation In progress (4/8, 2026-11-10); Independently Verified No; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
