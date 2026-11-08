# ADR-0222 - Intended versus achieved Energy Horizon composition

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Create.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0143/0169/0173; no earlier status changed.
- **Existing source touchpoints:** web/src/ui/MusicObjects.tsx; web/src/views/MixSetup.tsx.

## Context and evidence boundary

Make five-point energy shaping tactile and precise, while separating user-requested curve from optional genuine measured energy or unknown data. Earlier ADRs and code may already implement significant functionality, but no new task is marked complete without exact acceptance and evidence. This is a proposed artistic delta, not source implementation, visual sign-off or real-audio approval.

## Proposed decision

Make five-point energy shaping tactile and precise, while separating user-requested curve from optional genuine measured energy or unknown data. Retain all current usable controls with intentional grouping, exact stable musical object identities, recoverable errors and local-only data. An expressive layout must never imply a new audio-engine capability.

## Visual, animation and microinteraction contract

- One first-glance object and action plus discoverable expert options, accurate editable versus committed scope and visible pending outcomes.
- Illustrative graphics and confirmed data remain distinguishable in every visual mode and accessibility description.
- Motion only follows user gestures or real audio/status events, with full reduced-motion, touch, keyboard and screen-reader parity.
- Audio playback, paused state and authoritative mix revisions cannot change as a side effect of inspecting or navigating.

## Alternatives, trade-offs and limits

No promise that a requested arc will be exactly heard and no incomparable scales overlaid. Reject ungrounded decoration, forced transitions and high-fidelity effects that starve the player. This ADR does not authorize SaaS, remote upload, telemetry or new backend logic without its own decision and tests.

## Implementation checklist - 0/8 Implemented, 0/8 Verified

1. **SF-0222-01 - Document energy provenance.** **Acceptance:** Intent, measured and absent data typed. **Required verification:** Schema audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0222-02 - Redesign five-stop gesture.** **Acceptance:** Pointer/touch updates precise repeatable stops. **Required verification:** Value tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0222-03 - Preserve exact keyboard controls.** **Acceptance:** Every stop reachable with known value. **Required verification:** AT and zoom tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0222-04 - Create reversible presets.** **Acceptance:** Preset shape transparent and undoable. **Required verification:** Preset mapping test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0222-05 - Distinctly draw measured journey.** **Acceptance:** Measured data labeled with scale and uncertainty. **Required verification:** Data/graphic fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0222-06 - Guard settings scope.** **Acceptance:** Current edit, draft and default never conflated. **Required verification:** Persistence E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0222-07 - Profile editing performance.** **Acceptance:** Dragging does not hurt audio playback. **Required verification:** Frame trace. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0222-08 - Test musical comprehension.** **Acceptance:** Users interpret rise/drop and uncertainty correctly. **Required verification:** Novice/DJ study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve single audio owner, intentional Pause, original media and local privacy, accurate LRCLIB metadata disclosure, current/draft revisions and scoped Undo, exact song/seam IDs, consented atomic request bridge, all eight Studio stem lanes and 8–64 cells with local recovery, truthful library readiness, blind listening neutrality and frozen-revision decodable FLAC. Include stale/failed/slow operations, absent media, duplicate songs, keyboard/touch/zoom/RTL, forced-colors/reduced motion and real-audio cases where relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0143/0169/0173 and new foundation ADR-0198/0199, plus shared visual system.
- **Next:** owner decision → prototype/critique → targeted implementation PR with tests → independent human/AT/real-audio/performance evidence → GO/NO-GO.
- **Now:** Accepted, 0/8 Implemented, 0/8 independently Verified; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
