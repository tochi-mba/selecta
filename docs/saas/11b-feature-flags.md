*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 11B. Feature flags and targeting

### 11B.1 What exists now (merged in PR #42 and #43, ADR-0390)

- One registry of about 90 flags in `src/selecta/flags/*.json`, one file per area, each with label, description, `core`, `default`, `requires`, the API routes, CLI commands and site surfaces it owns, and the words that name it. `docs/flags.md` is generated from it and a test keeps it current.
- `SELECTA_FLAGS` (e.g. `-requests -move.*`, `minimal`, `all`) is read **once per process**; child processes inherit it. `flags.on(id)` answers for the whole process; `resolve()` returns each flag's state and the reason (core, default, `SELECTA_FLAGS`, "needs X").
- `flags/guard.py` refuses a route whose owning flag is off with **403 `flag_off`** (never 404, which the site reads as "older server"), before the database is touched and before idempotency replay.
- Background work checks flags at its source (`stems.py`, `seams.py`, `seam_worker.py`, `planner/vibes.py`, `lyrics/lrclib.py`, `lucy/settings.py`…); a saved seam whose move is off is planned again without changing what's saved.
- The site imports the same JSON (`web/src/flags.ts`), learns which flags are on from `/api/status`, and every page closes up around a feature that's off: no link, word, tab or empty container. A Playwright sweep (`web/e2e/flags.e2e.ts`, `pnpm e2e:flags`) turns each flag off in turn at 375 and 1280 px.
- ADR-0390 decided flags are **developer-only, with no switch page**, and records that as your choice.

This is an excellent base: the registry, the dependency cascade, route ownership, the 403 contract and the reflow sweep all carry over. What it lacks for the cloud is **context**: it can't say "on for this user, off for that tier", and it can't change without a restart.

### 11B.2 Four questions, kept separate

A feature reaches a user only if all four say yes. Each has a different owner and lifetime.

