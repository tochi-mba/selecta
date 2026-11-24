*Part of the [Selecta Cloud proposal](README.md). Written 2026-11-24 after a staff walkthrough of the v1 console. It extends [07 §7.3 to §7.6](07-identity-rbac-admin.md); where they differ, this chapter wins for the console.*

## 7B. The staff admin console in full

The console is how one operator runs a paying product on day 1 and how a small team runs it on day 1,000. It must answer "is anything wrong?" in five seconds, take any customer question to the right record in one step, and make it hard to do harm by accident. This chapter is the design: the walkthrough that led to it, the pages, every action with its rules, the role matrix, onboarding and help, and the safety rules the server enforces. "As built" at the end says honestly what exists.

### 7B.1 What the walkthrough found (v1, 24 November 2026)

Walked with Playwright on the local stack at 1440x900, 1024x768 and 390x844, as the seeded Owner and as one sign-in per role. Screenshots are kept with the agent report, not in the repo.

- **The console could not be entered locally at all.** The local identity provider never issued the staff organization, and the dev API had no staff organization configured, so "Enter console" answered 503. Fixed: staff sign-ins carry `org_selectadj_local_staff`, and `dev.cmd cloud --seed` makes the seeded account Owner.
- **Nothing made the first Owner.** `bootstrap_owner()` had no caller. Fixed: `selecta admin bootstrap-owner` (§7B.2).
- **The console link is buried** in the account corner of the rail, and a reload of any `/admin/...` page drops the in-memory admin session and asks to enter again with a fresh sign-in.
- **Overview reads like a database dump:** raw metric names (`health.anthropic`, `jobs.failed_24h`), "1" for a healthy database, every external dependency "Unknown, never measured", no signups, paying customers, revenue or churn, and fifteen red "Engage" buttons for emergency controls taking most of the page. Nobody could say in five seconds whether the service is well.
- **Accounts:** the list loads unfiltered (an audited search on every visit), has no paging, no created date, no staff marker, no copy id, and the record opens below the list with no URL. There is no billing history, devices, rooms, Lucy usage, notes, staff-action history, sign-out-everywhere, export or deletion.
- **Security:** assignments cannot be revoked from the page, there is no form to assign a role, admin sessions show raw user ids and cannot be ended, the audit log shows ISO timestamps and raw ids with no paging or export.
- **Jobs:** type and state are free-text boxes, so a typo silently matches nothing.
- **AI routing** lists tier routes to deployments (`haiku-low`, `sonnet-medium`) that the deployments table does not contain locally, with no warning.
- **Business pilots** is shown with its flag off and its request fails with 403 on every visit; a page whose feature is off must be hidden, not broken.
- **Roles:** Billing sees Accounts but cannot see its own audit trail; Support and Billing can see that a page exists only by trying; no page says what a role cannot do or whom to ask.
- **No help, no tour, no empty state that explains anything, no command palette, no environment marker, no read-only mode, no idempotency, no record version check, no undo.**

### 7B.2 Making the first Owner

`selecta admin bootstrap-owner --email <sign-in email> --reason "<10+ characters>"`, run once per environment in the API service's Render shell. It refuses when any active Owner exists, when the email has no SelectaDJ account (sign in once first), or when the account is suspended or deleted; it takes a PostgreSQL advisory lock; it prints only the user id; it audits `role.assigned` and `admin.owner.bootstrap` and raises `security.owner_bootstrapped`. To enter the console the person must also belong to the WorkOS staff organization in `SELECTA_STAFF_ORGANIZATION_ID`. Every later Owner is made in the console (Staff, Make Owner), which waits 15 minutes and can be cancelled.

### 7B.3 Shape of the console

