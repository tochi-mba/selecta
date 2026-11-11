# Jobs quarantined

Alert: `SelectaJobsQuarantined` (`infra/observability/`). Status: written before beta; refine after the first game day.

## What it means

A job failed often enough, or in a way that looked unsafe, that it was quarantined so it stops consuming workers.

## First checks

1. Admin Jobs & workers, quarantined filter: which job types and error classes?
2. Open the job's trace by id; the `worker.run` span carries the outcome and the failure.
3. Was a worker release just deployed?

## Safe actions

- Leave them quarantined while diagnosing; release them through the admin console once fixed.
- If one job type is failing everywhere, [drain workers](emergency/workers-drained.md) and roll back the worker image.
