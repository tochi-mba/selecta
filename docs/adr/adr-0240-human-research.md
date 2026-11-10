# ADR-0240 - Independent listening research and artistic quality acceptance

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 0/8 In progress, 3/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Verification.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0164/0184/0021; previous task/status evidence remains unchanged.
- **Existing source touchpoints:** docs/acceptance.md; web/e2e/visual.e2e.ts; docs/research/ui-ux.md.

## Context and evidence boundary

Test the full journey with uncoached listeners, creators and DJs. Qualitative delight is distinct from comprehension and technical correctness. Real music quality requires human listening on actual rendered tracks. Source-level capabilities, this planning decision, code tests and independent acceptance are separate. Historical evidence remains at its original snapshot until separately reconciled against a future implementation SHA.

## Proposed decision

Test the full journey with uncoached listeners, creators and DJs. Qualitative delight is distinct from comprehension and technical correctness. Real music quality requires human listening on actual rendered tracks. Keep one coherent audio-state truth and intentional user control. Require explicit source provenance and measurable acceptance for every interactive, accessibility and visual change.

## Visual, animation and microinteraction contract

- Every critical action remains discoverable, keyboard/touch operable and reversible where the backend permits.
- Planned versus prepared versus committed versus playing or failed states remain distinct with static and assistive-tech equivalents.
- All motion is causal, optional and non-blocking; the player and exact edit revisions win over display rendering.
- Design for both themes, high zoom, forced colors, reduced motion, long/RTL names, offline and slow/failed requests.

## Alternatives and trade-offs

No confounded blind A/B, self-certified screenshot, unreported sample size or assertion of completed studies. A new artistic effect is rejected if it reduces musical accuracy, accessibility, local privacy, performance or intelligible recovery. No production code or SaaS capability is authorized by a documentation-only ADR.

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0240-01 - Define listener journey scripts.** **Acceptance:** First run, first play, first handoff covered. **Required verification:** Uncoached research protocol. **Implementation:** Implemented; listener scripts L1 to L5 cover first run, first play, pause and resume, first handoff and lyrics, uncoached, with Done criteria; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/research/flow-research-protocol.md` Listener journey scripts; `tests/test_flow_cross_cutting.py` 'test_the_research_protocol_covers_each_journey_and_keeps_joy_apart' (passed 2026-11-10).
2. **SF-0240-02 - Define creator journey scripts.** **Acceptance:** Shape, reorder, audition, Studio and export covered. **Required verification:** Task outcome forms. **Implementation:** Implemented; creator scripts C1 to C6 cover shape, reorder, audition, Studio, Undo and export, with a task outcome form; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/research/flow-research-protocol.md` Creator journey scripts and Task outcome form; `tests/test_flow_cross_cutting.py` 'test_the_research_protocol_covers_each_journey_and_keeps_joy_apart' (passed 2026-11-10).
3. **SF-0240-03 - Define DJ expert review.** **Acceptance:** Real technique, cue and handoff precision assessed. **Required verification:** Recorded expert feedback. **Implementation:** Not started; Needs a person: a DJ expert review with recorded feedback on technique, cue and handoff precision; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0240-04 - Define accessibility participant testing.** **Acceptance:** AT and motion preferences included. **Required verification:** Named environment and protocol. **Implementation:** Implemented; named environments (NVDA with Edge, keyboard only, forced colours, reduced motion, phone with large text) and the tasks and extra fields for access sessions; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/research/flow-research-protocol.md` Accessibility participant sessions; `tests/test_flow_cross_cutting.py` (passed 2026-11-10).
5. **SF-0240-05 - Protect blind comparison neutrality.** **Acceptance:** No visual/source labels leak treatment condition. **Required verification:** Neutral A/B review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0240-06 - Separate joy from correctness.** **Acceptance:** Ratings and measured task errors reported separately. **Required verification:** Analysis plan. **Implementation:** Implemented; correctness (outcome and time) and delight are recorded and reported separately and never combined into one score; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/research/flow-research-protocol.md` Joy kept apart from correctness; `tests/test_flow_cross_cutting.py` (passed 2026-11-10).
7. **SF-0240-07 - Record reproducible findings.** **Acceptance:** Denominator, hardware, SHA and fixtures accompany claims. **Required verification:** Review dossier. **Implementation:** Implemented; every finding carries denominator, exact SHA, fixture, hardware and evidence, and stays an observation until accepted; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/research/flow-research-protocol.md` Reproducible findings; `tests/test_flow_cross_cutting.py` (passed 2026-11-10).
8. **SF-0240-08 - Specify approval and rejection criteria.** **Acceptance:** P0 blocks and P1 thresholds explicit before testing. **Required verification:** Owner and independent reviewer decision. **Implementation:** Not started; Needs a person: the owner and an independent reviewer approving P0 and P1 thresholds before testing; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Single player and intentional Pause; unchanged local music and explicit LRCLIB metadata disclosure; exact current/draft revisions and scoped Undo; stable song and seam IDs; consented atomic bridges; all eight stem lanes and 8–64 cells with recovery; truthful Library readiness; neutral blind research; and exact frozen-revision decodable FLAC remain protected. Verify slow/stale/offline/failure cases, multi-tab, touch, 320–2560px, 400% zoom, forced colors, reduced motion, NVDA/Edge and real-audio operation as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0164/0184/0021; new ADR-0198/0199 and previous programme acceptance records.
- **Next:** dated owner decision → design specimens → small code/test PR → separate independent human/AT/audio/performance report → explicit release gate.
- **Now:** Decision Accepted; Implementation 5/8 (2026-11-10); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
