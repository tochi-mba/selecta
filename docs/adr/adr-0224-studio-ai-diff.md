# ADR-0224 - Explainable Studio arrangement proposals and safe local recovery

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 1/8 In progress, 2/8 Not started or needing a person; updated 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Studio.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0152/0174/0122; no earlier status changed.
- **Existing source touchpoints:** web/src/views/Studio.tsx; web/src/studio.ts; web/src/audio/focus.ts.

## Context and evidence boundary

Show human and Selecta arrangements as a concrete returned cell-level difference and preserve uncommitted local work across app interruptions. Separate working, applied and rendered states. Earlier ADRs and code may already implement significant functionality, but no new task is marked complete without exact acceptance and evidence. This is a proposed artistic delta, not source implementation, visual sign-off or real-audio approval.

## Proposed decision

Show human and Selecta arrangements as a concrete returned cell-level difference and preserve uncommitted local work across app interruptions. Separate working, applied and rendered states. Retain all current usable controls with intentional grouping, exact stable musical object identities, recoverable errors and local-only data. An expressive layout must never imply a new audio-engine capability.

## Visual, animation and microinteraction contract

- One first-glance object and action plus discoverable expert options, accurate editable versus committed scope and visible pending outcomes.
- Illustrative graphics and confirmed data remain distinguishable in every visual mode and accessibility description.
- Motion only follows user gestures or real audio/status events, with full reduced-motion, touch, keyboard and screen-reader parity.
- Audio playback, paused state and authoritative mix revisions cannot change as a side effect of inspecting or navigating.

## Alternatives, trade-offs and limits

No fabricated AI reasoning, overwriting newer cells, claiming a shape is rendered audio or losing recovery after failure. Reject ungrounded decoration, forced transitions and high-fidelity effects that starve the player. This ADR does not authorize SaaS, remote upload, telemetry or new backend logic without its own decision and tests.

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0224-01 - Define source-backed diff model.** **Acceptance:** Only returned cell changes and provenance shown. **Required verification:** Proposal fixture test. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Studio.test.tsx` 'lists the exact server-returned cell differences and lets the user restore the previous shape', 'fine tunes your own grid and says what it changed and why' (2026-11-10).
2. **SF-0224-02 - Design side-by-side comparison.** **Acceptance:** Before/after and unchanged cells readable. **Required verification:** Visual task test. **Implementation:** Needs a person: visual task test of before/after comparison; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0224-03 - Preserve human edit authority.** **Acceptance:** Stale proposal cannot overwrite newer strokes. **Required verification:** Race E2E. **Implementation:** In progress: a new stroke clears fine-tune notes (`web/src/views/Studio.test.tsx` 'a change of your own clears what fine tuning said'), but no race E2E proves a stale proposal cannot overwrite newer strokes; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** -; **Evidence:** -.
4. **SF-0224-04 - Make Apply explicit.** **Acceptance:** Working, applied and rendered have distinct stages. **Required verification:** Status matrix tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Studio.test.tsx` 'nothing it does is final until Apply to this transition', 'using it saves the shape, closes and says what happens next'; `tests/test_studio.py::test_using_a_shape_makes_it_that_seam_and_renders_it_first` (2026-11-10).
5. **SF-0224-05 - Refine Undo and restore.** **Acceptance:** Changes recoverable after interruption. **Required verification:** Local recovery tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Studio.test.tsx` 'recovers a valid uncommitted grid for the same transition', 'ignores a corrupted local grid', 'lets Selecta arrange it, and what was there can be put back'; `tests/test_studio.py::test_a_used_shape_can_be_undone` (2026-11-10).
6. **SF-0224-06 - Explain unavailable stems.** **Acceptance:** Missing data and failed preview honest. **Required verification:** Failure injection. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Studio.test.tsx` 'explains when Selecta can't arrange these two', 'explains a failure in the words it was given', 'if using it fails, the shape is still there'; `tests/test_studio.py::test_songs_that_cannot_share_a_studio_get_a_reason` (2026-11-10).
7. **SF-0224-07 - Maintain preview focus contract.** **Acceptance:** Studio preview returns control without surprise resume. **Required verification:** Audio session test. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Studio.test.tsx` 'closing lets go of the audio', 'stops the owned Studio preview ... when the tab becomes hidden'; `web/e2e/listen.e2e.ts` 'a preview takes the sound, and gives it back' (2026-11-10).
8. **SF-0224-08 - Evaluate perceived control.** **Acceptance:** Users predict impact of AI suggestion and undo. **Required verification:** Producer study. **Implementation:** Needs a person: producer study of perceived control; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve single audio owner, intentional Pause, original media and local privacy, accurate LRCLIB metadata disclosure, current/draft revisions and scoped Undo, exact song/seam IDs, consented atomic request bridge, all eight Studio stem lanes and 8–64 cells with local recovery, truthful library readiness, blind listening neutrality and frozen-revision decodable FLAC. Include stale/failed/slow operations, absent media, duplicate songs, keyboard/touch/zoom/RTL, forced-colors/reduced motion and real-audio cases where relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0152/0174/0122 and new foundation ADR-0198/0199, plus shared visual system.
- **Next:** owner decision → prototype/critique → targeted implementation PR with tests → independent human/AT/real-audio/performance evidence → GO/NO-GO.
- **Now:** Accepted, 0/8 Implemented, 0/8 independently Verified; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
