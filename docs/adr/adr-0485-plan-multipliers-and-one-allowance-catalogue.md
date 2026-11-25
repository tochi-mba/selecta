# ADR-0485 - Plan multipliers and one allowance catalogue

- **Decision:** Proposed (Claude for the owner, 2026-11-25).
- **Programme:** Lucy Usage (LM).
- **Implementation:** Not started. Allowances are written twice, in `src/selecta/billing/plans.py` (catalogue v1 and v2) and in `src/selecta/ai/allowance.py`, with dollar ceilings a third time in `TIER_LIMITS` in `src/selecta/ai/spend.py`.
- **Source touchpoints:** `src/selecta/billing/plans.py`, `src/selecta/ai/allowance.py`, `src/selecta/ai/spend.py`, `src/selecta/business/entitlements.py`, `src/selecta/lucy/cloud_prompt.py`, `web/src/cloud/Billing.tsx`.

## Context

Three tables describe what a plan gets from Lucy and are kept in step by hand (ADR-0480 fault 4). Lucy's prompt repeats the figures a fourth time. Claude, Gemini and ChatGPT describe higher plans as a multiple of a lower one, which lets the allowance underneath change without rewriting the plan. Two open items already ask for allowances to be editable without a code change (`T-20261124-a859`) and for per-account caps (`T-20261124-22ca`).

## Decision

1. The versioned plan catalogue of ADR-0402 is the **only** place a Lucy allowance is written. The gateway, the spend guards, the meter, Lucy's prompt and the plan cards read it; none holds its own copy.
2. A catalogue version states one **base weekly allowance** in usage units and, per plan, a **multiplier** and a **session share**. A plan's weekly limit is base times multiplier; its session limit is weekly limit times session share.
3. **Starting multipliers (hypotheses, set by ADR-0487).** Free is 1x. Standard is 14x and Premium 26x, which are today's ceilings ($3.56 and $6.60 against $0.25) rounded to whole numbers. The session share is one quarter on every plan.
4. Plans are described to customers by relative size and level, never by a count: "Lucy Standard, 14 times the free allowance". A multiplier is only published once measurement has confirmed it.
5. The per-turn caps, concurrent turns, seconds per turn and earlier-conversation limits move into the same catalogue entry as the multiplier, unchanged in value.
6. A catalogue change is a new version with an effective date. A workspace keeps the version it subscribed under until its next weekly reset, then moves to the current one. Existing subscribers are told before a change that reduces what they get, under ADR-0402's rules for plan changes.
7. A per-account override (a different multiplier, or Lucy switched off) is an admin action with a reason and an audit record. It is the mechanism `T-20261124-22ca` asks for and does not create a new plan.
8. Venue pools (ADR-0448) are a catalogue entry of the same shape with no session share.
9. Whether Free keeps a Lucy model at all stays the owner's open question from `docs/saas/17-roadmap-and-risks.md`; a multiplier of 0 expresses "built-in planner only" without another code path.

## Consequences

- Changing an allowance becomes a reviewed catalogue edit, and later a database setting (`T-20261124-a859`), with no gateway change.
- The duplicate tables and the allowance lines in Lucy's prompt are deleted.
- Catalogue v1 and v2 turn-count fields stay readable for workspaces on the old flag state until ADR-0487's cutover.

## Rejected alternatives

- **Keep a hand-written allowance per plan.** Works for three plans; it is how the tables drifted.
- **Publish the unit figures.** Nobody outside the company can use them, and they would have to change with every model price change.
- **Add a fourth, higher plan now.** The market has one at about $100; nothing in beta data yet shows SelectaDJ members want it. Multipliers make it a catalogue entry if they do.

## Acceptance

The [Lucy Usage checklist](selecta-lucy-usage-implementation-checklist.md) LM-0485 items define implementation and verification.
