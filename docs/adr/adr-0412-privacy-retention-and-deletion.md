# ADR-0412 - Privacy, retention and the deletion ledger

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/4 Implemented; 0/4 In progress; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 4. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0025 (local privacy, scoped by ADR-0391); their statuses are unchanged.
- **Source touchpoints:** new deletion workflow in `src/selecta/maintenance/`; `web/src/account/`; privacy notice.
- **Proposal chapter:** [docs/saas/12-security-privacy-legal.md](../saas/12-security-privacy-legal.md#122-privacy-uk-gdpr).

## Context and evidence boundary

Cloud mode holds people's music and personal data, so UK GDPR applies in full, and deletions must survive database restores.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

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
2. **SC-0412-02 - Deletion workflow.** **Acceptance:** Deletion removes objects and rows in batches and releases quota. **Required verification:** Integration test. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0412-03 - Restore safety.** **Acceptance:** After a restore, replaying the ledger removes data deleted since the backup. **Required verification:** Restore drill. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0412-04 - Data export.** **Acceptance:** Export includes originals, mixes and settings JSON. **Required verification:** Playwright test. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
