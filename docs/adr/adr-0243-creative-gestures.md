# ADR-0243 - Tactile gestures, pointer feedback and equal keyboard control

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (4/8 Implemented, 3/8 In progress, 1/8 Not started or needing a person; updated 2026-11-11).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Interaction.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0150/0173/0174; historical statuses remain unmodified.
- **Existing source touchpoints:** web/src/views/EditorRows.tsx; web/src/views/Studio.tsx; web/src/views/MixSetup.tsx.

## Context and evidence boundary

Make drag/reorder, energy shaping and stem-cell painting expressive and predictable without relying on gesture-only functionality. Protect server commits and correct pointer capture. The codebase includes substantial existing source functionality; this record specifies new artistic and acceptance deltas and no newly implemented source behavior. Prior programme checkmarks require per-task reconciliation before reuse is credited.

## Proposed decision

Make drag/reorder, energy shaping and stem-cell painting expressive and predictable without relying on gesture-only functionality. Protect server commits and correct pointer capture. Make decisions explicit and reversible when possible. Preserve music and source-data safety, locally controlled storage, genuine playback and exact draft/revision identity through all expressive presentation changes.

## Visual, animation and microinteraction contract

- Primary actions, status, identity and recovery remain visible with one focused music object per scene.
- Never conflate intended, pending, committed, prepared, rendered, heard or unknown states in copy, visuals or animations.
- Motion is causal, short, cancellable and optional. Reduced motion, forced colors, keyboard, touch and assistive technology preserve function.
- Test actual audio continuity and responsible CPU use wherever visual styling shares a thread with playback.

## Alternatives and trade-offs

No gesture that silently edits current mix, toggles multiple times per stroke or traps page scroll on touch. Preserve a proven reliable interface when a proposed artistic treatment cannot demonstrate improved user outcomes. This docs-only decision does not implement remote services, SaaS, telemetry, accounts or changes to music files.

## Implementation checklist - 2/8 Implemented, 0/8 Verified

