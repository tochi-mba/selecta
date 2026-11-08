# ADR-199 — Head baseline and historical ADR implementation reconciliation

- **Decision:** Proposed (owner acceptance pending).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Foundation.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0184/0164/0113; no historical status is changed.
- **Existing source touchpoints:** docs/adr/README.md; docs/acceptance.md; web/e2e/visual.e2e.ts.

## Context and evidence boundary

Previous programme implementation counts are historic snapshots at different SHAs. New tasks must represent genuinely new acceptance deltas; existing code remains a reuse candidate, not automatically completed or missing. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Previous programme implementation counts are historic snapshots at different SHAs. New tasks must represent genuinely new acceptance deltas; existing code remains a reuse candidate, not automatically completed or missing. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

Do not erase prior evidence, confuse screenshot candidates with approval, or claim docs merge equals implementation. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-199-01 — Pin baseline commit and tree.** **Acceptance:** All new tasks reference exact parent SHA. **Required verification:** GitHub tree comparison. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-199-02 — Inventory visual and interactive states.** **Acceptance:** Every core scene including errors captured. **Required verification:** Screenshot and state matrix. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-199-03 — Map CI/MI and historic overlap.** **Acceptance:** Existing features distinguished from new design outcomes. **Required verification:** Cross-programme audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-199-04 — Record source test catalogue.** **Acceptance:** Automated checks separated from independent acceptance. **Required verification:** Test-file inspection. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-199-05 — Define screen review protocol.** **Acceptance:** Candidates versus approved visuals have separate status. **Required verification:** Reviewer and SHA record. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-199-06 — Record real hardware baseline.** **Acceptance:** OS, browser, CPU/GPU and loads documented. **Required verification:** Reproducible benchmark protocol. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-199-07 — List known existing limitations.** **Acceptance:** Baseline issues not misattributed to changes. **Required verification:** Evidence issue register. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-199-08 — Enforce truthful status promotion.** **Acceptance:** Every task needs implementation and independent proof separately. **Required verification:** Evidence ledger audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0184/0164/0113 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Proposed; Implementation Not started; Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
