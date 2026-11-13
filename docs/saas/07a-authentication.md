*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

> **Local-first architecture supersession (accepted 2026-11-13; implementation not started).** Authentication and session lifecycle remain; connected local engines now have independently revocable, workspace-scoped device identities. A browser controller never inherits filesystem privileges. See [ADR-0462](../adr/adr-0462-device-pairing-and-secure-local-cloud-command-channel.md). Historical plan details and past implementation evidence below are retained; this documentation PR does not change running software.


## 7A. Authentication: every flow and edge case

Selecta never sees a password. Sign-up, sign-in, Google sign-in, "forgot password", email verification and MFA all happen on AuthKit's hosted pages (WorkOS), styled as Selecta. Our code does three things: start the sign-in, check the access token on every request, and keep its own account records in step with WorkOS. This chapter is the specification for all three ([ADR-0400](../adr/adr-0400-identity-with-workos-authkit.md)).

### 7A.1 The pieces

| Piece | Where | Job |
|---|---|---|
| AuthKit hosted pages | WorkOS, on our auth domain (`auth.selecta.app`) | Sign-up, sign-in, Google, forgot password, email verification, MFA |
| `@workos-inc/authkit-react` | `web/src/cloud/CloudRoot.tsx` | Starts sign-in (PKCE), holds the access token in memory, refreshes it |
| Token check | `selecta.identity.tokens` | RS256 only, issuer, expiry, JWKS with rotation |
| WorkOS API client | `selecta.identity.workos` | Look up users, list and revoke sessions, delete users, verify WorkOS webhooks |
| Account records | `selecta.identity.accounts` | Users, personal workspace, revocation cut-off, deletion start |
| WorkOS webhook | `POST /api/webhooks/workos` | Email changes, revoked sessions, deleted users, password resets |

**Where tokens live.** The access token lives only in memory in the page (never in `localStorage`). The refresh token lives in an HttpOnly, Secure cookie on our own auth domain, set by AuthKit. That only happens with a custom auth domain and `devMode` off. In development mode AuthKit keeps the refresh token in `localStorage`, which any injected script could read, so:
- `devMode` is set from the build: on only for `vite dev`.
- A production build without a custom auth domain (`VITE_WORKOS_API_HOSTNAME`) fails at start with a clear error instead of quietly falling back to development mode.

### 7A.2 Flows

**Sign up with email and password**
1. "Create your account" calls `signUp()`, which goes to the hosted page.
2. The person enters email and password. AuthKit checks password strength and known breached passwords, then emails a verification code.
3. They verify, and AuthKit redirects back with a code; the SDK swaps it for tokens (PKCE, so no secret in the browser).
4. The app calls `POST /api/onboarding/complete` with their age confirmation and timezone.
5. The server looks the user up **from WorkOS by the token's subject**, not from token claims, and requires a verified email. It provisions the user, a personal workspace and the Free plan.

**Sign up or sign in with Google**
- Same as above, except the hosted page offers "Continue with Google".
- Google proves the email, so no code is needed.
- Onboarding still asks for age (13 or over) and accepts the terms, because Google tells us neither.

**An email that already has a password account signs in with Google**
- AuthKit links the Google identity to the existing user only when the email is verified, so both ways in reach one Selecta account.
- An unverified password account can't be taken over this way: verification is required for every account.

**Sign in**
- `signIn()` goes to the hosted page; methods are password, Google, or a one-time email code (Magic Auth).
- If MFA is enrolled, AuthKit asks for it. Staff accounts must have it (§7A.5).

**Forgot password**
1. On the hosted page, "Forgot password?" asks for an email.
2. The page always answers the same way ("If an account exists, we've emailed a link"), so it can't be used to find out who has an account.
3. The link is single-use and expires.
4. After a reset, WorkOS tells us through the webhook (event name to confirm in the WorkOS dashboard), and Selecta signs the person out everywhere else, keeping only the session they just made.

**A Google-only user wants a password.** They use "Forgot password" with their email; the reset adds a password to the same account.

**Email change**
- Changed in WorkOS (from Account, which links to AuthKit's settings, or by Google itself when the person's Google email changes).
- The `user.updated` webhook updates our copy.
- A changed email must be verified again before it's used for anything that matters (receipts, recovery).

**Sign out**
- `signOut()` ends this browser's WorkOS session and returns to the welcome page.
- Nothing is left in storage: the in-memory token is gone and the cookie is cleared by AuthKit.

