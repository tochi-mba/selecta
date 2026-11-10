# Accepted job lost

Alert: `SelectaSloBurn_accepted_jobs_kept_page / _ticket` (`infra/observability/`). Status: written before beta; refine after the first game day.

## What it means

The invariant audit found an accepted job with no live or finished state. The objective is zero lost accepted jobs; any loss is a correctness bug, not a capacity problem.

## First checks

1. Run the invariant audit by hand against a read replica: `selecta.audit.invariants.assert_clean` names the broken invariant and the job ids.
2. Look the job up by id in the trace store (the job id is a span attribute and its trace id is derived from it): which step ran last?
3. Was there a restore, failover or migration in the window? Check the restore-drill reports and deploy history.

## Safe actions

- Do not delete or edit job rows by hand. Retry the job through the admin console (an audited command).
- If loss continues, [pause admission](emergency/admission-paused.md) until the cause is known.
- Write an incident note: lost accepted work is customer-visible.
