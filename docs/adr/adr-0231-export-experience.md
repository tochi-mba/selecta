# ADR-0231 - Export Studio: frozen revision, honest render progress and finished artifact

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (7/8 Implemented, 0/8 In progress, 1/8 Not started or needing a person; updated 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Export.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0157/0181/0127; earlier statuses unchanged.
- **Existing source touchpoints:** web/src/views/ExportPanel.tsx; web/src/views/ExportJobs.tsx; web/src/views/exportStore.ts.

## Context and evidence boundary

Export should feel like finishing a creative work but remain a reliable exact-revision background job. Show frozen input identity, truthful processing, failure and decodable FLAC outcome. Existing functional code can be reused; this record defines additional visual, interaction and human-outcome acceptance and does not certify its implementation or independent verification.

## Proposed decision

Export should feel like finishing a creative work but remain a reliable exact-revision background job. Show frozen input identity, truthful processing, failure and decodable FLAC outcome. Favor accessible, truthful, music-first expression. Retain current route functionality and backend truth while enhancing layout, copy, hierarchy and feedback. If a redesign obscures correct status or adds risk, prefer the simpler proven interaction.

## Visual, animation and microinteraction contract

- Clear primary musical object, one intentional primary action and discoverable advanced capability.
- Planned versus prepared versus committed versus playing status and exact object scope must be visible.
- Motion follows cause, actual user action or measured music rather than decorative pseudo-beats and preserves static equivalents.
- Keep interaction available by pointer, touch, keyboard, screen reader, reduced motion, forced colors and high zoom.

## Alternatives, trade-offs and limits

No fake percentage, output from the wrong draft, implied finished artifact when job is pending or non-decodable file. Do not add accounts, SaaS subscriptions, cloud uploads, telemetry, hardware launchers or new audio sources through this design proposal.

## Implementation checklist - 7/8 Implemented, 0/8 Verified

1. **SF-0231-01 - Show frozen revision before export.** **Acceptance:** Selected mix ID and revision explicitly confirmed. **Required verification:** Snapshot fixture. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/UpNext.test.tsx` 'SF-0231-01 confirms the frozen mix, its revision and exact songs once saving starts'; `web/src/views/Mix.test.tsx` 'shows the exact ordered source songs before creating a file' (2026-11-10).
2. **SF-0231-02 - Design job phase visualization.** **Acceptance:** Queued, rendering, finalizing, done and failed accurate. **Required verification:** Backend job tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `tests/test_flow_export_jobs.py` (preparing, encoding, ready, cancelled, failed); `web/src/views/UpNext.test.tsx` 'SF-0231-02 gives each job phase its own words'; `web/src/views/Mix.test.tsx` 'only offers the file once it really exists' (2026-11-10).
3. **SF-0231-03 - Display only real progress.** **Acceptance:** Indeterminate used when no reliable percentage. **Required verification:** Slow-job and no-progress tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/UpNext.test.tsx` 'SF-0231-03 counts real transitions and never shows an invented percentage' (2026-11-10).
4. **SF-0231-04 - Protect edit during export.** **Acceptance:** Changes after submission cannot mutate existing job. **Required verification:** Concurrent edit E2E. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/e2e/integration.e2e.ts` 'editing a draft during export keeps the job pinned to its original revision'; `tests/test_selecta3_changes.py::test_export_job_keeps_its_original_revision_after_the_mix_changes` (2026-11-10).
5. **SF-0231-05 - Handle cancel/retry safely.** **Acceptance:** Actions reflect actual backend semantics. **Required verification:** Cancel failure tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `tests/test_flow_export_jobs.py::test_cancel_is_offered_only_while_waiting_and_really_stops`, `::test_once_the_file_is_being_written_cancel_is_refused`; `web/src/views/UpNext.test.tsx` 'SF-0231-05 offers Cancel only when the server says it can still cancel'; `tests/test_export_retry.py` (2026-11-10).
6. **SF-0231-06 - Present finished artifact.** **Acceptance:** Real path, format, metadata and next action correct. **Required verification:** FLAC decode and metadata validation. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `tests/test_export_validation.py::test_complete_export_is_decoded_frame_by_frame`, `::test_bad_or_wrong_export_cannot_be_reported_ready`; `tests/test_flow_export_jobs.py::test_once_the_file_is_being_written_cancel_is_refused` (ready job names its .flac file, length and revision); download link in `web/src/views/Mix.test.tsx` 'only offers the file once it really exists' (2026-11-10).
7. **SF-0231-07 - Design failure recovery.** **Acceptance:** Specific cause and retry do not lose context. **Required verification:** Corrupt/storage-full fixtures. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `tests/test_flow_export_jobs.py::test_no_room_fails_before_encoding_and_a_retry_keeps_the_same_snapshot`, `::test_a_corrupt_file_or_full_disk_mid_write_is_reported_specifically`, `::test_a_failed_transition_names_the_pair_and_the_job_says_failed` (2026-11-10).
8. **SF-0231-08 - Evaluate finishing moment.** **Acceptance:** Artistic completion never sacrifices job truth. **Required verification:** User and music output review. **Implementation:** Needs a person: user and music output review of the finishing moment; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve original local music; intentional Pause and one audio owner; disclosed LRCLIB metadata lookup; exact current/draft revisions and Undo; stable song and seam IDs; atomic bridge joining with explicit consent; eight-lane Studio and local recovery; honest readiness and processing; neutral blind comparison; frozen-revision decodable FLAC. Exercise failures, stale results, missing music, offline and multitab, 320px/high zoom, long/RTL names, keyboard/touch/AT, forced colors, reduced motion and real audio when applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0157/0181/0127; ADR-0198/0199 and cross-cutting UI foundation.
- **Next:** owner decision → prototypes → source-level implementation PR → regression tests → independent visual, access, audio and device evidence → release gate.
- **Now:** Accepted; 7/8 Implemented (2026-11-10); 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
