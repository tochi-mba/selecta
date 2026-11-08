# ADR-0236 — Modular frontend visual architecture and safe migration seams

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Architecture.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0092/0164/0184; previous task/status evidence remains unchanged.
- **Existing source touchpoints:** web/src/App.tsx; web/src/shell/Shell.tsx; web/src/views/Now.tsx; web/src/styles/tokens.css.

## Context and evidence boundary

Refactor only where needed: isolate scene presentation, data provenance, player ownership, music objects and CSS responsibilities. Keep existing APIs and local server contracts stable, with small reversible implementation PRs. Source-level capabilities, this planning decision, code tests and independent acceptance are separate. Historical evidence remains at its original snapshot until separately reconciled against a future implementation SHA.

## Proposed decision

Refactor only where needed: isolate scene presentation, data provenance, player ownership, music objects and CSS responsibilities. Keep existing APIs and local server contracts stable, with small reversible implementation PRs. Keep one coherent audio-state truth and intentional user control. Require explicit source provenance and measurable acceptance for every interactive, accessibility and visual change.

## Visual, animation and microinteraction contract

- Every critical action remains discoverable, keyboard/touch operable and reversible where the backend permits.
- Planned versus prepared versus committed versus playing or failed states remain distinct with static and assistive-tech equivalents.
- All motion is causal, optional and non-blocking; the player and exact edit revisions win over display rendering.
- Design for both themes, high zoom, forced colors, reduced motion, long/RTL names, offline and slow/failed requests.

## Alternatives and trade-offs

No wholesale rewrite hiding regressions, no duplicated player state or source file beyond repository size limits. A new artistic effect is rejected if it reduces musical accuracy, accessibility, local privacy, performance or intelligible recovery. No production code or SaaS capability is authorized by a documentation-only ADR.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0236-01 — Map ownership boundaries.** **Acceptance:** Transport, route, scene, library and editor each have one owner. **Required verification:** Module dependency graph. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0236-02 — Define component seams.** **Acceptance:** Shared tokens/primitives avoid cross-screen coupling. **Required verification:** Architecture review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0236-03 — Separate state and presentation.** **Acceptance:** Actual domain status remains source-of-truth. **Required verification:** Type/API tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0236-04 — Plan CSS consolidation.** **Acceptance:** Tokens and page modules replace brittle overrides incrementally. **Required verification:** Cascade audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0236-05 — Preserve route and API contracts.** **Acceptance:** Existing deep links and endpoint shapes remain compatible. **Required verification:** Contract E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0236-06 — Enforce source maintainability.** **Acceptance:** Code files under repo limit with coherent tests. **Required verification:** CI file-size and review checks. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0236-07 — Define reversible feature rollout.** **Acceptance:** New view can fall back without data migration. **Required verification:** Rollback test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0236-08 — Plan future-proof boundaries only.** **Acceptance:** Local data/storage interfaces do not add SaaS features. **Required verification:** Architecture acceptance review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and negative cases

Single player and intentional Pause; unchanged local music and explicit LRCLIB metadata disclosure; exact current/draft revisions and scoped Undo; stable song and seam IDs; consented atomic bridges; all eight stem lanes and 8–64 cells with recovery; truthful Library readiness; neutral blind research; and exact frozen-revision decodable FLAC remain protected. Verify slow/stale/offline/failure cases, multi-tab, touch, 320–2560px, 400% zoom, forced colors, reduced motion, NVDA/Edge and real-audio operation as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0092/0164/0184; new ADR-0198/0199 and previous programme acceptance records.
- **Next:** dated owner decision → design specimens → small code/test PR → separate independent human/AT/audio/performance report → explicit release gate.
- **Now:** Accepted; 0/8 Implemented, 0/8 independently Verified; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
