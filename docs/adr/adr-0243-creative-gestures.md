# ADR-0243 — Tactile gestures, pointer feedback and equal keyboard control

- **Decision:** Proposed (owner approval pending).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
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

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0243-01 — Inventory gesture affordances.** **Acceptance:** Every pointer action has explicit drag handle or visual clue. **Required verification:** Interaction review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0243-02 — Define provisional visuals.** **Acceptance:** Hover/drag preview distinct from committed result. **Required verification:** Slow server tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0243-03 — Implement cancel paths.** **Acceptance:** Escape, pointer cancel and navigation restore state. **Required verification:** Pointer E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0243-04 — Make keyboard equivalents.** **Acceptance:** Reorder, paint and arc shape operable without drag. **Required verification:** Keyboard/NVDA tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0243-05 — Design touch scrolling boundaries.** **Acceptance:** Grid and arc avoid unwanted gesture conflicts. **Required verification:** Mobile gesture tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0243-06 — Prevent double-application.** **Acceptance:** Each intended stem cell changes at most once per stroke. **Required verification:** Pointer path fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0243-07 — Support stylus and coarse pointers.** **Acceptance:** Hit zones remain precise and accessible. **Required verification:** Device test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0243-08 — Measure editing accuracy.** **Acceptance:** Users can edit quickly with low unintended changes. **Required verification:** Creator study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve one player and intentional Pause, unchanged local audio and LRCLIB metadata disclosure, current/draft revision guards and scoped Undo, stable song/seam identity, explicitly consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, accurate Library readiness, neutral blind studies and decodable exact frozen-revision FLAC. Include relevant offline/slow/stale/failed/cancel, duplicate song, RTL/long copy, 320–2560px/400% zoom, touch/keyboard/NVDA, forced color, reduced motion and real-audio testing.

## Dependencies, evidence and status

- **Depends on:** ADR-0150/0173/0174; new ADR-0198/0199 and corresponding programme checklist.
- **Next:** owner acceptance → design review → focused implementing PR with tests → independent audio, accessibility, visual and hardware acceptance → release decision.
- **Now:** Proposed; 0/8 Implemented, 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
