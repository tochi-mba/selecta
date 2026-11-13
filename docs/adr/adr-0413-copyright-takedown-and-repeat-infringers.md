# ADR-0413 - Copyright terms, takedown and repeat infringers

> **Local-first supersession (2026-11-13):** Relevant hosted-audio assumptions in this historical ADR are superseded by ADR-0475, ADR-0480 and [the LF preservation map](selecta-local-first-overlap-and-parity.md). Historic statuses and completed evidence remain unchanged. New architecture is accepted, not implemented.

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 1/4 Implemented; 2/4 In progress; 1/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 7. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** None; their statuses are unchanged.
- **Source touchpoints:** Terms of service; takedown process in `docs/operations/`; admin console.
- **Proposal chapter:** [docs/saas/12-security-privacy-legal.md](../saas/12-security-privacy-legal.md#123-copyright-and-music).

## Context and evidence boundary

The UK has no private-copying exception, and US locker precedent (EMI v. MP3tunes) shows safe harbour can be lost without an enforced repeat-infringer policy.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Terms require users to hold rights to what they upload; private lockers only (no public links or sharing at launch); no audio sent to Room guests.
- Notice-and-takedown process with expeditious action; a written, enforced repeat-infringer policy; a registered DMCA agent for US users, renewed every three years.
- Personal and private use only; public or commercial playback needs the user's own licences (UK: TheMusicLicence).
- A UK media/IP lawyer reviews the model before paid launch.

## User outcome and acceptance contract

Selecta behaves as a responsible host and avoids features that would turn it into a distributor.

## Rejected alternatives

- Public mix links at launch.
- Cross-account deduplication.

## Implementation checklist - 1/4 Implemented; 0/4 independently Verified

1. **SC-0413-01 - Terms.** **Acceptance:** Terms cover rights, private use and public performance. **Required verification:** Legal review. **Implementation:** Not started; the product side the terms describe exists (private lockers, no sharing, no audio to Room guests, versioned checkout consent). Needs a person: a UK media/IP lawyer drafts and reviews the terms covering upload rights, personal and private use and public performance licences, and the owner publishes them. **Independently Verified:** No.
2. **SC-0413-02 - Takedown process.** **Acceptance:** Notices are logged, acted on and audited within the stated time. **Required verification:** Drill. **Implementation:** In progress; notice, 24-hour decision deadline, overdue flag, act (hides the asset and starts its deletion through the ledger), reject, evidence and audit (with whether the action was within target) plus staff routes exist and pass their tests. Needs a person: the owner (or named legal contact) runs a takedown drill end to end on staging (a test notice received by the published contact route, logged, decided and acted on within 24 hours, the audit trail checked) and files the drill record. **Evidence:** `src/selecta/admin/takedowns.py`; `src/selecta/admin/routes_controls.py`; `tests/test_cloud_admin_takedowns.py` (6 passed on SQLite on 2026-11-10; the PostgreSQL runs are in the Cloud / PostgreSQL job). **Independently Verified:** No.
3. **SC-0413-03 - Repeat-infringer enforcement.** **Acceptance:** Accounts with repeated valid notices are restricted per policy. **Required verification:** Admin test. **Implementation:** Implemented; two valid notices restrict that workspace's uploads, raise a repeat-infringer alert and show on the admin account page; other workspaces are untouched; lifting is audited and restores uploads. **Evidence:** `tests/test_cloud_admin_takedowns.py::test_repeated_valid_notices_suspend_uploads_until_lifted`, passing locally on 2026-11-10. **Independently Verified:** No.
4. **SC-0413-04 - DMCA agent.** **Acceptance:** Agent registered and renewal calendared. **Required verification:** Registration on file. **Implementation:** In progress; the renewal reminder is built: `src/selecta/admin/dmca.py` and the `dmca_renewal` task in `selecta maintain` (flag `cloud.dmca_renewal_reminder`) read `SELECTA_DMCA_AGENT_REGISTERED_ON` and raise an owner alert weekly from 90 days before the three-year designation lapses and daily once it has; without the date the task is left out and the start-up log names the setting. Needs a person: the owner registers a DMCA designated agent with the US Copyright Office (and publishes the agent's contact on the site), files the registration, sets `SELECTA_DMCA_AGENT_REGISTERED_ON` in production and puts the renewal in the calendar. Evidence: `tests/test_dmca_reminder.py` (5 passed on 2026-11-12). **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
