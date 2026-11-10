*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 13. Hosting, infrastructure and cost

### 13.1 Chosen stack (beta)

| Piece | Choice | Why | Alternative |
|---|---|---|---|
| Code, CI, images | GitHub, GitHub Actions, GHCR | Already home; OIDC deploys | - |
| Static app + marketing | Cloudflare Pages | Free, global, same vendor as R2 | Vercel |
| DNS, TLS, WAF | Cloudflare | Rate limiting, bot protection | - |
| Object storage | Cloudflare R2, EU jurisdiction | $0.015/GB-month, **zero egress**: essential for audio playback | S3 (egress fees), Backblaze B2 |
| API, gateway, maintenance | Render web services (Frankfurt), Pro workspace ($25/month flat; autoscaling needs Pro or above) | Docker deploys from GitHub, simple; their traffic is small JSON/SSE, so Render's 25 GB included egress and $0.15/GB beyond are acceptable here | Fly.io Machines, AWS ECS later |
| PostgreSQL | Render Postgres (Frankfurt) with point-in-time recovery; Render's built-in PgBouncer (transaction mode, free on paid databases) for request traffic, direct connections for `LISTEN` and the leader lock | Same network as the API, simple ops | Neon (scale-to-zero, branching for previews), Supabase |
| CPU workers (beta) | Modal functions in an EU region (per-second billing, scale to zero) | No servers to run; absorbs import spikes; monthly egress allowance then ~$0.04/GiB | Runpod CPU |
| Reserved CPU workers (later) | Hetzner shared-vCPU servers (CX/CAX lines) | Cheapest steady compute with large included traffic; add when steady utilisation justifies it. Dedicated CCX prices more than doubled in 2026, so avoid those | - |
| GPU stems | Modal (T4 ~$0.59/h, L4 ~$0.80/h) | Per-second, scale to zero, Python-native | Runpod serverless (flex workers per-second) |
| **Not chosen for workers** | Render background workers | Every worker upload to R2 is Render egress at $0.15/GB past 25 GB/month; proxies, stems and exports would make that the biggest bill | - |
| Maintenance service | Two Render background workers running `selecta maintain` (one leads, one stands by), on a direct database connection | Small and steady; it only talks to PostgreSQL, Stripe, WorkOS and R2, so no worker egress | Any always-on container host |
| Identity | WorkOS AuthKit | Free to 1M MAU, MFA, passkeys | Clerk |
| Payments | Stripe Billing, Checkout, Portal, Tax | Your choice | Paddle as merchant of record if VAT burden bites |
| AI | Anthropic API | Already integrated (`providers.py`), tiered model family | Second vendor via OpenAI-compatible adapter |
| Errors | Sentry | Frontend + backend | - |
| Metrics, logs, traces | Grafana Cloud via OpenTelemetry | Free tier to start | Better Stack |
| Email | Postmark or Resend | Transactional only | - |
| Status page | Better Stack or Instatus (separate infrastructure) | Up when we're down | - |
| IaC | OpenTofu for Cloudflare; `render.yaml` blueprint; Modal apps in code | Reproducible staging/prod | - |

### 13.2 Environments

- **Local dev**: `dev.cmd` as now for local mode; `docker compose` (Postgres, MinIO for S3 API, API, one worker) for cloud mode.
- **Preview**: per-PR frontend previews on Cloudflare Pages; optional Neon branch database for backend previews later.
- **Staging**: full stack, Stripe test mode, capped AI keys, synthetic users and libraries; stress tests run here.
- **Production**: protected GitHub environment with required approval; migrations run as a release step (expand → deploy → contract, never breaking old workers).

### 13.3 CI/CD changes

- Keep the Windows jobs (local mode is a Windows app).
- Add **Linux jobs** for cloud mode: Postgres service container, MinIO, worker image build, integration tests, scheduler simulator, migration up/down check.
- Build and push images on `main`; deploy to staging automatically; deploy to prod by approval; Modal deploys from the same commit.
- The file-length rule continues to apply to all new code and docs.

### 13.4 Monthly cost estimate

| Item | Beta (~200 users, ~50 active, ~0.6 TB stored) | Growth (~2,000 users, ~6 TB) | Scale (~20,000 users, ~60 TB) |
|---|---|---|---|
| R2 storage + operations (originals + derived, plus a backup copy of originals in Infrequent Access) | ~$20 | ~$170 | ~$1,600 |
| Render Pro workspace | $25 | $25 | $25 (or Scale plan) |
| API + gateway instances | ~$25–60 | ~$100–250 | ~$500–1,200 |
| Postgres | ~$20–50 | ~$100–200 | ~$500–1,500 |
| CPU + GPU workers (Modal at beta; reserved Hetzner pool from Growth) | ~$20–90 | ~$300–700 | ~$2,500–6,000 |
| Worker egress (uploads to R2 beyond allowances) | ~$0 (inside allowance) | ~$0–60 | ~$200–800 |
| Anthropic (Lucy) | ~$20–80 | ~$300–900 | ~$3,000–9,000 |
| Auth, errors, metrics, email, status | ~$0–40 | ~$100–250 | ~$500–1,200 |
| **Total** | **~$130–400** | **~$1,100–2,600** | **~$8,000–21,000** |

Ranges widen with scale because Lucy and processing depend on behaviour, which beta will measure. Phase 0 measures egress per song (proxy, stems, clips) alongside CPU seconds, because data transfer is now a real line item. Revenue check at "Growth": if 8% of 2,000 users pay an average £9, that's ~£1,440/month, roughly break-even against these costs, so the free-to-paid ratio and Lucy allowances are the levers to watch.

### 13.5 Backups and disaster recovery

- Postgres: provider PITR (target recovery point ≤ 5 minutes) plus a nightly logical dump to a separate R2 bucket in another account; restore drill monthly in staging.
- R2: originals copied nightly to a backup bucket in a separate Cloudflare account (different credentials, Infrequent Access class at about two-thirds the price) for recovery from our own bugs or compromised keys; physical deletion of originals runs 30 days after the user deletes (the deletion ledger still hides them at once), which covers accidental deletion without restoring from backup; derived data is not backed up (it can be regenerated).
- After any restore: replay the deletions ledger, run storage reconciliation, re-run Stripe reconciliation, expire leases, then reopen.
- Targets to prove in drills: recovery time under 60 minutes for a database restore; zero accepted jobs lost in covered failures (whole-region loss is out of scope for beta).

---

[← 12-security-privacy-legal.md](12-security-privacy-legal.md) · [Contents](README.md#chapters) · [14-operations.md →](14-operations.md)
