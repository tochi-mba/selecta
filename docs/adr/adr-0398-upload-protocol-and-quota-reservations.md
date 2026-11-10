# ADR-0398 - Upload protocol with server-side completion and quota reservations

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 4/5 Implemented; 0/5 In progress; 1/5 Not started.
- **Independent verification:** 0/5 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 3. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0397, ADR-0402; their statuses are unchanged.
- **Source touchpoints:** new `src/selecta/storage/uploads.py`; `web/src/uploads/`; `web/src/views/Start.tsx`; `web/src/views/Library.tsx`.
- **Proposal chapter:** [docs/saas/05-storage-uploads-playback.md](../saas/05-storage-uploads-playback.md#52-upload-protocol-always-multipart-server-completes).

## Context and evidence boundary

Users upload whole libraries from browsers. R2 doesn't support presigned POST policies, so upload size can't be enforced when signing, and quotas must hold under heavy concurrency.

The branch now has workspace-scoped Cloud multipart upload routes and a browser upload flow with SHA-256 duplicate detection, direct signed part uploads, server completion and metadata validation. Uploads are still accepted synchronously in the API process, so the sandboxed worker validation and full Cloud library workflow are incomplete.

## Decision

- Always multipart: the browser uploads parts with presigned UploadPart URLs (Uppy S3 multipart against R2's S3 endpoint).
- The server, not the client, completes the upload after `ListParts` confirms the total equals the reserved size.
- Quota is reserved atomically per upload under a row lock; reservations expire with their session; committed usage changes only on verified completion or deletion.
- Acceptance runs `ingest.validate` in a sandboxed worker (real format check, decode test, duration and tag limits, full hash) before a song exists.
- Within one account, duplicates are detected and the user chooses.

## User outcome and acceptance contract

Uploads resume after refresh, never oversubscribe storage, and reject bad files with a plain reason.

## Rejected alternatives

- Uploading through the API servers (memory and bandwidth bottleneck).
- Trusting client-declared sizes.

## Implementation checklist - 0/5 Implemented; 3/5 In progress; 0/5 independently Verified

1. **SC-0398-01 - Session planning.** **Acceptance:** Batch planning of up to 500 files with reservations and duplicate flags. **Required verification:** Integration test. **Implementation:** Implemented; batches of up to 500 files are planned with quota reservations and duplicate flags; larger batches are refused. **Evidence:** `tests/test_cloud_uploads.py::test_a_batch_of_exactly_500_files_is_planned`, `tests/test_cloud_uploads.py::test_a_batch_of_more_than_500_files_is_refused`, `tests/test_cloud_upload_api.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
2. **SC-0398-02 - Server completion.** **Acceptance:** Oversize or mismatched uploads are aborted and reservations released. **Required verification:** Integration test with a lying client. **Implementation:** Implemented; the server lists parts itself; oversize, mismatched or wrongly split uploads are aborted and their reservations released; expired sessions cannot complete. **Evidence:** `tests/test_cloud_uploads_completion.py::test_a_bad_upload_is_aborted_and_its_reservation_released`, `tests/test_cloud_uploads_completion.py::test_a_finished_object_of_the_wrong_size_is_aborted`, `tests/test_cloud_uploads_completion.py::test_property_completion_succeeds_exactly_when_the_r2_rules_hold_and_the_total_matches`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
3. **SC-0398-03 - Quota race.** **Acceptance:** 1,000 concurrent uploads for the last 1 GB never exceed the limit. **Required verification:** Concurrency test. **Implementation:** Implemented; quota reservations lock the workspace's quota row, so racing uploads can't oversubscribe it. **Evidence:** `tests/test_cloud_usage_quota.py::test_a_thousand_uploads_racing_for_the_last_gigabyte_never_oversubscribe` (1,000 at once for the last 1 GB: 500 accepted, 500 refused, exactly 10 GB used) and the 200-upload, uneven and first-row races, passing on PostgreSQL. **Independently Verified:** No.
4. **SC-0398-04 - Validation sandbox.** **Acceptance:** Decode bombs, fake extensions and truncated files are rejected safely within limits. **Required verification:** Hostile-file test set. **Implementation:** Not started; **Independently Verified:** No.
5. **SC-0398-05 - Resume.** **Acceptance:** A refreshed browser resumes from uploaded parts. **Required verification:** Playwright test. **Implementation:** Implemented; a refreshed browser asks the server which parts arrived and uploads only the rest. **Evidence:** `web/e2e-cloud/storage.cloud.ts` 'a refreshed browser carries on an upload from the parts already uploaded', passing in `pnpm e2e:cloud` on PostgreSQL. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
