# ADR-0235 — Audio-first performance and power-aware artistic rendering

- **Decision:** Proposed; explicit owner acceptance is pending.
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Quality.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0162/0183/0029; previous task/status evidence remains unchanged.
- **Existing source touchpoints:** web/src/views/Now.tsx; web/src/views/spectrumVisuals.ts; web/src/views/Library.tsx.

## Context and evidence boundary

Audio decoding, playback and seamless transitions take priority over canvas effects, charts, thumbnails and layout transitions. Treat INP, LCP and CLS as measurable targets and set hardware-specific visual budgets. Source-level capabilities, this planning decision, code tests and independent acceptance are separate. Historical evidence remains at its original snapshot until separately reconciled against a future implementation SHA.

## Proposed decision

Audio decoding, playback and seamless transitions take priority over canvas effects, charts, thumbnails and layout transitions. Treat INP, LCP and CLS as measurable targets and set hardware-specific visual budgets. Keep one coherent audio-state truth and intentional user control. Require explicit source provenance and measurable acceptance for every interactive, accessibility and visual change.

## Visual, animation and microinteraction contract

- Every critical action remains discoverable, keyboard/touch operable and reversible where the backend permits.
- Planned versus prepared versus committed versus playing or failed states remain distinct with static and assistive-tech equivalents.
- All motion is causal, optional and non-blocking; the player and exact edit revisions win over display rendering.
- Design for both themes, high zoom, forced colors, reduced motion, long/RTL names, offline and slow/failed requests.

## Alternatives and trade-offs

No power-draining hidden effects, work on the audio thread, uncontrolled canvas allocations or unmeasured performance claims. A new artistic effect is rejected if it reduces musical accuracy, accessibility, local privacy, performance or intelligible recovery. No production code or SaaS capability is authorized by a documentation-only ADR.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0235-01 — Baseline real devices.** **Acceptance:** Record OS, browser, cores, memory and real media. **Required verification:** Reproducible trace register. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0235-02 — Define input and layout budgets.** **Acceptance:** Target p75 INP at most 200ms and low CLS where applicable. **Required verification:** Web vitals capture. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0235-03 — Profile visualizer loads.** **Acceptance:** Adaptive frames, device pixel ratio and visibility handling. **Required verification:** CPU/GPU profiling. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0235-04 — Stress analysis plus playback.** **Acceptance:** No audible dropout during background render load. **Required verification:** Real-audio observation. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0235-05 — Stress 20k-song Library.** **Acceptance:** Search and paging remain responsive. **Required verification:** 20k fixture and heap trace. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0235-06 — Stress 100-song editor.** **Acceptance:** Reorder and inspection stay interactive. **Required verification:** 100-song browser test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0235-07 — Stress 64-cell Studio.** **Acceptance:** Painting remains responsive and audio focus stable. **Required verification:** 64-cell recording. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0235-08 — Gate degraded motion automatically.** **Acceptance:** Low-power fallback preserves information. **Required verification:** Forced throttle and device review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and negative cases

Single player and intentional Pause; unchanged local music and explicit LRCLIB metadata disclosure; exact current/draft revisions and scoped Undo; stable song and seam IDs; consented atomic bridges; all eight stem lanes and 8–64 cells with recovery; truthful Library readiness; neutral blind research; and exact frozen-revision decodable FLAC remain protected. Verify slow/stale/offline/failure cases, multi-tab, touch, 320–2560px, 400% zoom, forced colors, reduced motion, NVDA/Edge and real-audio operation as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0162/0183/0029; new ADR-0198/0199 and previous programme acceptance records.
- **Next:** dated owner decision → design specimens → small code/test PR → separate independent human/AT/audio/performance report → explicit release gate.
- **Now:** Proposed; 0/8 Implemented, 0/8 independently Verified; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
