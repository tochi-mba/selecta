# Routine API latency SLO burning

Alert: `SelectaSloBurn_api_routine_latency_page / _ticket` (`infra/observability/`). Status: written before beta; refine after the first game day.

## What it means

More than 5% of routine API requests (uploads, the event stream and Lucy streams excluded) take longer than 300 ms.

## First checks

1. Dashboard `selecta-slo-api_routine_latency`: which routes? Open a slow trace from the exemplars.
2. Database: lock waits, slow queries, PgBouncer queueing; a long transaction holding job rows.
3. Admin read paths: are many staff viewers open? They read small aggregates; compare with `tests/load/admin_read_isolation.js` results.
4. Render CPU and memory per instance; is autoscaling at its maximum?

## Safe actions

- Scale the API service up in Render (production scaling allows up to 6 instances).
- [Disable speculative work](emergency/speculative-disabled.md) to cut background writes.
- Roll back the last deploy if latency rose with it.
