*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 4. Target architecture

### 4.1 Runtime modes: one codebase

| Concern | `local` mode (today's app, kept) | `cloud` mode (new) |
|---|---|---|
| Users | One, no login | Accounts, workspaces, staff roles |
| Database | SQLite | PostgreSQL |
| Audio | Folders on disk | R2 objects via uploads |
| Jobs | Same job tables and runner, in-process workers | Same job tables, remote worker pools |
| Lucy | Bring your own key, or built-in planner | Server-owned routing by tier |
| Network posture | 127.0.0.1 only, Host/Origin checks | Auth, CORS allowlist, rate limits, WAF |
| Settings UI | Machine settings visible | Machine settings hidden; plan and billing shown |

`SELECTA_MODE=local|cloud` selects adapters at app start. Domain logic (analysis, planner, render, seams, mix, Lucy tools) stays shared. The strangler order is deliberate: **the durable job system lands in local mode first** (Phase 1), so the live local app proves it with real audio before anything goes to the cloud.

### 4.1.1 Current implementation on the Cloud branch

The branch now has an executable Cloud slice: `selecta.api:serve` selects the Cloud app when
`SELECTA_MODE=cloud`; the Cloud app requires PostgreSQL, explicit AuthKit issuer/audience settings,
and host/origin allowlists; it starts no local watcher or audio worker. It exposes liveness and
migration-aware readiness, verified-email and age-confirmed account provisioning, Free-plan storage initialization,
account/entitlement reads with per-user feature decisions, Labs opt-ins, sign-out-everywhere,
Stripe Checkout and customer portal sessions, and a signed Stripe webhook receiver that persists
event ids and re-fetches subscription state before updating entitlement and storage quota.
The onboarding route is owned by `cloud.signups` in the shared flag registry. `selecta db upgrade` applies the checked-in Alembic
schema to the configured PostgreSQL database.

The automated Cloud bootstrap test guards against the local startup hooks running in Cloud mode.

The shared migration set currently contains 50 tables and has been exercised through SQLite
upgrade, schema comparison and rollback while preserving a legacy `songs` table. PostgreSQL
migration execution and row-level security are not yet verified or implemented. Stripe session
creation and webhook reconciliation are wired, and Cloud uploads can reserve quota, resume
multipart transfers, validate metadata and accept objects into workspace storage. Nightly billing
reconciliation, a durable webhook retry worker, Stripe Tax setup and Cloud billing UI remain
incomplete. Upload completion currently probes audio metadata in API temporary storage; moving that
work to remote workers remains part of the worker gateway effort. Worker gateway routes and the
Cloud UI also remain future implementation work.

### 4.2 Component map

```
 Browser (React SPA, PWA)                     Staff browser (/admin, same SPA, lazy chunk)
   │  HTTPS JSON + SSE          direct PUT/GET to R2 (presigned, short TTL)
   ▼                                   │
 Cloudflare (DNS, TLS, WAF, Pages for static assets)
   │                                   │
   ▼                                   ▼
 API service (FastAPI, stateless, N instances) ───────────► R2 buckets: originals / derived / exports / staging
   │  ├─ public API (customer) + SSE                          ▲            ▲
   │  ├─ admin API (staff, step-up)                           │            │ signed URLs per attempt
   │  ├─ Stripe webhook receiver                              │            │
   │  └─ AI gateway (Lucy) ─────► Anthropic API (+ fallback)  │            │
   │                                                          │   Worker pools (Linux containers)
 Gateway service (same image, own deployment) ◄──── HTTPS ─────────── ├─ CPU pools (Modal at beta, EU region)
   │  /internal/workers/*: register, claim, heartbeat, complete         ├─ GPU stems (Modal)
   │                                                                    └─ later: reserved CPU on Hetzner
   ▼
 PgBouncer (transaction pooling) ──► PostgreSQL (system of record: accounts, library, mixes,
   ▲                                  jobs, leases, usage ledger, outbox, audit)
   │  plus one direct connection per instance for LISTEN, and one for the leader lock
 Maintenance process (single leader via advisory lock): lease reaper, dependency release,
 quota reconciler, GC, Stripe nightly reconcile, usage rollups, autoscaler (spawns Modal workers)
```

**Rules that make this hold together:**
- Audio never passes through the API or gateway: browsers and workers read and write R2 directly with short-lived signed URLs. The API's own outbound traffic stays small (JSON and SSE), which matters on hosts that charge for egress.
- Request traffic uses the pooler; anything that needs a session (`LISTEN`, session advisory locks) uses its own direct connection. The connection budget is planned: pooled connections per instance × instances + one listener per instance + one leader connection stays under the database's limit with headroom.
- Every tenant query runs inside an explicit transaction that sets the workspace for row-level security with `set_config('app.workspace_id', …, true)` (transaction-scoped, so it's safe through the pooler).

External services: WorkOS AuthKit (identity), Stripe (billing), Anthropic (Lucy), Sentry and Grafana Cloud (observability), a transactional email provider, an independent status page.

### 4.3 Deployment units (all built from one commit)

| Unit | Image | Scale | Notes |
|---|---|---|---|
| `web` | static build of `web/` | CDN | Cloudflare Pages |
| `api` | `selecta-api` | 2+ instances (Render) | Stateless; no background threads in cloud mode; customer, admin, webhook and SSE traffic |
| `gateway` | `selecta-api` with `selecta gateway` | 2+ instances (Render) | Worker API only; scales with worker count, isolated from customer traffic |
| `maintenance` | `selecta-api` with `selecta maintain` | 1 active + 1 standby (Render) | Leader election with `pg_try_advisory_lock` on a direct connection; tasks idempotent and term-fenced |
| `worker-cpu` | `selecta-worker` (ffmpeg, torch CPU, models baked in) | 0–N on Modal at beta; reserved Hetzner pool later | Pools selected by env |
| `worker-gpu` | `selecta-worker-gpu` (CUDA torch, Demucs) | 0–N on Modal | Stems only at first |

---

[← 02-plans-and-economics.md](02-plans-and-economics.md) · [Contents](README.md#chapters) · [04-queue-and-scheduling.md →](04-queue-and-scheduling.md)
