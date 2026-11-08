# ADR-0245 — Final visual-detail audit and art-direction coherence

- **Decision:** Proposed (owner approval pending).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Polish.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0091/0130/0183; historical statuses remain unmodified.
- **Existing source touchpoints:** web/src/styles/tokens.css; web/src/styles/polish.css; web/src/styles/music-objects.css.

## Context and evidence boundary

Treat finishing as a disciplined visual review: typography baselines, icon optics, selection shadows, dividers, content spacing, state-specific assets and responsive truncation all matter. The codebase includes substantial existing source functionality; this record specifies new artistic and acceptance deltas and no newly implemented source behavior. Prior programme checkmarks require per-task reconciliation before reuse is credited.

## Proposed decision

Treat finishing as a disciplined visual review: typography baselines, icon optics, selection shadows, dividers, content spacing, state-specific assets and responsive truncation all matter. Make decisions explicit and reversible when possible. Preserve music and source-data safety, locally controlled storage, genuine playback and exact draft/revision identity through all expressive presentation changes.

## Visual, animation and microinteraction contract

- Primary actions, status, identity and recovery remain visible with one focused music object per scene.
- Never conflate intended, pending, committed, prepared, rendered, heard or unknown states in copy, visuals or animations.
- Motion is causal, short, cancellable and optional. Reduced motion, forced colors, keyboard, touch and assistive technology preserve function.
- Test actual audio continuity and responsible CPU use wherever visual styling shares a thread with playback.

## Alternatives and trade-offs

No status hidden for aesthetic minimalism, low-contrast shadow-only focus or flaky screenshot approvals. Preserve a proven reliable interface when a proposed artistic treatment cannot demonstrate improved user outcomes. This docs-only decision does not implement remote services, SaaS, telemetry, accounts or changes to music files.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0245-01 — Audit alignment and spacing.** **Acceptance:** Controls align across scene, card and dialog components. **Required verification:** Pixel-diff review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0245-02 — Audit type and icon optics.** **Acceptance:** Titles, timestamps and icons align optically. **Required verification:** Visual specimen audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0245-03 — Audit borders and depth.** **Acceptance:** Nested panels, elevation and selected states intentional. **Required verification:** Light/dark gallery. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0245-04 — Review state-specific artwork.** **Acceptance:** Empty/failed/loading/pending visuals do not claim data. **Required verification:** Fixture snapshots. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0245-05 — Review all hover/focus/active states.** **Acceptance:** Every shared primitive consistent. **Required verification:** Interactive screenshot grid. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0245-06 — Audit content edge cases.** **Acceptance:** Long strings, tiny counts, nulls and overflow handled. **Required verification:** RTL/zoom tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0245-07 — Audit motion finishing.** **Acceptance:** Transitions cancel without jitter or ghost surfaces. **Required verification:** Slow-motion capture. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0245-08 — Sign off across devices.** **Acceptance:** Independent reviewer approves exact candidate SHA. **Required verification:** Signed visual QA dossier. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve one player and intentional Pause, unchanged local audio and LRCLIB metadata disclosure, current/draft revision guards and scoped Undo, stable song/seam identity, explicitly consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, accurate Library readiness, neutral blind studies and decodable exact frozen-revision FLAC. Include relevant offline/slow/stale/failed/cancel, duplicate song, RTL/long copy, 320–2560px/400% zoom, touch/keyboard/NVDA, forced color, reduced motion and real-audio testing.

## Dependencies, evidence and status

- **Depends on:** ADR-0091/0130/0183; new ADR-0198/0199 and corresponding programme checklist.
- **Next:** owner acceptance → design review → focused implementing PR with tests → independent audio, accessibility, visual and hardware acceptance → release decision.
- **Now:** Proposed; 0/8 Implemented, 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
