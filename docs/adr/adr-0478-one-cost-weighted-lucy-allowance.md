# ADR-0478 - One cost-weighted Lucy allowance

- **Decision:** Proposed (Claude for the owner, 2026-11-25).
- **Programme:** Lucy Usage (LM).
- **Implementation:** Not started. The gateway already records tokens and dollars per run (`ai_runs`) and per account (`ai_usage`), and already reserves a worst case and reconciles to real cost for the platform caps; none of that is used as the customer's allowance yet.
- **Source touchpoints:** `src/selecta/ai/allowance.py`, `src/selecta/ai/gateway.py`, `src/selecta/ai/spend.py`, `src/selecta/ai/registry.py`, `src/selecta/lucy/cloud_agent.py`.

## Context

Today a turn costs one count from a class bucket whatever it did. A two-word question and a long planning turn with eight tool calls weigh the same, and which bucket pays depends on a regular expression over the person's words. The money is tracked separately and only the money protects the margin (ADR-0477). Claude and Gemini both measure usage by work done for this reason.

## Decision

1. A workspace has **one Lucy allowance**, measured in **usage units**. One unit is one millionth of a US dollar of settled model cost at the pinned deployment's prices in `src/selecta/ai/registry.py`, cache reads and writes included. There is no other exchange rate.
2. The four request classes stop being allowance buckets. `RequestClass` may stay as a routing and logging label, but no admission or charge depends on it.
3. **Admission reserves, settlement charges.** When a turn is accepted the gateway reserves that turn's worst case (the tier's per-turn dollar cap) against the allowance in the same atomic statement used for counters today. When the turn settles, the reservation is replaced by the real cost.
4. **A turn is admitted while any allowance remains.** A running turn always finishes, so a window can end at most one per-turn cap over its limit. The overshoot is carried into the weekly figure, never forgiven and never billed.
5. **What a person is charged for:**
   - A turn that completes is charged its real cost.
   - A turn the person stops is charged what it had used when it stopped.
   - A turn that fails through no fault of the person (provider error, timeout, platform cap, a deployment switched off) is charged nothing to their allowance. Its dollars are still booked to platform spend, as now.
   - A retry down the model chain inside one turn is charged once, at the cost of the attempt that answered.
6. Tool calls, earlier conversation sent as context and cache writes all count, because they all cost money. The per-plan limit on earlier conversation (12k, 40k and 80k characters) stays as a bound on how heavy one turn can be.
7. The allowance ledger is the single record. The meter (ADR-0481), the admission check, the admin economics view and Download my data all read it; no second counter is kept for display.
8. Units are never shown to customers and never appear in Lucy's words. Support and admin screens may show them, labelled as units.

## Consequences

- A person who asks short questions gets many more of them than a person who asks for whole sets, which matches what each costs.
- The hidden monthly ceiling and the visible limit become one number (ADR-0479 turns it into windows).
- Because the charge is known only at settlement, the meter can move after a reply has finished. ADR-0481 handles the wording.
- A model price change in the registry changes how far an allowance goes. ADR-0484 makes a price change a reviewed event with a re-measurement.

## Rejected alternatives

- **Weighted turns** (an everyday turn is 1, a planning turn 3): still depends on a classifier that is wrong today, and still drifts from real cost.
- **Count tokens.** Tokens on Haiku and Opus differ in price forty times over; a token count would need a per-model weight, which is cost by another name.
- **Charge the worst case at admission and never reconcile.** Simple, but it charges a short answer the same as a long one and wastes most of the allowance.

## Acceptance

The [Lucy Usage checklist](selecta-lucy-usage-implementation-checklist.md) LM-0478 items define implementation and verification.
