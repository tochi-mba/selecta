# ADR-0065: Persistent FLAC export jobs, exact revisions and download recovery

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 7 of 8 tasks implemented with automated evidence on 2026-11-10; 1 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 5 - Discovery and operations
- **Extends existing decisions:** ADR-0022, ADR-0026, ADR-0043
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Export currently prepares seams, renders FLAC and exposes a download through an overlay. Closing the overlay should not make the result hard to recover. Changing a mix mid-export risks reporting a file as belonging to the wrong revision.

## Decision proposed

Treat export as an explicitly revision-bound job visible independently of its initiating dialog. Preserve existing FLAC encoding and prereq rendering, introduce additive job/status API only if verified necessary, and never claim persistence beyond actual backend retention.

## Experience and frontend architecture

- Before launch, show mix identity, scope, readiness, approximate duration and any required renders. Associate the export with a snapshot including track instances, seam settings and playable render references (not just a count or order).

- An activity/job surface shows real stages: prepare seams, encode file, ready for download. Completion provides a durable download link only for the actual file-retention interval. If no existing durable job ID exists, document and review the minimum compatible extension before UI coding.

- An invalid or changed snapshot either uses its original immutable data or fails/requests a deliberate new export. Retrying never silently exports a different set.

## Detailed implementation work

1. **S3-0065-01 - Implemented.** Inspect existing FLAC export API, file retention, content identity and active job mechanisms. **Evidence:** docs/adr/selecta-3-api.md records the export job routes, their sidecars in exports/jobs/, retry identity and the export_jobs feature in /api/status; src/selecta/routes/exports.py as_shown reports a missing file as expired and an orphaned run as interrupted; tests/test_selecta3_changes.py test_a_job_file_busy_for_a_moment_loses_nothing and test_a_job_file_that_stays_locked_reports_the_real_error (passed 2026-11-10).
2. **S3-0065-02 - Implemented.** Define immutable mix-snapshot/revision contract including seam intent and render provenance. **Evidence:** src/selecta/routes/exports.py snapshot_of freezes scope, draft, song order, each seam's key and settings, and a revision hash of order plus seam identity; tests/test_selecta3_changes.py test_export_job_keeps_its_original_revision_after_the_mix_changes; tests/test_flow_export_jobs.py test_no_room_fails_before_encoding_and_a_retry_keeps_the_same_snapshot; web/e2e/integration.e2e.ts 'editing a draft during export keeps the job pinned to its original revision' (passed 2026-11-10).
3. **S3-0065-03 - Implemented.** Design export initiation with prerequisites, exact target scope, error conditions and truthful progress. **Evidence:** web/src/views/ExportPanel.tsx shows mix name, scope, frozen revision and unready transitions before Save; web/src/views/Mix.test.tsx 'blocks export until the invalid transition is fixed'; tests/test_export_validation.py test_invalid_seam_placement_is_rejected_before_scheduling_export; tests/test_flow_export_jobs.py test_a_failed_transition_names_the_pair_and_the_job_says_failed (passed 2026-11-10).
4. **S3-0065-04 - Implemented.** Provide persistent in-app job entry to recover progress and download after overlay dismissal. **Evidence:** web/src/views/ExportJobs.tsx and exportStore.ts list server-held jobs in Activity and Workspace; web/src/views/ExportJobs.test.tsx 'offers a download only for a ready file, never for expired, failed or unfinished jobs, and shows no percent'; tests/test_export_retry.py test_export_retry_recovers_previous_job_despite_stale_order_after_restart; web/e2e/mp-0294-export-and-study.e2e.ts MP-0294-02/03/04 (passed 2026-11-10).
5. **S3-0065-05 - Implemented.** Preserve rendering and download semantics; never auto-replace source mix during export. **Evidence:** tests/test_selecta3_changes.py test_export_job_keeps_its_original_revision_after_the_mix_changes; web/e2e/integration.e2e.ts 'saving a draft as a file while another mix is reordered: the file is of the draft' and 'editing a draft during export keeps the job pinned to its original revision' (passed 2026-11-10).
6. **S3-0065-06 - Implemented.** Handle cancel/retry where supported, expired files and disk-space failures with explicit messages. **Evidence:** tests/test_flow_export_jobs.py test_cancel_is_offered_only_while_waiting_and_really_stops, test_once_the_file_is_being_written_cancel_is_refused, test_no_room_fails_before_encoding_and_a_retry_keeps_the_same_snapshot and test_a_corrupt_file_or_full_disk_mid_write_is_reported_specifically; tests/test_operation_identity.py test_operation_id_deduplicates_only_the_exact_command; web/src/views/ExportJobs.test.tsx 'names every stage distinctly, and an unknown one as unknown rather than ready' (passed 2026-11-10).
7. **S3-0065-07 - Implemented.** Test actual FLAC decoding and rendered sequence/revision identity. **Evidence:** tests/test_export_validation.py test_complete_export_is_decoded_frame_by_frame and test_bad_or_wrong_export_cannot_be_reported_ready (passed 2026-11-10).
8. **S3-0065-08 - Needs a person.** Run audible comparisons for seam continuity, seek and end-of-file correctness. **Status:** Needs a person: an audible comparison of a real export against the live mix for seam continuity, seek and end-of-file correctness (docs/listening-procedure.md); the automated decode checks in tests/test_export_validation.py passed 2026-11-10 but are not a listening result.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Export draft B while A plays; reorder B and switch current mix during render; ensure exact revision.
- Close/reopen dialog, reload page, backend restart or download expiry; do not fabricate a ready link.
- Stalled seam, failed encode, disk full, stale result and repeated Export clicks; no wrong file.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Keep the modal open through completion: simpler but fragile for long jobs. Force a backend job-system rewrite: unnecessary unless existing contracts lack durable identity. Start with compatible additions.

## Acceptance and evidence

Any completed download corresponds to the declared mix revision and remains recoverable for the actual supported retention period.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (7/8) | Task-by-task evidence on each item; 1 need a person, 0 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
