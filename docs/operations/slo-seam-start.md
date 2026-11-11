# Interactive seam start SLO burning

Alert: `SelectaSloBurn_seam_start_latency_page / _ticket` (`infra/observability/`). Status: written before beta; refine after the first game day.

## What it means

More than 5% of interactive jobs wait over 10 s between queued and claimed (`job.wait` spans, interactive lane). The SLO only holds when capacity exists, so first decide whether this is capacity or a fault.

## First checks

1. Modal: are cpu-light and cpu-heavy containers starting? Hitting `max_containers`? Slow cold starts?
2. Gateway: claim errors in its traces; `/api/ready` on the gateway.
3. Admin Jobs & workers page: queue depth by lane, workers registered, any pool paused or drained.
4. Emergency controls: is admission paused or are workers drained on purpose?

## Safe actions

- Raise `max_containers` for the pool in `infra/modal/selecta_workers.py` and redeploy workers.
- [Disable speculative work](emergency/speculative-disabled.md) so interactive work gets the capacity.
- If a bad worker release is failing jobs, [drain workers](emergency/workers-drained.md) and redeploy the previous image.
