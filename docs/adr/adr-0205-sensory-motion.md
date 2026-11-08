# ADR-0205 - Causal motion and Still/Subtle/Expressive intensity

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Motion.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0137/0182/0161; no historical status is changed.
- **Existing source touchpoints:** web/src/styles/tokens.css; web/src/views/Now.tsx.

## Context and evidence boundary

Motion must communicate actual music, action consequences or navigation continuity. Design stillness as a first-class option and respect OS settings. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Motion must communicate actual music, action consequences or navigation continuity. Design stillness as a first-class option and respect OS settings. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

No fake beat pulse, strobe, surprise sound, moving hit targets or animated delay on Pause. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist - 0/8 Implemented, 0/8 Verified

1. **SF-0205-01 - Inventory animations and owners.** **Acceptance:** Triggers and data authority recorded. **Required verification:** Source and video audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0205-02 - Define timing/easing grammar.** **Acceptance:** Short feedback and scene transitions coherent. **Required verification:** Motion gallery. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0205-03 - Add sensory intensity setting.** **Acceptance:** Still/Subtle/Expressive saved locally. **Required verification:** Preference E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0205-04 - Honor reduced-motion priority.** **Acceptance:** OS reduce overrides nonessential effects. **Required verification:** Emulation and visual inspection. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0205-05 - Bind musical movement to audio.** **Acceptance:** Handoff and analyzer use real clocks/samples. **Required verification:** Audio/video timing review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0205-06 - Handle interruptions.** **Acceptance:** Fast navigation/escape settle correctly. **Required verification:** Race E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0205-07 - Budget render and power cost.** **Acceptance:** Stop hidden loops, cap expensive effects. **Required verification:** Real hardware profiler. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0205-08 - Validate comfort and delight.** **Acceptance:** User benefits not outweighed by distraction. **Required verification:** Counterbalanced participant study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0137/0182/0161 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation Not started; Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
