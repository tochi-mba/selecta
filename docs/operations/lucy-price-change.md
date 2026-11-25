# Lucy price change procedure (LM-0487-09)

What to do when something that decides how far a Lucy allowance goes is about to change.
[ADR-0487](../adr/adr-0487-lucy-usage-measurement-migration-and-rollout.md) rule 10 says such a
change re-runs the measurement on recent data before it ships. This is a procedure, not an
alert runbook.

State on 2026-11-25: the check below is in place, and so is the guard on a price changed in a
running database (see the known gap). No measurement has been run yet, and the
recorded baseline says so (`"measured_on": null`).

## When this applies

Any change to one of these:

| What | Where in the code |
|------|-------------------|
| A model's price per million tokens | `MODEL_PRICES` in `src/selecta/ai/registry.py` |
| The cache read or cache write multiplier | `CACHE_READ_MULTIPLIER`, `CACHE_WRITE_MULTIPLIER` in the same file |
| A default deployment's model, prices, per-turn cost cap or fallback | `DEFAULT_DEPLOYMENTS` in the same file |
| Which deployment a plan routes to | `DEFAULT_ROUTING` in the same file |
| The allowance table, any version | `LUCY_USAGE` in `src/selecta/billing/plans.py` |

One usage unit is a millionth of a US dollar of model cost. If a model costs more, the same
allowance buys fewer replies; if a plan moves to a dearer model, the same. That is why a change
here is a change to what every member gets, even when no allowance figure moves.

## The check that stops it shipping unmeasured

`tests/fixtures/lucy_price_baseline.json` is a committed record of every figure in the table
above, with the date and the report of the measurement that backs them.
`tests/test_lucy_price_baseline.py` fails in CI whenever the code and the record differ, and
names each difference in a plain sentence. To see the differences yourself:

```
uv run python -m selecta.audit.lucy_price_baseline
```

It prints one line per difference and exits 1 when there are any. It only reads the code and
that one file.

## The procedure

1. **Make the change on a branch.** The check now fails and lists what moved. Read the list: it
   should name what you meant to change and nothing else.
2. **Re-run the measurement on recent data**, at least the last four weeks, against the
   production database with a read-only role:

   ```
   uv run python tools/lucy_usage_report.py --db <read-only url> --days 28
   ```

   The report measures turns at the prices they were charged at. Work out from it what the same
   turns would cost after your change, per plan, and check the three sizing conditions of
   ADR-0487 rule 3 again: a member at the weekly limit costs at most 40% of the net plan price;
   no more than about 1 in 20 active paid members would reach the weekly limit; no paid member
   gets less Lucy than before on their plan's model.
3. **Write it down.** Save a dated report in `docs/verification/` with the window, the figures,
   the change, and whether each condition still holds. Add a row to the measurement log in the
   [measurement record](../verification/lm-usage-measurement.md). If the figures were not
   reconciled with a provider invoice for the window, say so in the report.
4. **Decide.** If a condition no longer holds, the owner decides a new size before the change
   ships. A new size is itself a change to the allowance table and goes in the same pull request.
5. **Rewrite the baseline**, naming the measurement:

   ```
   uv run python -m selecta.audit.lucy_price_baseline --write --measured-on <YYYY-MM-DD> --measurement docs/verification/<the dated report>.md
   ```

   The command refuses to write without both, and refuses a report that does not exist or is
   not under `docs/verification/`. There is no way to rewrite the baseline without naming a
   measurement, and that is the point.
6. **Commit the change, the report and the rewritten baseline together.** The reviewer checks
   that the report named in the baseline is the one for this change.
7. **Reopen the gates.** A price, routing, cap or allowance change reopens gates 4, 5 and 6 in
   the [gate register](../verification/lm-gate-register.md). Record it there. If a rollout step
   is in progress, hold it until they are green again
   ([rollout runbook](lucy-usage-rollout-runbook.md)).

## Known gap: changes made in a running database

The check above reads the code. It cannot see a change made in a running database, and the
gateway charges from the database, not from the code:

- Each row of the `model_deployments` table carries its own model, input and output prices,
  per-turn cost cap and fallback. `registry.save_deployment` writes them. The permission meant
  for this is `models.deployments.manage`.
- The active row of `model_routing_versions` decides which deployment each plan routes to.
  `registry.create_routing_version` and `registry.activate_routing_version` write it. The
  permissions meant for this are `models.routing.propose` and `models.routing.apply`.
- The staged rollout of a new deployment (`python -m selecta.ops.lucy_eval rollout`) moves a
  share of turns onto a candidate deployment, which may have a different price.

