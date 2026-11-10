*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 7. Identity, roles and the admin console

### 7.1 Sign-in

- **WorkOS AuthKit** (free up to 1M monthly active users; email + password, magic link, Google/Apple sign-in, MFA, passkeys). Clerk is the fallback choice (better prebuilt UI, costs more at scale).
- The API verifies AuthKit JWTs against the JWKS on every request; sessions are short-lived access tokens + refresh in an HttpOnly, Secure, SameSite=Lax cookie on the app's domain. No tokens in `localStorage`.
- Account lifecycle: sign-up → email verification → personal workspace created → Free plan → onboarding. Email change re-verifies. Account deletion starts the deletion workflow and cancels the Stripe subscription.
- Minimum age 13 (UK GDPR age of consent for online services), stated at sign-up.

### 7.2 Three separate permission systems

1. **Plan** (Free/Standard/Premium): what the workspace may consume.
2. **Workspace role** (owner/editor/viewer): personal workspaces only at launch; the schema supports sharing later.
3. **Platform role** (staff): what a Selecta operator may do. A Premium subscriber is never staff; staff browsing their own library act as a customer.

### 7.3 Staff RBAC

- **Permissions** are stable strings in a code registry (`selecta/authz/permissions.py`), e.g. `jobs.read`, `jobs.retry`, `queues.policy.propose`, `workers.scale`, `models.routing.apply`, `accounts.read_metadata`, `accounts.suspend`, `billing.overrides.create`, `security.roles.assign`, `audit.read`, `support.content_access.request`.
- **Roles** are code-defined bundles (versioned with the code, not editable in the UI at launch): Owner, Admin, Operator, AI Admin, Support, Billing, Analyst, Auditor.
- **Assignments** live in the database with scope (`platform:*`, `platform:operations`, `support_case:{id}`, `workspace:{id}`), issuer, reason and optional expiry.
- **Every request** resolves actor → active assignments → permission + scope + resource → extra conditions (fresh MFA, approval) → allow or 403, and audits sensitive allows and all denies on admin routes.
- **No staff access to customer audio by default.** Listening to a user's track requires a time-limited `support.content_access` grant tied to a support case, with the user's consent recorded, and is audited.
- **Staff sessions**: separate admin session with 1-hour lifetime, MFA required (passkey/security key preferred), step-up re-auth within 5 minutes for dangerous actions, all sessions revoked on role change.

### 7.4 Dangerous actions when there's only one staff member

Two-person approval is the right design, but at launch you're the only operator. Substitute: **delayed execution with alerts**. Dangerous actions (changing tier weights by more than 50%, assigning Owner, bulk deletion, disabling an emergency control, mass entitlement overrides) are queued for 15 minutes, email and push-notify you, can be cancelled, then execute with a re-check. When a second staff member exists, switch the same actions to two-person approval. A break-glass Owner credential lives offline on a hardware key.

### 7.5 Admin console v1 (six pages, before beta)

Built as a lazy-loaded `/admin` area of the same React app, hidden unless the session has staff roles, with every action enforced server-side. It reuses the design system and adds a data table and simple charts.

1. **Overview**: service health (API, Postgres, R2, Modal, Anthropic, Stripe webhooks), active users, jobs waiting per pool and lane, oldest eligible job, p95 wait by tier, worker counts, today's spend (compute, AI, storage), failed/quarantined jobs, open incidents. Every number shows its freshness.
2. **Jobs & workers**: search by job/workspace/type/state; job detail with dependency graph, attempts, leases, worker, timings, costs, error; actions: retry, cancel, quarantine, release (all as audited commands, never direct edits); worker list with drain/pause; pool min/max and spend ceiling.
3. **Accounts & billing**: search accounts (metadata only: email, plan, status, storage used, usage, recent failures); Stripe reconciliation state; entitlement overrides with reason and expiry; suspend/restore.
4. **AI routing**: tier → model deployment table, limits, fallback chain, rollout percentage, current cost per tier, provider health, emergency disable.
5. **Security**: staff list, role assignments, sessions, access grants, audit log search.
6. **Flags**: kill switches, per-tier and per-user rules, rollouts, impact preview, "what does this user see and why", history and rollback ([§11B.5](11b-feature-flags.md#11b5-the-admin-flags-page-joins-admin-v1-making-six-pages)).

**As built (console).** `web/src/admin/` is the console, loaded only when a staff member opens it (`React.lazy` from `CloudApp`), and linked only when `/api/account` says the person is staff and `admin.console` is on. Entering it starts an admin session, kept in memory only. Each of the six pages is shown when the session's roles hold that page's read permission, and each action is a command with a typed reason. The pages reuse the Cloud tokens and a small `web/src/ui/DataTable.tsx`. Verified with Vitest against a fake admin API (`AdminArea.test.tsx`); there is no Cloud browser-test server yet, so no Playwright walkthrough. Not built yet: the job dependency graph as a picture (it's a table), pool min/max and spend ceiling editing, Stripe reconciliation drill-down, current cost per tier and provider health (these show as unknown until something reports them).

Later pages: queue policy editor with simulator forecast, storage inventory and cleanup (dry-run then approved batch), audio quality dashboard (transition success, fallback rate, validation failures, human ratings), Rooms overview (open rooms, guests, abuse signals), deployments, incidents, stress-test reports.

**Read vs command paths.** Dashboards read from metrics (Grafana Cloud) and small aggregate tables refreshed every 15–60 s, never from heavy scans of the live jobs table. Actions go through the same transactional services customers use.

### 7.6 Audit log

Append-only `audit_events` written by a dedicated role (the app role can insert but not update/delete), exported daily to a write-once R2 bucket. Records: staff logins, role changes, grants, overrides, model/queue policy changes, emergency controls, account suspensions, content access, data exports, denied admin requests. No secrets, prompts, audio or signed URLs in audit rows. An alert fires if audit writes stop.

**As built (backend).** The admin API is `selecta/admin/` under `/api/admin/`, owned by the `admin.console` flag. A request carries the bearer token and the admin session id from `POST /api/admin/session` in `X-Admin-Session`; the actor is built from the stored session only. Every action is a command that calls `authorize()` and writes an audit row: job retry, cancel, quarantine (a staff hold: the job waits in `blocked` with error class `staff_hold`) and release; worker drain, pause and resume; entitlement overrides with reason and expiry (overrides for many workspaces are the delayed action `billing.overrides.mass`); account suspend and restore; role assignment. Overview numbers come from the small `admin_metrics` table, refreshed at most every 30 seconds, and each carries its as-of time and a state: fresh, stale (after two minutes) or unknown (after ten, when the value is withheld). Refusals of escalation, content access without a grant, audit changes, bulk account paging and self-approval raise a `platform_alerts` row; `tests/test_cloud_security_admin_drill.py` is the compromised-admin drill. Account searches are audited, capped at 50 a page and refused after 30 in ten minutes.

---

[← 06-data-model.md](06-data-model.md) · [Contents](README.md#chapters) · [07a-authentication.md →](07a-authentication.md)
