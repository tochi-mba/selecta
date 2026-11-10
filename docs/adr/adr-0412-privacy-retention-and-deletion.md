# ADR-0412 - Privacy, retention and the deletion ledger

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 1/4 Implemented; 2/4 In progress; 1/4 Not started.
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

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **SC-0412-01 - Privacy notice and ICO.** **Acceptance:** Notice published; ICO fee paid. **Required verification:** Doc and receipt on file. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0412-02 - Deletion workflow.** **Acceptance:** Deletion removes objects and rows in batches and releases quota. **Required verification:** Integration test. **Implementation:** Implemented; song and account deletion tombstones at once, releases quota, and purges objects in bounded batches, retrying when R2 refuses. **Evidence:** `tests/test_cloud_storage_deletion.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
3. **SC-0412-03 - Restore safety.** **Acceptance:** After a restore, replaying the ledger removes data deleted since the backup. **Required verification:** Restore drill. **Implementation:** In progress; song/account/export tombstones append to a transactional mirror outbox, and the bounded storage maintenance pump writes canonical snapshots to R2 before physical deletion. `selecta replay-deletions-after-restore` idempotently re-hides objects, releases quota, restores account revocations and requeues workflows before serving. The restore drill remains; R2 does not guarantee write-once storage; **Independently Verified:** No.
4. **SC-0412-04 - Data export.** **Acceptance:** Export includes originals, mixes and settings JSON. **Required verification:** Playwright test. **Implementation:** In progress; authenticated `GET /api/account/export` downloads integrity-checked originals with profile/Labs settings and metadata. `mixes.json` explicitly states Cloud mix persistence is not available yet; bounded background export for large libraries and the completed mixes payload remain; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
