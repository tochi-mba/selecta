# ADR-0477 - Lucy Usage: goal, evidence and boundaries

- **Decision:** Proposed (Claude for the owner, 2026-11-25).
- **Programme:** Lucy Usage (LM), building on ADR-0402, ADR-0404, ADR-0464 and ADR-0476 rather than replacing them.
- **Implementation:** Not started. This is a docs-only set; no code changed with it.
- **Baseline:** `main` at `f5b6a4a`.
- **Source touchpoints:** `src/selecta/ai/allowance.py`, `src/selecta/ai/spend.py`, `src/selecta/ai/gateway.py`, `src/selecta/billing/plans.py`, `src/selecta/usage/meters.py`, `src/selecta/lucy/cloud_agent.py`, `web/src/views/LucyCloudSettings.tsx`, `web/src/cloud/Meters.tsx`.
- **Sibling LM ADRs:** [ADR-0478](adr-0478-one-cost-weighted-lucy-allowance.md) to [ADR-0484](adr-0484-lucy-usage-measurement-migration-and-rollout.md).
- **Research:** [docs/research/ai-chat-usage-limits.md](../research/ai-chat-usage-limits.md).

## Context

Lucy is sold in turns per calendar month, counted per request class (everyday, planning, deep plan, quick). Underneath, each plan has a monthly dollar ceiling per account that the customer never sees: $0.25 on Free, $3.56 on Standard and $6.60 on Premium (`TIER_LIMITS` in `src/selecta/ai/spend.py`). Since the owner's 2026-11-24 change to one model per plan (Free on Haiku, Standard on Sonnet, Premium on Opus), a member who used every sold turn would cost more than the ceiling allows, so the ceiling, not the turn count, is the limit that actually holds the 40% rule. That change is recorded in [docs/saas/02-plans-and-economics.md](../saas/02-plans-and-economics.md) and [CHANGES-2026-11.md](../saas/CHANGES-2026-11.md) but in no ADR; ADR-0404's Decision still describes the earlier routing.

Reading the code at the baseline found five faults in the present model:

1. **The meter does not read what is enforced.** The gateway counts turns in the `ai_usage` table. The meters read `lucy_turn.*` allowance counters (`src/selecta/usage/meters.py`), and nothing under `src/` writes those counters. The meter most likely shows nothing used however much Lucy is used.
2. **Two of the four classes cannot happen.** `request_class` in `src/selecta/lucy/cloud_agent.py` returns only everyday or planning. Premium's 25 deep plans are never drawn on, and its quick "fair use" of 1,000 becomes 1,000 further Opus turns once everyday runs out, held back only by the dollar ceiling.
3. **One message for two causes.** When either the turn allowance or the dollar ceiling is used up, Lucy says "You've used this month's Lucy turns on your plan". When the ceiling was the cause that is not true.
4. **Two tables kept in step by hand.** Allowances are written in `src/selecta/billing/plans.py` and again in `src/selecta/ai/allowance.py`.
5. **What is sold is not what is delivered.** A plan card promises 400 turns; the ceiling delivers about 170 on the plan's model and then quietly answers with a smaller one.

During 2026 the large chat products moved away from message counts to a single allowance measured by work done, on a rolling five-hour window under a weekly cap (see the research note). That design removes faults 2, 3 and 5 by construction, because the thing the customer is shown is the thing that limits them.

## Decision

1. The goal of this programme is that **the limit a person sees is the limit that is enforced**, in one unit, with one meter, and with words that are true for every cause.
2. The 40% rule stays: a member who uses their whole Lucy allowance costs at most about 40% of the plan's net price in AI. Prices stay as held by ADR-0464. This programme changes how the allowance is measured and shown, not how much money a plan may spend.
3. One model per plan (owner, 2026-11-24) is recorded here as the routing this set assumes: Free answers on Haiku, Standard on Sonnet, Premium on Opus, each stepping down the chain Opus, Sonnet, Haiku, built-in planner. ADR-0404's text is not edited; this rule is the later statement.
4. Every number in this set (window length, session share, weekly size, multipliers, credit price) is a **starting hypothesis**. Beta cost measurement under ADR-0484 and BF-0464-04 sets the real figures, and the owner approves them.
5. Nothing in this set weakens a spend guard. The per-turn caps, run leases, provider breakers, platform day and month caps and the emergency controls of ADR-0404 and ADR-0410 stay exactly as they are and stay authoritative.
6. The whole programme sits behind one flag, `lucy.usage_windows`, off by default. With the flag off Lucy behaves as at the baseline.
7. Local mode with the person's own key (ADR-0330, ADR-0333) is outside this set.

## Consequences

- "Turns" stop being the unit a customer is sold. Plan cards, Lucy's prompt and the settings page all change wording (ADR-0481, ADR-0482).
- ADR-0402's rule that customers never see token or CPU meters is kept: the meter shows a share used and a reset time, never tokens or dollars.
- The request classifier stops deciding what a person is charged. It may still pick effort or a prompt, but a wrong guess no longer changes the allowance (ADR-0478).
- Existing tests that assert turn counts (`tests/test_cloud_ai_gateway.py`, `tests/test_lucy_cloud.py`) keep passing with the flag off and gain flag-on twins.

## Rejected alternatives

- **Fix the four-class turn model in place.** It would repair the meter and the classifier but leave two limits, one visible and one hidden, and the plan card would still promise turns the ceiling cannot deliver.
- **Unlimited Lucy on paid plans with only abuse guardrails.** ChatGPT does this for plain text chat. Lucy's turns call tools and plan mixes on Sonnet and Opus; without a cap the 40% rule cannot be kept at the held prices.
- **Sell dollars of credit as the plan allowance.** Honest, but it shows customers money and model prices, which ADR-0402 rejected, and suits developers more than people making a party mix.

## Acceptance

The [Lucy Usage checklist](selecta-lucy-usage-implementation-checklist.md) LM-0477 items define implementation and verification.
