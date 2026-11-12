# Selecta Cloud — SaaS setup and launch checklist (WIP)

> **Work in progress, 12 November 2026.** Practical operator checklist for the accepted Selecta Cloud design. This does **not** mean the accounts are configured or the product is deployment-ready. Source of truth: [Cloud implementation checklist](../adr/selecta-cloud-implementation-checklist.md), [hosting plan](13-hosting-and-cost.md), [architecture](03-architecture.md), [authentication](07a-authentication.md), [billing](08-billing.md), [operations](14-operations.md), and [licence register](licence-register.md). Verify current vendor requirements and costs before paying. **Set up staging before production.** Local mode remains unchanged.

## 1. Accounts and services to create

| Done | Account/service | Why you need it | When |
|---|---|---|---|
| [ ] | Business-owned email and password manager | Provider owner/recovery identity, support@/privacy@/billing@/security@ inboxes; MFA and offline recovery codes | First |
| [ ] | Domain registrar | Buy/verify the *real* domain, configure renewal/registrar lock | First |
| [ ] | [GitHub](https://github.com) — existing repo | Source, CI, GitHub Container Registry (GHCR), deployment approvals | Existing; verify access |
| [ ] | [Cloudflare](https://dash.cloudflare.com) primary account | DNS/TLS/WAF, Pages site, private EU-jurisdiction R2 audio buckets | First |
| [ ] | **Second Cloudflare account** | Separate, independently secured backup account for originals, database dumps and infrastructure state | Before real data |
| [ ] | [Render](https://dashboard.render.com) | Frankfurt PostgreSQL, API, worker gateway, maintenance services | First |
| [ ] | [Modal](https://modal.com) | EU CPU analysis/render jobs, optional GPU stem separation | Before end-to-end staging |
| [ ] | [WorkOS AuthKit](https://dashboard.workos.com) | Customer signup, Google login, sessions, staff MFA | First |
| [ ] | [Google Cloud](https://console.cloud.google.com) | Selecta-branded Google OAuth credentials for WorkOS | Before live sign-in |
| [ ] | [Stripe](https://dashboard.stripe.com) | GBP subscriptions, Checkout, customer portal, Stripe Tax, webhooks | Test mode first |
| [ ] | [Anthropic Console](https://console.anthropic.com) | Lucy's server-owned AI models and budget | Before Lucy staging |
| [ ] | [Sentry](https://sentry.io) | Frontend/backend error reporting | Before beta |
| [ ] | [Grafana Cloud](https://grafana.com/products/cloud/) | Metrics, OpenTelemetry traces, alerts | Before beta |
| [ ] | [Resend](https://resend.com) **or** [Postmark](https://postmarkapp.com) | Transactional mail; choose one, not both | Before beta |
| [ ] | [Better Stack](https://betterstack.com) **or** [Instatus](https://instatus.com) | Independent public status page | Before beta |
| [ ] | UK business/bank/accountant | Stripe seller verification, payouts, tax filings, record keeping | Before charging |
| [ ] | [ICO](https://ico.org.uk) | UK data-protection fee assessment/registration as appropriate | Before beta |
| [ ] | UK music/IP, privacy and consumer-law adviser | Written review of user music, lyrics, model licences, privacy, subscription terms | **Paid launch blocker** |

**Not required initially:** Hetzner's reserved worker fleet, a second AI provider, extra currencies or a separate merchant of record. The accepted beta design uses a private UK-only launch.

## 2. Decide and secure the basics

- [ ] Choose an **actually owned** domain. The deployment files' `selecta.app` is explicitly a **placeholder**, not proof of ownership.
- [ ] Adopt consistent addresses, for example `app.YOUR-DOMAIN`, `api.YOUR-DOMAIN`, `gateway.YOUR-DOMAIN`, `auth.YOUR-DOMAIN`, plus corresponding staging hosts.
- [ ] Set DNS, end-to-end HTTPS/TLS, mail SPF/DKIM/DMARC, support/security/privacy inboxes, ownership/recovery and MFA on every vendor.
- [ ] Decide company/sole-trader structure and UK billing scope with professional advice. Ensure the sale country boundary is actually enforced; Stripe Checkout collecting a billing address is **not** country blocking.
- [ ] Confirm plan **storage** (Free 10 GB, Standard 50 GB, Premium 100 GB). Proposal **prices** (£6.99/£12.99 per month; £59/£109 annually) are hypotheses, not binding decisions.
- [ ] Set real provider spend alerts and hard application-level AI/worker budgets. The proposal's roughly US$130–400/month beta cost is only an estimate, not a verified quote.

## 3. Cloudflare and R2

Repository: [Cloudflare OpenTofu](../../infra/cloudflare/main.tf), [env variables](../../infra/cloudflare/variables.tf), [R2 lifecycle](../../infra/r2/lifecycle.tf.json).

- [ ] Add real domain and record primary Cloudflare **account ID** and **zone ID**.
- [ ] Create separately owned **backup Cloudflare account**, record its account ID and **different** restricted keys.
- [ ] Bootstrap the `selecta-tofu-state` bucket in the backup account **before** running `tofu init` (see `infra/cloudflare/env/{staging,production}.backend.hcl`); protect state and separate environments.
- [ ] Use actual account/zone IDs, DNS hostnames and Render DNS targets with `infra/cloudflare/env/{staging,production}.tfvars`. Never commit API tokens/keys.
- [ ] Provision **private EU-jurisdiction** R2 buckets for each environment: `selecta-ENV-originals`, `-derived`, `-exports`, `-staging`, `-deletion-ledger`; separate backup account buckets for originals backup and DB dumps.
- [ ] Configure role-scoped R2 keys, exact website-origin CORS for signed multipart `PUT` and playback `GET`, required ETag/Range headers, multipart cleanup, staged upload cleanup and plan-specific export expiry.
- [ ] Deploy Cloudflare Pages React site; verify SPA reloads, TLS, API origin, signed URLs and Cloudflare WAF/rate limiting. Do **not** expose user files publicly.

## 4. Render and PostgreSQL

Repository: [Render Blueprint](../../infra/render/render.yaml), [Cloud engineering guide](../engineering/README.md).

- [ ] Create **staging** and **production** Render projects/services in Frankfurt, separate PostgreSQL databases, backups/PITR and connection policies.
- [ ] Confirm the checked-in Render Blueprint matches Render's current available syntax/plans before provisioning.
- [ ] Deploy separate `selecta-api-ENV`, `selecta-gateway-ENV`, and `selecta-maintain-ENV` (two maintenance instances, one fenced leader); never route bulky audio through Render.
- [ ] Give API requests pooled DB connections; use direct DB connections for PostgreSQL `LISTEN` and leader locks. Use separate privileged maintenance/migration credentials.
- [ ] Configure Render secret groups (`selecta-staging-api`, `-gateway`, `-maintenance`, and production equivalents). Every `sync: false` value is operator-supplied; see Section 11.
- [ ] Set `SELECTA_MODE=cloud`, exact host/origin allowlists and R2/WorkOS/Stripe settings. The AI registry uses `ANTHROPIC_API_KEY`; this is **not declared** in the current Render Blueprint, so add it safely before enabling Lucy.
- [ ] Run `selecta db upgrade`; check `/api/ready` on both API and gateway and migrations. Prove cross-tenant isolation and multiple-instance operation.

## 5. Modal audio workers

Repository: [Modal app](../../infra/modal/selecta_workers.py), [worker pools](../../infra/workers/pools.json).

- [ ] Create staging and production Modal environments, budgets, alerting and access policies.
- [ ] Create Modal secrets `selecta-staging-workers` and `selecta-production-workers` containing `SELECTA_WORKER_GATEWAY_URL`, `SELECTA_WORKER_BOOTSTRAP_TOKEN`, `SELECTA_WORKER_STORAGE_HOSTS`, and optional OpenTelemetry endpoint/headers.
- [ ] Deploy/test `cpu_light`, `cpu_heavy`, and later `gpu_stems`. Require EU residency, bounded concurrency, no DB credentials in workers, fenced job results and signed R2 access.
- [ ] Validate pinned model weights, FFmpeg builds, scratch quotas, crashes/retries, cold starts and measured egress. **GPU stems remain blocked** pending commercial-use review of Demucs weights.
- [ ] Prove real upload → validation → analysis → seamless rendering → cloud playback → export. Fake-backend unit tests are not deployment proof.

## 6. WorkOS + Google OAuth

Repository: [AuthKit setup](07a-authentication.md), [frontend configuration](../../web/src/cloud/authConfig.ts).

- [ ] Create WorkOS staging and production environments with distinct client IDs, API keys, signing keys/issuer/audience and webhooks.
- [ ] Configure precise callback/logout origins and production custom auth domain `auth.YOUR-DOMAIN`. The production website must have `VITE_WORKOS_API_HOSTNAME`; do not bypass it with `devMode`.
- [ ] Enable email/password, verified email, password reset, optional Magic Auth, Google login and bot protection.
- [ ] In Google Cloud, create branded OAuth consent screen/web client; use **WorkOS-provided redirect URI**, not a guessed path.
- [ ] Create a Selecta Staff organisation with required MFA/privileged-session checks.
- [ ] Configure `POST /api/webhooks/workos` for each environment and verify event signing/retries.
- [ ] Test actual hosted signup, email verification, Google identity linking, password reset, two-device sessions, logout-everywhere and staff login against the **real staging provider**.

## 7. Stripe test mode → live billing

Repository: [Stripe design and current implementation](08-billing.md), [price-map parser](../../src/selecta/billing/stripe_sync.py).

- [ ] Verify Stripe UK seller/business, payout bank, support identity and tax settings.
- [ ] Create **Selecta Standard** and **Selecta Premium** products with GBP monthly and annual recurring prices in **test mode**. Free does not need a Stripe subscription.
- [ ] Copy the actual test price IDs into `SELECTA_STRIPE_PRICES` JSON mapping each `price_...` to `{"plan":"standard"|"premium","version":1,"interval":"month"|"year"}`. Use a **different live map**.
- [ ] Configure Checkout, Customer Portal, upgrades/downgrades, cancellations, invoices, failed-payment Smart Retries and tax registrations/product codes.
- [ ] Set `SELECTA_CHECKOUT_CONSENT_VERSION` and matching frontend `VITE_CHECKOUT_CONSENT_VERSION`, after reviewing consent and cancellation wording with counsel.
- [ ] Create test/live webhook URLs `/api/webhooks/stripe`, relevant subscription/checkout/invoice/refund/dispute events, and distinct signing secrets in `SELECTA_STRIPE_WEBHOOK_SECRETS`.
- [ ] Set `SELECTA_STRIPE_SECRET_KEY` and price map **only on the server**. Set a UK-only paid sales boundary; Stripe automatic tax does **not** register/file VAT.
- [ ] Schedule `selecta billing-maintenance` plus periodic `--reconcile`. Test successful payment, duplicates, out-of-order events, failed renewal, refunds, disputes, cancellations and outages using Stripe **test mode**.
- [ ] Only move to live mode after legal/payment readiness and a controlled live purchase/refund/reconciliation test.

## 8. Anthropic / Lucy

Repository: [Lucy server-owned model routing](09-lucy-ai-gateway.md), [AI deployment registry](../../src/selecta/ai/registry.py).

- [ ] Create Anthropic API account, verify available models and current pricing/terms, create **server-side** `ANTHROPIC_API_KEY` and separate staging/production budgets or projects.
- [ ] Configure model deployments by plan: inexpensive default for Free; stronger models for paid capabilities; fallback to built-in planner. Do not promise specific model IDs until tested against current provider availability.
- [ ] Enforce per-turn, per-account, per-plan and daily/monthly ceilings; set provider budget alarms, concurrency limits and failure fallbacks.
- [ ] Run `src/selecta/ai/eval_set.json` against real staging deployments; do not allow an unevaluated model to become a tier default.

## 9. Monitoring, backups, email and status page

- [ ] Configure Sentry front/backend environments, error scrubbing and alert routes. Never send raw audio, access tokens, customer emails or provider secrets into logs.
- [ ] Configure Grafana Cloud OTLP endpoint/headers, dashboards and alert contact points from [`infra/observability/`](../../infra/observability/). Verify one trace from API through gateway/worker to R2.
- [ ] Choose **Resend or Postmark**; verify sender domain and customer email journeys. WorkOS may separately own auth emails; verify actual responsibility and templates.
- [ ] Create status page on external infrastructure; publish status, incident communications and support address.
- [ ] Schedule [nightly DB dump](../../infra/backup/nightly_db_dump.sh) and [originals copy](../../infra/backup/copy_originals.sh) to the **backup account**, not the source account. Ensure the real scheduler, restricted credentials, monitoring and retention are operational.
- [ ] Run a **staging restore drill** with [runbook](../operations/backup-and-restore.md): replay deletion ledger, reconcile storage and Stripe, expire stale leases before reopening traffic. Document actual recovery time/RPO.
- [ ] Schedule account deletion and storage deletion maintenance, including a privileged role and R2 deletion ledger. Perform a deletion/restore and expired-export retention test.
- [ ] Test phone alerts for API outage, old interactive jobs, quarantined jobs, spend ceiling, audit failure, reconciliation drift and backup failure.

## 10. Legal and release blockers — cannot be fixed just by opening accounts

From [Cloud checklist](../adr/selecta-cloud-implementation-checklist.md) and [licence register](licence-register.md):

- [ ] **S-KEY/Deezer key-detection weights are non-commercial research only**. Select a commercially permitted replacement, benchmark and listen before paid plans.
- [ ] **Demucs weights are marked Review**; obtain written commercial-use advice before enabling GPU stem separation for paying customers. Review the other flagged dependency/model weights and the actual FFmpeg worker build.
- [ ] Clarify **LRCLIB/lyric use and display rights** in writing. Disable Cloud lyric lookup/display if licensing cannot be secured; do not assume public API access permits commercial republication.
- [ ] Obtain UK music/IP lawyer's advice on private lockers, uploaded works, derived stems/transitions, takedown/repeat-infringer workflow and potential international obligations.
- [ ] Publish real Terms, Privacy Notice, cancellation/refund rules, processor list, retention schedule, data subject rights channel and takedown contact.
- [ ] Complete UK GDPR/ICO assessment, vendor DPAs, international transfer safeguards, DPIA as appropriate, age/children's privacy assessment and security controls. Check current UK consumer subscription and VAT rules with qualified advisers.
- [ ] **Live staging integrations are not independently verified** in the current checklist: WorkOS real AuthKit flows, Stripe test-mode webhooks, worker images, real GPU/CPU audio, real cloud playback/audio alignment, multi-instance correctness, backup restore, migrations and operational alerts.
- [ ] **Deployment pipeline external dependency:** [`infra/deploy/oidc_credentials.sh`](../../infra/deploy/oidc_credentials.sh) expects a **hosted OIDC credential broker**, passed in GitHub variable `SELECTA_CREDENTIAL_BROKER_URL`. The repository includes a **broker client script**, not evidence that the broker service exists. Implement/deploy/audit it and verify it checks GitHub token audience, repository, branch, workflow and staging/production environment; issues restricted **under-one-hour** credentials. Without it, [the deploy workflow](../../.github/workflows/deploy.yml) cannot complete as written.
- [ ] Infrastructure manifests must be validated against real provider accounts, not just syntax/unit tests. Record end-to-end tests, tenant isolation and security evidence.

## 11. Environment variables / credentials inventory

Values below are *names*, **not** instructions to publish secrets. Confirm complete deployment-specific requirements from source before provisioning.

| Component | Configuration to supply |
|---|---|
| Cloud API on Render | `SELECTA_MODE=cloud`, `SELECTA_ENV`, `SELECTA_DATABASE_URL`, `SELECTA_ALLOWED_HOSTS`, `SELECTA_ALLOWED_ORIGINS`, `SELECTA_AUTH_ISSUER`, `SELECTA_AUTH_AUDIENCE`, `SELECTA_WORKOS_CLIENT_ID`, `SELECTA_WORKOS_API_KEY`, `SELECTA_WORKOS_WEBHOOK_SECRET`, `SELECTA_STRIPE_SECRET_KEY`, `SELECTA_STRIPE_WEBHOOK_SECRETS`, `SELECTA_STRIPE_PRICES`, `SELECTA_CHECKOUT_CONSENT_VERSION`, `SELECTA_R2_ACCOUNT_ID`, `SELECTA_R2_ACCESS_KEY_ID`, `SELECTA_R2_SECRET_ACCESS_KEY`, `SELECTA_R2_JURISDICTION=eu`, required R2 bucket variables, `SELECTA_IP_HASH_KEY`, `SELECTA_ROOMS_PEPPER`, **`ANTHROPIC_API_KEY`** |
| Worker gateway on Render | `SELECTA_MODE=cloud`, `SELECTA_GATEWAY_DATABASE_URL`, `SELECTA_GATEWAY_ALLOWED_HOSTS`, `SELECTA_WORKER_TOKEN_SECRET`, `SELECTA_WORKER_BOOTSTRAP_TOKEN`, same environment's R2 signer credentials |
| Maintenance service | `SELECTA_MODE=cloud`, privileged maintenance DB URL, WorkOS/Stripe/R2 credentials, deletion-ledger bucket and scheduler-specific variables |
| React Cloudflare Pages build (public) | `VITE_SELECTA_API_ORIGIN`, `VITE_WORKOS_CLIENT_ID`, `VITE_WORKOS_API_HOSTNAME`, `VITE_CHECKOUT_CONSENT_VERSION` |
| Modal workers | `SELECTA_WORKER_GATEWAY_URL`, `SELECTA_WORKER_BOOTSTRAP_TOKEN`, `SELECTA_WORKER_STORAGE_HOSTS` |
| OpenTelemetry (where enabled) | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` |
| OpenTofu / Cloudflare | `TF_VAR_cloudflare_api_token`, `TF_VAR_backup_api_token`, `TF_VAR_account_id`, `TF_VAR_backup_account_id`, `TF_VAR_zone_id`, actual hosts/Render targets, state bucket restricted credentials |
| GitHub Actions | `SELECTA_CREDENTIAL_BROKER_URL`, `SELECTA_STAGING_API_URL`, `SELECTA_STAGING_GATEWAY_URL`, `SELECTA_PRODUCTION_API_URL`, `SELECTA_PRODUCTION_GATEWAY_URL`; protected `staging` and `production` environments |
| OIDC broker's short-lived deploy response | Restrained Render credentials, Modal credentials, Cloudflare primary/backup tokens, migration DB connection, state bucket credentials and environment-specific service IDs; see [release script](../../infra/deploy/release.sh) |
| Backup scheduler | Direct `DATABASE_URL`, `BACKUP_S3_ENDPOINT`, `BACKUP_BUCKET`, scoped `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`; originals-copy source/backup R2 credentials |

**Important:** The checked-in Render Blueprint omits at least the registry-required `ANTHROPIC_API_KEY` and some optional settings; the table does **not** mean every environment variable is already wired. Run an explicit config audit before deployment. Keep staging and production credentials separate and rotate after any leak.

## 12. Safe launch sequence and sign-off

### Stage A — accounts only (no customers)

- [ ] Secure domain, business mailbox, GitHub, primary and backup Cloudflare, Render, Modal, WorkOS, Google Cloud, Stripe test mode, Anthropic, monitoring and transactional email.
- [ ] Record **where** every credential is stored. Never paste secret values into this issue/PR.
- [ ] Create exact DNS/origin/environment plan; choose private beta invite policy, prices and hard spending caps.

### Stage B — real synthetic staging

- [ ] Provision state bucket → R2/DNS/Pages → PostgreSQL → API/gateway/maintenance → WorkOS/Stripe test configuration → Modal workers, with migrations before services.
- [ ] Deploy staging; ensure GitHub's OIDC credential broker actually exists or document the blocked deploy gate.
- [ ] Verify actual signup, upload, hosted analysis and render, playback, export, billing, cancellation, deletion, backups, logs, cost protection and admin access with **synthetic** data.
- [ ] Prove cross-workspace isolation, idempotent payments, lease/fencing/crash recovery and actual audio quality. Test Chrome, Edge, Firefox and Safari audio alignment.
- [ ] Run stress tests and a restore drill; record reproducible outputs/evidence in the canonical implementation checklist.

### Stage C — protected production + invited UK beta

- [ ] Set legal policies and commercial model licences; complete security and privacy reviews. No open "Blocked" or "Review" licence rows relevant to features enabled for beta.
- [ ] Create production resources with distinct keys and protected deployment approvals; never point them at staging DB or data buckets.
- [ ] Run production smoke tests, tightly controlled live Stripe purchase/refund, email delivery, an incident alert, safe rollback and deletion check.
- [ ] Start with a **small number of invited UK users** (then 50 → 150 → 300 if evidence is good); enforce spend, quota, privacy and invite controls and monitor costs continuously.
- [ ] Track actual storage/compute/AI/egress economics and user reports. Public signup is a *separate* go/no-go decision.

## Remaining work on this document

- [ ] Confirm up-to-date provider UI paths and prices, including Cloudflare/Render/Modal plan limits.
- [ ] Have the actual operator fill in owned domains, account IDs, URLs, provisioning dates and sign-off evidence **outside the public repo**.
- [ ] Confirm all required environment variables and provider callback URLs against the final staging deployment and add tested command-by-command verification steps.
- [ ] Reconcile the contents of this WIP guide with changes made while outstanding PRs are merged.

**Do not equate opening accounts or merging this documentation with launch readiness.** The Cloud programme's verification criteria in [the implementation checklist](../adr/selecta-cloud-implementation-checklist.md) still apply.
