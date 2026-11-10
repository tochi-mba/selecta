# ADR-0221 - Hear-first Transition Inspector with technique truth and conditional A/B

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (2/8 Implemented, 2/8 In progress, 4/8 Not started or needing a person; updated 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Create.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0151/0172/0121; no earlier status changed.
- **Existing source touchpoints:** web/src/views/SeamInspector.tsx; web/src/audio/focus.ts; web/src/ui/seam.ts.

## Context and evidence boundary

Organize the exact selected pair into Hear, Shape and Understand, putting real audible evidence first and preserving technical options. A/B only when two immutable actual audio clips are available. Earlier ADRs and code may already implement significant functionality, but no new task is marked complete without exact acceptance and evidence. This is a proposed artistic delta, not source implementation, visual sign-off or real-audio approval.

## Proposed decision

Organize the exact selected pair into Hear, Shape and Understand, putting real audible evidence first and preserving technical options. A/B only when two immutable actual audio clips are available. Retain all current usable controls with intentional grouping, exact stable musical object identities, recoverable errors and local-only data. An expressive layout must never imply a new audio-engine capability.

## Visual, animation and microinteraction contract

- One first-glance object and action plus discoverable expert options, accurate editable versus committed scope and visible pending outcomes.
- Illustrative graphics and confirmed data remain distinguishable in every visual mode and accessibility description.
- Motion only follows user gestures or real audio/status events, with full reduced-motion, touch, keyboard and screen-reader parity.
- Audio playback, paused state and authoritative mix revisions cannot change as a side effect of inspecting or navigating.

## Alternatives, trade-offs and limits

No phantom audio, invented quality judgment, mismatched seam, or fake comparison result. Reject ungrounded decoration, forced transitions and high-fidelity effects that starve the player. This ADR does not authorize SaaS, remote upload, telemetry or new backend logic without its own decision and tests.

## Implementation checklist - 2/8 Implemented, 0/8 Verified

1. **SF-0221-01 - Design inspector hierarchy.** **Acceptance:** Hear, technique and exact pair understandable. **Required verification:** First-glance test. **Implementation:** Needs a person: first-glance test of the inspector hierarchy; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0221-02 - Refine preview transport.** **Acceptance:** Real clip loading, playing and stop states accurate. **Required verification:** Real-audio focus tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/e2e/listen.e2e.ts` 'a preview takes the sound, and gives it back when it's done'; `web/src/views/Mix.test.tsx` 'plays the exact render'; `web/src/audio/focus.test.tsx` (2026-11-10).
3. **SF-0221-03 - Explain requested versus rendered.** **Acceptance:** Technique and fallback not conflated. **Required verification:** Seam data fixtures. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Mix.test.tsx` 'keeps the move you asked for pressed, and names what really plays separately', 'says what you chose and what will really play, if they differ'; `web/src/ui/MusicObjects.test.tsx` 'uses the rendered move rather than disguising a fallback' (2026-11-10).
4. **SF-0221-04 - Expose technique compatibility.** **Acceptance:** Unavailable move shows reason. **Required verification:** AT and capability tests. **Implementation:** Needs a person: assistive-technology check of unavailable-move reasons. Automated part: `web/src/views/Mix.test.tsx` 'says why the stems can't be shaped' and `tests/test_studio.py::test_the_chooser_explains_when_the_studio_is_not_possible` pass; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0221-05 - Refine exact cue and length.** **Acceptance:** Units and edit scope consistent. **Required verification:** Keyboard and range tests. **Implementation:** In progress: no keyboard/range test yet proves cue and length units and edit scope; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** -; **Evidence:** -.
6. **SF-0221-06 - Gate A/B on real clips.** **Acceptance:** Comparison absent without verified alternatives. **Required verification:** Clip/revision contract tests. **Implementation:** Not started: the inspector has no A/B comparison to gate; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** -; **Evidence:** -.
7. **SF-0221-07 - Keep inspector context.** **Acceptance:** Sticky panel does not lose selection on reorder. **Required verification:** Large-mix E2E. **Implementation:** In progress: selection survives reorder (`web/src/views/Mix.test.tsx` 'the same stays selected when others move') and the column can stick (`tests/test_selecta3_changes.py`), but no large-mix E2E; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** -; **Evidence:** -.
8. **SF-0221-08 - Validate listen-first design.** **Acceptance:** Users judge transition without false status trust. **Required verification:** DJ and novice study. **Implementation:** Needs a person: DJ and novice listen-first study; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve single audio owner, intentional Pause, original media and local privacy, accurate LRCLIB metadata disclosure, current/draft revisions and scoped Undo, exact song/seam IDs, consented atomic request bridge, all eight Studio stem lanes and 8–64 cells with local recovery, truthful library readiness, blind listening neutrality and frozen-revision decodable FLAC. Include stale/failed/slow operations, absent media, duplicate songs, keyboard/touch/zoom/RTL, forced-colors/reduced motion and real-audio cases where relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0151/0172/0121 and new foundation ADR-0198/0199, plus shared visual system.
- **Next:** owner decision → prototype/critique → targeted implementation PR with tests → independent human/AT/real-audio/performance evidence → GO/NO-GO.
- **Now:** Accepted, 2/8 Implemented (2026-11-10), 0/8 independently Verified; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
