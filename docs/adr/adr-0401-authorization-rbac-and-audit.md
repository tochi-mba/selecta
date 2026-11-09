# ADR-0401 - Authorization: staff roles, scopes and the audit log

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/5 Implemented; 0/5 In progress; 5/5 Not started.
- **Independent verification:** 0/5 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 4. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0400; their statuses are unchanged.
- **Source touchpoints:** new `src/selecta/authz/`, `src/selecta/admin/`; `web/src/admin/`.
- **Proposal chapter:** [docs/saas/07-identity-rbac-admin.md](../saas/07-identity-rbac-admin.md#73-staff-rbac).

## Context and evidence boundary

Subscription tiers, workspace roles and staff powers are different things and must not be merged into one flag. At launch the owner is the only operator.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Three separate systems: plan (what a workspace consumes), workspace role (owner/editor/viewer), platform role (staff).
- Permissions are stable strings in a code registry; roles are code-defined bundles; assignments are stored with scope, issuer, reason and expiry.
- Deny by default; every admin request checks permission, scope, resource and conditions (fresh MFA, approval) and is audited.
- No staff access to customer audio without a time-limited, consented, audited support grant.
- With one operator, dangerous actions run after a 15-minute delay with alerts and can be cancelled; with two staff they need two-person approval. Break-glass Owner credential kept offline.
- Append-only audit log written by a separate database role and exported daily to write-once storage.

## User outcome and acceptance contract

The owner sees everything operational, while a stolen session, stale tab or slip can't destroy data or quietly grant power.

## Rejected alternatives

- A single `is_admin` flag.
- Staff impersonation of customers at launch.
- A UI role editor at launch.

## Implementation checklist - 0/5 Implemented; 0/5 independently Verified

1. **SC-0401-01 - Permission registry and checks.** **Acceptance:** Every admin route declares its permission; unknown permissions fail CI. **Required verification:** Unit tests. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0401-02 - Scoped assignments.** **Acceptance:** Assignments respect scope and expiry; revocation takes effect immediately. **Required verification:** Integration tests. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0401-03 - Delayed dangerous actions.** **Acceptance:** Listed actions wait 15 minutes, notify, can be cancelled and re-check authority. **Required verification:** Integration test. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0401-04 - Audit log.** **Acceptance:** Sensitive allows and all admin denies are recorded; the app role cannot update or delete audit rows. **Required verification:** Database permission test. **Implementation:** Not started; **Independently Verified:** No.
5. **SC-0401-05 - Compromised-admin drill.** **Acceptance:** Escalation, content access and audit tampering attempts are blocked and alerted. **Required verification:** Security test. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
