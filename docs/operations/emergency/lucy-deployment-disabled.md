# Disable one Lucy deployment (`lucy.deployment_disabled`)

Status: stub. It records what the control does in the code today; first checks and recovery steps
need a game-day drill before beta.

## What it does

Routing treats that deployment as disabled and falls back along its chain, down to the built-in planner. The built-in planner itself can't be disabled.

Target: a deployment id from the AI routing page. Enforced in `selecta.ai.gateway.plan_turn`.

## When to use it

One model or provider is unhealthy, slow or too expensive.

## First checks

Check the deployment's health and cost per tier on the AI routing page.

## Engage

`POST /api/admin/emergency/lucy.deployment_disabled/engage` with `{"reason": "...", "target": "..."}`. Needs
`platform.emergency_controls.manage` with MFA in the last five minutes. Audited as
`platform.emergency_control.engage` and alerted (`platform.emergency_control`).

## Recover

`POST /api/admin/emergency/lucy.deployment_disabled/release` queues the release as the dangerous action
`platform.emergency_control.disable`. After 15 minutes, `POST /api/admin/actions/{id}/execute`
turns the control off (audited as `platform.emergency_control.release`). Then confirm normal
behaviour returned; `tests/test_cloud_admin_emergency.py` shows what "normal" means for this control.