1. **SF-0243-01 - Inventory gesture affordances.** **Acceptance:** Every pointer action has explicit drag handle or visual clue. **Required verification:** Interaction review. **Implementation:** Implemented; each gesture has a visible clue, a keyboard or button equivalent and a cancel; table in docs/engineering/flow-cross-cutting.md; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/engineering/flow-cross-cutting.md` Gesture affordances; `web/src/views/Studio.test.tsx` 'is one tab stop, moves with the arrow keys, and Space turns a square on or off'; `web/src/state/shortcuts.test.ts` 'leaves Space to a custom role=button reorder grip and its children'; `web/src/views/MixSetup.test.tsx`; passed 2026-11-10.
2. **SF-0243-02 - Define provisional visuals.** **Acceptance:** Hover/drag preview distinct from committed result. **Required verification:** Slow server tests. **Implementation:** Implemented; a move sent to a slow server marks the song "Moving…" with a dashed outline and aria-busy and leaves it where it is until the server answers; the energy arc is a dashed sketch while drawn ("Drawing. Nothing is saved until you let go") and nothing is sent until the stroke ends; the drop preview keeps "Changes if the song is dropped there"; **Verified:** No; **Owner:** Claude agent r4a; **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** `web/src/views/sfGestures.test.tsx` 'marks a song as moving while a slow server works, and only shows it moved once the server says so', 'draws the energy arc as a sketch while it is being drawn, and saves nothing until the stroke ends' (vitest passed 2026-11-11); `web/src/views/EditorRows.tsx`, `web/src/views/Mix.tsx`, `web/src/views/MixSetup.tsx`, `web/src/ui/MusicObjects.tsx`.
3. **SF-0243-03 - Implement cancel paths.** **Acceptance:** Escape, pointer cancel and navigation restore state. **Required verification:** Pointer E2E. **Implementation:** Implemented; a cancelled pointer or Escape mid-stroke puts back every Studio square the stroke touched (earlier work kept), leaving the page mid-stroke keeps the pre-stroke grid, Escape while drawing the energy arc restores it and saves nothing, and Escape during a finger drag of a song drops nothing; **Verified:** No; **Owner:** Claude agent r4a; **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** `web/src/views/sfGestures.test.tsx` SF-0243-03 cancel paths (5 tests: pointer cancel, Escape, leaving mid-stroke, arc Escape, song drag Escape); `web/src/views/MixSetup.test.tsx` 'cancels an interrupted pointer stroke ...'; `web/src/views/Studio.test.tsx` (vitest passed 2026-11-11).
4. **SF-0243-04 - Make keyboard equivalents.** **Acceptance:** Reorder, paint and arc shape operable without drag. **Required verification:** Keyboard/NVDA tests. **Implementation:** In progress; Needs a person: an NVDA test of reorder, paint and arc shaping without drag. Automated keyboard part passed 2026-11-11: `web/e2e/finishing.e2e.ts` 'reordering with the keyboard moves the song, and focus stays on it' (dist-r3j); `web/src/views/Studio.test.tsx` 'is one tab stop, moves with the arrow keys, and Space turns a square on or off'; `web/src/views/MixSetup.test.tsx` 'keeps numeric input, slider and drawn stops on the same exact preference values' (vitest); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0243-05 - Design touch scrolling boundaries.** **Acceptance:** Grid and arc avoid unwanted gesture conflicts. **Required verification:** Mobile gesture tests. **Implementation:** Implemented; Needs a person: a gesture check on a real phone. Built: Studio squares and the energy arc use `touch-action: pan-y`, so a vertical swipe scrolls the page (the browser cancels the stroke and it is put back) while a tap or sideways stroke paints or draws; only the reorder handle takes a finger from timeline scrolling; the Studio grid scrolls sideways inside itself. `web/src/views/sfGestures.test.tsx` SF-0243-05 (3 tests, vitest passed 2026-11-11); **Verified:** No; **Owner:** Claude agent r4a; **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** -.
6. **SF-0243-06 - Prevent double-application.** **Acceptance:** Each intended stem cell changes at most once per stroke. **Required verification:** Pointer path fixtures. **Implementation:** Implemented; one stroke changes each Studio cell at most once, even when it passes over it again; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/views/Studio.test.tsx` 'paints a consistent value over touched cells without re-toggling a revisited cell' (passed 2026-11-10).
7. **SF-0243-07 - Support stylus and coarse pointers.** **Acceptance:** Hit zones remain precise and accessible. **Required verification:** Device test. **Implementation:** In progress; Needs a person: a stylus and coarse-pointer device test; `pointer: coarse` raises targets in CSS and MP-0298-03 measures 44px primary targets, but no real device was used. Automated stylesheet part passed 2026-11-12: `web/src/styles/sfCoarsePointer.test.ts` 'every coarse-pointer target is at least 44px, and an inline term hint at least 24px', 'compact density goes back to 44px controls under a coarse pointer', 'the Studio squares and the reorder handle are full-height targets', 'a pen or finger on the grid, the arc or the waveform still scrolls the page; only the handle takes it', 'hover-only hints are kept to precise pointers, so a pen or finger never leaves one stuck on' (5 passed, vitest); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0243-08 - Measure editing accuracy.** **Acceptance:** Users can edit quickly with low unintended changes. **Required verification:** Creator study. **Implementation:** Not started; Needs a person: a creator study of editing speed and unintended changes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and intentional Pause, unchanged local audio and LRCLIB metadata disclosure, current/draft revision guards and scoped Undo, stable song/seam identity, explicitly consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, accurate Library readiness, neutral blind studies and decodable exact frozen-revision FLAC. Include relevant offline/slow/stale/failed/cancel, duplicate song, RTL/long copy, 320–2560px/400% zoom, touch/keyboard/NVDA, forced color, reduced motion and real-audio testing.

## Dependencies, evidence and status

- **Depends on:** ADR-0150/0173/0174; new ADR-0198/0199 and corresponding programme checklist.
- **Next:** owner acceptance → design review → focused implementing PR with tests → independent audio, accessibility, visual and hardware acceptance → release decision.
- **Now:** Decision Accepted; Implementation 2/8 (2026-11-11); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
