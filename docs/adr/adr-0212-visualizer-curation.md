# ADR-0212 — Curation and visual refinement of fifteen existing spectrum styles

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Listen.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0185–0197/0170/0162; prior statuses unchanged.
- **Existing source touchpoints:** web/src/views/spectrumVisuals.ts; web/src/views/Now.tsx.

## Context and evidence boundary

Preserve all fifteen currently source-present live-spectrum modes while curating signature and optional groups, and measuring actual render power. These are new design acceptance criteria, not proof that similar functionality does not already exist. Source-level implementation, automated tests, independent human review and musical acceptance remain distinct.

## Proposed decision

Preserve all fifteen currently source-present live-spectrum modes while curating signature and optional groups, and measuring actual render power. Preserve a reliable, local-first instrument underneath any new art direction. Keep current versus draft context, exact song/seam IDs, authoritative analysis, single player ownership and transparent pending operations.

## Visual, animation and microinteraction contract

- Music leads; one obvious primary object/action with discoverable precision controls.
- Distinguish decorative visuals, requested intentions, measured states, render-complete artifacts and actual playback.
- Causal, optional, interruptible motion with reduced-motion and textual equivalents; never delay Pause, cancel or Undo.
- Every state has keyboard, touch, focus, high-contrast and screen-reader affordances where meaningful.

## Alternatives and trade-offs

Do not count visualizer feature implementation as a newly unimplemented task or falsely claim test approval. Reject spectacle when it costs accessibility, audio continuity or task comprehension. This ADR approves no new SaaS, login, account, cloud upload, telemetry, audio engine rewrite or code change by itself.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0212-01 — Audit existing modes.** **Acceptance:** Exact real-frequency mapping recorded. **Required verification:** Spectrum source review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0212-02 — Refine brand coherence.** **Acceptance:** All modes have intentional palette and composition. **Required verification:** Screen gallery. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0212-03 — Curate selector groups.** **Acceptance:** Signature and specialist modes findable. **Required verification:** Preference study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0212-04 — Define honest silence.** **Acceptance:** Zero input remains quiet and static. **Required verification:** Silence fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0212-05 — Preserve transport on switch.** **Acceptance:** No pause, seek or restart by visual choice. **Required verification:** Audio-owner tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0212-06 — Budget visual performance.** **Acceptance:** Loop stops hidden and limits allocation. **Required verification:** CPU GPU profiles. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0212-07 — Audit accessibility.** **Acceptance:** Name, contrast and reduced motion across all styles. **Required verification:** NVDA and comfort review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0212-08 — Approve meaningful default.** **Acceptance:** Most useful signature mode justified. **Required verification:** Listener comparison. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and negative cases

Preserve one audio owner and intentional Pause, original local music and LRCLIB metadata disclosure, revision-guarded current and draft and scoped Undo, consented atomic request bridges, eight-lane/8–64-cell Studio with recovery, truthful Library states, neutral blind evaluation and frozen-revision decodable FLAC. Test absent, stale, offline, failed and slow data, duplicate/RTL titles, 320px to wide, 400% zoom, forced colors, reduced motion and actual playback as applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0185–0197/0170/0162, ADR-0198 and ADR-0199. Reconcile previous code per task rather than reimplementing blindly.
- **Sequence:** owner decision → design specimens → scoped code/test PR → independent audio/visual/AT/performance review → recorded GO/NO-GO.
- **Now:** Decision Accepted; Implementation Not started; Independently Verified No; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
