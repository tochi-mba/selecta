# How-to recipes

Step-by-step recipes for the changes people make most. Each ends with the checks to run. Read [conventions](conventions.md) first.

## Add a feature (always behind a flag)

1. **Decide the flag.** Add it to the right `src/selecta/flags/*.json` area. Cloud-only features go in `cloud.json` with `"modes": ["cloud"]`. Fill in `label`, `about`, `requires`, and the `routes`, `cli` and `surfaces` it owns. Paid features are listed in the plans that include them (`billing/plans.py`); a flag never grants a paid feature by itself.
2. **Build the server side.** Every route you add must be listed on the flag. Background work checks the flag at its source; a job type names its owning flag in `work/catalogue.py`.
3. **Build the UI.** Wrap it in the flag (`<Flag id="...">`, `useFlag`, `visible()` in `web/src/flags.ts`) so it disappears cleanly when off.
4. **Regenerate the catalogue:**
   ```bash
   .venv/Scripts/python.exe -m selecta.cli flags --markdown docs/flags.md
   ```
5. **Check:**
   ```bash
   .venv/Scripts/python.exe -m pytest tests/test_flags.py tests/test_flag_server.py -q
   ```
   From `web/`: `pnpm e2e:flags` when the UI changed.

## Add or change a table

1. Declare the table in the owning package's `schema.py` on `persistence.metadata`, with `workspace_id` (non-null, indexed) if it holds tenant data. Register a new module in `persistence/registry.py`.
2. Generate a migration against an up-to-date scratch database:
   ```python
   from selecta.persistence import make_engine, migrate
   engine = make_engine("sqlite:///scratch.sqlite")
   migrate.upgrade(engine)
   migrate.revision(engine, "what changed, in plain words")
   ```
3. Rewrite the generated file in the style of the others in `persistence/migrations/versions/` (`from collections.abc import Sequence`, a docstring saying why), and check the `downgrade()` undoes it.
4. **Check:** `migrate.pending_changes(engine)` is empty after `upgrade`, upgrading twice is a no-op, and `tests/test_cloud_api.py::test_cloud_schema_upgrade_and_rollback_preserve_legacy_local_tables` passes. Never edit a migration that has run anywhere: add a new one.

## Add a job type

1. Add it to `work/catalogue.py`: pool, default lane, owning flag, default estimated cost and maximum run time.
2. Write the handler for the runner (`workers/`): it takes the job input and a context (scratch folder, `progress()`, `check_in()`, output publishing) and returns results. Call `check_in()` in long loops so cancellation and preemption work.
3. If its results change database rows, register a result applier so they're applied inside the fenced `complete` transaction. Workers never write to the database directly.
4. Producers enqueue with an idempotency key, so asking twice makes one job.
5. **Check:** the lifecycle tests for the new type (claim, complete, fail, cancel, lease expiry) and the flag test.

## Add a permission or change a role

1. Add the permission to `authz/permissions.py` with a description and danger level. Dangerous permissions need fresh MFA and are audited.
2. Give it to roles in `authz/roles.py`. The registry validates itself at import, so a typo fails at once.
3. If the action is dangerous enough to wait or need a second person, add an `ActionKind` and `ActionRule` in `authz/delayed.py`.
4. In the route, call `authorize(conn, actor, "<permission>", resource)` before doing anything.
5. **Check:** the authz tests, and the role tables in [§7.3](../saas/07-identity-rbac-admin.md#73-staff-rbac) and [§11B.9](../saas/11b-feature-flags.md) still match the code (update the docs in the same PR).

## Add a plan entitlement

1. Add the field to `Plan` in `billing/plans.py` with a value for every plan.
2. Enforce it on the server where the feature is used (quota, allowance or limit check), never only in the UI.
3. Show it on the Plan & billing page with the plan that unlocks it.
4. **Check:** the plan catalogue tests, and update [§3.1](../saas/02-plans-and-economics.md#31-plan-catalogue-starting-values-all-admin-tunable-and-versioned).

## Record progress on the checklist

When a task's acceptance is met and its verification ran, tick it in [the checklist](../adr/selecta-cloud-implementation-checklist.md) and the ADR's own list, ending the line with `Evidence:` naming the files, tests or CI run. Then run:

```bash
python src/selecta/audit/checklist_evidence.py
```

"Independently verified" stays `No` until someone other than the implementer checks it.
