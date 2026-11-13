# Selecta - UF historical status reconciliation and evidence provenance

**Status:** 24 Accepted ADRs (0366–0389); 0 UF tasks Not started; 0 In progress; 192 Implemented; 0 independently Verified (recounted from the checklist task lines 2026-11-12). Acceptance approved by requester on 2026-11-08; implementation owners and independent reviewers remain unassigned. Baseline main `f17944530d54203e49baebdabc08a57ee9f40526` (2026-11-08); PR #41 now includes app source and regression tests.

## Three independent statuses

1. **Decision:** Proposed → Accepted / Rejected / Superseded only through named owner/date/rationale.
2. **Implementation:** Not started → In progress → Implemented only through implementing code/test PR and exact SHA with item-level proof. Existing code can meet a new task after source reconciliation; a docs-only merge cannot.
3. **Independent verification:** No → Yes only after a separate reviewer documents date, device/OS/browser/AT, relevant real sound/visual/task/performance evidence and observed verdict.

## Four synchronized representations

The implementation state and independence state of every UF item are represented in (a) its ADR embedded eight-item checklist; (b) the UF implementation checklist; (c) per-item evidence ledger; (d) machine-readable UF JSON. All four must advance together with real evidence and update 0/8 counters accurately. Never auto-mark items complete based on authoring planning documents.

## Source-first reconciliation sequence

1. Pin the implementation candidate SHA and scope.
2. Identify source-present capability and related T/P/S3/S31/S4/EX/MI/CI/SF/GP/FP/MP/LU/LX decisions.
3. Classify exactly one of: already satisfied, refinement, new, verification-only, duplicate/supersede or deferred; document evidence.
4. Seek approval before changing any earlier accepted design or expanding the product boundaries.
5. Implement only missing delta in a future source/test PR, preserving invariants and rollback.
6. Record implementing PR/SHA, acceptance test, reviewer/date/platform and independent outcome.
7. Update ADR/checklist/evidence/JSON consistently; never rewrite history or sum overlapping task denominators.
8. Publish the gate decision for UF alone, not a retroactive verdict on the present app.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence ledger](selecta-unified-finish-implementation-evidence.md) · [status JSON](selecta-unified-finish-code-status.json) · [overlap/parity](selecta-unified-finish-overlap-and-parity.md) · [experience contract](selecta-unified-finish-experience-contract.md) · [verification matrix](selecta-unified-finish-verification-matrix.md) · [status reconciliation](selecta-unified-finish-status-reconciliation.md) · [release gates](selecta-unified-finish-release-gates.md)
