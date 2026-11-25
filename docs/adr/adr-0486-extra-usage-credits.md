# ADR-0486 - Extra usage credits

- **Decision:** Proposed (Claude for the owner, 2026-11-25). Deferred: nothing here is built or switched on until ADR-0487's measurement has run and the owner sets a price.
- **Programme:** Lucy Usage (LM).
- **Implementation:** Not started. There is no overage, top-up or credit path anywhere in the baseline.
- **Source touchpoints:** `src/selecta/billing/`, `src/selecta/ai/allowance.py`, `src/selecta/ai/gateway.py`, `web/src/cloud/Billing.tsx`.

## Context

At the weekly limit a paying member's only choices are to wait or change plan. Claude and Gemini both let a subscriber keep going on prepaid credits, and Copilot bills past its pool. A member the night before a party is the person most likely to want this and the person a week's wait serves worst. Credits also carry risk: a surprise bill, a refund dispute and a tax line, for a product whose promise is a flat price.

## Decision

1. Extra usage is **prepaid only**. A member buys a pack of usage units in advance through Stripe (ADR-0403). There is no metered billing after the fact and no automatic top-up.
2. It is **opt-in twice**: the owner switches the feature on with the flag `lucy.extra_usage`, and a member must buy a pack before any is spent. A member with no pack sees the wait message of ADR-0483 and nothing else.
3. Extra units are spent **only** when the weekly limit is reached, on the plan's own model, and only after the member confirms once per week that extra usage may be used. The session window does not apply to extra units, but every per-turn cap and every platform guard still does.
4. **Price keeps the 40% rule.** A pack is priced so its AI cost is at most about 40% of its net price after VAT and Stripe fees. The pack sizes and prices are the owner's decision after measurement; none is set here.
5. Packs are for paid plans. Free is offered a plan, not a pack.
6. Unused extra units last 12 months from purchase and are not refunded on cancellation, stated at the point of sale. A pack bought in error and unspent is refundable for 14 days.
7. A workspace's extra balance is a separate ledger line from the plan allowance. The meter (ADR-0484) shows it as a third line, as a share of the last pack bought, only when a balance exists.
8. A hard cap applies per workspace per calendar month on extra units bought (starting hypothesis: four packs), so a compromised account cannot run up provider spend. The platform day and month caps of ADR-0404 still stand above it.
9. Venue pools do not get packs in this ADR; a venue that needs more Lucy changes its venue plan.

## Consequences

- A second Stripe product, VAT treatment and a refund rule are needed (legal and billing review).
- Extra units are deferred revenue until spent; finance reporting needs the balance.
- The feature can be left off for good. Every other LM ADR works without it.

## Rejected alternatives

- **Bill overage in arrears.** The surprise-bill case, and against the flat-price promise.
- **Automatic top-up.** Convenient and the usual source of disputed charges.
- **Spend extra units before the weekly limit to skip the session window.** It would sell a way round a fair-use control and make sessions meaningless for anyone with a balance.

## Acceptance

The [Lucy Usage checklist](selecta-lucy-usage-implementation-checklist.md) LM-0486 items define implementation and verification.
