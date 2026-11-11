# Oldest interactive job over 2 minutes

Alert: `SelectaOldestInteractiveJobOld` (`infra/observability/`). Status: written before beta; refine after the first game day.

## What it means

An interactive job has waited more than two minutes. A listener is waiting on a transition.

## First checks

1. Same first checks as the [seam start SLO](slo-seam-start.md): worker containers, gateway, pools paused or drained.
2. Admin Jobs & workers: is it one job type or one workspace? A job no worker can take (engine version, GPU memory) waits forever.

## Safe actions

- Scale the pool, or redeploy workers with the needed capability.
- Cancel or retry the stuck job through the admin console (audited).
