# ADR-0412 - Privacy, retention and the deletion ledger

> **Local-first supersession (2026-11-13):** Relevant hosted-audio assumptions in this historical ADR are superseded by ADR-0457, ADR-0480 and [the LF preservation map](selecta-local-first-overlap-and-parity.md). Historic statuses and completed evidence remain unchanged. New architecture is accepted, not implemented.

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 2/4 Implemented; 2/4 In progress; 0/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 4. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0025 (local privacy, scoped by ADR-0391); their statuses are unchanged.
- **Source touchpoints:** `src/selecta/identity/deletion.py`; deletion effect adapters; `web/src/account/`; privacy notice.
- **Proposal chapter:** [docs/saas/12-security-privacy-legal.md](../saas/12-security-privacy-legal.md#122-privacy-uk-gdpr).

## Context and evidence boundary

Cloud mode holds people's music and personal data, so UK GDPR applies in full, and deletions must survive database restores.

Account deletion now creates a durable workflow alongside immediate account hiding and session revocation. The workflow leases and fences each step, retries failures, and holds destructive workspace cleanup until the recovery period passes. Concrete job, Stripe, WorkOS identity, membership, storage tombstone/quota and fail-closed row-cleanup adapters exist. `selecta account-deletion-maintenance` advances workflow steps and writes account-plan snapshots to a dedicated R2 ledger bucket. Song, account and export tombstones also enter a transactional outbox; `selecta storage-maintenance` mirrors that outbox before it streams due workspace-prefix objects through bounded R2 delete batches. `selecta replay-deletions-after-restore` replays storage tombstones, restores account revocations and requeues workflows before traffic is opened. The restore drill remains. Maintenance commands require scheduling and a privileged database role. R2 does not provide WORM guarantees; backup expiry remains an external lifecycle confirmation.

## Decision

- Register with the ICO; publish a privacy notice listing data, purposes, lawful bases, retention, processors and transfers; sign each processor's DPA; prefer EU regions.
- Only strictly necessary cookies; a DPIA and high-privacy defaults because teenagers are likely users.
- A published retention table; account and file deletion as an auditable workflow; a deletions ledger replayed after any restore.
- 'Download my data' for originals, mixes and settings; rights requests answered within a month.

## User outcome and acceptance contract

Users can see, take and delete their data, and a backup restore can never bring deleted data back.

## Rejected alternatives

- Plain SQL deletes.
- Analytics cookies needing a consent banner.

## Implementation checklist - 2/4 Implemented; 0/4 independently Verified

1. **SC-0412-01 - Privacy notice and ICO.** **Acceptance:** Notice published; ICO fee paid. **Required verification:** Doc and receipt on file. **Implementation:** In progress; the codeable parts it rests on exist: Download my data, account and song deletion, the 30-day Rooms guest-data purge, strictly necessary cookies only, and the retention rules in docs/saas/12-security-privacy-legal.md section 12.4; a draft notice (data, purposes and lawful bases, retention, processors and transfers, cookies, rights) is in the app as `web/src/cloud/privacyNoticeDraftText.ts`, shown under Settings only behind `cloud.privacy_notice_draft` (off by default) and headed Draft pending legal review, not published and not in force; nothing is published. Needs a person: the owner (with a privacy adviser) rewrites and approves the notice, fills the placeholders (legal name, contact, email provider, ICO number), publishes it, registers with the ICO and pays the data protection fee, and files the notice and the fee receipt. Evidence: `web/src/cloud/PrivacyNoticeDraft.test.tsx` (3 passed on 2026-11-12). **Independently Verified:** No.
2. **SC-0412-02 - Deletion workflow.** **Acceptance:** Deletion removes objects and rows in batches and releases quota. **Required verification:** Integration test. **Implementation:** Implemented; song and account deletion tombstones at once, releases quota, and purges objects in bounded batches, retrying when R2 refuses. **Evidence:** `tests/test_cloud_storage_deletion.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
3. **SC-0412-03 - Restore safety.** **Acceptance:** After a restore, replaying the ledger removes data deleted since the backup. **Required verification:** Restore drill. **Implementation:** In progress; song/account/export tombstones append to a transactional outbox, and `selecta storage-maintenance` mirrors bounded snapshots to the dedicated private R2 ledger bucket before physical purge. `selecta replay-deletions-after-restore` reapplies all storage tombstones, revokes restored account sessions and requeues deletion workflows before traffic is opened. A local restore rehearsal runs inside the catastrophe suite, and (added 2026-11-12) the restore drill ends with a `Deleted data stays gone` step that fails the drill and keeps traffic closed if any song in the deletions ledger is visible again. R2 writes are not WORM. `python infra/staging/run.py restore-drill` is the one command (inputs listed in `infra/staging/README.md`; it refuses missing inputs and non-staging URLs). Needs staging: a real restore drill (restore a staging backup, replay the ledger before opening traffic, check deleted data stays gone) with its record filed. **Evidence:** `tests/test_cloud_restore_drill.py::test_a_deleted_song_that_comes_back_after_the_replay_fails_the_drill` and `::test_the_drill_replays_the_ledger_reconciles_and_reports_every_step_in_order` (12 passed on 2026-11-12); `tests/test_cloud_catastrophe.py::test_flaky_r2_delayed_stripe_and_a_restore_during_traffic_with_pending_deletions`; `tests/test_cloud_storage_deletion.py` replay tests. **Independently Verified:** No.
4. **SC-0412-04 - Data export.** **Acceptance:** Export includes originals, mixes and settings JSON. **Required verification:** Playwright test. **Implementation:** Implemented; Download my data saves one ZIP with the original files, settings.json and mixes.json. **Evidence:** `web/e2e-cloud/storage.cloud.ts` 'Download my data saves a ZIP with originals, settings.json and mixes.json' and `tests/test_cloud_account_export.py`, passing. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
