# Disable sign-ups (`signups.disabled`)

Status: stub. It records what the control does in the code today; first checks and recovery steps
need a game-day drill before beta.

## What it does

`POST /api/onboarding/complete` answers 403 `signups_closed` for people without an account. Existing accounts can still finish onboarding.

Target: *. Enforced in `identity.routes` (onboarding).

## When to use it

Abuse through new accounts, or capacity that can't take new users.

## First checks

Check new accounts today and Free-tier abuse signals.

## Engage

`POST /api/admin/emergency/signups.disabled/engage` with `{"reason": "...", "target": "..."}`. Needs
`platform.emergency_controls.manage` with MFA in the last five minutes. Audited as
`platform.emergency_control.engage` and alerted (`platform.emergency_control`).

## Recover

`POST /api/admin/emergency/signups.disabled/release` queues the release as the dangerous action
`platform.emergency_control.disable`. After 15 minutes, `POST /api/admin/actions/{id}/execute`
turns the control off (audited as `platform.emergency_control.release`). Then confirm normal
behaviour returned; `tests/test_cloud_admin_emergency.py` shows what "normal" means for this control.
