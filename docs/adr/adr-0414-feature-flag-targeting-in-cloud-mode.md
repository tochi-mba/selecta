# ADR-0414 - Feature-flag targeting in cloud mode

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 5/10 Implemented; 2/10 In progress; 3/10 Not started.
- **Independent verification:** 0/10 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 4. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0390 (feature flags), whose status is unchanged; their statuses are unchanged.
- **Source touchpoints:** `src/selecta/flags/__init__.py`; `src/selecta/flags/guard.py`; `src/selecta/flags/*.json`; `web/src/flags.ts`; `web/e2e/flags.e2e.ts`; new `flag_rules` tables and admin Flags page.
- **Proposal chapter:** [docs/saas/11b-feature-flags.md](../saas/11b-feature-flags.md#11b2-four-questions-kept-separate).

## Context and evidence boundary

ADR-0390 built one registry for about 90 features, read once per process from `SELECTA_FLAGS`, enforced on routes and background work, with pages that close up around features that are off. It decided flags are developer-only with no switch page. The owner now wants to turn features off for specific users or whole tiers, which needs per-request context and runtime changes.

The branch now includes Cloud registry flags, per-account feature snapshots and stored Labs preferences. Runtime admin targeting, cross-instance rule propagation, the Labs UI and independent verification remain incomplete.

## Decision

- Keep the ADR-0390 registry as the single list of features; add fields `scope`, `modes`, `when_off`, `when_locked`, `kind`, `owner`, `review_by`.
- A feature reaches a user only if four layers agree: build (`SELECTA_FLAGS`, unchanged), mode, plan (entitlements), and admin rules; then the `requires` cascade and the user's own preference.
- Rules: kill switch, user/workspace lists, segments (plan, staff, account age, country, client version, device kind), stable percentage rollouts, schedules; first match wins.
- Flags can switch features off or roll them out but never grant beyond the plan; core flags and staff routes can't be targeted.
- Server-side evaluation only: the site receives decisions (plus teaser locks), never rules; changes are pushed over SSE; jobs re-check at claim; one snapshot per request, attempt and Lucy turn.
- Propagation targets: kill switch within 5 s, other changes within 30 s. Local mode is unchanged.
- In cloud mode only, an admin Flags page with impact preview, per-user decision trace, self-preview, history and rollback. This reverses ADR-0390's 'no switch page' for cloud mode only.
- Flag powers are separate permissions (`flags.read`, `flags.preview_self`, `flags.user_override`, `flags.kill_switch`, `flags.rules.propose`, `flags.rules.apply`) given per role as in §11B.9; AI Admin may change only `lucy.*` flags; Support overrides are limited to the case or workspace in its scope; broad changes become a delayed action. Emergency controls get their own permission, `platform.emergency_controls.manage`.
- Users can opt in to `beta` flags themselves (Labs), only when every other layer allows the feature.
- Every cloud feature has a registry flag in a cloud-only area, enforced at the API, at job claim and in the site (§11B.11).

## User outcome and acceptance contract

The owner can turn any feature off for everyone, a tier or named users in seconds, see exactly who is affected, and roll it back; users see features vanish cleanly or appear as locked upgrades, never broken.

## Rejected alternatives

- A second flag system or a SaaS flag vendor alongside the registry.
- Sending rules to the browser.
- Using flags to grant paid features.

## Implementation checklist - 0/10 Implemented; 0/10 independently Verified

1. **SC-0414-01 - Layered resolver.** **Acceptance:** `decide(flag, ctx)` returns on/off with layer and reason for every flag and context. **Required verification:** Property tests (determinism, no grant beyond plan, core always on, cascade). **Implementation:** Implemented; `flags.targeting.decide` returns on or off with layer and reason; Hypothesis properties prove determinism, no grant beyond the plan, core always on, the requires cascade and monotonic rollouts. **Evidence:** `tests/test_cloud_targeting_properties.py`, `tests/test_cloud_targeting.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
2. **SC-0414-02 - Rules storage and propagation.** **Acceptance:** Rule changes reach every API instance and the worker gateway within targets. **Required verification:** Multi-instance propagation test. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0414-03 - Guard and codes.** **Acceptance:** Rule/build off returns 403 `flag_off`; plan-locked returns 403 `plan_required` with the plan. **Required verification:** API tests. **Implementation:** Implemented. **Evidence:** `src/selecta/flags/cloud_gate.py`; `tests/test_cloud_flag_gate.py`. **Independently Verified:** No.
4. **SC-0414-04 - Jobs and workers.** **Acceptance:** Jobs for a feature switched off while queued block or cancel per `when_off`; resume when switched back on. **Required verification:** Integration tests. **Implementation:** Not started; **Independently Verified:** No.
5. **SC-0414-05 - Site.** **Acceptance:** Decisions and locks arrive in status and SSE; reflow and teaser sweeps pass in cloud mode. **Required verification:** Playwright sweeps. **Implementation:** Not started; **Independently Verified:** No.
6. **SC-0414-06 - Admin Flags page.** **Acceptance:** Kill switch, tier, user, rollout and schedule actions with impact preview, trace, history and rollback; broad changes delayed per ADR-0401. **Required verification:** Playwright and audit tests. **Implementation:** In progress; backend preview, trace, history, rollback and change commands exist; the React page and Playwright coverage remain. **Evidence:** `src/selecta/admin/flags_admin.py`; `src/selecta/admin/routes_controls.py`. **Independently Verified:** No.
7. **SC-0414-07 - Local mode unchanged.** **Acceptance:** Local behaviour and `docs/flags.md` generation are identical to ADR-0390. **Required verification:** Existing flag tests. **Implementation:** Implemented; local mode decides exactly as ADR-0390's `resolve()` for any `SELECTA_FLAGS` string, and `docs/flags.md` generation is unchanged. **Evidence:** `tests/test_flags.py`, `tests/test_cloud_targeting_properties.py` (local mode equals resolve); green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
8. **SC-0414-08 - Staff flag permissions.** **Acceptance:** Roles hold exactly the flag permissions in §11B.9; AI Admin can change only `lucy.*`; Support overrides only inside its scope; kill switches are instant and alert Owners; broad rules become delayed actions; every change is audited. **Required verification:** Unit tests for roles and `may_change_flag`; integration tests for the admin flag service. **Implementation:** Implemented; each staff role holds exactly the flag permissions in the section 11B.9 tables; AI Admin may change only `lucy` flags. **Evidence:** `tests/test_cloud_authz_roles.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
9. **SC-0414-09 - Labs opt-in.** **Acceptance:** Beta flags turn on for a user only when they opted in and every other layer allows it; a kill switch or rule always wins; the Labs list shows only betas the plan includes. **Required verification:** Property and integration tests; Playwright for the Labs setting. **Implementation:** Implemented; a beta turns on only with the user's opt-in and every other layer allowing it; rules and kill switches win; Labs lists only betas the plan includes. **Evidence:** `tests/test_cloud_flags.py`, `tests/test_cloud_targeting.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
10. **SC-0414-10 - Every cloud feature flagged.** **Acceptance:** Each cloud feature has a registry flag; every cloud route and job type names its owning flag; the reflow sweep covers the cloud surfaces. **Required verification:** Registry test that no cloud route or job type lacks a flag; flag sweep in cloud mode. **Implementation:** In progress; all mounted Cloud customer API routes now have owners, app construction checks coverage, and the strict Cloud guard fails closed on an unowned route. The job catalogue also assigns feature flags to worker job types; a dedicated registry test and Cloud reflow sweep remain; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
