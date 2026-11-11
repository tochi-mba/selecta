# ADR-0127 - Export: truthful frozen revision, job lifecycle and file delivery

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** Implemented 5/5 new tasks (2026-11-10, uncommitted on `feat/finish-checklists`).
- **Verified:** Automated verification 3/5 on 2026-11-10; open items name a person or a pending run in the checklist.
- **Proposed:** 2026-11-07. **Baseline:** `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` after merged PR #29.
- **Priority / phase:** P1 / Operations.
- **Related:** ADR-0108, ADR-0065, not automatically superseded or verified.
- **Source touchpoints:** `web/src/views/ExportPanel.tsx`, `web/src/views/ExportJobs.tsx`, `web/src/views/exportStore.ts`.

## Context and evidence limits

An export must represent a specific mix/draft revision, song range and rendered transition state. Dismissing a dialog should not lose track of an existing job; a successful UI label cannot prove audio validity. This is a future design proposal; source-observed current functionality, CI and previous ADRs do not prove an implemented new experience or actual user acceptance.

## Decision proposal

- Name the exact source mix, revision and range in a focused confirmation before export.
- Separate saving a project, preparing seams, generating a FLAC, download ready and successfully downloaded states.
- Make progress, failure and recovery visible after closing dialogs and revisiting Workspace/Activity.
- Never present a job created for an older revision as the new current mix's export.
- Require actual decode/order/duration verification before a release claim; no new audio formats implied.

## Alternatives and tradeoffs

A one-click export hides scope and readiness; a large engineering-options dialog is unnecessary. Use concise confirmation with durable jobs.

## Consequences, scope and failure modes

The backend snapshot-not UI text-is authoritative. Revision mismatch, storage full, file deletion and stale retries need meaningful states. Preserve all existing routes, data, local file safety, listening study integrity, explicit bridge consent, revisions/Undo, single-owner transport and frozen-revision FLAC. Neither desktop packaging nor SaaS migration nor unreviewed backend/audio changes are part of this programme.

## New implementation status per task

1. **EX-0127-01 - Specify export source identity**. **Acceptance:** Target draft/current, revision and song range explicit. **Verification:** Cross-scope task walk-through. **Implementation: Implemented; Verified: Yes (automated, 2026-11-10). Evidence: see checklist.**
2. **EX-0127-02 - Design durable job lifecycle**. **Acceptance:** Progress survives overlay dismissal and refresh. **Verification:** Reload/async job E2E. **Implementation: Implemented; Verified: Yes (automated, 2026-11-10). Evidence: see checklist.**
3. **EX-0127-03 - Handle blocked/failed/stale jobs**. **Acceptance:** No false completion or wrong-target download. **Verification:** Storage and service fault tests. **Implementation: Implemented; Verified: Yes (automated, 2026-11-10). Evidence: see checklist.**
4. **EX-0127-04 - Verify final FLAC identity**. **Acceptance:** Decoded output matches frozen revision order and length. **Verification:** ffmpeg and real media inspection. **Implementation: Implemented; Verified: No. Needs a person: ffmpeg/real-media inspection of an export made from the owner's real library. Evidence: see checklist.**
5. **EX-0127-05 - Keep accessible export parity**. **Acceptance:** Existing actions and link/download semantics preserved. **Verification:** Keyboard/NVDA and browser tests. **Implementation: Implemented; Verified: No. Needs a person: NVDA session of the export dialog and Workshop export list. Evidence: see checklist.**

## Independent verification

Review dark/light/system themes, empty/loading/stale/failed/partial states, 320–2560px widths, 200/400% zoom, reduced motion, keyboard/touch/NVDA, long/duplicate/RTL content and concurrent operations. Test actual audio when audible behavior is claimed. Do not mark new tasks done based on PR #29 without task-specific mapping. [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [human-AI interaction research](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) and [NN/g disclosure](https://www.nngroup.com/articles/progressive-disclosure/) inform patterns, not measured Selecta outcomes. [Checklist](selecta-experience-implementation-checklist.md) · [Evidence](selecta-experience-evidence.md) · [Historical status](selecta-experience-status-reconciliation.md).
