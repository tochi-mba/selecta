*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

> **Accepted local-first target (2026-11-13; not implemented).** Retire audio worker/pool/queue/storage operations after cutover; retain API, auth, billing and command availability. Add local-engine fleet, output audible health, source availability, clock, software versions, offline journal and device diagnostics without audio telemetry. See ADR-0479. The following historic hosted-media plan and implementation evidence are preserved for reference. [Current architecture](20-local-first-cloud-architecture.md) · [Transition](22-local-first-transition.md).


## 14. Observability and operations

### Maintenance entry points

Schedule `selecta account-deletion-maintenance` and `selecta storage-maintenance` against the Cloud
database with the WorkOS, Stripe and R2 credentials described in [engineering setup](../engineering/README.md).
Storage maintenance mirrors all pending deletion events before it physically deletes any due
objects; a nonzero or pending mirror count stops that purge run. After a database restore, keep the
API and workers closed to customers, run `selecta replay-deletions-after-restore`, and reopen traffic
only after it succeeds. The restore drill (`infra/backup/restore_drill.sh`, then `python -m selecta.ops.restore_drill`) and the backup jobs are described in [backups and the restore drill](../operations/backup-and-restore.md); the first drill in staging is still to run.

- **Traces**: OpenTelemetry across API → Postgres → worker gateway → worker → R2, with the job id as a span attribute (not a metric label). Built in `src/selecta/observability/tracing.py`: each job's trace id is derived from its id, so API, gateway and worker spans meet in one trace (`tests/test_cloud_tracing.py`); export needs the `observability` extra and `OTEL_EXPORTER_OTLP_ENDPOINT`.
- **Metrics** (low-cardinality labels: pool, lane, tier, job type, error class, deployment): queue depth and outstanding work-seconds, wait time p50/p95/p99 by tier and lane, share-vs-weight error, attempts by outcome, lease expiries, worker utilisation, upload success rate, quota reservations outstanding, playback fetch errors, Lucy latency/tokens/cost per tier, Stripe webhook lag and reconciliation drift, R2 errors.
- **SLOs (beta)**: API availability 99.5%; routine API p95 < 300 ms; interactive seam start p95 < 10 s when capacity exists; zero lost accepted jobs; webhook-to-entitlement p95 < 60 s.
- **Alerts** to your phone: API down, error budget burn, oldest interactive job > 2 min, quarantined jobs, spend ceilings hit, audit writes stopped, reconciliation drift, backup failures.
- **Runbooks** in `docs/operations/` for each alert: what it means, first checks, safe actions (drain pool, pause admission, disable a Lucy deployment, read-only mode). SLOs, burn-rate alerts and dashboards are code in `infra/observability/` (`python -m selecta.observability.slo_rules --write`); `tests/test_cloud_slos.py` fails when an alert has no runbook.
- **Emergency controls** as declarative states (not scripts): pause uploads, pause admission per pool, drain workers, disable speculative work, disable Lucy or one deployment, billing safe mode, read-only app, disable signups. They are implemented in `selecta/admin/` (`state.py` says what each one changes and where; `emergency.py` changes them). Engaging needs `platform.emergency_controls.manage`, is instant, audited and alerted; releasing is the dangerous action `platform.emergency_control.disable`, which waits 15 minutes. A change reaches every API instance at once through PostgreSQL `NOTIFY` (a two-second re-read is the fallback), and the maintenance leader runs due releases on its tick, once, under its term fence. Runbook stubs for each are in [docs/operations/emergency](../operations/emergency/README.md); the game-day drill itself is still to run, and no deployed process starts the maintenance loop yet.
- **Status page** on separate infrastructure; incident notes after anything customer-visible.

---

[← 13-hosting-and-cost.md](13-hosting-and-cost.md) · [Contents](README.md#chapters) · [15-stress-testing.md →](15-stress-testing.md)
