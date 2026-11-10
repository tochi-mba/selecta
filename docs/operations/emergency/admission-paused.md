# Pause admission for one pool (`admission.paused`)

Status: stub. It records what the control does in the code today; first checks and recovery steps
need a game-day drill before beta.

## What it does

`JobStore.admit` refuses new work for that pool with the reason `admission paused`. Work already queued still runs. Other pools are untouched.

Target: a pool (`cpu-light`, `cpu-heavy`, `gpu`, `export`, `internal`). Enforced in `work.store.JobStore.admit` through `admin.state.DbWorkControls`.

## When to use it

A pool's queue is growing faster than it drains, or its workers are failing every job.

## First checks

On the Overview, look at jobs waiting and the oldest eligible job for that pool, and at failed jobs in the last 24 hours.

## Engage

`POST /api/admin/emergency/admission.paused/engage` with `{"reason": "...", "target": "..."}`. Needs
`platform.emergency_controls.manage` with MFA in the last five minutes. Audited as
`platform.emergency_control.engage` and alerted (`platform.emergency_control`).

## Recover

`POST /api/admin/emergency/admission.paused/release` queues the release as the dangerous action
`platform.emergency_control.disable`. After 15 minutes the maintenance leader runs it on its next tick (or `POST /api/admin/actions/{id}/execute` runs it by hand), which
turns the control off (audited as `platform.emergency_control.release`). Then confirm normal
behaviour returned; `tests/test_cloud_admin_emergency.py` shows what "normal" means for this control.
