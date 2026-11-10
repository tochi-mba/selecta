# ADR-0400 - Identity with WorkOS AuthKit

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 7/10 Implemented; 0/10 In progress; 3/10 Not started.
- **Independent verification:** 0/10 Verified.
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

## Implementation checklist - 0/10 Implemented; 0/10 independently Verified

1. **SC-0400-01 - Sign-up and sign-in.** **Acceptance:** Flows work with verification and the age statement. **Required verification:** Playwright test against AuthKit test environment. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0400-02 - JWT verification.** **Acceptance:** Expired, wrong-audience and tampered tokens are refused. **Required verification:** Unit tests. **Implementation:** Implemented; expired, wrong-issuer, wrong-audience, tampered, non-RS256 and unknown-key tokens are refused. **Evidence:** `tests/test_cloud_identity.py::test_token_verification_checks_signature_issuer_audience_and_times`, `tests/test_cloud_identity.py::test_token_verifier_rejects_non_rs256_and_unknown_key`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
3. **SC-0400-03 - Session revocation.** **Acceptance:** Revoking sessions signs out every device within the access-token lifetime. **Required verification:** Integration test. **Implementation:** Implemented; revoking sessions refuses every earlier access token at once by cut-off and by session id. **Evidence:** `tests/test_cloud_identity.py::test_workspace_membership_and_session_revocation_are_enforced`, `tests/test_cloud_auth.py::test_sign_out_everywhere_revokes_every_workos_session_and_refuses_old_tokens_by_sid`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
4. **SC-0400-04 - Account deletion.** **Acceptance:** Deletion cancels the subscription and starts the deletion workflow. **Required verification:** Integration test. **Implementation:** Implemented; deleting an account invalidates its sessions and starts the durable deletion workflow, whose plan cancels the subscription. **Evidence:** `tests/test_cloud_identity.py::test_account_deletion_is_idempotent_and_invalidates_sessions`, `tests/test_cloud_identity.py` (plan steps include `cancel_subscriptions`); green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
5. **SC-0400-05 - Hosted sign-in, Google and forgot password.** **Acceptance:** Sign-up, sign-in, Google sign-in, forgot password and email verification run on AuthKit's hosted pages on our auth domain; a Google sign-in links to an existing account only by verified email; the forgot-password page never reveals whether an account exists. **Required verification:** WorkOS staging walkthrough recorded; Playwright test of the redirects with a fake AuthKit. **Implementation:** Not started; **Independently Verified:** No.
6. **SC-0400-06 - Production token storage.** **Acceptance:** `devMode` is on only for `vite dev`; a production build without a custom auth domain fails at start; the access token is never written to localStorage. **Required verification:** Vitest for CloudRoot config; a build-time check. **Implementation:** Implemented; `devMode` is on only under `vite dev`; a production build without a custom auth domain shows a configuration error instead of the app; our code never stores the access token. **Evidence:** `web/src/cloud/authConfig.test.ts`, `web/src/cloud/authConfig.ts`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
7. **SC-0400-07 - Onboarding reads the user from WorkOS.** **Acceptance:** Onboarding takes email and verified status from the WorkOS user found by the token's subject, not from token claims; unverified emails, missing age confirmation and deleted accounts are refused with their own codes. **Required verification:** Integration tests with a fake WorkOS client. **Implementation:** Implemented; onboarding reads email and verified status from the WorkOS user, and refuses unverified emails, missing age confirmation, deleting accounts and vanished users with their own codes. **Evidence:** `tests/test_cloud_auth.py::test_onboarding_reads_the_email_from_workos_when_the_token_has_none`, `tests/test_cloud_auth.py::test_onboarding_refuses_when_workos_says_the_email_is_unverified`, `tests/test_cloud_auth.py::test_onboarding_refuses_an_account_that_is_being_deleted`, `tests/test_cloud_auth.py::test_each_account_refusal_has_its_own_code`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
8. **SC-0400-08 - Sign out everywhere revokes WorkOS sessions.** **Acceptance:** Signing out everywhere revokes every WorkOS session of the user, records the revoked session ids and the cut-off, and refuses their access tokens at once. **Required verification:** Integration tests with a fake WorkOS client; staging check that another device's refresh fails. **Implementation:** In progress; signing out everywhere revokes every WorkOS session, records the revoked session ids and the cut-off, refuses old tokens by sid, and reports sessions WorkOS could not revoke, all proven with a fake WorkOS client; the staging check that another device's refresh fails remains. **Evidence:** `tests/test_cloud_auth.py::test_sign_out_everywhere_revokes_every_workos_session_and_refuses_old_tokens_by_sid` and the two tests after it. **Independently Verified:** No.
9. **SC-0400-09 - WorkOS webhooks.** **Acceptance:** `POST /api/webhooks/workos` verifies the signature and timestamp, stores each event once, and handles email changes, deleted users, revoked sessions and password resets by re-reading WorkOS. **Required verification:** Unit tests for signatures; integration tests per event, including duplicates and out-of-order delivery. **Implementation:** Implemented; the WorkOS webhook verifies signature and timestamp, stores each event once, and handles user updates, deletions, revoked sessions, password resets and email verification by re-reading WorkOS. **Evidence:** `tests/test_cloud_auth.py::test_a_webhook_with_a_bad_signature_or_an_old_timestamp_stores_nothing`, `tests/test_cloud_auth.py::test_a_duplicate_event_is_processed_once`, `tests/test_cloud_auth.py::test_events_out_of_order_end_with_what_workos_says_now`, `tests/test_cloud_auth.py::test_a_password_reset_revokes_every_other_session_and_keeps_the_new_one`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
10. **SC-0400-10 - Staff privileged sessions.** **Acceptance:** Admin access needs a fresh token from the Selecta Staff organization (MFA required); the server creates a privileged session of at most an hour, and `authorize()` builds the Actor only from it. **Required verification:** Integration tests for creation, expiry, revocation and refusal outside the staff organization. **Implementation:** Implemented; admin access needs a fresh token from the staff organization; the server creates a privileged session of at most an hour, and `authorize()` builds the Actor only from it. **Evidence:** `tests/test_cloud_auth.py::test_a_fresh_staff_token_starts_a_privileged_session_of_at_most_an_hour`, `tests/test_cloud_auth.py::test_admin_entry_is_refused_outside_the_staff_organization_and_audited`, `tests/test_cloud_auth.py::test_a_privileged_session_ends_on_expiry_revocation_or_a_role_change`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
