# ADR-0239 — Automated regression strategy and visual-evidence governance

- **Decision:** Proposed; explicit owner acceptance is pending.
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Verification.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0164/0184/0029; previous task/status evidence remains unchanged.
- **Existing source touchpoints:** web/playwright.config.ts; web/e2e/visual.e2e.ts; web/e2e/creative-visualizers.e2e.ts.

## Context and evidence boundary

Expand source-level unit, interaction E2E and screenshot candidates to cover new visual states while explicitly separating captured screenshots, test passes, independent audio and human approvals. Source-level capabilities, this planning decision, code tests and independent acceptance are separate. Historical evidence remains at its original snapshot until separately reconciled against a future implementation SHA.

## Proposed decision

Expand source-level unit, interaction E2E and screenshot candidates to cover new visual states while explicitly separating captured screenshots, test passes, independent audio and human approvals. Keep one coherent audio-state truth and intentional user control. Require explicit source provenance and measurable acceptance for every interactive, accessibility and visual change.

## Visual, animation and microinteraction contract

- Every critical action remains discoverable, keyboard/touch operable and reversible where the backend permits.
- Planned versus prepared versus committed versus playing or failed states remain distinct with static and assistive-tech equivalents.
- All motion is causal, optional and non-blocking; the player and exact edit revisions win over display rendering.
- Design for both themes, high zoom, forced colors, reduced motion, long/RTL names, offline and slow/failed requests.

## Alternatives and trade-offs

No snapshot update that masks a real functional break, no CI-only audio quality claims and no doctored baselines. A new artistic effect is rejected if it reduces musical accuracy, accessibility, local privacy, performance or intelligible recovery. No production code or SaaS capability is authorized by a documentation-only ADR.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0239-01 — Map existing tests to new tasks.** **Acceptance:** Every task has relevant automated and independent evidence gap. **Required verification:** Test crosswalk. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0239-02 — Build stable visual fixtures.** **Acceptance:** Light/dark, no-data, errors, loading and sizes captured. **Required verification:** Deterministic screenshot runs. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0239-03 — Protect audio ownership E2E.** **Acceptance:** Theme, scene, preview and route changes never duplicate player. **Required verification:** Real-browser counter tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0239-04 — Test revision and request contracts.** **Acceptance:** Optimistic edits, conflicts and bridge consent resilient. **Required verification:** API stubs and integration tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0239-05 — Specify a11y automation.** **Acceptance:** Contrast, labels, focus and reduced motion checked where possible. **Required verification:** Automated audit plus manual gap. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0239-06 — Define exact screenshot approval.** **Acceptance:** Candidates not considered golden until signed review. **Required verification:** Evidence manifest checks. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0239-07 — Build low-power stress suites.** **Acceptance:** Live playback during analysis and render measured. **Required verification:** Hardware logs. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0239-08 — Require per-PR evidence record.** **Acceptance:** SHA, fixture, reviewer and unresolved findings attached. **Required verification:** CI and independent sign-off checklist. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and negative cases

Single player and intentional Pause; unchanged local music and explicit LRCLIB metadata disclosure; exact current/draft revisions and scoped Undo; stable song and seam IDs; consented atomic bridges; all eight stem lanes and 8–64 cells with recovery; truthful Library readiness; neutral blind research; and exact frozen-revision decodable FLAC remain protected. Verify slow/stale/offline/failure cases, multi-tab, touch, 320–2560px, 400% zoom, forced colors, reduced motion, NVDA/Edge and real-audio operation as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0164/0184/0029; new ADR-0198/0199 and previous programme acceptance records.
- **Next:** dated owner decision → design specimens → small code/test PR → separate independent human/AT/audio/performance report → explicit release gate.
- **Now:** Proposed; 0/8 Implemented, 0/8 independently Verified; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