| Layer | Question | Owner | Changes by |
|---|---|---|---|
| 1. Build | Is this code path available in this deployment at all? | Developer | `SELECTA_FLAGS` + JSON defaults (today's system, unchanged) |
| 2. Mode | Does it make sense in this runtime mode? | Registry | New `modes` field (e.g. music folders, local backup, cache slider, bring-your-own-key Lucy are local-only; uploads, billing, Rooms are cloud-only) |
| 3. Plan | Does the account's plan include it? | Billing / plan catalogue | Entitlements ([§3](02-plans-and-economics.md#3-product-plans-entitlements-and-economics), [§8](08-billing.md#8-billing-and-entitlements-stripe-uk-business)); never a flag |
| 4. Rules | Is it currently switched on for this user, workspace, tier or cohort? | Admin, at runtime | Targeting rules (below), no restart |

Then today's `requires` cascade runs over the result, and a user's own preference (e.g. Lucy phases, already modelled in `lucy/settings.py`) applies last.

**Key rule: flags can only switch features off or roll them out; they never grant what a plan doesn't include.** Giving a Free user a Premium feature is an entitlement override ([§8.3](08-billing.md#83-entitlement-rules)), audited and expiring. This stops a mistyped rule from giving away paid features.

### 11B.3 Targeting rules

Each flag can have an ordered list of rules, evaluated against a context; the first rule that matches decides; if none match, the flag's cloud default applies.

**Context** (built once per request, job or SSE connection): environment, mode, `workspace_id`, `user_id`, plan and plan version, staff roles, account age, country, client version, device kind, and for Room guests a `guest` context with only `room_id`.

**Rule kinds**:
- **Kill switch**: off for everyone, now. Bypasses delays; for incidents.
- **Lists**: off (or on) for these user ids or workspace ids.
- **Segments**: by plan (`plan in [free]`), staff, account age, country, client version, device kind.
- **Percentage rollout**: on for N% of a segment, chosen by a stable hash of `flag_id + salt + workspace_id`, so the same account gets the same answer on every device, and raising the percentage only adds accounts. Changing the salt reshuffles and warns.
- **Schedule**: from/until (UTC), e.g. switch a feature on at launch time.

**Flag scope** (new registry field): `global`, `workspace`, `user` or `guest`, so percentage rollouts hash the right id and workspace features don't change when a different member signs in.

**Off behaviour** (new registry field `when_off`): `drain` (running work finishes; nothing new starts) or `stop` (running work stops at its next safe checkpoint). Default `drain`. What the claim path does today (`work/flag_gates.py`): a queued job whose flag is off for its workspace is taken out of its fair-share head and moved to `blocked` with the error class `flag_off` under `drain`, or cancelled (blocking whatever depends on it) under `stop`. Every `JobStore.flag_resume_s` seconds (5 by default) a claim in that pool puts its `flag_off` jobs whose flag is on again back where their prerequisites say, so drained work resumes by itself. A staff hold is a different mark and is never released this way. A job already running when its `stop` flag goes off is asked to cancel on its next heartbeat (reason `flag_off`), stops at its next `check_in()` and ends `cancelled`; only jobs of `stop` flags pay for that check.

**Plan-locked behaviour** (new registry field `when_locked`): `hide` (today's "gone as if never built") or `teaser` (shown with a lock and the plan that includes it, e.g. "Rooms · Premium"). A feature that's off only because it needs plan-locked teasers is a teaser too, naming the plan that unlocks them all; one that needs a hidden feature is hidden. A feature switched off by a rule or kill switch is always hidden, never teased, and so is anything that needs it.

### 11B.4 Enforcement in the cloud

- **One resolver**: `flags.decide(flag_id, ctx) → Decision(on, layer, reason)`, extending today's `resolve()` and `State.why`. Reasons are machine codes: `core`, `build_off`, `mode_off`, `plan_locked`, `rule_off`, `needs:<flag>`, `user_off`.
- **Middleware order and cost**: in cloud mode the authentication middleware runs first and builds the context; `guard.py` runs straight after it, still before the database is opened and before idempotency replay (as ADR-0390 requires). It reads the workspace's entitlement snapshot and the rules snapshot from per-instance caches keyed by version, so a flag decision never costs a database query; caches refresh on the same `NOTIFY` as rules, and on an entitlement-version bump.
- **API**: `guard.py` evaluates with the request context. Rule or build off → 403 `flag_off` as today. Plan-locked → 403 `plan_required` with the plan that includes it, so the site can show an upgrade prompt for teaser features.
- **Site**: `/api/status` (cloud: `/api/me`) returns the *decided* flags for that user plus, for teaser features, `locked: {flag: plan}`. **Rules are never sent to the browser** (they'd leak lists and segments). Changes arrive as a `flags.changed` event on the SSE stream; the existing reflow contract makes the feature vanish cleanly. `flags.ts` keeps its "older server: assume on" handling. Responses carrying flags are `Cache-Control: private`.
- **Jobs and workers**: each job type declares its owning flag. Producers check before creating jobs. The claim transaction re-checks for the job's workspace (an eligibility filter, [§4A.4](04-queue-and-scheduling.md#4a4-scheduling-policy)), so jobs for a feature switched off while queued become `blocked` with reason `feature_off` (`drain`) or are cancelled (`stop`). The claim response includes the decisions the worker needs, so workers never evaluate rules themselves.
- **Lucy**: tool availability is decided at the start of each turn; a kill switch stops the run at its next step.
- **Consistency**: one snapshot per request (no flag flipping halfway through a request), one per job attempt, one per Lucy turn.
- **Propagation**: rules live in Postgres (`flag_rules`, immutable `flag_rule_versions`); each API instance and the worker gateway hold an in-memory snapshot, refreshed on a Postgres `NOTIFY` and at most every 30 s. Target: a kill switch enforced everywhere within 5 s; a rollout change within 30 s. Every response carries the snapshot version in a header for debugging. **Today:** every rule change sends `pg_notify('selecta_flag_rules', version)` in its own transaction (heard only if it commits); the API and the gateway each keep one `PgListener` (`persistence/listen.py`) whose callback reloads `RulesCache` at once, and re-checks after every reconnect. Both caches also refresh when older than 5 s on their next use, the backstop for a lost notification. `tests/test_cloud_fanout.py` changes a rule on one engine and measures two API instances and the gateway, each on its own engine, picking it up by notification alone.
- **Local mode**: unchanged. No rules, no context: `SELECTA_FLAGS` and the JSON defaults, exactly as ADR-0390 describes.
- **Cloud build ceiling**: `SELECTA_FLAGS` still applies per deployment (e.g. staging `all`, production defaults), and rules can't switch on anything the build has off.

### 11B.5 The admin Flags page (joins admin v1, making six pages)

- Every flag from the registry, grouped by area as in `docs/flags.md`, with its effective cloud default and current rules.
- One-click actions: **Off for everyone** (kill switch, instant, audited, alerted), **Off for a tier**, **Off for these users** (search and pick), **Roll out to N% of a tier**, **Schedule**.
- **Impact preview** before saving: how many accounts and active sessions change, broken down by plan, and which dependent flags go off with it (from `requires`).
- **"What does this user see, and why?"**: pick an account and get every flag's decision with its reason chain. The same trace answers support questions.
- **Preview on my account**: staff can switch a flag on for themselves only, for QA.
- **History and rollback**: every change is a new version with author and reason; one click restores a previous version.
- **Safety**: broad changes (off for a whole tier, or for more than 10% of active users) use the delayed-execution rule in [§7.4](07-identity-rbac-admin.md#74-dangerous-actions-when-theres-only-one-staff-member) unless they're a kill switch; core flags can't be targeted at all; rules naming a removed flag fail CI until cleaned up by a migration.

**As built.** The page is `web/src/admin/FlagsPage.tsx`, over `selecta/admin/flags_admin.py` and the `/api/admin/flags` routes. Each action (off for everyone, off for a tier, off for these users, roll out to a share, schedule, or a raw rule list) adds one rule at the front of the flag's list. "Preview impact" counts, over every live account, how many would change, by plan, and which dependent flags follow. Applying runs the §11B.9 checks in order: `authorize()`, `may_change_flag()` on the matched assignment's role, `flags.rules.problems`, then breadth: a kill switch is instant and alerts Owners, one account's switch-off is a per-workspace override, a whole-tier switch-off or a change for more than 10% of accounts is proposed as `flags.rules.broad`, and anything smaller applies at once with `flags.rules.apply`. History lists every version with author and reason; restoring one goes through the same checks. "What does this user see, and why" runs `targeting.explain` for every flag for one account. "Preview on my account" uses `flags.preview_self`.

### 11B.6 Registry additions

New fields: `scope`, `modes`, `when_off`, `when_locked`, `kind` (`release` / `ops` / `experiment`), `owner`, `review_by` (temporary rollout flags get a date, and CI warns when it passes, so flags don't pile up). New flags for SaaS features, e.g. `cloud.uploads`, `cloud.signups`, `billing.checkout`, `rooms`, `rooms.votes`, `rooms.display`, `devices.remote_control`, `lucy.deep_plan`, `account.data_export`. New surfaces for the reflow sweep: account, billing, uploads tray, room panel, guest page, display, admin. The plan catalogue lists the flag ids each plan includes; CI fails if a plan names a flag that doesn't exist.

### 11B.7 Edge cases for flags

| Case | Behaviour |
|---|---|
| Flag turned off while a user is on that page | SSE `flags.changed`; the feature closes up; unsaved local edits in it (e.g. Stem Studio) are kept in local storage with "This feature is paused. Your changes are saved on this device." |
| Turned off while jobs are queued or running | `drain`: running finish, queued become `blocked: feature_off`; `stop`: running stop at the next checkpoint |
| Turned back on | Blocked jobs return to `queued` automatically; nothing was deleted |
| Flapping (on/off/on in a minute) | Allowed, but the admin page warns after 3 changes in 10 minutes; jobs use the decision at claim time |
| Saved data referencing an off feature | Kept; behaviour follows today's rule (e.g. a seam set to an off move is planned again without changing what's saved) |
| Plan changes mid-session | Entitlement version bump → flags re-decided → SSE push |
| Same user on several devices | Workspace- and user-scoped hashing gives every device the same answer |
| Room guests | Only guest-scoped flags apply; a host's rules apply to their room (`rooms` off for the host closes the room with notice to guests) |
| Old site, new server | Unknown flags in the response are ignored; a `flag_off` refusal is handled as today |
| Old worker during a deploy | Decisions arrive in the claim response; unknown flags are treated as off for that worker's jobs |
| Rule references a deleted user | Ignored and flagged for cleanup |
| Instance with a stale snapshot | Bounded by NOTIFY + 30 s refresh; kill switches also checked against a version counter on every claim |
| Admin locks themselves out of the admin console | The admin console and staff routes are core in cloud mode and can't be targeted |
| Unauthenticated pages (sign-up, guest join) | Evaluated with an anonymous context; `cloud.signups` can close sign-ups during abuse |
| Experiments | Sticky assignment; exposure logged once per account per experiment; never mixed with a kill switch on the same flag |

### 11B.8 Tests added on top of today's sweep

- Property tests: decisions are deterministic for a context; raising a rollout percentage never removes accounts; flags never grant beyond the plan; core flags are always on; `requires` cascade holds in every context.
- A tier matrix: every plan-gated and teaser flag checked for Free, Standard and Premium in the API and the site (hidden vs teaser vs on).
- Propagation: change a rule, then assert every API instance and the gateway enforce it within the targets.
- Mid-flight: flag off during upload, render, export, Lucy turn and an open Room.
- The existing reflow sweep runs in both modes, plus a "teaser" pass for locked features.
- **Cloud defaults.** A flag may set `cloud_default: false` to start off in the cloud while staying on locally. `lyrics.display` does (ADR-0406): with no licence, the cloud decides it off at the mode layer, so `listen.lyrics`, `listen.word_focus`, `listen.stage` and `discover.word_links` are off with it, and only the build (`SELECTA_FLAGS=+lyrics.display`) can turn it on; targeting rules can't. Local mode ignores the field. **Note for the cloud reflow sweep:** run it once with the cloud defaults and check that Listen, Stage and Discover > Words close up with no empty lyric panel, stage button, palette entry or help text (`tests/test_cloud_lyric_display.py` lists the surfaces).

### 11B.9 Who can change flags, and how far

Flag powers are separate permissions, so each role gets exactly what its job needs (`src/selecta/authz/permissions.py`, `roles.py`):

| Permission | What it allows | Danger |
|---|---|---|
| `flags.read` | See every flag, its rules and history, and "what does this user see, and why" | read |
| `flags.preview_self` | Turn a flag on for your own account only, to try it | change |
| `flags.user_override` | Switch a feature off, or on within their plan, for one workspace | sensitive (audited) |
| `flags.kill_switch` | Turn a non-core feature off for everyone, at once | dangerous (fresh MFA, alert) |
| `flags.rules.propose` | Propose rules by plan, segment, percentage or time | change |
| `flags.rules.apply` | Apply rules; broad ones wait 15 minutes or need a second person | dangerous (fresh MFA) |
| `platform.emergency_controls.manage` | Pause or resume uploads, worker pools, sign-ups (declarative emergency states, not flags) | dangerous |

| Role | Flag powers | Which flags |
|---|---|---|
| Owner, Admin | All of the above | Any non-core flag |
| Operator | Read, preview, per-workspace override, kill switch, emergency controls | Any non-core flag |
| AI Admin | Read, preview, kill switch, propose and apply rules | Lucy flags only (`lucy.*`) |
| Support | Read, preview, per-workspace override | Any non-core flag, only at the support-case or workspace scope they're assigned |
| Billing, Analyst, Auditor | Read | - |

How a change is checked, in order:
1. `authorize()` confirms the permission at a scope covering the target (one workspace, or the platform).
2. `may_change_flag(role, flag)` confirms the role may touch that flag at all (AI Admin only `lucy.*`).
3. Targeting validation refuses core flags, staff and admin flags, malformed rules and anything that would grant beyond a plan.
4. Breadth decides speed:
   - a kill switch is instant, with an alert to every Owner;
   - a per-workspace override is instant;
   - a rule switching a feature off for a whole plan, or changing it for more than 10% of active accounts, becomes a delayed action (`flags.rules.broad`): 15 minutes with alerts while there's one operator, a second approver once there are two.
5. Every change is a new immutable version with author and reason, audited, and pushed to every instance.

Support overrides are tied to the case or workspace in the assignment's scope, expire when that assignment does, and are listed on the account's page so the next person can see them.

### 11B.10 Users opting in to betas ("Labs")

Flags of kind `beta` can be switched on by users themselves in Settings, under Labs. A beta reaches a user only when every earlier layer allows it (build, mode, plan, rules) **and** the user opted in, so a rule or kill switch always wins and nobody gets a feature their plan doesn't include. Opting out is instant. The Labs list shows only betas the user's plan includes, with a short note on what may change.

**Implementation slice:** Cloud account responses include a server-evaluated feature snapshot and
plan teaser locks. `/api/account/labs` lists beta features the build, mode, plan and targeting rules
allow; `PUT /api/account/labs/{flag_id}` records a user's opt-in or opt-out. Preferences are stored
in `user_flag_preferences`. Only `kind: beta` Cloud flags can be changed there, and opting in
cannot override a plan gate or a targeting kill switch. The React Labs settings page and a beta
flag with a shipped capability are still to be built.

Cloud app construction now checks that every mounted customer `/api` route has an owner in the
registry, and the Cloud request guard fails closed if a route is mounted without one. Local mode
keeps its existing guard behavior. Worker job types already carry their owner in the job catalogue.
The Cloud reflow sweep and a durable route/job registry test remain.

### 11B.11 Every new feature is behind a flag

No cloud feature ships without a registry flag, and the same flag is enforced in three places: the API (routes owned by the flag answer 403 `flag_off`), the workers (job types name their owning flag and are refused at claim), and the site (the page closes up around it, checked by the reflow sweep). The new flags live in a `cloud` area, are cloud-only (`modes: ["cloud"]`), and include at least:

| Flag | Feature | Notes |
|---|---|---|
| `cloud.signups` | New accounts can sign up | Kill switch during abuse |
| `cloud.uploads` | Uploading music | `when_off: drain` (finishing uploads complete) |
| `billing.checkout` | Buying or changing a plan | Portal stays reachable to cancel |
| `devices.remote_control` | Remotes and "Play here" | Off means each device plays on its own |
| `rooms` | Rooms | Plan-gated (Premium), `when_locked: teaser` |
| `rooms.votes` | Votes in Rooms | Needs `rooms` |
| `rooms.display` | Big-screen display | Needs `rooms` |
| `lucy.deep_plan` | Opus deep-plan turns | Plan-gated (Premium) |
| `account.data_export` | Download my data | Never targeted off for a whole plan (a legal right); kill switch only for incidents |
| `admin.console` | The staff console | Core in cloud mode: can't be targeted |

Adding a feature means adding its flag first; [the engineering guide](../engineering/README.md) walks through it.

---

[← 11a-devices-and-rooms.md](11a-devices-and-rooms.md) · [Contents](README.md#chapters) · [12-security-privacy-legal.md →](12-security-privacy-legal.md)
