# ADR-0404 - Lucy AI gateway with server-owned model routing

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 5/6 Implemented; 1/6 In progress; 0/6 Not started.
- **Independent verification:** 0/6 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P1 / Phase 5. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0390 (Lucy phase flags); Lucy programme ADRs 0340–0365; their statuses are unchanged.
- **Source touchpoints:** `src/selecta/lucy/settings.py`; `src/selecta/lucy/providers.py`; `src/selecta/lucy/agent.py`; `web/src/views/LucySettings.tsx`; `web/src/views/LucyGate.tsx`; new `src/selecta/ai/`.
- **Proposal chapter:** [docs/saas/09-lucy-ai-gateway.md](../saas/09-lucy-ai-gateway.md#91-routing-model).

## Context and evidence boundary

In local mode users bring their own provider, model and API key. In the cloud, users buy a Lucy experience and Selecta chooses and pays for the model, so routing, secrets and spending move to the server.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Plans grant a capability (`lucy_basic`, `lucy_standard`, `lucy_advanced`); an admin-editable, versioned registry maps capabilities to deployments (provider, model, limits, fallback, rollout).
- Starting map: Free on Claude Haiku 5.5; Standard on Haiku 5.5 with a Sonnet 5.5 allowance for whole-mix planning; Premium on Sonnet 5.5 with an Opus 5.5 deep-plan allowance. Requests may route down within a tier, never up.
- Layered spend protection: per call, per turn, per account (allowance and concurrency, replacing the process-wide semaphore), per tier, per provider, platform-wide with emergency disable.
- Each run pins its deployment, policy, prompt and tool-schema versions; tool steps carry idempotency keys; model output never authorises an action.
- Cloud mode hides provider, model, base URL, API key and budget settings; local mode keeps them.
- A fixed evaluation set gates any deployment before it becomes a tier default, followed by a staged rollout.

## User outcome and acceptance contract

Users get a Lucy that matches their plan without seeing model names; a maxed-out user costs at most about 40% of their plan price in AI.

## Rejected alternatives

- Hard-coding a model per plan.
- Self-hosted model GPUs (owner chose hosted APIs).
- Showing token counts to users.

## Implementation checklist - 5/6 Implemented; 1/6 In progress; 0/6 Not started; 0/6 independently Verified

1. **SC-0404-01 - Registry and routing.** **Acceptance:** Tier requests resolve to the configured deployment; changes apply to new runs only. **Required verification:** Unit and integration tests. **Implementation:** Implemented; each tier and request class resolves to its configured deployment, never above the tier's allowed set; routing versions are immutable and a run keeps the deployment it started with. **Evidence:** `tests/test_cloud_ai_routing.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
2. **SC-0404-02 - Allowance ledger.** **Acceptance:** Turns are metered; limits enforced mid-conversation gracefully. **Required verification:** Integration test. **Implementation:** Implemented; turns are metered per served class; a turn in progress finishes at the limit and the next is told why; allowances reset monthly in the account's time zone. **Evidence:** `tests/test_cloud_ai_gateway.py`, `tests/test_cloud_ai_spend.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
3. **SC-0404-03 - Spend guards.** **Acceptance:** No admission past per-account or platform ceilings, proven with a fake provider. **Required verification:** Load test with fake provider. **Implementation:** Implemented; per-call, per-turn, per-account and platform caps are reserved before a call and reconciled after; concurrent turn starts on PostgreSQL never admit past a ceiling. **Evidence:** `tests/test_cloud_ai_spend.py` (including the PostgreSQL races); green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
4. **SC-0404-04 - Fallback chain.** **Acceptance:** Provider outage degrades to the next model or the built-in planner; the rest of the app is unaffected. **Required verification:** Chaos test. **Implementation:** Implemented; an unhealthy, disabled or draining deployment falls back down the chain to the built-in planner; the circuit breaker opens, half-opens and closes. **Evidence:** `tests/test_cloud_ai_routing.py`, `tests/test_cloud_ai_spend.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
5. **SC-0404-05 - Settings split.** **Acceptance:** Cloud Lucy settings show only user-owned choices and a usage meter. **Required verification:** Playwright test per mode. **Implementation:** Implemented; Cloud Lucy settings show the plan's level, the turn meter and only the person's own choices; local keeps provider, limits and key. **Evidence:** `web/e2e-cloud/live.cloud.ts` 'Lucy settings in Cloud show the plan's level, the turn meter and only the person's choices' and `web/e2e/lucy-settings.e2e.ts` for local mode, passing. **Independently Verified:** No.
6. **SC-0404-06 - Evaluation gate.** **Acceptance:** The Lucy evaluation set passes for each tier's deployment. **Required verification:** Eval run report. **Implementation:** In progress; the gate is built: `src/selecta/ai/eval_set.json` (version 1: a synthetic library and six scripted cases for mood and length, exclusions, invented songs, keeping the current mix, asking before a big change and valid tool calls) and `selecta.ai.evaluation`, which scores each case including cost and latency limits, records the pass only when every case passes, and gates every tier's first-choice deployment so routing accepts them. Needs staging: a real subject that drives the Lucy agent with each deployment's provider key, and the eval run report for haiku-low, haiku-medium, sonnet-medium and opus-high. **Evidence:** `tests/test_cloud_ai_evaluation.py` with a fake provider (15 passed locally on SQLite on 2026-11-10); `src/selecta/ai/evaluation.py`. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