**Sign out everywhere** (Account → Devices)
1. The server lists the user's WorkOS sessions and revokes each one, so their refresh tokens stop working.
2. It also records a revocation cut-off and the revoked session ids, so access tokens already issued (they last minutes) are refused at once.
3. The page making the request is signed out last.
4. Playback on other devices stops within the device lease ([§11A.1](11a-devices-and-rooms.md#11a1-devices-and-the-playback-session)).

**Delete account** ([§5.5](05-storage-uploads-playback.md#55-deletion), [§12.4](12-security-privacy-legal.md#124-data-lifecycle)):
- The account is hidden and every session revoked at once.
- Signing in during the 30-day recovery window shows "This account is being deleted", with a way to contact support to restore it.
- When erasure finishes, the WorkOS user is deleted too, so the same email or Google account can start fresh.

### 7A.3 What the server checks on every request

1. A bearer token is present and well formed.
2. It's signed RS256 by a key in AuthKit's JWKS, from our issuer, unexpired (60 s leeway).
3. Its session id (`sid`) isn't in the revoked list, and it wasn't issued before the user's revocation cut-off.
4. The user exists in Selecta (otherwise only onboarding is allowed) and isn't deleted. A suspended account is read-only: reads (GET, HEAD) go ahead, and anything else is refused, except signing out everywhere and deleting the account.
5. The workspace in `X-Workspace-ID` is one the user belongs to; RLS is set for it. Otherwise the answer is a 404, the same as for a workspace that doesn't exist, so it never reveals that someone else's workspace exists.

Each refusal has its own code, so the app can show the right message instead of a generic error:

| Code | Status | When |
|---|---|---|
| `token_invalid` | 401 | The token is missing a valid signature, issuer or claim |
| `token_expired` | 401 | The token has expired |
| `session_revoked` | 401 | The session id is revoked, or the token predates the revocation cut-off |
| `not_onboarded` | 409 | No Selecta account yet: only onboarding is allowed |
| `account_deleting` | 403 | The account is being deleted |
| `account_suspended` | 403 | The account is suspended and the request would change or process data |
| `workspace_not_found` | 404 | The workspace doesn't exist or isn't one of the user's |

### 7A.4 WorkOS webhooks

`POST /api/webhooks/workos` verifies the `WorkOS-Signature` header (`t=…,v1=…`, HMAC-SHA256 over `"{t}.{raw body}"`, 5-minute tolerance, constant-time comparison), stores each event id once, and processes:

| Event | Selecta does |
|---|---|
| `user.updated` | Sync email and verified status |
| `user.deleted` | Mark the account for deletion, if it isn't already being deleted |
| `session.revoked` | Add the session id to the revoked list |
| password reset succeeded | Revoke the user's other sessions |
| `email_verification.succeeded` | Mark the email verified |

Unknown event types are stored and ignored. Events can arrive late, twice or out of order, so each one is a "poke": Selecta re-reads the user from WorkOS rather than trusting the payload's snapshot. The route is owned by a core cloud flag, so it can't be switched off.

### 7A.5 Staff sign-in

- Staff are members of a "Selecta Staff" organization in WorkOS, with MFA required by that organization's policy.
- Entering the admin console needs a token from that organization issued within the last 5 minutes (a fresh sign-in).
- The server then creates a privileged session row (id, user, WorkOS `sid`, `issued_at`, `mfa_at`, ending at most 1 hour later) and builds the `Actor` that `authorize()` checks ([§7.3](07-identity-rbac-admin.md#73-staff-rbac)) from that row, never from the client.
- Revoking the WorkOS session or any role change ends the privileged session.

### 7A.6 Edge cases

| Case | Behaviour |
|---|---|
| Token without email (AuthKit's default) | Onboarding reads email from WorkOS by subject |
| Unverified email reaches onboarding | 403 `verified_email_required`; the app sends them back to verify |
| Under 13, or age box not ticked | Onboarding refused; nothing is stored |
| Two tabs finish onboarding at once | One account (unique subject, retried insert) |
| Refresh in two tabs at once | The SDK serialises refreshes; a rotated refresh token is never reused |
| Clock wrong on the device | Tokens are judged by server time; 60 s leeway only |
| JWKS rotation, or an unknown `kid` | One refetch, rate-limited; an outage answers 503, not 401 |
| Revoked session's access token still in a tab | Refused at once by `sid` and cut-off checks |
| Password reset on one device | Every other session revoked |
| Google email changed by Google | `user.updated` syncs it; the account stays the same |
| Same person signs up twice (password, then Google) | Linked by verified email into one account |
| Account being deleted signs in | `account_deleting` page with the restore route |
| Account erased, same email signs up | A brand-new account (the WorkOS user was deleted at erasure) |
| Suspended account | Read-only: can view its own data, export, sign out and delete; anything else answers `account_suspended` |
| `return_to` link after sign-in | Only same-origin paths; anything else goes to the home page |
| Sign-up abuse (many accounts) | AuthKit's bot protection plus our sign-up flag (`cloud.signups`) and rate limits |
| WorkOS outage | Existing access tokens keep working until expiry; new sign-ins show a clear outage message; the status page says so |
| Webhook replay or forgery | Signature and timestamp checks; event ids stored once |
| Staff token from outside the staff organization | Admin console refused, audited |

### 7A.7 Setting it up (runbook outline)

1. In WorkOS, create staging and production environments; set the redirect URIs to exactly the app origins.
2. Set the custom auth domain (`auth.selecta.app`) for production, with DNS from WorkOS.
3. Enable email and password, Magic Auth and Google. Production uses our own Google OAuth client, so Google's consent screen says "SelectaDJ"; staging may use WorkOS's demo credentials.
4. Keep email verification required (the default) and turn on bot protection.
5. Create the "Selecta Staff" organization with MFA required.
6. Add the webhook endpoint for the events in §7A.4, and store its secret in the hosting secret store.
7. Set `SELECTA_WORKOS_CLIENT_ID`, `SELECTA_WORKOS_API_KEY`, `SELECTA_AUTH_ISSUER`, `SELECTA_WORKOS_WEBHOOK_SECRET`, and `VITE_WORKOS_CLIENT_ID` and `VITE_WORKOS_API_HOSTNAME` for the site.
8. Decode one real token from each environment and confirm the issuer and claims match what the API expects.

---

[← 07-identity-rbac-admin.md](07-identity-rbac-admin.md) · [Contents](README.md#chapters) · [08-billing.md →](08-billing.md)
