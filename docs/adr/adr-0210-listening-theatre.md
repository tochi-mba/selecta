# ADR-0210 - Listening Theatre: cinematic song-first listening

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 0/8 In progress, 3/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Listen.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0144/0170/0171; prior statuses unchanged.
- **Existing source touchpoints:** web/src/views/Now.tsx; web/src/styles/listening.css.

## Context and evidence boundary

Arrange a cinematic scene around actual song identity, real transport, lyrics and Up Next without burying controls. These are new design acceptance criteria, not proof that similar functionality does not already exist. Source-level implementation, automated tests, independent human review and musical acceptance remain distinct.

## Proposed decision

Arrange a cinematic scene around actual song identity, real transport, lyrics and Up Next without burying controls. Preserve a reliable, local-first instrument underneath any new art direction. Keep current versus draft context, exact song/seam IDs, authoritative analysis, single player ownership and transparent pending operations.

## Visual, animation and microinteraction contract

- Music leads; one obvious primary object/action with discoverable precision controls.
- Distinguish decorative visuals, requested intentions, measured states, render-complete artifacts and actual playback.
- Causal, optional, interruptible motion with reduced-motion and textual equivalents; never delay Pause, cancel or Undo.
- Every state has keyboard, touch, focus, high-contrast and screen-reader affordances where meaningful.

## Alternatives and trade-offs

Never fabricate media, fake playing state or confuse Stage with a separate audio owner. Reject spectacle when it costs accessibility, audio continuity or task comprehension. This ADR approves no new SaaS, login, account, cloud upload, telemetry, audio engine rewrite or code change by itself.

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0210-01 - Compose song-first hero.** **Acceptance:** Song, artist, artwork and transport dominate. **Required verification:** Dark/light first-glance review. **Implementation:** Not started; Needs a person: a dark/light first-glance review of the song-first hero; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0210-02 - Design narrow screen.** **Acceptance:** 320–430px and landscape preserve transport. **Required verification:** Touch and zoom E2E. **Implementation:** Implemented; from 320 to 430 wide and in landscape the song identity and transport stay reachable before display options; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/pages.e2e.ts` 'on a phone, Listen keeps display options after the song identity and transport reachable', landscape and zoom overflow tests; run 2026-11-10.
3. **SF-0210-03 - Map player scenes.** **Acceptance:** Idle, playing, waiting, handoff and error display truth. **Required verification:** Player fixture tests. **Implementation:** Implemented; idle, loading, playing, waiting, hand-off, end of mix and missing audio each show what is true; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/views/Now.test.tsx` 'missing or invalid song duration', 'beat-grid transition countdown'; `web/e2e/listen.e2e.ts` 'a song's audio going missing says so', 'a transition that isn't ready doesn't stop the music', 'the end of the mix comes to a stop'; run 2026-11-10.
4. **SF-0210-04 - Refine artwork fallback.** **Acceptance:** No-art rendering remains meaningful without metadata claims. **Required verification:** Absent-media test. **Implementation:** Implemented; with no art the title carries the song's decorative motif and unknown metadata says Unknown artist rather than guessing; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/MusicObjects.test.tsx` 'gives one library ID the same decorative motif without depending on titles or artwork'; `web/src/views/Now.tsx` TrackTitle; run 2026-11-10.
5. **SF-0210-05 - Progressively disclose DJ controls.** **Acceptance:** Precision actions remain discoverable. **Required verification:** Novice/DJ tasks. **Implementation:** Implemented; DJ controls sit in a disclosure after Up Next, and stay discoverable; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/views/Now.test.tsx` 'keeps expert view controls discoverable without competing with playback'; run 2026-11-10.
6. **SF-0210-06 - Integrate lyrics and Up Next.** **Acceptance:** Panels never obstruct transport or text. **Required verification:** Real playback visual review. **Implementation:** Not started; Needs a person: a visual review during real playback that lyrics and Up Next never cover transport or text. Automated part: `web/e2e/pages.e2e.ts` phone Listen order test passes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0210-07 - Harden Stage lifecycle.** **Acceptance:** Fullscreen cancel and Escape preserve player and focus. **Required verification:** Fullscreen tests. **Implementation:** Implemented; fullscreen refusal falls back to filling the page, Escape leaves, focus returns and the music never stops; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/finishing.e2e.ts` 'fullscreen refused: the lyrics still fill the page, Escape gets out, focus comes back, and the music never stops'; `web/e2e/listen.e2e.ts` 'lyrics follow the song, and the fullscreen view keeps everything working'; run 2026-11-10.
8. **SF-0210-08 - Assess immersive comfort.** **Acceptance:** Listeners prefer new composition without task loss. **Required verification:** Comparative music study. **Implementation:** Not started; Needs a person: a comparative music study of listener preference; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Preserve one audio owner and intentional Pause, original local music and LRCLIB metadata disclosure, revision-guarded current and draft and scoped Undo, consented atomic request bridges, eight-lane/8–64-cell Studio with recovery, truthful Library states, neutral blind evaluation and frozen-revision decodable FLAC. Test absent, stale, offline, failed and slow data, duplicate/RTL titles, 320px to wide, 400% zoom, forced colors, reduced motion and actual playback as applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0144/0170/0171, ADR-0198 and ADR-0199. Reconcile previous code per task rather than reimplementing blindly.
- **Sequence:** owner decision → design specimens → scoped code/test PR → independent audio/visual/AT/performance review → recorded GO/NO-GO.
- **Now:** Decision Accepted; Implementation 5/8 (2026-11-10); Independently Verified No; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
