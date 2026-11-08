# ADR-0202 — Editorial display type and precision numeric typography

- **Decision:** Proposed (owner acceptance pending).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Visual system.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0091/0130/0160; no historical status is changed.
- **Existing source touchpoints:** web/src/styles/tokens.css; web/src/views/Now.tsx; web/src/views/Library.tsx.

## Context and evidence boundary

Introduce distinct typography for artist/song identity, UI explanations and technical music time. Preserve Unicode and reflow. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Introduce distinct typography for artist/song identity, UI explanations and technical music time. Preserve Unicode and reflow. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

No font that causes unacceptable layout shift, clipped titles or obscure cue controls. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0202-01 — Choose display/editorial/interface/technical roles.** **Acceptance:** Type functions and sizes explicit. **Required verification:** Specimen review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0202-02 — Define responsive scale.** **Acceptance:** Titles legible across widths and zoom. **Required verification:** 320–2560 and 400% screenshots. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0202-03 — Specify tabular numeric rules.** **Acceptance:** Times/BPM/bars align and show units. **Required verification:** Numeric regression fixture. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0202-04 — Stress long and RTL metadata.** **Acceptance:** Controls never occluded by names. **Required verification:** Unicode content tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0202-05 — Document truncation behavior.** **Acceptance:** Full identity available by keyboard and touch. **Required verification:** AT and interaction checks. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0202-06 — Minimise font-loading cost.** **Acceptance:** Offline fallbacks stable. **Required verification:** Cold-load trace. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0202-07 — Refine line height and rhythm.** **Acceptance:** Dialog and information copy comfortable. **Required verification:** Reading study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0202-08 — Approve both-theme type consistency.** **Acceptance:** Typography remains expressive and accessible. **Required verification:** Design sign-off. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0091/0130/0160 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Proposed; Implementation Not started; Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
