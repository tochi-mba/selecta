# ADR-0108: Export audio, revision-pinned FLAC jobs, durable progress and verified downloads

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress (9/10 implemented, 1 in progress; source reconciliation 2026-11-10, branch feat/finish-checklists)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 9 Operations
- **Extends, does not automatically supersede:** ADR-0022, ADR-0065, ADR-0083
- **Source surfaces to reconcile:** `web/src/views/ExportPanel.tsx`; `web/src/views/ExportJobs.tsx`; `src/selecta/routes/exports.py`
- **Tasks:** S4-0108-01 through S4-0108-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Save as draft, Export audio and Download FLAC represent different outcomes; export may continue after modal closure and must render the frozen starting revision, not whatever mix currently exists.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Use Export audio consistently for producing files, Save for editable projects, and Download only after a file is actually ready. Display mix identity, snapshot version, stage, progress and immutable job association across Activity and Workspace.

## Experience, frontend and interaction specification

- Pre-submit confirmation identifies mix/draft scope, song count, first/last song, format and frozen revision.
- Job stages distinguish transition preparation, encoding and ready-to-download; 'export started' not 'file ready'.
- Closing modal or changing draft never reassigns/cancels authoritative job.
- Only FLAC offered until verified backend encoding support exists for other formats.

## Detailed implementation work

1. **S4-0108-01 - Standardize Save/Export/Download terminology across routes.** Acceptance: User cannot confuse editable project and completed file. Required verification: Copy audit plus unassisted task comprehension. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: ExportPanel.tsx 'Save as an audio file' and 'download'; docs/adr/completion/copy-audit.md. Needs a person: unassisted task comprehension.
2. **S4-0108-02 - Redesign pre-export scope/snapshot confirmation.** Acceptance: Exact source and revision visible before submission. Required verification: Current/draft same-name and edited-after-start cases. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/views/ExportPanel.tsx shows scope, name, revision and the proposed order before Save; Mix.test.tsx 'does not carry an in-flight export across a change of editing scope'. Needs a person: same-name current/draft review.
3. **S4-0108-03 - Preserve revision-pinned export backend job.** Acceptance: Mix edits after submission do not affect FLAC bytes. Required verification: Frozen snapshot and server contract tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: tests/test_selecta3_changes.py 'export_job_keeps_its_original_revision_after_the_mix_changes'; integration.e2e.ts 'editing a draft during export keeps the job pinned to its original revision'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read test_selecta3_changes.py 'export_job_keeps_its_original_revision_after_the_mix_changes' and integration.e2e.ts 'editing a draft during export keeps the job pinned to its original revision'; separately a FLAC exported from the made-up library came back byte-identical after the mix was reordered (docs/verification/claude-checks/selecta-4-implementation-checklist/S4-0108-08/export-decode.json); every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights), and the cited Edge specs (Edge 157, dist-vb build, e2e_server) 25 passed.
4. **S4-0108-04 - Design queued/rendering/encoding/ready/failed/cancelled/expired stages.** Acceptance: No invented readiness or percent on incomplete backend data. Required verification: Job state fixture screenshots. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/views/ExportJobs.tsx STATES with an unknown fallback; new web/src/views/ExportJobs.test.tsx 'names every stage distinctly, and an unknown one as unknown rather than ready'. Needs a person: job-state screenshot review.
5. **S4-0108-05 - Preserve export while dialog closes, route changes or browser reloads.** Acceptance: Authoritative job remains retrievable independent of UI. Required verification: Reload/draft switch/Stage navigation tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/views/exportStore.ts server-held jobs shown in Activity and Workspace; tests/test_export_retry.py 'export_retry_recovers_previous_job_despite_stale_order_after_restart'. Needs a person: reload/Stage navigation review.
6. **S4-0108-06 - Harden cancel/retry/duplicate export and idempotency.** Acceptance: Interrupted mutation does not create duplicate job unnoticed. Required verification: Server timeout, twice-submit and cancel race tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: ExportPanel.tsx reuses the x-operation-id on an uncertain retry; tests/test_export_retry.py; tests/test_operation_identity.py. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read tests/test_export_retry.py and tests/test_operation_identity.py and ExportPanel.tsx: an uncertain retry reuses its x-operation-id, so the server returns the same job; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).
7. **S4-0108-07 - Make correct download discoverable and failure recoverable.** Acceptance: No missing/expired file shown as downloadable. Required verification: Expired URL, storage full and unauthorized route tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: ExportJobs.test.tsx 'offers a download only for a ready file, never for expired, failed or unfinished jobs, and shows no percent'. Needs a person: storage-full and unauthorised route check.
8. **S4-0108-08 - Verify actual FLAC file identity and decode correctness.** Acceptance: Decodable output matches song order, duration and frozen transitions. Required verification: Decode file, compare sample format/timing/revision. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: tests/test_export_validation.py 'complete_export_is_decoded_frame_by_frame', 'bad_or_wrong_export_cannot_be_reported_ready'; tests/check_export_audio.py. Needs a person: independent decode of a real export.
9. **S4-0108-09 - Clarify transitions prepared or falling back at export start.** Acceptance: Export status accurately reports technical readiness. Required verification: Missing seam, fallback and rerender fixture tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: ExportPanel.tsx lists unready transitions and blocks cut-off ones; Mix.test.tsx 'blocks export until the invalid transition is fixed'; test_export_validation.py 'invalid_seam_placement_is_rejected_before_scheduling_export'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read Mix.test.tsx 'blocks export until the invalid transition is fixed' and test_export_validation.py 'invalid_seam_placement_is_rejected_before_scheduling_export'; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).
10. **S4-0108-10 - Record real listening acceptance separately from encoder success.** Acceptance: Successful encode not evidence of musically good handoff. Required verification: Audible review with representative transition set. **Implementation: In progress (2026-11-10, source-reconciled); Verified: No.** Evidence: docs/listening-procedure.md keeps listening apart from encoder success; no recorded session. Needs a person: audible review of a representative transition set.

## Required negative cases and regression strategy

- Two exports for same named mix remain distinguishable via job ID/revision.
- Server responds after user changed drafts: never attach old job to new draft.
- HTTP 200 download is insufficient proof; decode and inspect output.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Detailed frozen-version disclosure adds one decision step but protects user trust and artifact correctness.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0108 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (9/10) | Not verified | Source reconciliation against current code with focused tests run 2026-11-10; every task still needs independent verification |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
