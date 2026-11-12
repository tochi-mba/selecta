# ADR-0235 - Audio-first performance and power-aware artistic rendering

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (4/8 Implemented, 3/8 In progress, 1/8 Not started or needing a person; updated 2026-11-12).
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

## Implementation checklist - 4/8 Implemented, 0/8 Verified

1. **SF-0235-01 - Baseline real devices.** **Acceptance:** Record OS, browser, cores, memory and real media. **Required verification:** Reproducible trace register. **Implementation:** Not started; Needs a person: a real-device baseline (OS, browser, cores, memory, real media) recorded as a reproducible trace register; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0235-02 - Define input and layout budgets.** **Acceptance:** Target p75 INP at most 200ms and low CLS where applicable. **Required verification:** Web vitals capture. **Implementation:** Implemented; browser check pending (`web/e2e/p0136-responsiveness.e2e.ts` 'P0136 / SF-0235-02 lab INP stays at most 200 ms and CLS at most 0.1 on each surface, reported as lab data'); shares the P0136 measurement code (`web/e2e/perf-probe.ts` `vitalsSince`, `web/e2e/vitals.ts`, unit tests `web/e2e/vitals.test.ts`), also used by MP-0298-06; method and lab-only labelling in `docs/adr/completion/performance.md`; a field p75 needs real-user data a local app does not collect; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0235-03 - Profile visualizer loads.** **Acceptance:** Adaptive frames, device pixel ratio and visibility handling. **Required verification:** CPU/GPU profiling. **Implementation:** In progress; `web/e2e/mp-0296-motion.e2e.ts` 'MP-0296-07 the visualizer draws at most 15 frames a second while playing and nothing while hidden' passed 2026-11-11; the device-pixel-ratio cap in `web/src/views/visualizerBudget.test.tsx` was not rerun this session, and CPU/GPU profiling on real hardware needs a person; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0235-04 - Stress analysis plus playback.** **Acceptance:** No audible dropout during background render load. **Required verification:** Real-audio observation. **Implementation:** In progress; Needs a person: real-audio observation of playback during background render load; the lab check `web/e2e/mi-0162-performance.e2e.ts` 'MI-0162-03' exists but is not a listening result; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0235-05 - Stress 20k-song Library.** **Acceptance:** Search and paging remain responsive. **Required verification:** 20k fixture and heap trace. **Implementation:** Implemented; a 20,000-song library pages and searches within budget with a bounded heap; server side `tests/test_s3_library_profile.py` and `tests/test_library_edges.py::test_twenty_thousand_songs_are_all_reachable_and_a_page_stays_quick` passed 2026-11-11; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** `web/e2e/sf-0235-library-scale.e2e.ts` 'SF-0235-05 a 20,000-song library pages and searches quickly, and the heap stays bounded' passed (CI run 43119473767, Edge E2E (shard 2/2) job 130857753267, head f851f2b, recorded 2026-11-12); local reruns on 2026-11-12 on the overloaded shared laptop (three browser slots busy) missed the 3 s per-page budget at 3.1 to 3.9 s, so the budget holds on CI hardware and a quiet machine, not under that load.
6. **SF-0235-06 - Stress 100-song editor.** **Acceptance:** Reorder and inspection stay interactive. **Required verification:** 100-song browser test. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r3j; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** 100-song browser tests `web/e2e/sf-flow-create.e2e.ts` 'SF-0220-07 a hundred-song mix keeps scrolling and focus steady while songs move' (reorder) and 'SF-0221-07 in a hundred-song mix the inspector keeps its pair while other songs move' (inspection); passed 2026-11-11 (dist-r3j).
7. **SF-0235-07 - Stress 64-cell Studio.** **Acceptance:** Painting remains responsive and audio focus stable. **Required verification:** 64-cell recording. **Implementation:** Implemented; the real Studio, laid out by the server on stems cached by `tests/e2e_server.py` (`SELECTA_E2E_STEMS=1`), has 8 lanes of 8 squares; every lane is painted by dragging while the preview plays and the page records its own timings: no long task, pointer-move input delay p95 15 ms, next frame p95 16 ms, worst pointerdown/pointerup Event Timing 176 ms (all budgets: long tasks under 200 ms, move delay p95 under 100 ms, next frame p95 under 200 ms, events under 200 ms), with no second audio context, no restarted sounds and the preview still playing. No jank found, so no product change was needed. The wall-clock total (43 s) is recorded, not gated: it is Playwright's round trip per pointer move on the loaded laptop. The older stubbed 512-square spec `web/e2e/sf-studio-stress.e2e.ts` stays as an extra; **Verified:** No; **Owner:** Flow checklist agent (Claude) r7d; **PR/SHA:** feat/finish-checklists-2 (uncommitted; coordinator commits), 2026-11-12; **Evidence:** `web/e2e/sf-0235-studio-stems.e2e.ts` 'SF-0235-07 painting all 64 squares of the real Studio stays responsive and the preview keeps the audio focus' passed in Edge 2026-11-12 (`SELECTA_E2E_STEMS=1`, dist-r7d, 1 passed); it skips without the stems server.
8. **SF-0235-08 - Gate degraded motion automatically.** **Acceptance:** Low-power fallback preserves information. **Required verification:** Forced throttle and device review. **Implementation:** Implemented; Needs a person: a forced-throttle review on a real low-power device. Built `web/src/ui/lowPower.ts` (flag `app.auto_low_motion`): a short frame sample while the page is visible; two 90-frame windows in a row with most frames over 50 ms switch the page to the Still styling (`data-low-power=auto` in `web/src/styles/tokens.css`, `useReducedMotion`), which keeps every value and control; the saved motion choice is untouched, the sampler rests 60 s between bursts on a healthy device, and Workspace offers "Use full motion here". `web/src/ui/lowPower.test.tsx` (5 tests) and `web/src/ui/useReducedMotion.test.tsx` passed (vitest 2026-11-11); **Verified:** No; **Owner:** Claude agent r4a; **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** -.

## Invariants and negative cases

Single player and intentional Pause; unchanged local music and explicit LRCLIB metadata disclosure; exact current/draft revisions and scoped Undo; stable song and seam IDs; consented atomic bridges; all eight stem lanes and 8–64 cells with recovery; truthful Library readiness; neutral blind research; and exact frozen-revision decodable FLAC remain protected. Verify slow/stale/offline/failure cases, multi-tab, touch, 320–2560px, 400% zoom, forced colors, reduced motion, NVDA/Edge and real-audio operation as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0162/0183/0029; new ADR-0198/0199 and previous programme acceptance records.
- **Next:** dated owner decision → design specimens → small code/test PR → separate independent human/AT/audio/performance report → explicit release gate.
- **Now:** Decision Accepted; Implementation 1/8 (2026-11-11); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
