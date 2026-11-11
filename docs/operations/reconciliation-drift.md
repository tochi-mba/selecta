# Reconciliation drift

Alert: `SelectaReconciliationDrift` (`infra/observability/`). Status: written before beta; refine after the first game day.

## What it means

Usage, storage or billing reconciliation found a difference between the ledger, quotas, inventory or Stripe. `selecta.usage.reconcile` only reads; a person decides what is wrong.

## First checks

1. Which check (the `check` label): rollup, storage or billing?
2. Run the reconciliation by hand and read each `Drift`: a missing rollup is cheap to rebuild; a ledger that disagrees with the inventory means something was charged or released wrongly.
3. Was there a restore? Run the post-restore steps (`python -m selecta.ops.restore_drill`).

## Safe actions

- Rebuild missing rollups with `ledger.rollup_day`.
- Never overwrite one side to match the other without finding the cause; record the decision in the incident note.
