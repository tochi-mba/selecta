# ADR-0237 - Shared data provenance and authoritative music-state truth

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Architecture.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0166/0170/0172/0175; previous task/status evidence remains unchanged.
- **Existing source touchpoints:** web/src/state/readiness.ts; web/src/ui/MusicObjects.tsx; web/src/player.ts.

## Context and evidence boundary

Every visible musical graphic must identify whether it is decorative, requested, discovered, measured, rendered, applied, previewed or playing. Consolidate truth mapping without inventing backend facts. Source-level capabilities, this planning decision, code tests and independent acceptance are separate. Historical evidence remains at its original snapshot until separately reconciled against a future implementation SHA.

## Proposed decision

Every visible musical graphic must identify whether it is decorative, requested, discovered, measured, rendered, applied, previewed or playing. Consolidate truth mapping without inventing backend facts. Keep one coherent audio-state truth and intentional user control. Require explicit source provenance and measurable acceptance for every interactive, accessibility and visual change.

## Visual, animation and microinteraction contract

- Every critical action remains discoverable, keyboard/touch operable and reversible where the backend permits.
- Planned versus prepared versus committed versus playing or failed states remain distinct with static and assistive-tech equivalents.
- All motion is causal, optional and non-blocking; the player and exact edit revisions win over display rendering.
- Design for both themes, high zoom, forced colors, reduced motion, long/RTL names, offline and slow/failed requests.

## Alternatives and trade-offs

No guessed beat, cover, harmonic fit, exact lyric word, render percentage, track availability or successful mutation. A new artistic effect is rejected if it reduces musical accuracy, accessibility, local privacy, performance or intelligible recovery. No production code or SaaS capability is authorized by a documentation-only ADR.

## Implementation checklist - 0/8 Implemented, 0/8 Verified

1. **SF-0237-01 - Enumerate provenance types.** **Acceptance:** All musical objects have declared authority and uncertainty. **Required verification:** Domain schema audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0237-02 - Map current readiness states.** **Acceptance:** Song, seam, stem and job conditions use canonical values. **Required verification:** API and fixture tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0237-03 - Define visual-state contracts.** **Acceptance:** Cards, lines and badges never mix plan with real status. **Required verification:** Design state matrix. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0237-04 - Handle unknown explicitly.** **Acceptance:** Missing values display unknown instead of fake estimates. **Required verification:** Null fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0237-05 - Bind exact object identity.** **Acceptance:** Occurrence, seam and revision stable through async work. **Required verification:** Race and duplicate ID tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0237-06 - Design AT descriptions.** **Acceptance:** Readiness accessible without colors or diagrams. **Required verification:** NVDA inspection. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0237-07 - Test errors and fallback semantics.** **Acceptance:** Failed render and technique fallback visible. **Required verification:** Error fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0237-08 - Validate user comprehension.** **Acceptance:** Novices distinguish prepared versus playing versus requested. **Required verification:** Uncoached status study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Single player and intentional Pause; unchanged local music and explicit LRCLIB metadata disclosure; exact current/draft revisions and scoped Undo; stable song and seam IDs; consented atomic bridges; all eight stem lanes and 8–64 cells with recovery; truthful Library readiness; neutral blind research; and exact frozen-revision decodable FLAC remain protected. Verify slow/stale/offline/failure cases, multi-tab, touch, 320–2560px, 400% zoom, forced colors, reduced motion, NVDA/Edge and real-audio operation as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0166/0170/0172/0175; new ADR-0198/0199 and previous programme acceptance records.
- **Next:** dated owner decision → design specimens → small code/test PR → separate independent human/AT/audio/performance report → explicit release gate.
- **Now:** Accepted; 0/8 Implemented, 0/8 independently Verified; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
