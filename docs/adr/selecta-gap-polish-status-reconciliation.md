# Selecta - GP historical decision and implementation status reconciliation

**2026-11-12 status (recounted from the task lines of the [checklist](selecta-gap-polish-implementation-checklist.md)):** 16 Accepted ADRs (0248-0263, owner accepted 2026-11-08); 128 GP tasks: 111 Implemented, 0 In progress, 17 Not started (each names a person-only step); **0 independently Verified**.

**Historical 2026-11-08 planning baseline:** **16 Proposed ADRs (0248–0263), 128 new GP tasks Not started, 0 In progress, 0 Implemented and 0 independently Verified.** Planning baseline main `2956bc47fd735339e7216e03d27817fb3a31e92b` on 2026-11-08. Owner decisions remain pending. This PR changes only documentation; it neither implements code nor changes historical SF/CI/MI or earlier statuses.

| Programme | Historical scope | Change by GP documentation PR |
|---|---|---|
| T/P | ADR-0001–0046 | None |
| S3/S31/S4 | ADR-0047–0113 | None |
| EX/MI | ADR-0114–0164 | None |
| CI and 13 spectrum style additions | ADR-0165–0197 | None |
| SF | ADR-0198–0247 - [400-task checklist](selecta-flow-implementation-checklist.md) and [evidence](selecta-flow-implementation-evidence.md) | None; 50 accepted ADRs and original SF counts remain untouched |
| GP | ADR-0248–0263 - [new ledger](selecta-gap-polish-implementation-evidence.md) | Baseline 2026-11-08: 16 Proposed, 128 Not started. Now (2026-11-12): 16 Accepted, 111 Implemented, 0 In progress, 17 Not started, 0 Verified |

**Decision transitions:** Proposed → Accepted/Rejected/Superseded requires explicit owner decision and date. **Implementation transitions:** Not started → In progress → Implemented requires a linked *source/test* PR and exact code SHA; this documentation PR does not count. **Independent verification:** reviewer, environment, real music/AT/participant evidence and dated result. Existing code may already satisfy some GP criteria and must be evaluated precisely; do not assume absence or automatically count it complete.

Do not sum historical T/P/S3/S31/S4/EX/MI/CI/SF/GP checklists into a count of distinct missing product features. Each programme has a separate design acceptance scope and baseline.
