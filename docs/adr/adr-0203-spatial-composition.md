# ADR-0203 — Spacing, surfaces, density and flexible compositions

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Visual system.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0091/0160/0183; no historical status is changed.
- **Existing source touchpoints:** web/src/styles/shell.css; web/src/styles/creation.css; web/src/styles/operations.css.

## Context and evidence boundary

Replace accumulated CSS framing with a coherent spatial system spanning immersive listening and technical workspaces. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Replace accumulated CSS framing with a coherent spatial system spanning immersive listening and technical workspaces. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

No card-in-card clutter, sticky occlusion or shrinking critical touch targets in dense mode. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0203-01 — Audit CSS ownership and conflicting overrides.** **Acceptance:** Known selectors mapped to owners. **Required verification:** CSS inspection. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0203-02 — Define spacing/width tokens.** **Acceptance:** Rhythm consistent between screens. **Required verification:** Computed specimen review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0203-03 — Specify surfaces and elevation.** **Acceptance:** Sticky layers and modals use deliberate z-axis. **Required verification:** Scroll testing. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0203-04 — Reduce unnecessary nested cards.** **Acceptance:** Music objects retain hierarchy without box clutter. **Required verification:** Visual critique. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0203-05 — Design compact and comfortable density.** **Acceptance:** Both preserve full function and hit areas. **Required verification:** Coarse touch tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0203-06 — Implement adaptable split panes.** **Acceptance:** Inspector and player remain reachable at 320px. **Required verification:** Responsive E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0203-07 — Prevent sticky/focus obstruction.** **Acceptance:** Browser zoom and virtual keyboard supported. **Required verification:** 400% focus audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0203-08 — Test layout stability under load.** **Acceptance:** Async data does not shift important controls. **Required verification:** CLS and slow-server traces. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0091/0160/0183 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation Not started; Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
