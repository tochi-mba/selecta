# ADR-0400 — Identity with WorkOS AuthKit

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/4 Implemented; 0/4 In progress; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 4. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** None; their statuses are unchanged.
- **Source touchpoints:** new `src/selecta/identity/`; `web/src/account/`.
- **Proposal chapter:** [docs/saas/07-identity-rbac-admin.md](../saas/07-identity-rbac-admin.md#71-sign-in).

## Context and evidence boundary

Cloud mode needs accounts, sessions, MFA for staff and a path to passkeys without building authentication from scratch.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- WorkOS AuthKit for sign-up and sign-in (email, magic link, Google/Apple, MFA, passkeys); Clerk is the fallback.
- The API verifies JWTs against JWKS on every request; refresh tokens live in HttpOnly, Secure, SameSite=Lax cookies; no tokens in localStorage.
- Sign-up creates a personal workspace on the Free plan; minimum age 13.
- Account deletion starts the deletion workflow (ADR-0412) and cancels billing.

## User outcome and acceptance contract

Users sign in securely on any device; staff sessions are stronger by default.

## Rejected alternatives

- Building our own password system.
- Long-lived tokens in browser storage.

## Implementation checklist — 0/4 Implemented; 0/4 independently Verified

1. **SC-0400-01 — Sign-up and sign-in.** **Acceptance:** Flows work with verification and the age statement. **Required verification:** Playwright test against AuthKit test environment. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0400-02 — JWT verification.** **Acceptance:** Expired, wrong-audience and tampered tokens are refused. **Required verification:** Unit tests. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0400-03 — Session revocation.** **Acceptance:** Revoking sessions signs out every device within the access-token lifetime. **Required verification:** Integration test. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0400-04 — Account deletion.** **Acceptance:** Deletion cancels the subscription and starts the deletion workflow. **Required verification:** Integration test. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
