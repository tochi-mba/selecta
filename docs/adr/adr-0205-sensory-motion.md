# ADR-0205 - Causal motion and Still/Subtle/Expressive intensity

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (7/8 Implemented, 0/8 In progress, 1/8 Not started; 2026-11-11).
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

## Implementation checklist - 7/8 Implemented, 0/8 Verified

1. **SF-0205-01 - Inventory animations and owners.** **Acceptance:** Triggers and data authority recorded. **Required verification:** Source and video audit. **Implementation:** Implemented; every animation, its trigger, token and Still/reduced-motion behaviour is listed in docs/engineering/motion-inventory.md, and a test refuses unlisted durations or keyframes; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/styles/motion-tokens.test.ts` (ADR-296, passed 2026-11-10); `docs/engineering/motion-inventory.md`.
2. **SF-0205-02 - Define timing/easing grammar.** **Acceptance:** Short feedback and scene transitions coherent. **Required verification:** Motion gallery. **Implementation:** Implemented; durations and easings are motion tokens with named purposes, and stylesheets may not use others; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/styles/motion-tokens.test.ts`; `web/e2e/motion-preference.e2e.ts`; run 2026-11-10.
3. **SF-0205-03 - Add sensory intensity setting.** **Acceptance:** Still/Subtle/Expressive saved locally. **Required verification:** Preference E2E. **Implementation:** Implemented; Still, Subtle and Expressive are saved in this browser and change the motion tokens; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/motion-preference.e2e.ts` 'motion intensity is local and OS reduced-motion always wins'; `web/src/views/Now.test.tsx` 'keeps visual intensity independent from playback and remembers the choice'; run 2026-11-10.
4. **SF-0205-04 - Honor reduced-motion priority.** **Acceptance:** OS reduce overrides nonessential effects. **Required verification:** Emulation and visual inspection. **Implementation:** Implemented; the OS reduced-motion setting overrides Expressive and nothing moves by itself; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/useReducedMotion.test.tsx` 'honours the operating system even when Expressive is selected'; `web/e2e/finishing.e2e.ts` 'with reduced motion nothing keeps moving by itself, on any page'; run 2026-11-10.
5. **SF-0205-05 - Bind musical movement to audio.** **Acceptance:** Handoff and analyzer use real clocks/samples. **Required verification:** Audio/video timing review. **Implementation:** Implemented; the spectrum draws only sampled analyser bins and the hand-off is scheduled on the audio clock; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/views/spectrumVisuals.test.ts` (16 tests); `web/e2e/listen.e2e.ts` 'Play makes real sound, on a clock that really moves', 'a transition takes over exactly where it was planned, with no gap'; run 2026-11-10.
6. **SF-0205-06 - Handle interruptions.** **Acceptance:** Fast navigation/escape settle correctly. **Required verification:** Race E2E. **Implementation:** Implemented; fast navigation, rapid Next/Previous and Escape from Stage settle on the right state; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/listen.e2e.ts` 'Next and Previous go song by song, however fast they're pressed'; `web/e2e/integration.e2e.ts` 'a hundred quick looks at a page never lose what's on it'; `web/e2e/finishing.e2e.ts` 'fullscreen refused: ... Escape gets out, focus comes back'; run 2026-11-10.
7. **SF-0205-07 - Budget render and power cost.** **Acceptance:** Stop hidden loops, cap expensive effects. **Required verification:** Real hardware profiler. **Implementation:** Implemented; the Listen spectrum stops its frame loop while the tab is hidden or the canvas is off screen, draws at most about 15 frames a second, caps the backing store at 2x device pixels and reuses its gradient, and polling pauses when hidden; the real-hardware CPU/GPU and power profile is the independent check (Needs a person); **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** `web/src/views/visualizerBudget.test.tsx` 'draws at most about 15 frames a second however fast the display refreshes', 'stops its loop while the tab is hidden and starts again when it comes back', 'caps the backing store at twice the CSS size and reuses one gradient', 'cancels its frame when Listen goes away' (4 passed 2026-11-11); `web/src/ui/useVisiblePoll.test.tsx` (polling pauses when hidden, passed 2026-11-10).
8. **SF-0205-08 - Validate comfort and delight.** **Acceptance:** User benefits not outweighed by distraction. **Required verification:** Counterbalanced participant study. **Implementation:** Not started; Needs a person: a counterbalanced participant study of comfort and delight; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0137/0182/0161 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation 7/8 (2026-11-11); Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
