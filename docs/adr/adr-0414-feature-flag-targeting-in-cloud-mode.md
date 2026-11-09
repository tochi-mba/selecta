# ADR-0414 - Feature-flag targeting in cloud mode

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/7 Implemented; 0/7 In progress; 7/7 Not started.
- **Independent verification:** 0/7 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 4. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0390 (feature flags), whose status is unchanged; their statuses are unchanged.
- **Source touchpoints:** `src/selecta/flags/__init__.py`; `src/selecta/flags/guard.py`; `src/selecta/flags/*.json`; `web/src/flags.ts`; `web/e2e/flags.e2e.ts`; new `flag_rules` tables and admin Flags page.
- **Proposal chapter:** [docs/saas/11b-feature-flags.md](../saas/11b-feature-flags.md#11b2-four-questions-kept-separate).

## Context and evidence boundary

ADR-0390 built one registry for about 90 features, read once per process from `SELECTA_FLAGS`, enforced on routes and background work, with pages that close up around features that are off. It decided flags are developer-only with no switch page. The owner now wants to turn features off for specific users or whole tiers, which needs per-request context and runtime changes.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Keep the ADR-0390 registry as the single list of features; add fields `scope`, `modes`, `when_off`, `when_locked`, `kind`, `owner`, `review_by`.
- A feature reaches a user only if four layers agree: build (`SELECTA_FLAGS`, unchanged), mode, plan (entitlements), and admin rules; then the `requires` cascade and the user's own preference.
- Rules: kill switch, user/workspace lists, segments (plan, staff, account age, country, client version, device kind), stable percentage rollouts, schedules; first match wins.
- Flags can switch features off or roll them out but never grant beyond the plan; core flags and staff routes can't be targeted.
- Server-side evaluation only: the site receives decisions (plus teaser locks), never rules; changes are pushed over SSE; jobs re-check at claim; one snapshot per request, attempt and Lucy turn.
- Propagation targets: kill switch within 5 s, other changes within 30 s. Local mode is unchanged.
- In cloud mode only, an admin Flags page with impact preview, per-user decision trace, self-preview, history and rollback. This reverses ADR-0390's 'no switch page' for cloud mode only.

## User outcome and acceptance contract

The owner can turn any feature off for everyone, a tier or named users in seconds, see exactly who is affected, and roll it back; users see features vanish cleanly or appear as locked upgrades, never broken.

## Rejected alternatives

- A second flag system or a SaaS flag vendor alongside the registry.
- Sending rules to the browser.
- Using flags to grant paid features.

## Implementation checklist - 0/7 Implemented; 0/7 independently Verified

1. **SC-0414-01 - Layered resolver.** **Acceptance:** `decide(flag, ctx)` returns on/off with layer and reason for every flag and context. **Required verification:** Property tests (determinism, no grant beyond plan, core always on, cascade). **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0414-02 - Rules storage and propagation.** **Acceptance:** Rule changes reach every API instance and the worker gateway within targets. **Required verification:** Multi-instance propagation test. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0414-03 - Guard and codes.** **Acceptance:** Rule/build off returns 403 `flag_off`; plan-locked returns 403 `plan_required` with the plan. **Required verification:** API tests. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0414-04 - Jobs and workers.** **Acceptance:** Jobs for a feature switched off while queued block or cancel per `when_off`; resume when switched back on. **Required verification:** Integration tests. **Implementation:** Not started; **Independently Verified:** No.
5. **SC-0414-05 - Site.** **Acceptance:** Decisions and locks arrive in status and SSE; reflow and teaser sweeps pass in cloud mode. **Required verification:** Playwright sweeps. **Implementation:** Not started; **Independently Verified:** No.
6. **SC-0414-06 - Admin Flags page.** **Acceptance:** Kill switch, tier, user, rollout and schedule actions with impact preview, trace, history and rollback; broad changes delayed per ADR-0401. **Required verification:** Playwright and audit tests. **Implementation:** Not started; **Independently Verified:** No.
7. **SC-0414-07 - Local mode unchanged.** **Acceptance:** Local behaviour and `docs/flags.md` generation are identical to ADR-0390. **Required verification:** Existing flag tests. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
