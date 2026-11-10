# Read-only app (`app.read_only`)

Status: stub. It records what the control does in the code today; first checks and recovery steps
need a game-day drill before beta.

## What it does

Every customer request that would change something answers 503 `read_only`. Reads still work, and so do signing out everywhere, the signed Stripe and WorkOS webhooks, and the admin console.

Target: *. Enforced in `admin.guard` (API middleware).

## When to use it

A database incident, a restore in progress, or a data-corrupting bug.

## First checks

Check Postgres health, the error budget, and whether a restore or migration is running.

## Engage

`POST /api/admin/emergency/app.read_only/engage` with `{"reason": "...", "target": "..."}`. Needs
`platform.emergency_controls.manage` with MFA in the last five minutes. Audited as
`platform.emergency_control.engage` and alerted (`platform.emergency_control`).

## Recover

`POST /api/admin/emergency/app.read_only/release` queues the release as the dangerous action
`platform.emergency_control.disable`. After 15 minutes, `POST /api/admin/actions/{id}/execute`
turns the control off (audited as `platform.emergency_control.release`). Then confirm normal
behaviour returned; `tests/test_cloud_admin_emergency.py` shows what "normal" means for this control.
