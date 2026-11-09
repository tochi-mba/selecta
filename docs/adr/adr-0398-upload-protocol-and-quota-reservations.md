# ADR-0398 — Upload protocol with server-side completion and quota reservations

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/5 Implemented; 0/5 In progress; 5/5 Not started.
- **Independent verification:** 0/5 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 3. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0397, ADR-0402; their statuses are unchanged.
- **Source touchpoints:** new `src/selecta/storage/uploads.py`; `web/src/uploads/`; `web/src/views/Start.tsx`; `web/src/views/Library.tsx`.
- **Proposal chapter:** [docs/saas/05-storage-uploads-playback.md](../saas/05-storage-uploads-playback.md#52-upload-protocol-always-multipart-server-completes).

## Context and evidence boundary

Users upload whole libraries from browsers. R2 doesn't support presigned POST policies, so upload size can't be enforced when signing, and quotas must hold under heavy concurrency.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

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

## Implementation checklist — 0/5 Implemented; 0/5 independently Verified

1. **SC-0398-01 — Session planning.** **Acceptance:** Batch planning of up to 500 files with reservations and duplicate flags. **Required verification:** Integration test. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0398-02 — Server completion.** **Acceptance:** Oversize or mismatched uploads are aborted and reservations released. **Required verification:** Integration test with a lying client. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0398-03 — Quota race.** **Acceptance:** 1,000 concurrent uploads for the last 1 GB never exceed the limit. **Required verification:** Concurrency test. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0398-04 — Validation sandbox.** **Acceptance:** Decode bombs, fake extensions and truncated files are rejected safely within limits. **Required verification:** Hostile-file test set. **Implementation:** Not started; **Independently Verified:** No.
5. **SC-0398-05 — Resume.** **Acceptance:** A refreshed browser resumes from uploaded parts. **Required verification:** Playwright test. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
