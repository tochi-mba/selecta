# Selecta - historical status reconciliation and MI-only progress

**Source baseline:** main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7`, 2026-11-07, after merged PR #30. The MI programme adds ADR-0135–0164 and 240 tasks; [PR #31](https://github.com/tochi-mba/selecta/pull/31) now also changes product runtime code and targeted tests. All earlier programmes' historical statuses remain unchanged.

| Programme | Canonical historic evidence | Tracked tasks | Change made here | Status interpretation |
|---|---|---:|---|---|
| Original ADR-0001–0032 (T) | [Original ledger](implementation-evidence.md) | 279 | None | Historical headings may predate code merges |
| Polish ADR-0033–0046 (P) | [Polish ledger](polish-implementation-evidence.md) | 143 | None | Preserve prior owner decisions |
| Selecta 3.0 ADR-0047–0077 (S3) | [3.0 ledger](selecta-3-evidence.md) | 258 | None | Some historical PR labels are stale |
| Selecta 3.1 ADR-0078–0088 | [3.1 ledger](selecta-3-1-evidence.md) | 116 | None | Historical in-progress evidence, not new verification |
| Selecta 4.0 ADR-0089–0113 (S4) | [4.0 ledger](selecta-4-evidence.md) | 250 | None | Older 0-done tracker does not prove current code unimplemented |
| Experience-first ADR-0114–0134 (EX) | [Experience ledger](selecta-experience-evidence.md) | 105 | None | Previous proposal and baseline; reconciled separately |
| **Immersive ADR-0135–0164 (MI)** | [New MI ledger](selecta-microinteraction-evidence.md) | **240** | **Frontend code, tests and source-level status evidence on PR #31** | **25 Not started; 4 In progress; 211 Implemented; 0 independently Verified; 30 Accepted** |

**Do not add historical counts together to infer remaining developer work:** programmes overlap in scope, have different baselines and evidence standards. Existing code resembling an MI task is input for future reconciliation, not automatic implementation/verification.

**Decision:** 30 Accepted, 0 Proposed, 0 Rejected/Superseded. **Implementation:** 25 Not started, 4 In progress, 211 source-level Implemented. **Verification:** 240 No, 0 Yes. **Owner:** Unassigned for all new MI tasks until a named owner acts.

[PR #31](https://github.com/tochi-mba/selecta/pull/31) updates its MI ADR, the [checklist](selecta-microinteraction-implementation-checklist.md), [ledger](selecta-microinteraction-evidence.md) and [release gates](selecta-microinteraction-release-gates.md), with exact source SHA and applicable tests; a reviewer remains unassigned. Advance Verified only on independently recorded evidence including actual visual, human accessibility, audio and performance checks where relevant. See [historical experience reconciliation](selecta-experience-status-reconciliation.md) for earlier programme baselines.
