# Disable Lucy (`lucy.disabled`)

Status: stub. It records what the control does in the code today; first checks and recovery steps
need a game-day drill before beta.

## What it does

`ai.gateway.plan_turn` refuses every new turn with `lucy_disabled` before anything is counted. Turns already running finish.

Target: *. Enforced in `selecta.ai.gateway.plan_turn`.

## When to use it

An AI provider incident, a runaway cost, or a prompt or tool bug that harms answers.

## First checks

Check AI spend today, provider health and the AI routing page.

## Engage

`POST /api/admin/emergency/lucy.disabled/engage` with `{"reason": "...", "target": "..."}`. Needs
`platform.emergency_controls.manage` with MFA in the last five minutes. Audited as
`platform.emergency_control.engage` and alerted (`platform.emergency_control`).

## Recover

`POST /api/admin/emergency/lucy.disabled/release` queues the release as the dangerous action
`platform.emergency_control.disable`. After 15 minutes the maintenance leader runs it on its next tick (or `POST /api/admin/actions/{id}/execute` runs it by hand), which
turns the control off (audited as `platform.emergency_control.release`). Then confirm normal
behaviour returned; `tests/test_cloud_admin_emergency.py` shows what "normal" means for this control.
