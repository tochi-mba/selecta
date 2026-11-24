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

**The first Owner.** Nobody holds the permission to propose the first Owner, so `selecta admin bootstrap-owner --email ... --reason ...` makes it from an operator's shell (Render's shell on the API service, against `SELECTA_DATABASE_URL`). It refuses once any active Owner exists, refuses unknown, suspended or deleted accounts, takes a PostgreSQL advisory lock so two shells can't race, prints only the user id, audits `role.assigned` and `admin.owner.bootstrap`, and raises a `security.owner_bootstrapped` alert (`selecta/admin/bootstrap.py`, `tests/test_admin_bootstrap_owner.py`). The local stack's `dev.cmd cloud --seed` makes `dev@selectadj.test` the Owner when the local database has none, puts it in a local staff organization (`org_selectadj_local_staff`) so its sign-ins can enter the console, and adds one sign-in per role, `staff-<role>@selectadj.test` plus `staff-none@...` with no role. The full console design is [07b](07b-admin-console.md).

### 7.5 The admin console

The console is designed in full in [07b](07b-admin-console.md): pages, every action with its permission and tier, the role matrix, the safety rules, onboarding and help, and the integrations. This section says what it is and what is built.

It is a lazy-loaded `/admin` area of the same React app (`web/src/admin/`), linked as "Staff console" in the account menu and the More panel only when `/api/account` says the person is staff and `admin.console` is on. Every action is enforced on the server; the console only decides what to draw.

**As built (console, 2026-11-25).**

- **Pages:** Overview (one sentence about the service, then paying customers, MRR, churn, sign-ups, past due, stuck Stripe events, waiting actions and alerts, each explained; services by plain name with what feeds each; the Owner setup checklist), Customers (search, never an unfiltered list; Mode, Plan, Status, Library columns; a record with tabs for overview and grant time, configuration (storage mode), billing (Stripe live, then our copy), devices and rooms, sign-ins (WorkOS live), staff activity and notes), Billing (reconciliation, past due, Stripe events, disputes, the price map), Jobs and workers, AI, Flags, Content (takedown notices with deadlines), Emergency (controls grouped by control, engaged first), Staff and security (staff, Add a staff member, the role matrix, admin sessions, waiting dangerous actions, the audit log with CSV export, alerts), Communications (the status banner customers see), System (deployed commit, schema against code, settings set or missing, integrations connected or not), Business pilots (hidden when `business.pilots` is off). Every page, tab, record and filter has a URL.
- **Safety:** the console opens in view mode and the server refuses every admin write until "Make changes" opens a 15 minute window; actions carry a tier in code (`selecta/admin/tiers.py`) that the server enforces (`selecta/admin/safety.py`): version checks on records, typed confirmation and a sign-in from the last 5 minutes for dangerous ones, hourly blast limits with an Owner alert, the 15 minute delay for the highest, idempotency keys on every write, never acting on your own account. Nobody gives a role holding a permission they lack.
- **Help:** a help panel per page (`?`), a tour per page, a first-visit welcome, eight playbooks, the Ctrl+K palette (it opens places, never changes anything) and an alerts bell (`web/src/admin/help.ts`, `Guide.tsx`).
- **Integrations:** Stripe live reads and actions on the customer record, WorkOS sign-ins read and revoked; the rest show "not connected" with what they need ([07b §7B.13](07b-admin-console.md)).
- **Tests:** `web/src/admin/AdminArea.test.tsx` against a fake API, the Python admin tests (`tests/test_cloud_admin_*.py`, `tests/test_admin_*.py`) and the Playwright walkthroughs recorded in 07b.

Not built, and why, is listed in [07b §7B.12](07b-admin-console.md#7b12-as-built).

**Read vs command paths.** Dashboards read from metrics (Grafana Cloud) and small aggregate tables refreshed every 15–60 s, never from heavy scans of the live jobs table. Actions go through the same transactional services customers use.

### 7.6 Audit log

Append-only `audit_events` written by a dedicated role (the app role can insert but not update/delete), exported daily to a write-once R2 bucket. Records: staff logins, role changes, grants, overrides, model/queue policy changes, emergency controls, account suspensions, content access, data exports, denied admin requests. No secrets, prompts, audio or signed URLs in audit rows. An alert fires if audit writes stop.

**As built (backend).** The admin API is `selecta/admin/` under `/api/admin/`, owned by the `admin.console` flag. A request carries the bearer token and the admin session id from `POST /api/admin/session` in `X-Admin-Session`; the actor is built from the stored session only. Every action is a command that calls `authorize()` and writes an audit row, and every read and command checks its permission before saying whether a record exists (a test calls every admin route as staff holding no role and expects a refusal naming a registered permission): job retry, cancel, quarantine (a staff hold: the job waits in `blocked` with error class `staff_hold`) and release; worker drain, pause and resume; entitlement overrides with reason and expiry (overrides for many workspaces are the delayed action `billing.overrides.mass`); account suspend and restore; role assignment. Overview numbers come from the small `admin_metrics` table, refreshed at most every 30 seconds, and each carries its as-of time and a state: fresh, stale (after two minutes) or unknown (after ten, when the value is withheld). Refusals of escalation, content access without a grant, audit changes, bulk account paging and self-approval raise a `platform_alerts` row; `tests/test_cloud_security_admin_drill.py` is the compromised-admin drill. Account searches are audited, capped at 50 a page and refused after 30 in ten minutes.

---

[← 06-data-model.md](06-data-model.md) · [Contents](README.md#chapters) · [07a-authentication.md →](07a-authentication.md)
