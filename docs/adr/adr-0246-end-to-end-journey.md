# ADR-0246 — Complete listening-to-creation journey and musical delight milestones

- **Decision:** Proposed (owner approval pending).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Experience.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0165/0184/0141; historical statuses remain unmodified.
- **Existing source touchpoints:** web/src/views/Start.tsx; web/src/views/Now.tsx; web/src/views/Mix.tsx.

## Context and evidence boundary

Tie all scenes into a coherent experience: local setup, first DJ set, first real handoff, steering, shaping, preview, Studio, saved mix and artifact. Measure user confidence and actual sonic outcomes at key moments. The codebase includes substantial existing source functionality; this record specifies new artistic and acceptance deltas and no newly implemented source behavior. Prior programme checkmarks require per-task reconciliation before reuse is credited.

## Proposed decision

Tie all scenes into a coherent experience: local setup, first DJ set, first real handoff, steering, shaping, preview, Studio, saved mix and artifact. Measure user confidence and actual sonic outcomes at key moments. Make decisions explicit and reversible when possible. Preserve music and source-data safety, locally controlled storage, genuine playback and exact draft/revision identity through all expressive presentation changes.

## Visual, animation and microinteraction contract

- Primary actions, status, identity and recovery remain visible with one focused music object per scene.
- Never conflate intended, pending, committed, prepared, rendered, heard or unknown states in copy, visuals or animations.
- Motion is causal, short, cancellable and optional. Reduced motion, forced colors, keyboard, touch and assistive technology preserve function.
- Test actual audio continuity and responsible CPU use wherever visual styling shares a thread with playback.

## Alternatives and trade-offs

No staged progress masquerading as real data, compulsory tutorial, synthetic fake first handoff or forced interruption to celebrate milestones. Preserve a proven reliable interface when a proposed artistic treatment cannot demonstrate improved user outcomes. This docs-only decision does not implement remote services, SaaS, telemetry, accounts or changes to music files.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0246-01 — Storyboard first playable set.** **Acceptance:** From folder to six ready tracks to Listen recorded. **Required verification:** Journey protocol. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0246-02 — Storyboard first handoff.** **Acceptance:** Actual audio event and truthful visual moment identified. **Required verification:** Real playback review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0246-03 — Storyboard first edit.** **Acceptance:** User navigates to correct song and seam. **Required verification:** Task test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0246-04 — Storyboard Studio recovery.** **Acceptance:** Unapplied cells survive intentional route changes. **Required verification:** Recovery E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0246-05 — Storyboard request and consent.** **Acceptance:** Listener understands route and bridge decision. **Required verification:** Consent usability test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0246-06 — Storyboard finish and export.** **Acceptance:** Frozen rendered artifact validated. **Required verification:** FLAC decode and review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0246-07 — Evaluate cross-scene memory.** **Acceptance:** Song, mix and intent recognizable after navigation. **Required verification:** Uncoached session. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0246-08 — Record delight and correctness.** **Acceptance:** Music satisfaction separate from task accuracy. **Required verification:** Listener and DJ feedback. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve one player and intentional Pause, unchanged local audio and LRCLIB metadata disclosure, current/draft revision guards and scoped Undo, stable song/seam identity, explicitly consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, accurate Library readiness, neutral blind studies and decodable exact frozen-revision FLAC. Include relevant offline/slow/stale/failed/cancel, duplicate song, RTL/long copy, 320–2560px/400% zoom, touch/keyboard/NVDA, forced color, reduced motion and real-audio testing.

## Dependencies, evidence and status

- **Depends on:** ADR-0165/0184/0141; new ADR-0198/0199 and corresponding programme checklist.
- **Next:** owner acceptance → design review → focused implementing PR with tests → independent audio, accessibility, visual and hardware acceptance → release decision.
- **Now:** Proposed; 0/8 Implemented, 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
