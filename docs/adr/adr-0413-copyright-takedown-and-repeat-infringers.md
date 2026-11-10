# ADR-0413 - Copyright terms, takedown and repeat infringers

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/4 Implemented; 2/4 In progress; 2/4 Not started.
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

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **SC-0413-01 - Terms.** **Acceptance:** Terms cover rights, private use and public performance. **Required verification:** Legal review. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0413-02 - Takedown process.** **Acceptance:** Notices are logged, acted on and audited within the stated time. **Required verification:** Drill. **Implementation:** In progress; notice/action/deadline/evidence/audit services and staff routes exist; the drill remains. **Evidence:** `src/selecta/admin/takedowns.py`; `src/selecta/admin/routes_controls.py`. **Independently Verified:** No.
3. **SC-0413-03 - Repeat-infringer enforcement.** **Acceptance:** Accounts with repeated valid notices are restricted per policy. **Required verification:** Admin test. **Implementation:** In progress; restriction and lifting commands exist; focused repeat-infringer admin coverage remains. **Evidence:** `src/selecta/admin/takedowns.py`; `src/selecta/admin/routes_controls.py`. **Independently Verified:** No.
4. **SC-0413-04 - DMCA agent.** **Acceptance:** Agent registered and renewal calendared. **Required verification:** Registration on file. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
