# Game day: emergency controls drill

For SC-0410-04 (ADR-0410). Run in staging, with two people: one operator, one observer who
writes the record. Every control is engaged, checked, released and checked again. File the
record as `docs/operations/drills/game-day-<date>.md`.

## Before

1. Staging is on the same commit as production, with synthetic users and libraries, Stripe in
   test mode and capped AI keys.
2. `tests/test_cloud_admin_emergency.py` and `tests/test_cloud_admin_backend.py` pass on that
   commit: they define what "engaged" and "normal" mean for each control.
3. The operator has `platform.emergency_controls.manage` with MFA in the last five minutes.

## For each control

Controls: [uploads paused](emergency/uploads-paused.md), [admission paused](emergency/admission-paused.md),
[workers drained](emergency/workers-drained.md), [speculative work off](emergency/speculative-disabled.md),
[Lucy off](emergency/lucy-disabled.md), [one Lucy deployment off](emergency/lucy-deployment-disabled.md),
[billing safe mode](emergency/billing-safe-mode.md), [read-only](emergency/read-only.md),
[sign-ups off](emergency/signups-disabled.md).

1. Engage it from the admin console with a reason. Note the time.
2. Within 5 s, on every API instance: the effect its runbook describes (try the blocked action
   as a synthetic user from two browsers that hit different instances).
3. The audit log shows `platform.emergency_control.engage` with the reason; an owner alert was
   raised.
4. Release it. The release waits 15 minutes as a dangerous action; the maintenance leader runs it.
5. Normal behaviour is back; the audit log shows the release.

## First checks

If a control does not take effect within 5 s, check the PostgreSQL `NOTIFY` listener on each API
instance (the two-second re-read is the fallback) before anything else.

## Safe actions

- Stop the drill and release everything engaged if a real incident starts.
- Record every surprise as a ticket against the control's runbook.
