*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 14. Observability and operations

- **Traces**: OpenTelemetry across API → Postgres → worker gateway → worker → R2, with the job id as a span attribute (not a metric label).
- **Metrics** (low-cardinality labels: pool, lane, tier, job type, error class, deployment): queue depth and outstanding work-seconds, wait time p50/p95/p99 by tier and lane, share-vs-weight error, attempts by outcome, lease expiries, worker utilisation, upload success rate, quota reservations outstanding, playback fetch errors, Lucy latency/tokens/cost per tier, Stripe webhook lag and reconciliation drift, R2 errors.
- **SLOs (beta)**: API availability 99.5%; routine API p95 < 300 ms; interactive seam start p95 < 10 s when capacity exists; zero lost accepted jobs; webhook-to-entitlement p95 < 60 s.
- **Alerts** to your phone: API down, error budget burn, oldest interactive job > 2 min, quarantined jobs, spend ceilings hit, audit writes stopped, reconciliation drift, backup failures.
- **Runbooks** in `docs/operations/` for each alert: what it means, first checks, safe actions (drain pool, pause admission, disable a Lucy deployment, read-only mode).
- **Emergency controls** as declarative states (not scripts): pause uploads, pause admission per pool, drain workers, disable speculative work, disable Lucy or one deployment, billing safe mode, read-only app, disable signups.
- **Status page** on separate infrastructure; incident notes after anything customer-visible.

---

[← 13-hosting-and-cost.md](13-hosting-and-cost.md) · [Contents](README.md#chapters) · [15-stress-testing.md →](15-stress-testing.md)
