# Unit economics measurement: Lucy ceilings and per-mode cost (BF-0464-04, BF-0464-05)

How SelectaDJ measures what an account costs, per account mode, and whether the Lucy allowances
hold under the 40% rule of [ADR-0464](../adr/adr-0464-billing-pricing-and-unit-economics.md).
The method is code, so it is the same every time; the inputs that only the owner holds (the beta's
production data and the provider invoices) are named as person steps.

## What exists (machine-built)

| Piece | Where | What it does |
|-------|-------|--------------|
| Per-mode cost dashboard | `src/selecta/usage/unit_economics.py`, `GET /api/admin/economics/cost-per-mode?month=YYYY-MM` | Marginal cost per account, default (local-first) versus hosted, from stored bytes, upload writes, compute seconds and Lucy dollars, at the ADR-0464 rates; names every unmetered cost |
| Lucy ceiling report | `src/selecta/usage/lucy_ceiling.py`, `GET /api/admin/economics/lucy-ceiling?days=30` | Real turn costs per plan and bucket from the gateway run log, each allowance re-checked under the 40% rule, with a verdict and suggested allowances |
| Owner CLI | `tools/bf_unit_economics.py` | The same two reports from any database URL, as JSON; `--fixture` rehearses the ceiling method on sample data |
| Tests | `tests/test_bf_unit_economics.py` | Pricing, per-mode sums, gaps, verdicts, the database reads, the admin routes and the CLI, on fixtures |

Both admin routes are staff-only (`platform.dashboard.read`), read-only and owned by
`admin.console`.

## Lucy ceiling method (the record ADR-0464 asks for)

The full method is the module notes of `src/selecta/usage/lucy_ceiling.py`. In short:

1. One sample per Lucy run that finished `completed` or `incomplete` in the window (paid turns);
   refunded outcomes are excluded. Bucket = the allowance the run consumed. Dollars = the
   gateway's `cost_usd`.
2. Per plan and bucket: n, mean, median, p95, max, beside the estimated per-turn cap it replaces
   (`ai.spend.TIER_LIMITS`).
3. A maxed-out member costs allowance x mean per bucket, summed (fair-use buckets at their bound);
   a tail figure uses p95.
4. Budget = 40% of the plan price (GBP 6.99 and 12.99) at the day's USD/GBP rate; Free uses its
   accepted absolute ceiling (USD 0.25).
5. Verdict: `insufficient_data` below 30 samples in any bucket with turns; `confirmed` within
   budget; `adjust` otherwise, with every limited bucket scaled by budget / expected, rounded
   down. `tail_risk` flags a p95 overrun when the mean fits.

The report changes nothing. A changed allowance ships as a reviewed code change to
`ai/allowance.py` and the plan catalogue, after the owner's pricing decision (BF-0464-07).

## Per-mode cost method

The module notes of `src/selecta/usage/unit_economics.py` are the method. Mode = the truthful
storage state: hosted when the account holds the `cloud.hosted_media` grant or has bytes stored.
Known gaps, reported in every dashboard body rather than shown as zero:

- R2 Class B (read) operations are not metered per account.
- R2 Class A operations are a lower bound (one per accepted upload or kept export).
- Render bandwidth (API and SSE) is not metered per account.
- Worker compute seconds are not priced until a researched per-second rate is passed.

A dashboard counts as **live** only with at least one account in each mode and some metered use.
The step-4 guard (BF-0467-04) reads exactly that.

## Person steps (not doable by machine)

1. **Run on real data.** During the Labs beta, run both reports against the production database
   with a read-only role, for a full calendar month:

   ```
   uv run python tools/bf_unit_economics.py lucy-ceiling --db <read-only url> --days 30 --usd-per-gbp <day's rate>
   uv run python tools/bf_unit_economics.py cost-per-mode --db <read-only url> --month <YYYY-MM>
   ```

2. **Reconcile against invoices** (the ADRs' required verification). Compare the month's Lucy
   dollars (sum of `modes.*.components_usd.lucy`) with the model provider's invoice, and the R2
   storage and operations lines with the Cloudflare invoice. Record the differences and their
   causes here, dated. A difference over 10% blocks using the numbers until explained.
3. **Decide.** The owner reviews the ceiling verdicts and the per-mode costs with the
   reconciliation, records the allowance decision (BF-0464-07), and docs/saas/13's break-even
   sketch is updated from the reconciled per-mode figures.

## Measurement log

Newest first. No real-data run has happened yet; the first beta month's run and its
reconciliation go here.

| Date | Window | Report | Reconciled against | Result |
|------|--------|--------|--------------------|--------|
| | | | | |