- **One shell:** an environment bar (name and colour: Local, Staging, Production) that never scrolls away; the page header (breadcrumbs, title, the page's two or three most used actions, a "?" help button); the mode bar ("Viewing" or "Making changes, 14 min left"); a search box that recognises what is pasted; a bell for alerts and waiting actions; the command palette on Ctrl+K or Cmd+K.
- **Navigation:** Overview, Customers, Billing, Jobs, AI, Flags, Content, Staff and security, Communications, System, Business pilots. A page is listed only when the person's roles hold its read permission and its feature flag is on. Every page, tab, filter and record has a URL; reloading keeps it and re-enters the console when the sign-in is still fresh.
- **One grammar:** the same table (sort, filter chips, column choice, saved views, copy id, row opens the record, keyboard navigation, sticky header, numbers right-aligned in tabular figures, status as a small quiet badge), the same record layout (breadcrumbs; identity and actions on top; a wide column of changing things; a narrow column of stable facts with copyable ids), the same verbs (Suspend, Restore, Retry, Cancel, Revoke, Grant, Extend), relative times with the exact local time on hover.
- **Restraint:** colour only for meaning (status, danger, the one primary action); no box around everything; skeletons that match the final layout; every page has loading, empty, error and stale states.
- **Phone at 390 px:** tables become cards, the header actions stay reachable, emergency controls and alerts work one-handed, tours become bottom sheets.

### 7B.4 Pages

Each table lists its columns, then filters. Every list is paged (cursor, at most 50 per page; the audit log 200).

**Overview** (`platform.dashboard.read`). One sentence first: "All systems normal" or what is wrong, worst first. Then the key numbers, each with its freshness and a small trend where history exists:

| Number | Source | Notes |
|---|---|---|
| Service health: API, database, object storage, workers, AI provider, Stripe webhooks, WorkOS webhooks | `admin_metrics` health rows, written by whatever measures them; the API reports itself and the database on each refresh; Stripe and WorkOS from the age of their newest processed event | Unknown until measured, never shown as healthy by default |
| Signups today and in 7 days | `users.created_at` | |
| Active today | `users.active_today` metric | Unknown until the session reporter writes it |
| Paying customers | our `subscriptions` with status active, trialing or past_due | Stripe is the source of truth; ours is a mirror refreshed by webhooks and the nightly reconcile |
| MRR | sum of active subscriptions' unit price and quantity, monthly-normalised, from the stored Stripe object | Shown per currency; "from our copy of Stripe" stated |
| Churn (30 days) | subscriptions that became canceled in 30 days over paying at the start | |
| Past due | `subscriptions.past_due_since` set | Links to Billing, past due |
| Failed jobs and staff holds (24 h) | `admin_metrics` | Links to Jobs, filtered |
| Stuck Stripe events | `stripe_events` not processed after 15 minutes | Links to Billing, events |
| AI spend today against the ceiling | `economics` Lucy ceiling | |
| Open alerts and waiting dangerous actions | `platform_alerts`, `dangerous_actions` | |

Below: the Owner setup checklist (§7B.8) while items remain, then recent alerts. Emergency controls are one line ("All emergency controls off" or which are engaged) linking to System, never fifteen buttons on Overview.

**Customers** (`accounts.list`; record `accounts.read_metadata`). Search by email, user id, workspace id, Stripe customer (`cus_`) or subscription (`sub_`) id, or an error reference. Table: email, plan and its source, status (active, suspended, deletion pending), staff marker, created, storage, failed jobs (24 h). Filters: plan, status, created range. The list starts empty with a search box; it never loads every customer.

The customer record (`/admin/customers/<user id>/<tab>`): header with email, plan badge, status and the actions Grant time, Sign out everywhere, Suspend (or Restore). Right column: user id, workspace id, Stripe customer id (copy, and a link to Stripe's dashboard), created, timezone, plan and why (the entitlement source: paid, override, grace), staff marker. Tabs:

- **Overview:** entitlement and why, overrides with expiry, storage used against the limit, upload restriction and takedown count.
- **Billing:** subscriptions with status, price, period end, cancel at period end, past due since; Stripe events for this customer; a "Refund in Stripe" link to the Stripe dashboard (we never move money ourselves); "Re-sync from Stripe".
- **Devices and rooms:** devices (name, kind, last seen; never tokens) and rooms (open or closed, created, guests); counts only where the other team's read model gives no more.
- **Lucy:** turns and spend this period against the plan allowance. Never prompt text.
- **Jobs:** this workspace's jobs, filtered link to Jobs.
- **Activity:** staff actions on this customer from the audit log, newest first, each with who, why and "Reverse this" where reversal exists.
- **Notes:** staff notes (who, when; never shown to the customer).

Support actions and their rules are in §7B.5. Impersonation is **not built**: a "view as" would show a customer's library and history to staff, which the privacy design (doc 12) forbids without consent machinery we do not have. Rejected for launch; support uses the read-only record and, for audio, the existing consented content grant.

**Billing** (`billing.subscriptions.read`). Tabs: Reconciliation (our status, price and period end against Stripe's, from the nightly reconcile's last run; mismatches first; "Re-sync" per row), Past due and grace (since when, grace ends, last payment error), Events (Stripe events by status; failed and stuck first; "Retry processing"), Disputes (lost or open, from the subscription mirror), Price map (each configured price: plan, version, interval; prices our subscriptions use that the map lacks are an error).

**Jobs and workers** (`jobs.read`, `workers.read`). Jobs: state and type as selects, workspace and id as text; columns id, type, state, pool and lane, attempts, created, error class. Job record with attempts, dependencies and costs; actions Retry, Cancel, Hold, Release. Workers: pool, slots, last seen, hold; Drain, Pause, Resume.

**AI** (`models.read`). Tier routing, deployments with a warning for any route naming a missing deployment, spend against the ceiling, provider health, the two Lucy emergency controls.

**Flags** (`flags.read`). As built in doc 11B, with history and roll back.

**Content** (`legal.takedowns.read`). Takedown and DMCA queue: received, work, complainant, workspace, status, due by with a countdown, overdue first; Act or Reject with reason; repeat-infringer restrictions and Lift. Abuse reports and open rooms appear here when the rooms team exposes them (§7B.11).

**Staff and security** (`security.audit.read`). Staff: person, roles with scope and expiry, last admin session, MFA (from the staff organization's policy, stated as such). Assign a role (scope, expiry, reason), Revoke, Make Owner (delayed). Admin sessions: person, started, ends; End session. Content grants. Audit log: search by actor, action, resource, workspace, result and time; export of the current filter as CSV (audited, at most 5,000 rows, `audit.read`). Alerts with Acknowledge.

**Communications** (`platform.incidents.manage`). The status banner every signed-in customer sees: text, level (information, maintenance, incident), starts and ends, dismissable or not, a live preview; at most one active. Maintenance windows are banners with a start and end.

**System** (`platform.dashboard.read`). Web and API version (commit), migration head of the database against the code, config sanity (each required setting named as set or missing, never its value), emergency controls in full, backups and the last restore drill when the operations tooling reports them.

### 7B.5 Actions, permissions and tiers

The tier is declared in code next to the action (`selecta/admin/tiers.py`) and enforced by the server (§7B.7). "Undo" means the opposite action runs with the same record.

| Action | Permission | Tier | Undo or delay | Notes |
|---|---|---|---|---|
| Search, open, filter, add a note | read permissions, `support.cases.manage` for notes | Safe | | Searches audited and rate limited |
| Retry a job | `jobs.retry` | Careful | | Retry is new work, nothing to undo |
| Hold a job / Release | `jobs.cancel` / `jobs.retry` | Careful | Release / Hold | |
| Cancel a job | `jobs.cancel` | Dangerous | cannot be undone | type the job id's first 8 characters |
| Drain or pause a worker / Resume | `workers.drain` | Careful | Resume | |
| Grant time (entitlement override, expiring) | `billing.overrides.create` | Careful | Revoke override | Not on your own workspace |
| Revoke an override | `billing.overrides.create` | Careful | Grant again | |
| Re-sync a subscription from Stripe | `billing.subscriptions.reconcile` | Safe | | Reads Stripe, writes our mirror |
| Retry a stuck Stripe event | `billing.subscriptions.reconcile` | Careful | | Idempotent by event id |
| Sign out everywhere | `security.sessions.revoke` | Careful | | Customer signs in again |
| Suspend an account / Restore | `accounts.suspend` / `accounts.restore` | Dangerous / Careful | Restore | type the email; max 10 an hour |
| Start account deletion (30-day path) | `accounts.suspend` | Dangerous | cancellable for 30 days by the customer's own path | type the email; never immediate |
| Export a customer's data | `support.diagnostics.read` | Dangerous | | the existing export workflow; audited |
| Overrides for many workspaces | `billing.overrides.create` | Delayed | 15 minutes, cancellable | dry run first, max 500 |
| Assign a role below Owner | `security.roles.assign` | Dangerous | Revoke | only roles whose permissions you hold |
| Revoke a role | `security.roles.assign` (Owner rows `security.owners.assign`) | Dangerous | Assign again | never the last Owner |
| Make Owner | `security.owners.assign` | Delayed | 15 minutes, cancellable | |
| End an admin session | `security.sessions.revoke` | Careful | | |
| Acknowledge an alert | `platform.dashboard.read` | Safe | | |
| Engage an emergency control | `platform.emergency_controls.manage` | Dangerous | Release is delayed | type the control name |
| Release an emergency control | `platform.emergency_controls.manage` | Delayed | 15 minutes | |
| Flag kill switch, 100 percent rules | `flags.kill_switch`, `flags.rules.apply` | Dangerous / Delayed | Roll back | as doc 11B |
| AI routing change | `models.routing.apply` | Dangerous | Roll back | |
| Publish or end the status banner | `platform.incidents.manage` | Dangerous (reaches every customer) | End banner | type "publish" |
| Act on a takedown / Reject | `legal.takedowns.manage` | Dangerous / Careful | | |
| Export the audit log | `audit.read` | Careful | | at most 5,000 rows, audited |

### 7B.6 Roles

| Permission area | Owner | Admin | Operator | AI Admin | Support | Billing | Analyst | Auditor |
|---|---|---|---|---|---|---|---|---|
| Overview, System (read) | yes | yes | yes | yes | yes | yes | yes | yes |
| Customers: search and open | yes | yes | | | yes | yes | | |
| Customers: suspend, restore, delete | yes | yes | | | | | | |
| Sign out everywhere | yes | yes | | | | | | |
| Grant time (overrides) | yes | yes | | | | yes | | |
| Billing: read | yes | yes | | | yes | yes | | yes |
| Billing: re-sync, retry events | yes | yes | | | | yes | | |
| Jobs and workers: read | yes | yes | yes | yes | yes | | yes | yes |
| Jobs: retry | yes | yes | yes | | yes | | | |
| Jobs: cancel, hold; workers | yes | yes | yes | | | | | |
| AI: read / apply routing | yes / yes | yes / yes | yes / | yes / yes | | | yes / | yes / |
| Flags: read / kill switch | yes / yes | yes / yes | yes / yes | yes / yes (Lucy flags) | yes / | yes / | yes / | yes / |
| Emergency controls | yes | yes | yes | | | | | |
| Content and takedowns | yes | yes | | | | | | |
| Communications (banner) | yes | yes | yes | | | | | |
| Staff and audit: read | yes | yes | | | | | | yes |
| Assign roles below Owner | yes | yes | | | | | | |
| Make or revoke Owner | yes | | | | | | | |
| Export the audit log | yes | yes | | | | | | yes |

Rules the server enforces on roles: nobody assigns themselves; nobody assigns a role holding a permission they lack (so an Admin cannot make an Owner and nobody climbs above their own role); the last active Owner can't be revoked; any role change ends that person's admin sessions at once; an expired assignment stops working on the next request; staff roles never change the person's own customer account, and suspending a customer account never touches staff roles (a suspended person cannot enter the console, since sign-in refuses them, but their assignments stay for when they are restored).

### 7B.7 Safety: hard to do harm by accident

The owner's rule: it must not be easy to do something by accident. These are enforced by the server; the console only makes them pleasant.

**Tiers** (`selecta/admin/tiers.py`, one entry per action):

- **Safe:** reads, filters, notes. No confirmation.
- **Careful:** changes one record and can be reversed. It runs at once with no dialog; the result line names what happened ("Held job 01a2... for staff review") with Undo for 10 seconds. Dialogs are kept for what can't be undone, so they keep their meaning.
- **Dangerous:** money, access, data, many customers, or irreversible. A dialog lists the consequences (who, how many, what they will see, reversible or not), needs a reason (common reasons offered), needs the target typed (the email, the count, the control name), and needs an admin session started within the last 5 minutes (step-up: sign in again). The button names the consequence ("Suspend jo@example.com"). The irreversibility band appears only when it truly can't be undone.
- **Delayed:** the highest (Owner assignment, mass overrides, bulk deletion, releasing an emergency control) wait 15 minutes with a countdown, Cancel, and an alert to every Owner, then re-check everything when they run.

**Server checks on every write** (`selecta/admin/safety.py`):

1. **Read-only by default.** An admin session starts in view mode; writes are refused with `view_mode` until "Make changes" (`POST /api/admin/session/changes`) opens a change window of 15 minutes, renewed by each write and ended by "Stop making changes". Roles with no write permission never get the button.
2. **Idempotency.** Every write carries an `Idempotency-Key`; a repeat of the same key by the same person within 10 minutes returns the first answer marked `replayed` and does nothing. The console disables a button while it is pending.
3. **Version check.** Each record's read gives a `version` (a digest of the fields an action depends on) and the time it was read. A Careful or Dangerous action sends both; the server refuses with `record_changed` ("This record changed. Review it again.") when the record differs or was read more than 10 minutes ago.
4. **Type to confirm.** Dangerous actions send `confirm`; the server compares it with the target's identity and refuses `confirm_mismatch`.
5. **Step-up.** Dangerous actions need the admin session to have started within 5 minutes.
6. **Blast limits.** Per staff member per hour: 10 suspensions, 20 sign-outs, 20 overrides, 5 role changes, 5 emergency engagements. The limit refuses with `blast_limit` and alerts every Owner.
7. **Own account.** Acting on your own account or a workspace you belong to is refused and alerted.
8. **Bulk.** Bulk actions need a dry run first (count, a sample, what changes); the run must quote the dry run's digest; at most 500 per run; more goes the delayed path.
9. **Stale tabs.** A session that ended, or whose roles changed, refuses every request with `admin_session_ended`; nothing is half applied because each command is one transaction.

**In the console:** focus starts on Cancel; Enter never confirms a dangerous dialog (only a click or Space on its button does); a button newly enabled ignores clicks for 500 ms; dialogs open centred and never under the pointer; destructive buttons sit apart from safe ones and look destructive; selection clears when the page or filter changes; production confirmations say "Production" and the first console visit in a session on production shows one quiet notice; customer data views show who is looking in a persistent banner.

### 7B.8 Onboarding, help and tutorials

- **Welcome (first visit):** what the console is for, the person's roles, one line each on what the role can and cannot do, who invited them and when; "Take the tour" or "Skip". Never blocks; never shown again once finished or skipped; Help reopens it. Stored per person on the server (`staff_preferences`).
- **Owner setup checklist** (Owners only, while items remain), on Overview: turn on two-factor sign-in (the staff organization's MFA policy); check the config sanity page; confirm the support address; look at Stripe reconciliation; set the maintenance banner text; invite a second staff member with a narrower role; read the incident runbook. Each shows its status (checked by the server where it can be, otherwise marked by the person) and links to the place. Dismissable once done.
- **New staff member:** the role assignment carries who issued it and why; the first visit shows it with the role's purpose and the first thing to do. (Invite emails need the mail sender; until then the Owner tells the person to sign in and open the console.)
- **Tours:** one per page, 3 to 6 steps, each pointing at a real part of the page (`data-tour` anchors), skipping parts the role can't see. Focus moves to each step, steps are announced, Escape ends it; at 390 px a step is a bottom sheet; motion follows the Still, Subtle and Expressive setting and reduced motion. Progress saved on the server; Help has "Replay tour".
- **Help panel** on every page ("?" button and the `?` key): what the page is for, what each number means and where it comes from, how fresh it is, common tasks, and the runbook link. The text is a typed file next to the pages (`web/src/admin/help.ts`); a test fails when a page has no help.
- **What's this:** every metric, badge and column header carries a plain-words explanation (stale, unknown, past-due grace, staff hold).
- **Playbooks** ("How do I"), from Help and the palette, each step linking into the right screen with filters set: refund a customer; a customer can't sign in; a payment failed; an incident is happening; a takedown arrived; add a staff member; change a flag safely; undo a mistake.
- **Command palette** (Ctrl+K, Cmd+K): pages, playbooks, records by pasted id, and safe actions. It never runs a Careful or Dangerous action itself; it opens the record where the action lives.
- **Search box:** recognises an email, a user, workspace or job id, `cus_` and `sub_` ids, and an error reference, and goes straight to the record (`GET /api/admin/lookup`, permission-checked, audited, rate limited).
- **Bell:** unacknowledged alerts, delayed actions about to run, approvals waiting; each links to its place.
- **Empty states that teach:** "No alerts. When a staff member is refused something that looks like an attack, or an emergency control changes, it appears here." and similar on every list.
- **Disabled, not hidden, for actions:** a person who can see a record but not act sees the action disabled with "Needs the Billing role" (from the role matrix), so they learn whom to ask. Pages a role can't read are hidden.

### 7B.9 Edge cases the tests cover

The last Owner can't be removed or demoted; nobody grants a role they don't fully hold; role changes end admin sessions at once; expired assignments stop on the next request; a stale record is refused; a session older than an hour is refused and dangerous actions need step-up; delayed actions can be cancelled and re-check when they run; a suspended staff member's customer account and staff roles are independent; acting on your own workspace is refused; search is rate limited and audited; bulk actions need a dry run; exports are audited and capped; no secret, card number, audio or prompt text is ever returned (a test scans every admin answer for secret-shaped strings); every list is paged; every page has loading, empty, error and stale states; the console works with a page's flag off (hidden, not broken); keyboard and screen reader paths; 390 px.

### 7B.10 Not doing, and why

- **"View as" impersonation:** rejected for launch (privacy; §7B.4).
- **Refunds inside the console:** money moves only in Stripe's dashboard; the console links there and records the reason as a note.
- **Editing roles in the UI:** roles stay code-defined (ADR-0401).

### 7B.11 For other teams

- Devices and rooms: a read model `admin_summary(conn, workspace_id)` returning device and room counts and last-seen times, without tokens, would let the customer record show more than counts.
- Lucy: a per-workspace "turns and spend this period" function, without prompt text, for the customer record.
- Product audit: the customer-side status banner needs a slot in the Cloud shell (`GET /api/status-banner` is provided).

### 7B.12 As built

Kept current as the build lands; see the end of the PR body for the latest.
