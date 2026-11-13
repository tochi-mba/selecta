# SelectaDJ cloud: SaaS setup and launch checklist (WIP)

> **Accepted local-first target (2026-11-13; implementation not started).** All hosted-audio commercial launch checks must be re-evaluated under local-first hard gates: copyright, locally provisioned venue sources, zero cloud audio, real device sound/output, recipe migration, offline control and hardware support. No paid launch approved by docs alone. See LF release gates. Historic architecture and evidence below remain part of the record. [Current direction](20-local-first-cloud-architecture.md) · [Migration](22-local-first-transition.md).


> **Work in progress, cross-checked against the code on 12 November 2026.** Practical operator checklist for the accepted cloud design (internally "Selecta Cloud"; customers see **SelectaDJ**, a **REX Technologies** product). This does **not** mean the accounts are configured or the product is deployment-ready. Source of truth: [Cloud implementation checklist](../adr/selecta-cloud-implementation-checklist.md), [hosting plan](13-hosting-and-cost.md), [architecture](03-architecture.md), [authentication](07a-authentication.md), [billing](08-billing.md), [operations](14-operations.md), and [licence register](licence-register.md). Verify current vendor requirements and costs before paying. **Set up staging before production.** Local mode remains unchanged.

## 1. Accounts and services to create

