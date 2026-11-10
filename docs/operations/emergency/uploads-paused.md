# Pause uploads (`uploads.paused`)

Status: stub. It records what the control does in the code today; first checks and recovery steps
need a game-day drill before beta.

## What it does

Planning an upload (`POST /api/uploads/plan`) and signing its parts (`POST /api/uploads/{id}/parts`) answer 503 `uploads_paused`. Finishing an upload whose bytes are already sent still works.

Target: *. Enforced in `admin.guard` (API middleware).

## When to use it

R2 errors or costs spiking, a bad upload client release, abuse through uploads.

## First checks

Check R2 error rates and the upload success metric; check storage spend for today.

## Engage

`POST /api/admin/emergency/uploads.paused/engage` with `{"reason": "...", "target": "..."}`. Needs
`platform.emergency_controls.manage` with MFA in the last five minutes. Audited as
`platform.emergency_control.engage` and alerted (`platform.emergency_control`).

## Recover

`POST /api/admin/emergency/uploads.paused/release` queues the release as the dangerous action
`platform.emergency_control.disable`. After 15 minutes the maintenance leader runs it on its next tick (or `POST /api/admin/actions/{id}/execute` runs it by hand), which
turns the control off (audited as `platform.emergency_control.release`). Then confirm normal
behaviour returned; `tests/test_cloud_admin_emergency.py` shows what "normal" means for this control.
