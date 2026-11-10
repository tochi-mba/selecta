# Spend ceiling hit

Alert: `SelectaSpendCeilingHit` (`infra/observability/`). Status: written before beta; refine after the first game day.

## What it means

An AI or compute spend ceiling refused work. Per-account ceilings are normal; the platform ceiling means everyone's Lucy or processing is limited.

## First checks

1. Admin AI routing: which ceiling (per call, turn, account or platform) and which deployment?
2. Is one account burning the budget (abuse) or is it organic growth?
3. Anthropic console: does actual spend match the ledger?

## Safe actions

- [Disable one Lucy deployment](emergency/lucy-deployment-disabled.md) or [Lucy entirely](emergency/lucy-disabled.md) if spend is runaway.
- Raise a ceiling only after confirming the cost is real, and record why in the audit reason.