It also works the other way. `registry.seed_defaults` only adds deployments that are missing; it
never updates a row that is already there. So changing `MODEL_PRICES` in the code does **not**
change what an existing database charges. After a price change in the code, the stored rows
must be changed too, or the baseline and production disagree.

On 2026-11-25 no admin page or route changes a deployment's prices or the routing map; only
code and operator commands can.

### The guard on a stored price

`registry.save_deployment` is the one place a stored price is written (a test,
`tests/test_cloud_lucy_price_guard.py`, fails if another writer appears). Whenever it would
replace the input or output price of a row that is already there, it runs
`src/selecta/ai/price_guard.py`:

- **Any change needs a reason.** Pass `reason="..."` (and `actor_id` when a person is known).
  Without one the save is refused with `RegistryError` and nothing is written.
- **A change of more than 20% needs the marker.** If either price moves by more than 20% of its
  stored value, up or down, the reason must also carry `[lm-price-change]`. The marker is your
  word that the procedure above was followed: the measurement run again, the code and the
  baseline changed to match. No code can know that, which is why a person says it. Exactly 20%
  passes without the marker. A cut is held to the same rule as a rise, because it makes the
  recorded baseline untrue just the same. The 20% figure is a judgement, set as
  `THRESHOLD_PERCENT` in the guard: small enough that a provider's routine repricing of one
  model is caught, large enough that correcting a rounding slip is not.
- **Every change that goes ahead is audited.** One `audit_events` row with the action
  `models.deployments.price_change`, the deployment as the resource, the reason, and in its
  metadata the old and new input and output prices and whether the marker was given. It is
  written in the same transaction as the change.

For example, from an operator shell:

```python
registry.save_deployment(
    conn, replace(stored, prices=Prices(2.2, 11.0)),
    reason="provider list price up 10% from 2027-02-01, report 2027-02-03", actor_id=me,
)
```

A save that leaves both prices alone (the staged rollout's share, a status, a limit) needs no
reason. A small change still needs the procedure above; the guard only makes sure it is
deliberate and recorded.

### What the guard does not cover

- **A new deployment.** Adding a row is not checked: there is no stored price to compare with,
  and a new deployment answers no turn until routing or a staged rollout sends it some.
- **Routing and the staged rollout.** Activating a routing version, or advancing a candidate
  deployment's share, can move a plan onto a deployment with a different price. Neither is
  guarded yet.
- **The model, the per-turn cost cap and the fallback** of a stored row.
- **A change made with SQL directly**, past the application.
- **The reason is free text.** The guard cannot check that the measurement named in it exists.

**The manual step that covers these.** Before any change to a deployment row or to the active
routing, and again after it, an operator:

1. Reads the stored figures with a read-only role:

   ```sql
   SELECT id, model_id, input_usd_per_mtok, output_usd_per_mtok,
          per_turn_cost_cap_usd, fallback_id
   FROM model_deployments ORDER BY id;
   ```

   and reads the active routing map on the admin AI routing page (`GET /api/admin/ai`).
2. Compares both, line by line, with the `deployments` and `routing` sections of
   `tests/fixtures/lucy_price_baseline.json`.
3. Treats any difference as a price change: follows the procedure above, makes the same change
   in the code so the two agree, and rewrites the baseline with the measurement.

Do the same comparison once before each rollout step in the
[rollout runbook](lucy-usage-rollout-runbook.md).

To see what was changed and why:

```sql
SELECT created_at, actor_id, resource_id, reason, metadata
FROM audit_events WHERE action = 'models.deployments.price_change' ORDER BY created_at;
```

**What is still to build.**

- In `registry.activate_routing_version`: if the first-choice deployment of any plan differs
  from the active map's, require a reason and the marker in the same way.
- The same for a stored row's model, per-turn cost cap and fallback, and for a new deployment
  that is not one of the code's defaults.
- A read-only drift check that builds the same snapshot from the database (`load_deployments`
  and `active_routing`) and runs `lucy_price_baseline.diff` against the committed baseline, shown
  on the admin AI routing page and run before each rollout step, so that a database that has
  drifted from the record is seen without anyone having to look.

## Links

- [Measurement and sizing record](../verification/lm-usage-measurement.md)
- [Gate register](../verification/lm-gate-register.md)
- [Rollout runbook](lucy-usage-rollout-runbook.md)
- [Spend ceiling hit](spend-ceiling.md), for a cost that is already running away
- The check: `src/selecta/audit/lucy_price_baseline.py`, `tests/test_lucy_price_baseline.py`
- The guard on a stored price: `src/selecta/ai/price_guard.py`,
  `tests/test_cloud_lucy_price_guard.py`
