# ADR-0209 — Transport hierarchy, persistent audio focus and media session

- **Decision:** Proposed (owner acceptance pending).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Shell.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0140/0093/0167; no historical status is changed.
- **Existing source touchpoints:** web/src/player.ts; web/src/audio/focus.ts; web/src/shell/Shell.tsx.

## Context and evidence boundary

Keep the authoritative player alive while redesigning song progress, transport and responsive mini-player. Coordinate preview/Studio and multitab audio focus. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Keep the authoritative player alive while redesigning song progress, transport and responsive mini-player. Coordinate preview/Studio and multitab audio focus. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

No player duplication, auto-resume after manual Pause or false playing visualization. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0209-01 — Model all player states.** **Acceptance:** Idle/loading/playing/paused/seam/failure mapped. **Required verification:** State tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0209-02 — Redesign desktop transport.** **Acceptance:** Primary controls and identity coherent. **Required verification:** Wide/shallow visual review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0209-03 — Redesign mobile mini-player.** **Acceptance:** Safe area, nav and keyboard insets work. **Required verification:** 320–430 touch E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0209-04 — Use authentic playback clock.** **Acceptance:** Progress and transition match actual sound. **Required verification:** Audio/video sync study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0209-05 — Guarantee single owner.** **Acceptance:** Preview/Studio/Listen cannot overlap unexpectedly. **Required verification:** Focus race test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0209-06 — Preserve intentional Pause.** **Acceptance:** Theme, navigation, failure never restart sound. **Required verification:** Pause/route E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0209-07 — Verify supported media keys.** **Acceptance:** OS controls reflect actual session. **Required verification:** Windows/Edge device test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0209-08 — Audit accessible transport.** **Acceptance:** Control names and state announcements work. **Required verification:** Keyboard and NVDA review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0140/0093/0167 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Proposed; Implementation Not started; Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