| Done | Account/service | Why you need it | When |
|---|---|---|---|
| [ ] | Business-owned email and password manager | Provider owner/recovery identity, support@/privacy@/billing@/security@ inboxes; MFA and offline recovery codes | First |
| [ ] | Domain registrar | Buy/verify the *real* domain, configure renewal/registrar lock | First |
| [ ] | [GitHub](https://github.com), existing repo | Source, CI, GitHub Container Registry (GHCR), deployment approvals | Existing; verify access |
| [ ] | [Cloudflare](https://dash.cloudflare.com) primary account | DNS/TLS/WAF, Pages site, private EU-jurisdiction R2 audio buckets | First |
| [ ] | **Second Cloudflare account** | Separate, independently secured backup account for originals, database dumps and infrastructure state | Before real data |
| [ ] | [Render](https://dashboard.render.com) | Frankfurt PostgreSQL, API, worker gateway, maintenance services | First |
| [ ] | [Modal](https://modal.com) | EU CPU analysis/render jobs, optional GPU stem separation | Before end-to-end staging |
| [ ] | [WorkOS AuthKit](https://dashboard.workos.com) | Customer signup, Google login, sessions, staff MFA | First |
| [ ] | [Google Cloud](https://console.cloud.google.com) | SelectaDJ-branded Google OAuth credentials for WorkOS | Before live sign-in |
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

- [ ] Choose an **actually owned** domain that fits the product name **SelectaDJ**. The deployment files' `selecta.app` (tfvars, `VITE_WORKOS_API_HOSTNAME` example) is explicitly a **placeholder**, not proof of ownership.
- [ ] Use one public name everywhere customers look: **SelectaDJ** (capital D and J, no space) as the WorkOS/AuthKit application name, the Google OAuth consent-screen app name, the Stripe public business name, the Stripe products **SelectaDJ Standard** and **SelectaDJ Premium**, the card statement descriptor (for example `SELECTADJ`; Stripe allows 5 to 22 characters), the email sender display name (`SelectaDJ <support@YOUR-DOMAIN>`) and the status page. The legal entity in Stripe, WorkOS, the Terms and the Privacy Notice is **REX Technologies**. Resource names in code and infra (`selecta-*` buckets, services, Modal apps) stay as they are; customers never see them.
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
- [ ] Provision **private EU-jurisdiction** R2 buckets for each environment (OpenTofu names them `selecta-ENV-originals`, `-derived`, `-exports`, `-staging`, `-deletion-ledger`); the backup account holds `selecta-ENV-originals-backup` and `selecta-ENV-db-dumps` (35-day lifecycle).
- [ ] Set `SELECTA_R2_BUCKET_ORIGINALS`, `SELECTA_R2_BUCKET_DERIVED`, `SELECTA_R2_BUCKET_EXPORTS`, `SELECTA_R2_BUCKET_STAGING` and `SELECTA_R2_BUCKET_DELETION_LEDGER` to those names. The Render Blueprint sets all five per environment, and with `SELECTA_ENV=staging|production` the code's defaults are the same OpenTofu names (`selecta-ENV-KIND`; `sel-KIND` only for the development stack). The ledger has no default; `tests/test_cloud_infra.py` checks the three agree.
- [ ] Configure role-scoped R2 keys and exact website-origin CORS for signed multipart `PUT` and playback `GET` with the ETag/Range headers. OpenTofu sets CORS on the originals, derived, exports and staging buckets (`cloudflare_r2_bucket_cors.browser`: `https://web_hostname` only, `GET`/`PUT`/`HEAD`, `ETag` exposed); confirm it after `tofu apply`. Staged-upload cleanup is the `staging` bucket lifecycle in OpenTofu; plan-specific export expiry is the maintenance `export_expiry` task, not a bucket rule.
- [ ] Deploy Cloudflare Pages React site; verify SPA reloads, TLS, API origin, signed URLs and Cloudflare WAF/rate limiting. Do **not** expose user files publicly.

## 4. Render and PostgreSQL

Repository: [Render Blueprint](../../infra/render/render.yaml), [Cloud engineering guide](../engineering/README.md).

- [ ] Create **staging** and **production** Render projects/services in Frankfurt, separate PostgreSQL databases, backups/PITR and connection policies.
- [ ] Confirm the checked-in Render Blueprint matches Render's current available syntax/plans before provisioning.
- [ ] Deploy separate `selecta-api-ENV`, `selecta-gateway-ENV`, and `selecta-maintain-ENV` (two maintenance instances, one fenced leader); never route bulky audio through Render.
- [ ] Give API requests pooled DB connections; use direct DB connections for PostgreSQL `LISTEN` and leader locks. Use separate privileged maintenance/migration credentials.
- [ ] Configure Render secret groups (`selecta-staging-api`, `-gateway`, `-maintenance`, and production equivalents). Every `sync: false` value is operator-supplied; see Section 11.
- [ ] Set `SELECTA_MODE=cloud`, exact host/origin allowlists and R2/WorkOS/Stripe settings (full list in Section 11). The Render Blueprint declares every value each service reads at start (`tests/test_cloud_infra.py` checks it); type each `sync: false` value in once per environment.
- [ ] Run `selecta db upgrade`; check `/api/ready` on both API and gateway and migrations. Prove cross-tenant isolation and multiple-instance operation.
- [ ] `selecta maintain` logs every task it left out and the setting it needs (Stripe, WorkOS, deletion-ledger bucket, room pepper, backup bucket, Modal token). Read that start-up log on both instances; an empty "disabled" list is the goal.

## 5. Modal audio workers

Repository: [Modal app](../../infra/modal/selecta_workers.py), [worker pools](../../infra/workers/pools.json).

- [ ] Create staging and production Modal environments, budgets, alerting and access policies.
- [ ] Create Modal secrets `selecta-staging-workers` and `selecta-production-workers` containing `SELECTA_WORKER_GATEWAY_URL`, `SELECTA_WORKER_BOOTSTRAP_TOKEN`, `SELECTA_WORKER_STORAGE_HOSTS` (comma-separated R2 hosts the worker may fetch from, for example `ACCOUNT.eu.r2.cloudflarestorage.com`), and optional `OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_EXPORTER_OTLP_HEADERS`. The app itself sets `SELECTA_MODE=cloud`, `SELECTA_ENVIRONMENT` and `SELECTA_WORKER_POOL`.
- [ ] Deploy (`modal deploy infra/modal/selecta_workers.py --env ENV`, run by `infra/deploy/release.sh`) the apps `selecta-workers-staging` / `selecta-workers-production` and test the functions `cpu_light`, `cpu_heavy`, `export`, and later `gpu_stems` and its CPU fallback `gpu_stems_fallback` (EU region). The autoscaler scales these names (`MODAL_FUNCTIONS` in `work/autoscale_leader.py`).
- [ ] For maintenance-led autoscaling, give the maintenance service `SELECTA_MODAL_APP` (the app name above), `SELECTA_MODAL_TOKEN_ID` and `SELECTA_MODAL_TOKEN_SECRET`; without them the `autoscale` task is not registered. The Blueprint sets `SELECTA_MODAL_APP` per environment; the token pair is `sync: false`. Require EU residency, bounded concurrency, no DB credentials in workers, fenced job results and signed R2 access.
- [ ] Validate pinned model weights, FFmpeg builds, scratch quotas, crashes/retries, cold starts and measured egress. **GPU stems remain blocked** pending commercial-use review of Demucs weights.
- [ ] Prove real upload → validation → analysis → seamless rendering → cloud playback → export. Fake-backend unit tests are not deployment proof.

## 6. WorkOS + Google OAuth

Repository: [AuthKit setup](07a-authentication.md), [frontend configuration](../../web/src/cloud/authConfig.ts).

- [ ] Create WorkOS staging and production environments with distinct client IDs, API keys, signing keys/issuer/audience and webhooks.
- [ ] Set the WorkOS application name to **SelectaDJ** and brand the hosted AuthKit pages (logo, colours, support link) as SelectaDJ; the legal entity is REX Technologies.
- [ ] Redirect URI: exactly the site origin, `https://app.YOUR-DOMAIN` (and the staging origin). The React app passes no `redirectUri`, so AuthKit returns to the page origin; the `returnTo` path travels in `state`. Sign-out (`signOut({ returnTo: window.location.origin })`) also returns to the site origin, so allow the same origin as the logout redirect. Set the custom auth domain `auth.YOUR-DOMAIN`; the production website must have `VITE_WORKOS_API_HOSTNAME`; do not bypass it with `devMode`.
- [ ] Copy the client ID to `SELECTA_WORKOS_CLIENT_ID` and `VITE_WORKOS_CLIENT_ID`, and set `SELECTA_AUTH_ISSUER` and `SELECTA_AUTH_AUDIENCE` from the environment's JWT settings (the API refuses to start without all three).
- [ ] Enable email/password, verified email, password reset, optional Magic Auth, Google login and bot protection.
- [ ] In Google Cloud, create a consent screen named **SelectaDJ** and a web client; use the **WorkOS-provided redirect URI**, not a guessed path.
- [ ] Create a staff organisation with required MFA/privileged-session checks and put its ID in `SELECTA_STAFF_ORGANIZATION_ID` (empty means nobody passes the staff check).
- [ ] Configure the webhook `POST https://api.YOUR-DOMAIN/api/webhooks/workos` for each environment with its secret in `SELECTA_WORKOS_WEBHOOK_SECRET`. Events the code acts on: `user.updated`, `user.deleted`, `session.revoked`, `email_verification.succeeded`, `password_reset.succeeded` (and the older `user.password_reset_succeeded`); others are stored and ignored. Verify signing and retries.
- [ ] Test actual hosted signup, email verification, Google identity linking, password reset, two-device sessions, logout-everywhere and staff login against the **real staging provider**.

## 7. Stripe test mode → live billing

Repository: [Stripe design and current implementation](08-billing.md), [price-map parser](../../src/selecta/billing/stripe_sync.py).

- [ ] Verify Stripe UK seller/business, payout bank, support identity and tax settings.
- [ ] Set the Stripe public business name to **SelectaDJ**, the statement descriptor to `SELECTADJ` (or similar), and the legal entity to REX Technologies.
- [ ] Create **SelectaDJ Standard** and **SelectaDJ Premium** products with GBP monthly and annual recurring prices in **test mode**. Free does not need a Stripe subscription. (Checkout shows the Stripe product name, not text from the code.)
- [ ] Copy the actual test price IDs into `SELECTA_STRIPE_PRICES` JSON mapping each `price_...` to `{"plan":"standard"|"premium","version":1,"interval":"month"|"year"}`. Use a **different live map**.
- [ ] Configure Checkout, Customer Portal, upgrades/downgrades, cancellations, invoices, failed-payment Smart Retries and tax registrations/product codes.
- [ ] Set `SELECTA_CHECKOUT_CONSENT_VERSION` and matching frontend `VITE_CHECKOUT_CONSENT_VERSION`, after reviewing consent and cancellation wording with counsel.
- [ ] Create test and live webhook endpoints `POST https://api.YOUR-DOMAIN/api/webhooks/stripe` subscribed to exactly the events the code handles: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Put the signing secrets, comma-separated (so a rotation can overlap), in `SELECTA_STRIPE_WEBHOOK_SECRETS`.
- [ ] Configure `SELECTA_BUSINESS_STRIPE_PRICES` on the server as a JSON map of business subscription price IDs and quantity tiers. Use separate test and live price maps, never browser-exposed credentials.
- [ ] Set `SELECTA_STRIPE_SECRET_KEY` and price map **only on the server** (API and maintenance; the maintenance `stripe_events`/`stripe_reconcile` tasks need both). Optionally pin `SELECTA_STRIPE_API_VERSION`. Set `SELECTA_IP_HASH_KEY` (consent records hash the buyer's IP). Set a UK-only paid sales boundary; Stripe automatic tax does **not** register/file VAT.
- [ ] `selecta maintain` already runs the Stripe event and nightly reconcile tasks; `selecta billing-maintenance [--reconcile]` is the manual equivalent. Replay the recorded fixture events with `tests/load/stripe_fixture_replay.py` against staging. Test successful payment, duplicates, out-of-order events, failed renewal, refunds, disputes, cancellations and outages using Stripe **test mode**.
- [ ] Only move to live mode after legal/payment readiness and a controlled live purchase/refund/reconciliation test.

## 8. Anthropic / Lucy

Repository: [Lucy server-owned model routing](09-lucy-ai-gateway.md), [AI deployment registry](../../src/selecta/ai/registry.py).

- [ ] Create Anthropic API account, verify available models and current pricing/terms, create **server-side** `ANTHROPIC_API_KEY` and separate staging/production budgets or projects.
- [ ] Configure model deployments by plan: inexpensive default for Free; stronger models for paid capabilities; fallback to built-in planner. Do not promise specific model IDs until tested against current provider availability.
- [ ] Enforce per-turn, per-account, per-plan and daily/monthly ceilings; set provider budget alarms, concurrency limits and failure fallbacks.
- [ ] Set optional platform AI ceilings `SELECTA_AI_DAILY_CAP_USD`, `SELECTA_AI_MONTHLY_CAP_USD` and `SELECTA_AI_ALERT_PERCENTS` on the API (code defaults apply when unset).
- [ ] Run the evaluation set against real staging deployments with `python -m selecta.ops.lucy_eval eval --tiers --report eval-report.md`, then stage rollouts with `python -m selecta.ops.lucy_eval rollout ...` (5%, 25%, 100%); do not allow an unevaluated model to become a tier default.

## 9. Monitoring, backups, email and status page

- [ ] Configure Sentry front/backend environments, error scrubbing and alert routes. Never send raw audio, access tokens, customer emails or provider secrets into logs. **No Sentry SDK or DSN setting is wired in the code yet** (see "Known repo gaps").
- [ ] Configure Grafana Cloud: set `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` on the API, gateway, maintenance service and Modal worker secret (traces and metrics both read the endpoint; nothing is exported when it is empty). Load dashboards and alert rules from [`infra/observability/`](../../infra/observability/). Verify one trace from API through gateway/worker to R2.
- [ ] Choose **Resend or Postmark**; verify sender domain, `SelectaDJ <...@YOUR-DOMAIN>` sender name and customer email journeys. **The code sends no email itself today**: WorkOS sends the auth emails (brand them SelectaDJ in WorkOS); billing mail comes from Stripe's own customer emails if you enable them.
- [ ] Create status page on external infrastructure; publish status, incident communications and support address.
- [ ] Schedule [nightly DB dump](../../infra/backup/nightly_db_dump.sh) and [originals copy](../../infra/backup/copy_originals.sh) to the **backup account**, not the source account. No scheduler for them is in the repo (Render Blueprint has no cron job); choose one, give it restricted credentials and monitor it. Give the maintenance service read-only `SELECTA_BACKUP_S3_ENDPOINT`, `SELECTA_BACKUP_BUCKET`, `SELECTA_BACKUP_ACCESS_KEY_ID` and `SELECTA_BACKUP_SECRET_ACCESS_KEY` so its `backup_freshness` alert can see the newest dump.
- [ ] Run a **staging restore drill** with [runbook](../operations/backup-and-restore.md): replay deletion ledger, reconcile storage and Stripe, expire stale leases before reopening traffic. Document actual recovery time/RPO.
- [ ] Account deletion, storage deletion and export expiry run inside `selecta maintain` once `SELECTA_STRIPE_SECRET_KEY`, `SELECTA_WORKOS_API_KEY`, the R2 credentials and `SELECTA_R2_BUCKET_DELETION_LEDGER` are set; after a restore run `selecta replay-deletions-after-restore`. Perform a deletion/restore and expired-export retention test.
- [ ] Set `SELECTA_DMCA_AGENT_REGISTERED_ON` (ISO date of the last DMCA agent registration) on the maintenance service so the renewal alert works; optionally `SELECTA_REPEAT_INFRINGER_NOTICES` (default 3) on the API.
- [ ] Test phone alerts for API outage, old interactive jobs, quarantined jobs, spend ceiling, audit failure, reconciliation drift and backup failure.

## 10. Legal and release blockers (cannot be fixed just by opening accounts)

From [Cloud checklist](../adr/selecta-cloud-implementation-checklist.md) and [licence register](licence-register.md):

- [ ] **S-KEY/Deezer key-detection weights are non-commercial research only**. Select a commercially permitted replacement, benchmark and listen before paid plans.
- [ ] **Demucs weights are marked Review**; obtain written commercial-use advice before enabling GPU stem separation for paying customers. Review the other flagged dependency/model weights and the actual FFmpeg worker build.
- [ ] Clarify **LRCLIB/lyric use and display rights** in writing. Disable Cloud lyric lookup/display if licensing cannot be secured; do not assume public API access permits commercial republication.
- [ ] Obtain UK music/IP lawyer's advice on private lockers, uploaded works, derived stems/transitions, takedown/repeat-infringer workflow and potential international obligations.
- [ ] Publish real Terms, Privacy Notice (draft text in `web/src/cloud/privacyNoticeDraftText.ts` already names SelectaDJ and REX Technologies; fill its placeholders), cancellation/refund rules, processor list, retention schedule, data subject rights channel and takedown contact.
- [ ] Complete UK GDPR/ICO assessment, vendor DPAs, international transfer safeguards, DPIA as appropriate, age/children's privacy assessment and security controls. Check current UK consumer subscription and VAT rules with qualified advisers.
- [ ] **Live staging integrations are not independently verified** in the current checklist: WorkOS real AuthKit flows, Stripe test-mode webhooks, worker images, real GPU/CPU audio, real cloud playback/audio alignment, multi-instance correctness, backup restore, migrations and operational alerts.
- [ ] **Deployment pipeline external dependency:** [`infra/deploy/oidc_credentials.sh`](../../infra/deploy/oidc_credentials.sh) expects a **hosted OIDC credential broker**, passed in GitHub variable `SELECTA_CREDENTIAL_BROKER_URL`. The repository includes a **broker client script**, not evidence that the broker service exists. Implement/deploy/audit it and verify it checks GitHub token audience, repository, branch, workflow and staging/production environment; issues restricted **under-one-hour** credentials. Without it, [the deploy workflow](../../.github/workflows/deploy.yml) cannot complete as written.
- [ ] Infrastructure manifests must be validated against real provider accounts, not just syntax/unit tests. Record end-to-end tests, tenant isolation and security evidence.

## 11. Environment variables / credentials inventory

Values below are *names*, **not** instructions to publish secrets. Cross-checked against the code on 12 November 2026; `tests/test_launch_operator_checklist.py` fails when a `SELECTA_*` variable the code reads is missing here, or when this page names one the code no longer reads. "Blueprint" means [`infra/render/render.yaml`](../../infra/render/render.yaml) already declares it.

| Component | Required | Optional (code default) |
|---|---|---|
| Cloud API on Render (`selecta web`) | `SELECTA_MODE=cloud` (Blueprint), `SELECTA_ENV=staging\|production` (Blueprint; default `production`), `SELECTA_DATABASE_URL` (Blueprint, pooled), `SELECTA_ALLOWED_HOSTS`, `SELECTA_ALLOWED_ORIGINS` (HTTPS, no wildcard), `SELECTA_WORKOS_CLIENT_ID`, `SELECTA_AUTH_ISSUER`, `SELECTA_AUTH_AUDIENCE`, `SELECTA_WORKOS_API_KEY`, `SELECTA_WORKOS_WEBHOOK_SECRET`, `SELECTA_R2_ACCOUNT_ID`, `SELECTA_R2_ACCESS_KEY_ID`, `SELECTA_R2_SECRET_ACCESS_KEY`, `SELECTA_R2_BUCKET_ORIGINALS`, `SELECTA_R2_BUCKET_DERIVED`, `SELECTA_R2_BUCKET_EXPORTS`, `SELECTA_R2_BUCKET_STAGING` (Blueprint, per environment; default `selecta-ENV-KIND` from `SELECTA_ENV`), `SELECTA_ROOMS_PEPPER`, `SELECTA_STRIPE_SECRET_KEY`, `SELECTA_STRIPE_WEBHOOK_SECRETS`, `SELECTA_STRIPE_PRICES`, `SELECTA_CHECKOUT_CONSENT_VERSION`, `SELECTA_IP_HASH_KEY`, `ANTHROPIC_API_KEY`, `SELECTA_STAFF_ORGANIZATION_ID` (staff console) | `SELECTA_R2_JURISDICTION` (`eu`), `SELECTA_STRIPE_API_VERSION` (Stripe account default), `SELECTA_WORKOS_API_BASE` (`https://api.workos.com`; leave unset), `SELECTA_CLIENT_IP_HEADER` (unset uses the socket peer; behind Cloudflare set `cf-connecting-ip`), `SELECTA_BIND_HOST` (`0.0.0.0`), `SELECTA_AI_DAILY_CAP_USD`, `SELECTA_AI_MONTHLY_CAP_USD`, `SELECTA_AI_ALERT_PERCENTS`, `SELECTA_LRCLIB_RATE_PER_S` (`1.0`), `SELECTA_LRCLIB_BURST` (`1`), `SELECTA_REPEAT_INFRINGER_NOTICES` (`3`), `SELECTA_FLAGS` (operator override, for example `+name` to enable a licence-gated flag), `SELECTA_EMAIL_PROVIDER` (transactional mail provider), `SELECTA_EMAIL_API_KEY` (server-only secret), `SELECTA_EMAIL_FROM` (verified sender), `SELECTA_EMAIL_SITE_URL` (public account URL), `SELECTA_SENTRY_DSN` (server-side error reporting), `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` |
| Worker gateway on Render (`selecta gateway`) | `SELECTA_MODE=cloud`, `SELECTA_GATEWAY_DATABASE_URL` (Blueprint; falls back to `SELECTA_DATABASE_URL`), `SELECTA_GATEWAY_ALLOWED_HOSTS`, `SELECTA_WORKER_TOKEN_SECRET`, `SELECTA_WORKER_BOOTSTRAP_TOKEN`, the same R2 credentials and bucket names as the API | `SELECTA_GATEWAY_BIND_HOST` (`0.0.0.0`), `SELECTA_R2_JURISDICTION`, `OTEL_*` |
| Maintenance service (`selecta maintain`, two instances) | `SELECTA_MODE=cloud`, `SELECTA_MAINTENANCE_DATABASE_URL` (Blueprint; direct, not pooled; falls back to `SELECTA_DATABASE_URL`), `SELECTA_STRIPE_SECRET_KEY` and `SELECTA_STRIPE_PRICES`, `SELECTA_WORKOS_API_KEY`, the R2 credentials and bucket names, `SELECTA_R2_BUCKET_DELETION_LEDGER`, `SELECTA_ROOMS_PEPPER`, `SELECTA_BACKUP_S3_ENDPOINT`, `SELECTA_BACKUP_BUCKET`, `SELECTA_BACKUP_ACCESS_KEY_ID`, `SELECTA_BACKUP_SECRET_ACCESS_KEY`, `SELECTA_MODAL_APP`, `SELECTA_MODAL_TOKEN_ID`, `SELECTA_MODAL_TOKEN_SECRET`, `SELECTA_DMCA_AGENT_REGISTERED_ON` (all in the Blueprint; bucket names, `SELECTA_BACKUP_BUCKET` and `SELECTA_MODAL_APP` with per-environment values) | `SELECTA_WORKER_POOLS` (`infra/workers/pools.json`), `SELECTA_STRIPE_API_VERSION`, `SELECTA_WORKOS_API_BASE`, `OTEL_*` |
| React Cloudflare Pages build (public) | `VITE_SELECTA_API_ORIGIN`, `VITE_WORKOS_CLIENT_ID`, `VITE_WORKOS_API_HOSTNAME`, `VITE_CHECKOUT_CONSENT_VERSION` | none (`VITE_SELECTA_GALLERY` is a test-build switch; never set it in production) |
| Modal workers (secret `selecta-ENV-workers`) | `SELECTA_WORKER_GATEWAY_URL`, `SELECTA_WORKER_BOOTSTRAP_TOKEN`, `SELECTA_WORKER_STORAGE_HOSTS`; the app sets `SELECTA_MODE`, `SELECTA_ENVIRONMENT`, `SELECTA_WORKER_POOL` | `SELECTA_WORKER_ENGINE_VERSION` (`1`), `SELECTA_WORKER_SCRATCH_MB` (`4096`), `SELECTA_WORKER_SCRATCH_ROOT` (temp dir), `SELECTA_FFMPEG` (`ffmpeg` on PATH), `OTEL_*` |
| Operator tools (`selecta db upgrade`, `selecta.ops.lucy_eval`, `reconcile_check`, `restore_drill`, `infra/staging/run.py`) | `SELECTA_DATABASE_URL` (direct), plus each tool's own inputs: deployment keys such as `ANTHROPIC_API_KEY`; `SELECTA_R2_BUCKET_DELETION_LEDGER` and `SELECTA_STRIPE_SECRET_KEY` for the restore drill; `python infra/staging/run.py --list` prints every staging task's inputs | |
| OpenTofu / Cloudflare | `TF_VAR_cloudflare_api_token`, `TF_VAR_backup_api_token`, `TF_VAR_account_id`, `TF_VAR_backup_account_id`, `TF_VAR_zone_id`, hostnames and Render targets in `env/ENV.tfvars`, state bucket credentials as `AWS_*` | |
| GitHub Actions | Variables `SELECTA_CREDENTIAL_BROKER_URL`, `SELECTA_STAGING_API_URL`, `SELECTA_STAGING_GATEWAY_URL`, `SELECTA_PRODUCTION_API_URL`, `SELECTA_PRODUCTION_GATEWAY_URL`; the workflow sets `SELECTA_ENVIRONMENT`; protected `staging` and `production` environments | |
| OIDC broker's short-lived deploy response | `RENDER_API_KEY`, `RENDER_SERVICE_IDS`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `BACKUP_API_TOKEN`, `BACKUP_ACCOUNT_ID`, `DATABASE_URL` (migrations), `TOFU_STATE_ENDPOINT`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (state bucket); see [release script](../../infra/deploy/release.sh) | |
| Backup scheduler | DB dump: direct `DATABASE_URL`, `BACKUP_S3_ENDPOINT`, `BACKUP_BUCKET`, write-only `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Originals copy: `SOURCE_BUCKET`, `BACKUP_BUCKET` and an `RCLONE_CONFIG` with `source` (read-only) and `backup` (write-only) remotes | |

Keep staging and production credentials separate and rotate after any leak.

### Known repo gaps (checked 12 November 2026, updated the same evening)

Closed since the first draft, so no longer gaps: worker engine handlers (`selecta/workers/engine_handlers.py`, registered per pool by `workers/cloud.py`); plan-specific export expiry (`storage/export_expiry.py`, the `export_expiry` maintenance task); metrics (`observability/metrics.py`, leader metrics including backup freshness); the autoscale leader (`work/autoscale_leader.py`); sign-out-everywhere device revocation (`POST /api/account/sign-out-everywhere`); the Stripe replay tool (`tests/load/stripe_fixture_replay.py`); the staging runner (`infra/staging/run.py`); the Lucy evaluation and staged rollout (`selecta.ops.lucy_eval`); on 12 November 2026: the Render Blueprint now declares every variable each service reads at start, with bucket names per environment (`tests/test_cloud_infra.py`); the R2 bucket defaults derive from `SELECTA_ENV` to match OpenTofu; the autoscaler and the Modal app share one function mapping (`MODAL_FUNCTIONS`); R2 CORS is in OpenTofu; and the worker image no longer sets model-lock variables nothing read.

Still open:

- [ ] **No Sentry wiring** (no SDK, no DSN variable) in the API, gateway, workers or site.
- [ ] **No transactional email sender in the code;** WorkOS and Stripe send the only customer emails.
- [ ] **No scheduler for the backup scripts** in the repo.
- [ ] **OIDC credential broker** does not exist yet (Section 10).

## 12. Safe launch sequence and sign-off

### Stage A: accounts only (no customers)

- [ ] Secure domain, business mailbox, GitHub, primary and backup Cloudflare, Render, Modal, WorkOS, Google Cloud, Stripe test mode, Anthropic, monitoring and transactional email.
- [ ] Record **where** every credential is stored. Never paste secret values into this issue/PR.
- [ ] Create exact DNS/origin/environment plan; choose private beta invite policy, prices and hard spending caps.

### Stage B: real synthetic staging

- [ ] Provision state bucket → R2/DNS/Pages → PostgreSQL → API/gateway/maintenance → WorkOS/Stripe test configuration → Modal workers, with migrations before services.
- [ ] Deploy staging; ensure GitHub's OIDC credential broker actually exists or document the blocked deploy gate. Run each staging proof with `python infra/staging/run.py <task>` (`--list` shows tasks and inputs) and file its report.
- [ ] Verify actual signup, upload, hosted analysis and render, playback, export, billing, cancellation, deletion, backups, logs, cost protection and admin access with **synthetic** data.
- [ ] Prove cross-workspace isolation, idempotent payments, lease/fencing/crash recovery and actual audio quality. Test Chrome, Edge, Firefox and Safari audio alignment.
- [ ] Run stress tests and a restore drill; record reproducible outputs/evidence in the canonical implementation checklist.

### Stage C: protected production + invited UK beta

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
