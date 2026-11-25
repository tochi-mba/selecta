# ADR-0487 - Lucy Usage: measurement, migration and rollout

- **Decision:** Proposed (Claude for the owner, 2026-11-25).
- **Programme:** Lucy Usage (LM).
- **Implementation:** Not started. `src/selecta/usage/lucy_ceiling.py` can re-check allowances against real turn costs but has not been run on beta data (BF-0464-04 is In progress).
- **Source touchpoints:** `src/selecta/usage/lucy_ceiling.py`, `src/selecta/admin/routes_economics.py`, `src/selecta/flags/lucy.json`, `src/selecta/ai/allowance.py`, `tools/lucy_eval.py`, `tests/test_cloud_ai_gateway.py`.

## Context

Every size in this set is a guess until real turns are measured: the session share, the weekly limit, the multipliers, the price of a pack. The present allowances were also estimates, and the one-model-per-plan change showed how far an estimate can sit from the ceiling. Changing how a paying member is limited is also the kind of change that must be reversible and must not take anything away mid-period.

## Decision

1. **Shadow first.** Phase 1 computes the new ledger, windows and read model for every turn while the baseline turn model stays the one enforced and shown. No customer sees a difference.
2. **Measure before sizing.** From at least four weeks of shadow data on beta accounts, record per plan: the distribution of settled cost per turn, turns per session, sessions per week, the share of accounts that would have reached a session limit and a weekly limit, and the AI cost of a member at the 50th, 90th and 99th percentile. The method and the result are written to `docs/verification/` and reviewed against provider invoices, completing BF-0464-04 and BF-0464-05.
3. **Sizing rule.** The owner sets the base allowance, multipliers and session share so that: a member at the weekly limit costs at most 40% of net plan price; no more than about 1 in 20 active paid members would reach the weekly limit in a normal week; and no paid member gets less Lucy on their plan's model than the present dollar ceiling gives them.
4. **Flags.** `lucy.usage_windows` turns on enforcement and the new meter together, cloud mode only, and requires `lucy.cloud_conversation`. `lucy.extra_usage` (ADR-0486) requires `lucy.usage_windows`. Both are added to `src/selecta/flags/lucy.json` and `docs/flags.md` when built. Off means the baseline behaviour exactly.
5. **Rollout.** Staff accounts, then 5%, 25% and 100% of workspaces, holding at each step for a full week so every account passes a weekly reset. Each step compares AI cost per active member and limit-reached rates with the shadow figures.
6. **Cutover for a workspace.** The switch happens at the start of a calendar month in the account's time zone, so no one loses part of a month they were counted in. The first week opens at the cutover with nothing used.
7. **Roll back.** Turning the flag off returns a workspace to the turn model at once, with that month's turn counts intact because the old counters are still written until rule 9.
8. **Release gates.** The flag does not pass 5% until: the meter and the admission check are proved to read one ledger; the race for the last of an allowance is tested across two devices; the six messages of ADR-0483 are checked in a browser at phone and desktop widths; the Lucy evaluation set passes on each plan's lighter model; and a person other than the builder has verified each.
9. **Clean-up.** One full month after 100%, the class buckets, the `lucy_turn.*` counters, `ai.allowance.remaining()` and the monthly `TIER_LIMITS` backstop are removed, and catalogue v1 and v2 turn fields are retired.
10. **Price changes.** A change to a model's price or to a plan's model in `src/selecta/ai/registry.py` re-runs the measurement of rule 2 on recent data before it ships, because it changes how far every allowance goes.
11. **Telling members.** Paid members get notice in the product and by email before their cutover, in plain words, saying what changes and that the price does not.

## Consequences

- The programme cannot be finished in less than about ten weeks of calendar time, most of it waiting on data and weekly holds.
- Both models are written side by side for the rollout, at a small storage cost.
- If measurement shows the weekly limit would bite more than 1 member in 20, the answer is a different size or a different window, decided before anyone is affected.

## Rejected alternatives

- **Switch everyone at once with the hypothesised sizes.** Fast, and the surest way to cut off paying members on a guess.
- **Size from provider list prices and typical turn shapes.** That is how the present figures were made.
- **Cut over mid-month with a pro-rated allowance.** Fair on paper and impossible to explain in one sentence.

## Acceptance

The [Lucy Usage checklist](selecta-lucy-usage-implementation-checklist.md) LM-0487 items define implementation and verification.
