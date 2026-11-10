# Billing safe mode (`billing.safe_mode`)

Status: stub. It records what the control does in the code today; first checks and recovery steps
need a game-day drill before beta.

## What it does

Checkout and the billing portal answer 503 `billing_safe_mode`. Stripe webhooks are still received and stored but not applied (`status: held`), and `billing-maintenance` skips them; once safe mode ends, the next maintenance run applies every held event. Current entitlements stay as they are.

Target: *. Enforced in `admin.guard`, `billing.api` (webhook) and `billing.maintenance.drain_stripe_events`.

## When to use it

Stripe is sending wrong or duplicated state, a pricing mistake, or reconciliation drift that keeps growing.

## First checks

Check Stripe webhook lag, reconciliation drift and the stored events table.

## Engage

`POST /api/admin/emergency/billing.safe_mode/engage` with `{"reason": "...", "target": "..."}`. Needs
`platform.emergency_controls.manage` with MFA in the last five minutes. Audited as
`platform.emergency_control.engage` and alerted (`platform.emergency_control`).

## Recover

`POST /api/admin/emergency/billing.safe_mode/release` queues the release as the dangerous action
`platform.emergency_control.disable`. After 15 minutes the maintenance leader runs it on its next tick (or `POST /api/admin/actions/{id}/execute` runs it by hand), which
turns the control off (audited as `platform.emergency_control.release`). Then confirm normal
behaviour returned; `tests/test_cloud_admin_emergency.py` shows what "normal" means for this control.
