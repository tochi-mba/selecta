# Emergency controls runbooks

Each emergency control is a declarative state (§14, ADR-0410), not a script. Engage one from the admin console or with `POST /api/admin/emergency/{control}/engage` (`platform.emergency_controls.manage`, fresh MFA). Engaging is instant, audited and alerts every Owner. Releasing is a dangerous action: `POST /api/admin/emergency/{control}/release` queues it, it waits 15 minutes (or a second approver once there are two staff), then `POST /api/admin/actions/{id}/execute` runs it after re-checking the proposer's authority.

The controls take effect within two seconds on every API instance (`admin.state.EmergencyCache`) and at once in job claims, admission and Lucy turns, which read the table in their own transaction.

| Control | Target | Runbook |
|---|---|---|
| `uploads.paused` | * | [Pause uploads](uploads-paused.md) |
| `admission.paused` | a pool (`cpu-light`, `cpu-heavy`, `gpu`, `export`, `internal`) | [Pause admission for one pool](admission-paused.md) |
| `workers.drained` | a pool, or `*` for every pool | [Drain workers](workers-drained.md) |
| `speculative.disabled` | * | [Disable speculative work](speculative-disabled.md) |
| `lucy.disabled` | * | [Disable Lucy](lucy-disabled.md) |
| `lucy.deployment_disabled` | a deployment id from the AI routing page | [Disable one Lucy deployment](lucy-deployment-disabled.md) |
| `billing.safe_mode` | * | [Billing safe mode](billing-safe-mode.md) |
| `app.read_only` | * | [Read-only app](read-only.md) |
| `signups.disabled` | * | [Disable sign-ups](signups-disabled.md) |
