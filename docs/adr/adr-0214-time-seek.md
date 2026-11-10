# ADR-0214 - Truthful playback time, waveform and seek interactions

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (6/8 Implemented, 0/8 In progress, 2/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Listen.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0145/0170/0101; prior statuses unchanged.
- **Existing source touchpoints:** web/src/views/Now.tsx; web/src/player.ts.

## Context and evidence boundary

Separate seek preview from committed time, display peaks only from real audio, and explain protected seam regions. These are new design acceptance criteria, not proof that similar functionality does not already exist. Source-level implementation, automated tests, independent human review and musical acceptance remain distinct.

## Proposed decision

Separate seek preview from committed time, display peaks only from real audio, and explain protected seam regions. Preserve a reliable, local-first instrument underneath any new art direction. Keep current versus draft context, exact song/seam IDs, authoritative analysis, single player ownership and transparent pending operations.

## Visual, animation and microinteraction contract

- Music leads; one obvious primary object/action with discoverable precision controls.
- Distinguish decorative visuals, requested intentions, measured states, render-complete artifacts and actual playback.
- Causal, optional, interruptible motion with reduced-motion and textual equivalents; never delay Pause, cancel or Undo.
- Every state has keyboard, touch, focus, high-contrast and screen-reader affordances where meaningful.

## Alternatives and trade-offs

No synthetic waveforms, fake successful seek or fabricated beat markers. Reject spectacle when it costs accessibility, audio continuity or task comprehension. This ADR approves no new SaaS, login, account, cloud upload, telemetry, audio engine rewrite or code change by itself.

## Implementation checklist - 6/8 Implemented, 0/8 Verified

1. **SF-0214-01 - Define clock semantics.** **Acceptance:** Time, unknown and remaining from real player. **Required verification:** Clock tests. **Implementation:** Implemented; built: the seek slider says time, length and time left from the player clock, and "Duration unknown" when the length is not known; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/views/NowFlow.test.tsx` 'reads time, length and time left from the player clock'; `web/src/views/Now.test.tsx` 'keeps a finite, disabled slider and never attempts a seek'; `web/src/player.test.ts` 'never shows a time past the end of the song'; run 2026-11-10.
2. **SF-0214-02 - Redesign seek surface.** **Acceptance:** Touch and keyboard targets robust. **Required verification:** Touch/AT E2E. **Implementation:** Implemented; the seek strip is a 92px-tall full-width slider that takes a touch tap and arrow, Page and Home keys; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/flow-narrow.e2e.ts` 'the seek strip takes a tap on a touch screen and arrow keys, at 320px'; `web/e2e/listen.e2e.ts` 'the keyboard works the player'; run 2026-11-10.
3. **SF-0214-03 - Show ghost scrub position.** **Acceptance:** Proposed pointer distinct from accepted position. **Required verification:** Rejected seek test. **Implementation:** Implemented; a drag shows a ghost and "Seek to" while the playhead stays on the audio clock; a rejected or cancelled seek leaves the position alone; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/views/Now.test.tsx` 'previews the target without seeking until release'; `web/src/player.test.ts` 'rejects non-finite seeking without changing the playback position'; run 2026-11-10.
4. **SF-0214-04 - Explain blocked seams.** **Acceptance:** Seek restriction reason clear. **Required verification:** Seam audio tests. **Implementation:** Implemented; during a seam the strip stays the same control, says why it can't move, and the OS refuses seeks too; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/views/Now.tsx` Strip CANT_SEEK note; `web/src/audio/mediaSession.test.ts` 'follows the current song, rejects invalid seeks and refuses seeking during a seam'; `web/e2e/listen.e2e.ts` 'seeking moves within the song, and doesn't set off the transition'; run 2026-11-10.
5. **SF-0214-05 - Validate peak provenance.** **Acceptance:** Waveform derived from actual data. **Required verification:** Source test. **Implementation:** Implemented; peaks are the RMS envelope of the decoded song, and the strip draws one stroke per measured peak and nothing when there are none; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `tests/test_flow_waveform_peaks.py` (3 passed); `web/src/views/NowFlow.test.tsx` 'draws one stroke per measured peak ...', 'draws no waveform, bars, sections or seam mark when analysis has none'; run 2026-11-10.
6. **SF-0214-06 - Show trusted markers.** **Acceptance:** Cue/section only when known. **Required verification:** Partial-analysis fixtures. **Implementation:** Implemented; bar ticks, sections and the seam mark appear only when analysis or the plan supplies them; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/views/NowFlow.test.tsx` 'draws no waveform, bars, sections or seam mark when analysis has none', '... marks only known sections and the planned seam'; run 2026-11-10.
7. **SF-0214-07 - Measure scrub responsiveness.** **Acceptance:** No audio dropout under rapid gesture. **Required verification:** Hardware trace. **Implementation:** Not started; Needs a person: a hardware trace of rapid scrubbing for audio dropouts; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0214-08 - Test seek understanding.** **Acceptance:** Users distinguish preview versus commit. **Required verification:** Uncoached task. **Implementation:** Not started; Needs a person: an uncoached task test of preview versus commit; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Preserve one audio owner and intentional Pause, original local music and LRCLIB metadata disclosure, revision-guarded current and draft and scoped Undo, consented atomic request bridges, eight-lane/8–64-cell Studio with recovery, truthful Library states, neutral blind evaluation and frozen-revision decodable FLAC. Test absent, stale, offline, failed and slow data, duplicate/RTL titles, 320px to wide, 400% zoom, forced colors, reduced motion and actual playback as applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0145/0170/0101, ADR-0198 and ADR-0199. Reconcile previous code per task rather than reimplementing blindly.
- **Sequence:** owner decision → design specimens → scoped code/test PR → independent audio/visual/AT/performance review → recorded GO/NO-GO.
- **Now:** Decision Accepted; Implementation 6/8 (2026-11-10); Independently Verified No; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
