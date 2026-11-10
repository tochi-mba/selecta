# Disable speculative work (`speculative.disabled`)

Status: stub. It records what the control does in the code today; first checks and recovery steps
need a game-day drill before beta.

## What it does

Speculative (spare-time) jobs are neither admitted nor claimed. Interactive and standard work keep their full capacity.

Target: *. Enforced in `JobStore.admit` and `ClaimSession.run`.

## When to use it

Compute spend nearing its ceiling, or pools saturated so customers wait.

## First checks

Check today's compute spend and the p95 wait per lane.

## Engage

`POST /api/admin/emergency/speculative.disabled/engage` with `{"reason": "...", "target": "..."}`. Needs
`platform.emergency_controls.manage` with MFA in the last five minutes. Audited as
`platform.emergency_control.engage` and alerted (`platform.emergency_control`).

## Recover

`POST /api/admin/emergency/speculative.disabled/release` queues the release as the dangerous action
`platform.emergency_control.disable`. After 15 minutes the maintenance leader runs it on its next tick (or `POST /api/admin/actions/{id}/execute` runs it by hand), which
turns the control off (audited as `platform.emergency_control.release`). Then confirm normal
behaviour returned; `tests/test_cloud_admin_emergency.py` shows what "normal" means for this control.
