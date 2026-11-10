*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 14. Observability and operations

### Maintenance entry points

Schedule `selecta account-deletion-maintenance` and `selecta storage-maintenance` against the Cloud
database with the WorkOS, Stripe and R2 credentials described in [engineering setup](../engineering/README.md).
Storage maintenance mirrors all pending deletion events before it physically deletes any due
objects; a nonzero or pending mirror count stops that purge run. After a database restore, keep the
API and workers closed to customers, run `selecta replay-deletions-after-restore`, and reopen traffic
only after it succeeds. A full restore drill and backup expiration procedure still need to be
written and exercised.

- **Traces**: OpenTelemetry across API → Postgres → worker gateway → worker → R2, with the job id as a span attribute (not a metric label).
- **Metrics** (low-cardinality labels: pool, lane, tier, job type, error class, deployment): queue depth and outstanding work-seconds, wait time p50/p95/p99 by tier and lane, share-vs-weight error, attempts by outcome, lease expiries, worker utilisation, upload success rate, quota reservations outstanding, playback fetch errors, Lucy latency/tokens/cost per tier, Stripe webhook lag and reconciliation drift, R2 errors.
- **SLOs (beta)**: API availability 99.5%; routine API p95 < 300 ms; interactive seam start p95 < 10 s when capacity exists; zero lost accepted jobs; webhook-to-entitlement p95 < 60 s.
- **Alerts** to your phone: API down, error budget burn, oldest interactive job > 2 min, quarantined jobs, spend ceilings hit, audit writes stopped, reconciliation drift, backup failures.
- **Runbooks** in `docs/operations/` for each alert: what it means, first checks, safe actions (drain pool, pause admission, disable a Lucy deployment, read-only mode).
- **Emergency controls** as declarative states (not scripts): pause uploads, pause admission per pool, drain workers, disable speculative work, disable Lucy or one deployment, billing safe mode, read-only app, disable signups. They are implemented in `selecta/admin/` (`state.py` says what each one changes and where; `emergency.py` changes them). Engaging needs `platform.emergency_controls.manage`, is instant, audited and alerted; releasing is the dangerous action `platform.emergency_control.disable`, which waits 15 minutes. A change reaches every API instance at once through PostgreSQL `NOTIFY` (a two-second re-read is the fallback), and the maintenance leader runs due releases on its tick, once, under its term fence. Runbook stubs for each are in [docs/operations/emergency](../operations/emergency/README.md); the game-day drill itself is still to run, and no deployed process starts the maintenance loop yet.
- **Status page** on separate infrastructure; incident notes after anything customer-visible.

---

[← 13-hosting-and-cost.md](13-hosting-and-cost.md) · [Contents](README.md#chapters) · [15-stress-testing.md →](15-stress-testing.md)
