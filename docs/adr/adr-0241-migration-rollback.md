# ADR-0241 — Incremental scene migration, compatibility and reversible release slices

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Delivery.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0164/0184/0030; historical statuses remain unmodified.
- **Existing source touchpoints:** web/src/shell/Shell.tsx; web/src/router.ts; web/src/state/prefs.ts.

## Context and evidence boundary

Ship the new artistic language in separately reversible components without leaving incompatible old and new data models. Rollback must retain user mixes, requests, prefs, local paths and export history. The codebase includes substantial existing source functionality; this record specifies new artistic and acceptance deltas and no newly implemented source behavior. Prior programme checkmarks require per-task reconciliation before reuse is credited.

## Proposed decision

Ship the new artistic language in separately reversible components without leaving incompatible old and new data models. Rollback must retain user mixes, requests, prefs, local paths and export history. Make decisions explicit and reversible when possible. Preserve music and source-data safety, locally controlled storage, genuine playback and exact draft/revision identity through all expressive presentation changes.

## Visual, animation and microinteraction contract

- Primary actions, status, identity and recovery remain visible with one focused music object per scene.
- Never conflate intended, pending, committed, prepared, rendered, heard or unknown states in copy, visuals or animations.
- Motion is causal, short, cancellable and optional. Reduced motion, forced colors, keyboard, touch and assistive technology preserve function.
- Test actual audio continuity and responsible CPU use wherever visual styling shares a thread with playback.

## Alternatives and trade-offs

No big-bang rewrite, silent data migration, missing legacy route or loss of playback state when toggling a redesigned scene. Preserve a proven reliable interface when a proposed artistic treatment cannot demonstrate improved user outcomes. This docs-only decision does not implement remote services, SaaS, telemetry, accounts or changes to music files.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0241-01 — Specify migration sequence.** **Acceptance:** Visual foundation then shell then music scenes and operations. **Required verification:** Dependency plan. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0241-02 — Define compatibility boundaries.** **Acceptance:** Old URLs and backend APIs remain intact. **Required verification:** Router and API tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0241-03 — Plan reversible UI switches.** **Acceptance:** Rollback does not change stored media or mix formats. **Required verification:** Feature switch test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0241-04 — Preserve preferences and state.** **Acceptance:** Old to new to old retains selected mix and motion/theme prefs. **Required verification:** Persistence E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0241-05 — Avoid duplicated ownership.** **Acceptance:** Single player and edit model during phased rollout. **Required verification:** Architecture review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0241-06 — Require narrow PR boundaries.** **Acceptance:** Each release slice has explicit contracts and tests. **Required verification:** PR review checklist. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0241-07 — Exercise failure rollback.** **Acceptance:** Forced revert after edit/request/export is safe. **Required verification:** Scenario E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0241-08 — Record release candidate SHA.** **Acceptance:** Gate decision pinned to exact source and evidence. **Required verification:** Release record. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve one player and intentional Pause, unchanged local audio and LRCLIB metadata disclosure, current/draft revision guards and scoped Undo, stable song/seam identity, explicitly consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, accurate Library readiness, neutral blind studies and decodable exact frozen-revision FLAC. Include relevant offline/slow/stale/failed/cancel, duplicate song, RTL/long copy, 320–2560px/400% zoom, touch/keyboard/NVDA, forced color, reduced motion and real-audio testing.

## Dependencies, evidence and status

- **Depends on:** ADR-0164/0184/0030; new ADR-0198/0199 and corresponding programme checklist.
- **Next:** owner acceptance → design review → focused implementing PR with tests → independent audio, accessibility, visual and hardware acceptance → release decision.
- **Now:** Accepted; 0/8 Implemented, 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
