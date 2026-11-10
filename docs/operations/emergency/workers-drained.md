# Drain workers (`workers.drained`)

Status: stub. It records what the control does in the code today; first checks and recovery steps
need a game-day drill before beta.

## What it does

Claims in that pool (or every pool) return nothing, so workers take no new work; running attempts finish normally. For one worker, use the drain or pause command on the Jobs & workers page instead.

Target: a pool, or `*` for every pool. Enforced in `work.claims.ClaimSession.run` through `admin.state.DbWorkControls`.

## When to use it

A deploy needs workers empty, a worker image is bad, or a provider (Modal) is failing.

## First checks

Check worker counts and lease expiries on the Overview; look at the worker list for holds.

## Engage

`POST /api/admin/emergency/workers.drained/engage` with `{"reason": "...", "target": "..."}`. Needs
`platform.emergency_controls.manage` with MFA in the last five minutes. Audited as
`platform.emergency_control.engage` and alerted (`platform.emergency_control`).

## Recover

`POST /api/admin/emergency/workers.drained/release` queues the release as the dangerous action
`platform.emergency_control.disable`. After 15 minutes, `POST /api/admin/actions/{id}/execute`
turns the control off (audited as `platform.emergency_control.release`). Then confirm normal
behaviour returned; `tests/test_cloud_admin_emergency.py` shows what "normal" means for this control.
