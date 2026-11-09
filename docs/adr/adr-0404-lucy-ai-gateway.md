# ADR-0404 - Lucy AI gateway with server-owned model routing

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/6 Implemented; 0/6 In progress; 6/6 Not started.
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

## Implementation checklist - 0/6 Implemented; 0/6 independently Verified

1. **SC-0404-01 - Registry and routing.** **Acceptance:** Tier requests resolve to the configured deployment; changes apply to new runs only. **Required verification:** Unit and integration tests. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0404-02 - Allowance ledger.** **Acceptance:** Turns are metered; limits enforced mid-conversation gracefully. **Required verification:** Integration test. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0404-03 - Spend guards.** **Acceptance:** No admission past per-account or platform ceilings, proven with a fake provider. **Required verification:** Load test with fake provider. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0404-04 - Fallback chain.** **Acceptance:** Provider outage degrades to the next model or the built-in planner; the rest of the app is unaffected. **Required verification:** Chaos test. **Implementation:** Not started; **Independently Verified:** No.
5. **SC-0404-05 - Settings split.** **Acceptance:** Cloud Lucy settings show only user-owned choices and a usage meter. **Required verification:** Playwright test per mode. **Implementation:** Not started; **Independently Verified:** No.
6. **SC-0404-06 - Evaluation gate.** **Acceptance:** The Lucy evaluation set passes for each tier's deployment. **Required verification:** Eval run report. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
