# Lucy Usage measurement and sizing (LM-0487-02, LM-0487-03)

How SelectaDJ measures what Lucy's turns really cost before any allowance size is set, as
[ADR-0487](../adr/adr-0487-lucy-usage-measurement-migration-and-rollout.md) rules 2 and 3 ask.
Every size in the Lucy Usage set (the base weekly allowance, the plan multipliers, the session
share) is an estimate until this record holds a measurement. The method is code, so it is the
same every time. The two things only the owner holds, the beta's production data and the
provider's invoices, are named as person steps.

State on 2026-11-25: no measurement has been run. The log at the end is empty and the sizing
checklist is not filled in. The measurement also completes BF-0464-04 and BF-0464-05, recorded
in the [unit economics measurement](bf-unit-economics-measurement.md).

## What exists (machine-built)

| Piece | Where | What it does | State |
|-------|-------|--------------|-------|
| Shadow ledger tables | `lucy_usage_state` and `lucy_usage_ledger` (`src/selecta/ai/usage_schema.py`) | One row per workspace for its week and session, and one row per Lucy turn for what it reserved and what it was charged, in usage units. One unit is a millionth of a US dollar of model cost | Built; written for each turn while `lucy.usage_shadow` is on |
| Usage report | `src/selecta/usage/lucy_usage_report.py` | Reads the shadow ledger and gives the figures of rule 2 per plan. It changes nothing | Being built in the same pull request |
| Admin route | `GET /api/admin/economics/lucy-usage?days=30` | The same report for staff, read-only | Being built in the same pull request |
| Owner CLI | `tools/lucy_usage_report.py` | The same report from any database URL, as JSON | Being built in the same pull request |
| Earlier ceiling report | `src/selecta/usage/lucy_ceiling.py`, `GET /api/admin/economics/lucy-ceiling?days=30` | Real turn costs per plan under the turn model, re-checked under the 40% rule | Built; not yet run on beta data |
| Price baseline | `src/selecta/audit/lucy_price_baseline.py`, `tests/fixtures/lucy_price_baseline.json` | Records the prices, routing and allowance table the measurement was taken under, and fails CI when they change without a new measurement | Built; records that no measurement has been run |

## The method (ADR-0487 rule 2)

From at least four weeks of shadow data on beta accounts, record for each plan:

1. The distribution of settled cost per turn (mean, and the 50th, 90th and 99th percentile).
2. Turns per session.
3. Sessions per week.
4. The share of accounts that would have reached a session limit, and the share that would have
   reached a weekly limit.
5. The AI cost of a member at the 50th, 90th and 99th percentile in a week.

The exact rules (which turns count, how a refunded turn is treated, how a percentile is taken,
what happens to a week cut by the edge of the window) are the module notes of
`src/selecta/usage/lucy_usage_report.py`. The report says "insufficient data" for a plan with
too few settled turns, and a plan in that state cannot be sized from.

## Person steps (not doable by machine)

1. **Wait four weeks.** `lucy.usage_shadow` must have been on for the beta accounts for at least
   four full weeks. Write the start date in the measurement log.
2. **Run the report** against the production database with a read-only role:

   ```
   uv run python tools/lucy_usage_report.py --db <read-only url> --days 28
   ```

   Save the output as a dated report in this folder.
3. **Reconcile with the provider's invoice.** Add up what the report says Lucy cost in the
   window and compare it with the model provider's invoice for the same dates. Record both
   figures, the difference and its cause in the dated report. **A difference over 10 percent
   blocks using the numbers** until it is explained.
4. **Enter it in the measurement log** below, and record the date and the report in the price
   baseline with the command in the [price change procedure](../operations/lucy-price-change.md).
5. **Size.** The owner fills in the sizing checklist below from the reconciled figures.

## Sizing checklist (ADR-0487 rule 3, filled in by the owner)

The owner sets the base allowance, the multipliers and the session share so that all three
conditions hold. Nothing is ticked until the measurement above is reconciled.

| # | Condition | Figure from the measurement | Met | Date and owner's initials |
|---|-----------|-----------------------------|-----|---------------------------|
| 1 | A member at the weekly limit costs at most 40% of the net plan price | | | |
| 2 | No more than about 1 in 20 active paid members would reach the weekly limit in a normal week | | | |
| 3 | No paid member gets less Lucy on their plan's model than the present dollar ceiling gives them | | | |

Sizes decided (empty until the owner decides):

| Size | Value | Decided on |
|------|-------|------------|
| Base weekly allowance (usage units) | | |
| Free multiplier | | |
| Standard multiplier | | |
| Premium multiplier | | |
| Session share of the week | | |

When all three conditions are met, ADR-0482 and ADR-0485 are amended with the figures, the
allowance table in `src/selecta/billing/plans.py` is changed to match, the price baseline is
rewritten, and gates 5 and 6 of the [gate register](lm-gate-register.md) can be put forward for
review. If the measurement shows the weekly limit would be reached by more than 1 member in 20,
the answer is a different size or a different window, decided before anyone is affected.

## Measurement log

Newest first. No real-data run has happened yet.

| Date | Window | Report | Reconciled against | Difference | Result |
|------|--------|--------|--------------------|------------|--------|
| | | | | | |
