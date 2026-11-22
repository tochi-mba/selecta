# ruff: noqa: E501
"""Cloud setup setting catalogue and acquisition guidance."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Setting:
    name: str
    group: str
    destination: str
    description: str
    secret: bool = True
    generated: bool = False
    after_domain: bool = False


def s(name: str, group: str, destination: str, description: str, **kwargs: bool) -> Setting:
    return Setting(name, group, destination, description, **kwargs)


SETTINGS = (
    # GitHub contains URLs only. Long-lived deploy credentials come from the future OIDC broker.
    s(
        "SELECTA_CREDENTIAL_BROKER_URL",
        "GitHub deploy",
        "GitHub variable",
        "OIDC credential broker URL",
        secret=False,
    ),
    s(
        "SELECTA_API_URL",
        "GitHub deploy",
        "GitHub variable",
        "Public API URL",
        secret=False,
        after_domain=True,
    ),
    s(
        "SELECTA_GATEWAY_URL",
        "GitHub deploy",
        "GitHub variable",
        "Public worker-gateway URL",
        secret=False,
        after_domain=True,
    ),
    # Render API.
    s("SELECTA_DATABASE_URL", "Render API", "Render secret", "Pooled PostgreSQL connection URL"),
    s(
        "SELECTA_ALLOWED_HOSTS",
        "Render API",
        "Render value",
        "Comma-separated API hostnames",
        secret=False,
        after_domain=True,
    ),
    s(
        "SELECTA_ALLOWED_ORIGINS",
        "Render API",
        "Render value",
        "Exact HTTPS web origins",
        secret=False,
        after_domain=True,
    ),
    s("SELECTA_WORKOS_CLIENT_ID", "WorkOS", "Render value", "WorkOS client ID", secret=False),
    s(
        "SELECTA_AUTH_ISSUER",
        "WorkOS",
        "Render value",
        "Exact iss claim: normally https://api.workos.com; use the custom Authentication API "
        "origin after WorkOS verifies that domain",
        secret=False,
    ),
    s("SELECTA_WORKOS_API_KEY", "WorkOS", "Render secret", "WorkOS server API key"),
    s("SELECTA_WORKOS_WEBHOOK_SECRET", "WorkOS", "Render secret", "WorkOS webhook signing secret"),
    s(
        "SELECTA_STAFF_ORGANIZATION_ID",
        "WorkOS",
        "Render value",
        "Staff organisation ID",
        secret=False,
    ),
    s(
        "SELECTA_R2_ACCOUNT_ID",
        "Cloudflare R2",
        "Render value",
        "Primary Cloudflare account ID",
        secret=False,
    ),
    s("SELECTA_R2_ACCESS_KEY_ID", "Cloudflare R2", "Render secret", "Restricted R2 access key ID"),
    s(
        "SELECTA_R2_SECRET_ACCESS_KEY",
        "Cloudflare R2",
        "Render secret",
        "Restricted R2 secret access key",
    ),
    s(
        "SELECTA_R2_BUCKET_ORIGINALS",
        "Cloudflare R2",
        "Render value",
        "Original-audio bucket name",
        secret=False,
    ),
    s(
        "SELECTA_R2_BUCKET_DERIVED",
        "Cloudflare R2",
        "Render value",
        "Derived-audio bucket name",
        secret=False,
    ),
    s(
        "SELECTA_R2_BUCKET_EXPORTS",
        "Cloudflare R2",
        "Render value",
        "Exports bucket name",
        secret=False,
    ),
    s(
        "SELECTA_R2_BUCKET_STAGING",
        "Cloudflare R2",
        "Render value",
        "Staged-uploads bucket name",
        secret=False,
    ),
    s(
        "SELECTA_R2_BUCKET_DELETION_LEDGER",
        "Cloudflare R2",
        "Render value",
        "Deletion-ledger bucket name",
        secret=False,
    ),
    s(
        "SELECTA_ROOMS_PEPPER",
        "Internal secrets",
        "Render secret",
        "Room-code hashing pepper",
        generated=True,
    ),
    s(
        "SELECTA_PLAYBACK_SIGNING_SECRET",
        "Internal secrets",
        "Render secret",
        "Remote playback envelope key",
        generated=True,
    ),
    s("SELECTA_STRIPE_SECRET_KEY", "Stripe", "Render secret", "Stripe test/live secret key"),
    s(
        "SELECTA_STRIPE_WEBHOOK_SECRETS",
        "Stripe",
        "Render secret",
        "Comma-separated Stripe webhook secrets",
    ),
    s("SELECTA_STRIPE_PRICES", "Stripe", "Render secret", "JSON consumer price-to-plan map"),
    s(
        "SELECTA_BUSINESS_STRIPE_PRICES",
        "Stripe",
        "Render secret",
        "JSON business price/quantity map",
    ),
    s(
        "SELECTA_CHECKOUT_CONSENT_VERSION",
        "Stripe",
        "Render value",
        "Reviewed checkout-consent version",
        secret=False,
    ),
    s(
        "SELECTA_IP_HASH_KEY",
        "Internal secrets",
        "Render secret",
        "Buyer-IP hashing key",
        generated=True,
    ),
    s("ANTHROPIC_API_KEY", "Anthropic", "Render secret", "Lucy server API key"),
    s(
        "SELECTA_AI_DAILY_CAP_USD",
        "Anthropic",
        "Render value",
        "Application daily AI ceiling",
        secret=False,
    ),
    s(
        "SELECTA_AI_MONTHLY_CAP_USD",
        "Anthropic",
        "Render value",
        "Application monthly AI ceiling",
        secret=False,
    ),
    # Gateway and workers.
    s("SELECTA_GATEWAY_DATABASE_URL", "Render gateway", "Render secret", "Gateway PostgreSQL URL"),
    s(
        "SELECTA_GATEWAY_ALLOWED_HOSTS",
        "Render gateway",
        "Render value",
        "Gateway hostnames",
        secret=False,
        after_domain=True,
    ),
    s(
        "SELECTA_WORKER_TOKEN_SECRET",
        "Workers",
        "Render secret",
        "Short-lived worker-token signing key",
        generated=True,
    ),
    s(
        "SELECTA_WORKER_BOOTSTRAP_TOKEN",
        "Workers",
        "Render + Modal secret",
        "Worker enrollment token",
        generated=True,
    ),
    s(
        "SELECTA_WORKER_GATEWAY_URL",
        "Workers",
        "Modal secret",
        "Worker gateway URL",
        secret=False,
        after_domain=True,
    ),
    s(
        "SELECTA_WORKER_STORAGE_HOSTS",
        "Workers",
        "Modal secret",
        "Allowed comma-separated R2 hosts",
        secret=False,
    ),
    s("SELECTA_MODAL_APP", "Modal", "Render value", "Modal app name", secret=False),
    s("SELECTA_MODAL_TOKEN_ID", "Modal", "Render secret", "Modal token ID"),
    s("SELECTA_MODAL_TOKEN_SECRET", "Modal", "Render secret", "Modal token secret"),
    # Maintenance and backups.
    s(
        "SELECTA_MAINTENANCE_DATABASE_URL",
        "Maintenance",
        "Render secret",
        "Direct maintenance PostgreSQL URL",
    ),
    s("SELECTA_BACKUP_S3_ENDPOINT", "Backups", "Render secret", "Backup-account S3 endpoint"),
    s(
        "SELECTA_BACKUP_BUCKET",
        "Backups",
        "Render value",
        "Database-dump backup bucket",
        secret=False,
    ),
    s(
        "SELECTA_BACKUP_ACCESS_KEY_ID",
        "Backups",
        "Render secret",
        "Read-only backup monitor key ID",
    ),
    s(
        "SELECTA_BACKUP_SECRET_ACCESS_KEY",
        "Backups",
        "Render secret",
        "Read-only backup monitor secret",
    ),
    s(
        "SELECTA_DMCA_AGENT_REGISTERED_ON",
        "Maintenance",
        "Render value",
        "DMCA registration date (YYYY-MM-DD)",
        secret=False,
    ),
    # Browser build: all public by definition.
    s(
        "VITE_SELECTA_API_ORIGIN",
        "Cloudflare Pages",
        "Pages variable (public)",
        "Browser API origin",
        secret=False,
        after_domain=True,
    ),
    s(
        "VITE_WORKOS_CLIENT_ID",
        "Cloudflare Pages",
        "Pages variable (public)",
        "Browser WorkOS client ID",
        secret=False,
    ),
    s(
        "VITE_WORKOS_API_HOSTNAME",
        "Cloudflare Pages",
        "Pages variable (public)",
        "Custom auth hostname",
        secret=False,
        after_domain=True,
    ),
    s(
        "VITE_CHECKOUT_CONSENT_VERSION",
        "Cloudflare Pages",
        "Pages variable (public)",
        "Frontend consent version",
        secret=False,
    ),
    # Observability/email are optional integrations.
    s(
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "Observability",
        "Render + Modal secret",
        "Grafana OTLP endpoint",
        secret=False,
    ),
    s(
        "OTEL_EXPORTER_OTLP_HEADERS",
        "Observability",
        "Render + Modal secret",
        "Grafana authorization headers",
    ),
    s("SELECTA_SENTRY_DSN", "Observability", "Render secret", "Server Sentry DSN"),
    s(
        "SELECTA_EMAIL_PROVIDER",
        "Email",
        "Render value",
        "Transactional provider name",
        secret=False,
    ),
    s("SELECTA_EMAIL_API_KEY", "Email", "Render secret", "Transactional-email API key"),
    s(
        "SELECTA_EMAIL_FROM",
        "Email",
        "Render value",
        "Verified sender address",
        secret=False,
        after_domain=True,
    ),
    s(
        "SELECTA_EMAIL_SITE_URL",
        "Email",
        "Render value",
        "Public account/site URL",
        secret=False,
        after_domain=True,
    ),
    # Infrastructure/deploy inventory. These should ultimately be short-lived via OIDC.
    s(
        "CLOUDFLARE_API_TOKEN",
        "Infrastructure",
        "OIDC broker",
        "Restricted primary Cloudflare token",
    ),
    s(
        "CLOUDFLARE_ACCOUNT_ID",
        "Infrastructure",
        "OIDC broker",
        "Primary Cloudflare account ID",
        secret=False,
    ),
    s(
        "CLOUDFLARE_ZONE_ID",
        "Infrastructure",
        "OIDC broker",
        "Domain zone ID",
        secret=False,
        after_domain=True,
    ),
    s("BACKUP_API_TOKEN", "Infrastructure", "OIDC broker", "Restricted backup-account token"),
    s(
        "BACKUP_ACCOUNT_ID",
        "Infrastructure",
        "OIDC broker",
        "Backup Cloudflare account ID",
        secret=False,
    ),
    s("RENDER_API_KEY", "Infrastructure", "OIDC broker", "Short-lived/restricted Render API key"),
    s("RENDER_SERVICE_IDS", "Infrastructure", "OIDC broker", "Render service IDs", secret=False),
    s(
        "TOFU_STATE_ENDPOINT",
        "Infrastructure",
        "OIDC broker",
        "OpenTofu state S3 endpoint",
        secret=False,
    ),
    s("TOFU_STATE_ACCESS_KEY_ID", "Infrastructure", "OIDC broker", "OpenTofu state access key ID"),
    s("TOFU_STATE_SECRET_ACCESS_KEY", "Infrastructure", "OIDC broker", "OpenTofu state secret key"),
)

BY_NAME = {item.name: item for item in SETTINGS}

STRIPE_TEST_CATALOG = {
    "standard": {
        "name": "SelectaDJ Standard",
        "description": "SelectaDJ Standard consumer subscription",
        "prices": {"month": 699, "year": 5900},
    },
    "premium": {
        "name": "SelectaDJ Premium",
        "description": "SelectaDJ Premium consumer subscription",
        "prices": {"month": 1299, "year": 10900},
    },
}

STRIPE_BUSINESS_TEST_CATALOG = {
    "business_venue": {
        "name": "SelectaDJ Business venue",
        "prices": {"month": 7900, "year": 79000},
    },
    "business_extra_zone": {
        "name": "SelectaDJ Business extra zone",
        "prices": {"month": 2500, "year": 25000},
    },
    "business_extra_seat": {
        "name": "SelectaDJ Business extra staff seat",
        "prices": {"month": 500, "year": 5000},
    },
}

STRIPE_REQUIRED_WEBHOOK_EVENTS = frozenset(
    {
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.paused",
        "customer.subscription.resumed",
        "invoice.paid",
        "invoice.payment_failed",
        "invoice.payment_action_required",
        "charge.refunded",
        "charge.dispute.created",
        "charge.dispute.closed",
    }
)

# These are deliberately provider-level URLs: dashboard subpaths change frequently, while the
# click-path text tells the operator what object to look for. No credential value is fetched here.
SETUP_GUIDES = {
    "GitHub deploy": (
        "https://github.com",
        "Repository Settings > Environments. Create staging and production; add Variables, "
        "not Secrets. The credential-broker URL only exists after the broker is deployed.",
    ),
    "Render API": (
        "https://dashboard.render.com",
        "Do not create the services one-by-one from Render's New menu. Open Blueprints > New "
        "Blueprint Instance, connect this repository, and set Blueprint Path to "
        "infra/render/render.yaml. Review the resource list before applying it: that file contains "
        "both staging and paid production resources. After deployment, open the named service > "
        "Environment to enter values; Render-generated database URLs are wired by the Blueprint.",
    ),
    "WorkOS": (
        "https://dashboard.workos.com",
        "Select the matching staging/production environment. Applications shows the client ID. "
        "The standard AuthKit issuer is https://api.workos.com; Selecta binds a token to the "
        "application using its client_id claim. API Keys has "
        "the server key; create the signing secret under Webhooks. Organizations contains the "
        "staff organisation ID.",
    ),
    "Cloudflare R2": (
        "https://dash.cloudflare.com",
        "R2 Object Storage > Manage R2 API Tokens. Create environment-scoped credentials, then "
        "create private originals, derived, exports, staging and deletion-ledger buckets. Account "
        "ID is on the account overview.",
    ),
    "Internal secrets": (
        "generated locally",
        "These do not come from a vendor. Enter G and this wizard will generate an independent "
        "cryptographically random value. Generate a different value for staging and production.",
    ),
    "Stripe": (
        "https://dashboard.stripe.com",
        "Use the Test mode toggle for staging and live mode only for production. The wizard can "
        "create the complete staging consumer and business catalog after the test secret key is "
        "saved; you should not hand-build its JSON price maps.",
    ),
    "Anthropic": (
        "https://console.anthropic.com",
        "Create separate staging/production workspaces or projects and spending limits, then "
        "create a server API key. Never expose it to the browser.",
    ),
    "Render gateway": (
        "https://dashboard.render.com",
        "Open the gateway service > Environment. Use a PostgreSQL URL appropriate to the gateway "
        "and set the final gateway hostname after DNS exists.",
    ),
    "Workers": (
        "https://modal.com/settings",
        "The signing/enrollment values are generated here; copy the bootstrap token to both Render "
        "and the matching Modal secret. Gateway URL and R2 storage hosts come from your deployed "
        "infrastructure.",
    ),
    "Modal": (
        "https://modal.com/settings",
        "Create staging and production environments. Create a token for maintenance-led "
        "autoscaling, and secrets named selecta-staging-workers and selecta-production-workers.",
    ),
    "Maintenance": (
        "https://dashboard.render.com",
        "Open the maintenance service > Environment. Use the direct, not pooled, PostgreSQL URL. "
        "The DMCA date is an operational/legal value, not a generated credential.",
    ),
    "Backups": (
        "https://dash.cloudflare.com",
        "In the separately owned backup Cloudflare account, create the DB-dumps bucket and "
        "restricted credentials. Maintenance needs read-only listing access; backup jobs need "
        "separate write-only credentials.",
    ),
    "Cloudflare Pages": (
        "https://dash.cloudflare.com",
        "Workers & Pages > your Pages project > Settings > Variables and Secrets. These VITE "
        "values are public build configuration; never place a secret in a VITE variable.",
    ),
    "Observability": (
        "https://grafana.com/auth/sign-in",
        "In Grafana Cloud, open your stack's OpenTelemetry configuration and copy its OTLP "
        "endpoint and authentication headers. Sentry can wait until its SDK integration is "
        "enabled.",
    ),
    "Email": (
        "https://resend.com",
        "Optional for now: WorkOS and Stripe currently send customer mail. Later choose one "
        "provider, verify the domain, create a restricted API key and set the verified From "
        "address.",
    ),
    "Infrastructure": (
        "https://dash.cloudflare.com",
        "These are inputs to the not-yet-built OIDC credential broker. Create least-privilege "
        "provider credentials only while implementing that broker; do not copy long-lived versions "
        "into GitHub.",
    ),
}


# Field-level instructions are intentionally explicit. Provider dashboards change their wording,
# but an operator should always know which object to create, what to copy, and what a valid value
# looks like without having to infer it from the setting name.
FIELD_GUIDES: dict[str, tuple[str, ...]] = {
    "SELECTA_CREDENTIAL_BROKER_URL": (
        "Not available yet. Leave this blank until the OIDC credential-broker service has been deployed.",
        "When it exists, copy its full HTTPS base URL (for example https://credentials.example.com); do not enter a GitHub URL or an API key.",
    ),
    "SELECTA_API_URL": (
        "Derived automatically by --set-domain.",
        "Staging: https://api.staging.selectadj.app; production: https://api.selectadj.app.",
    ),
    "SELECTA_GATEWAY_URL": (
        "Derived automatically by --set-domain.",
        "Staging: https://gateway.staging.selectadj.app; production: https://gateway.selectadj.app.",
    ),
    "SELECTA_DATABASE_URL": (
        "Do not copy this from another environment.",
        "The Render Blueprint connects the API to its Postgres database. After deployment, open the API service > Environment and use the value Render supplied from the database; it should be a postgres:// or postgresql:// URL using the private/internal host.",
    ),
    "SELECTA_ALLOWED_HOSTS": (
        "Derived automatically by --set-domain.",
        "Enter hostnames only, with no https:// and no trailing slash. Multiple hosts are comma-separated.",
    ),
    "SELECTA_ALLOWED_ORIGINS": (
        "Derived automatically by --set-domain.",
        "Enter exact browser origins including https://, with no path or trailing slash.",
    ),
    "SELECTA_WORKOS_CLIENT_ID": (
        "WorkOS Dashboard > switch to the matching environment > Applications > your AuthKit application > Configuration.",
        "Copy Client ID. It starts with client_. Use the same value for VITE_WORKOS_CLIENT_ID in that environment.",
    ),
    "SELECTA_AUTH_ISSUER": (
        "For the standard WorkOS Authentication API, enter https://api.workos.com without a trailing slash.",
        "Use a custom Authentication API origin only after WorkOS verifies it. AuthKit session tokens identify the application with client_id, which Selecta checks separately.",
    ),
    "SELECTA_WORKOS_API_KEY": (
        "WorkOS Dashboard > matching environment > API Keys > Create API key.",
        "Copy the secret immediately; staging keys start with sk_test_. This is server-only and must never be a VITE value.",
    ),
    "SELECTA_WORKOS_WEBHOOK_SECRET": (
        "WorkOS Dashboard > Webhooks > Create endpoint.",
        "Endpoint URL: the environment API URL plus /api/webhooks/workos. Select user.updated, user.deleted, authentication.email_verification_succeeded, session.revoked, and password_reset.succeeded (or the equivalent password-reset event WorkOS offers). Do not select email_verification.created. Create the endpoint, then reveal/copy its signing secret—not its endpoint ID.",
    ),
    "SELECTA_STAFF_ORGANIZATION_ID": (
        "WorkOS Dashboard > Organizations > Create organization (name it SelectaDJ Staff, with the environment in the staging name).",
        "Open it and copy the ID beginning org_. Do not use a customer organization.",
    ),
    "SELECTA_R2_ACCOUNT_ID": (
        "Cloudflare Dashboard > choose the account > R2 Object Storage > Overview.",
        "Copy Account ID from the right-hand account details/API section. It is not the zone ID.",
    ),
    "SELECTA_R2_ACCESS_KEY_ID": (
        "Cloudflare Dashboard > R2 Object Storage > Manage R2 API Tokens > Create Account API token.",
        "Grant Object Read & Write only to this environment's five Selecta buckets. Copy Access Key ID from the one-time credentials screen.",
    ),
    "SELECTA_R2_SECRET_ACCESS_KEY": (
        "Use the same one-time R2 credentials screen as the access-key ID.",
        "Copy Secret Access Key. If that screen was closed, rotate/create a token; Cloudflare cannot show the secret again.",
    ),
    "SELECTA_R2_BUCKET_ORIGINALS": (
        "R2 Object Storage > Create bucket, or use --fill-known first.",
        "Expected name: selecta-staging-originals or selecta-production-originals. Keep the bucket private.",
    ),
    "SELECTA_R2_BUCKET_DERIVED": (
        "R2 Object Storage > Create bucket, or use --fill-known first.",
        "Expected name: selecta-staging-derived or selecta-production-derived. Keep the bucket private.",
    ),
    "SELECTA_R2_BUCKET_EXPORTS": (
        "R2 Object Storage > Create bucket, or use --fill-known first.",
        "Expected name: selecta-staging-exports or selecta-production-exports. Keep the bucket private.",
    ),
    "SELECTA_R2_BUCKET_STAGING": (
        "R2 Object Storage > Create bucket, or use --fill-known first.",
        "Expected name: selecta-staging-staging or selecta-production-staging. Keep the bucket private.",
    ),
    "SELECTA_R2_BUCKET_DELETION_LEDGER": (
        "R2 Object Storage > Create bucket, or use --fill-known first.",
        "Expected name: selecta-staging-deletion-ledger or selecta-production-deletion-ledger. Keep the bucket private and apply the retention policy from the launch checklist.",
    ),
    "SELECTA_ROOMS_PEPPER": (
        "This has no dashboard value. Type G and the wizard generates it.",
        "Never reuse the staging value in production; changing it invalidates existing room-code hashes.",
    ),
    "SELECTA_PLAYBACK_SIGNING_SECRET": (
        "This has no dashboard value. Type G and the wizard generates it.",
        "Never reuse it across environments; changing it invalidates outstanding playback envelopes.",
    ),
    "SELECTA_STRIPE_SECRET_KEY": (
        "Stripe Dashboard > ensure Test mode is ON for staging > Developers > API keys.",
        "Reveal and copy Secret key (sk_test_... for staging, sk_live_... only for production). Never copy the publishable pk_ key.",
    ),
    "SELECTA_STRIPE_WEBHOOK_SECRETS": (
        "Stripe Dashboard > Developers > Webhooks > Add destination > Your account.",
        "Endpoint URL: the environment API URL plus /api/webhooks/stripe. Select the events printed by --audit-stripe-webhook. Open the created destination > Signing secret > Reveal, then copy the whsec_... value. Separate multiple active secrets with commas during rotation.",
    ),
    "SELECTA_STRIPE_PRICES": (
        "Do not type this JSON manually for staging.",
        "After saving an sk_test_ key, exit and run: python setup_cloud.py --provision-stripe-test. It creates/reuses £6.99/£59 Standard and £12.99/£109 Premium recurring prices and saves the exact price-ID map here.",
    ),
    "SELECTA_BUSINESS_STRIPE_PRICES": (
        "Do not type this JSON manually for staging.",
        "After saving an sk_test_ key, run: python setup_cloud.py --provision-stripe-business-test. It creates/reuses venue, extra-zone and extra-seat recurring prices plus the volume coupon, then saves the map.",
    ),
    "SELECTA_CHECKOUT_CONSENT_VERSION": (
        "This identifies the exact checkout consent copy accepted by the customer; it is not supplied by Stripe.",
        "Use consumer-terms-2026-11-v1 for the currently planned first reviewed version, and set VITE_CHECKOUT_CONSENT_VERSION to exactly the same value. Increment it whenever the reviewed wording changes.",
    ),
    "SELECTA_IP_HASH_KEY": (
        "This has no dashboard value. Type G and the wizard generates it.",
        "Use a different key in each environment. Rotation breaks comparison with older IP hashes.",
    ),
    "ANTHROPIC_API_KEY": (
        "Anthropic Console > Settings > Workspaces (create/select the environment workspace) > API Keys > Create Key.",
        "Copy the sk-ant-... key once. Set a provider spending limit first and never expose this key to the browser.",
    ),
    "SELECTA_AI_DAILY_CAP_USD": (
        "Choose the maximum application spend allowed per UTC day; this is a decimal number, not an Anthropic key.",
        "For staging, start conservatively (for example 5). It must be no greater than the provider/project budget you configured.",
    ),
    "SELECTA_AI_MONTHLY_CAP_USD": (
        "Choose the maximum application spend allowed per calendar month; this is a decimal number.",
        "For staging, start conservatively (for example 25). Review it before production launch.",
    ),
    "SELECTA_GATEWAY_DATABASE_URL": (
        "The Render Blueprint connects the gateway to the environment's Postgres database.",
        "After deployment, open the gateway service > Environment and use the Render-supplied private/internal postgres:// URL. Do not use the other environment's database.",
    ),
    "SELECTA_GATEWAY_ALLOWED_HOSTS": (
        "Derived automatically by --set-domain.",
        "Enter the gateway hostname only, without https:// or a path.",
    ),
    "SELECTA_WORKER_TOKEN_SECRET": (
        "This has no dashboard value. Type G and the wizard generates it.",
        "The matching Render gateway/maintenance services must share the value within one environment; never share it across environments.",
    ),
    "SELECTA_WORKER_BOOTSTRAP_TOKEN": (
        "This has no dashboard value. Type G and the wizard generates it.",
        "Store the same environment-specific value in Render and the matching Modal secret. Rotate after worker enrollment if the runbook calls for it.",
    ),
    "SELECTA_WORKER_GATEWAY_URL": (
        "Derived automatically by --set-domain.",
        "Use the full HTTPS gateway origin with no trailing path.",
    ),
    "SELECTA_WORKER_STORAGE_HOSTS": (
        "Cloudflare R2 uses <account-id>.r2.cloudflarestorage.com.",
        "Enter allowed hostnames only (no https://), comma-separated if more than one. Use the account ID belonging to this environment.",
    ),
    "SELECTA_MODAL_APP": (
        "Use --fill-known or create/deploy the app from infra/modal.",
        "Expected name: selecta-workers-staging or selecta-workers-production.",
    ),
    "SELECTA_MODAL_TOKEN_ID": (
        "Modal dashboard > Settings > API Tokens > Create token for the matching environment/automation identity.",
        "Copy Token ID. Do not paste the token secret into this field.",
    ),
    "SELECTA_MODAL_TOKEN_SECRET": (
        "Copy Token Secret from the same Modal token creation screen.",
        "It is shown once. If lost, revoke the token and create another.",
    ),
    "SELECTA_MAINTENANCE_DATABASE_URL": (
        "Render Postgres > Connect, or use the Blueprint-provided database reference on the maintenance worker.",
        "Use the private/internal direct connection URL, not the pooled/PgBouncer URL, because migrations and maintenance require a direct session.",
    ),
    "SELECTA_BACKUP_S3_ENDPOINT": (
        "In the separately owned backup Cloudflare account, open R2 Overview.",
        "Copy the S3 endpoint in the form https://<backup-account-id>.r2.cloudflarestorage.com. This must not point at the primary R2 account.",
    ),
    "SELECTA_BACKUP_BUCKET": (
        "In the backup Cloudflare account > R2 > Create bucket.",
        "Create/select the environment-specific database-dump bucket. Enter its bucket name only, not a URL.",
    ),
    "SELECTA_BACKUP_ACCESS_KEY_ID": (
        "Backup Cloudflare account > R2 > Manage R2 API Tokens.",
        "Create monitoring credentials restricted to read/list the environment dump bucket, then copy Access Key ID.",
    ),
    "SELECTA_BACKUP_SECRET_ACCESS_KEY": (
        "Copy Secret Access Key from that same one-time backup R2 credentials screen.",
        "If lost, rotate the credentials rather than reusing a broader primary-account token.",
    ),
    "SELECTA_DMCA_AGENT_REGISTERED_ON": (
        "Use the effective date from the completed DMCA agent registration confirmation.",
        "Enter YYYY-MM-DD. Leave blank until registration is actually complete; do not invent a date.",
    ),
    "VITE_SELECTA_API_ORIGIN": (
        "Derived automatically by --set-domain; later add it to the frontend build environment.",
        "This is public configuration. Use the exact HTTPS API origin with no path.",
    ),
    "VITE_WORKOS_CLIENT_ID": (
        "Use the same client_... ID as SELECTA_WORKOS_CLIENT_ID for this environment.",
        "This is intentionally public browser configuration; never put the WorkOS API key here.",
    ),
    "VITE_WORKOS_API_HOSTNAME": (
        "Derived from the custom auth hostname by --set-domain.",
        "Enter hostname only (auth.staging.selectadj.app or auth.selectadj.app), but do not activate it until WorkOS verifies the custom auth domain and DNS is live.",
    ),
    "VITE_CHECKOUT_CONSENT_VERSION": (
        "Copy SELECTA_CHECKOUT_CONSENT_VERSION exactly.",
        "The frontend and API values must match or checkout will be rejected.",
    ),
    "OTEL_EXPORTER_OTLP_ENDPOINT": (
        "Grafana Cloud > your Stack > OpenTelemetry > Configure > Send OTLP data.",
        "Copy the OTLP endpoint exactly. It commonly ends in /otlp; use the endpoint shown for your stack and region.",
    ),
    "OTEL_EXPORTER_OTLP_HEADERS": (
        "On the same Grafana OpenTelemetry setup page, generate/select an access policy token with metrics/logs/traces write scopes.",
        "Copy the complete headers string Grafana provides (often Authorization=Basic ...). Treat it as a secret.",
    ),
    "SELECTA_SENTRY_DSN": (
        "Sentry > select/create the server project > Project Settings > Client Keys (DSN).",
        "Copy the DSN URL, not an auth token. Leave blank until the Sentry SDK is enabled if no project exists yet.",
    ),
    "SELECTA_EMAIL_PROVIDER": (
        "For the chosen provider, enter its lowercase adapter name.",
        "For your setup enter resend.",
    ),
    "SELECTA_EMAIL_API_KEY": (
        "Resend Dashboard > API Keys > Create API Key.",
        "Choose Sending access and restrict it to selectadj.app if offered; copy the re_... key once.",
    ),
    "SELECTA_EMAIL_FROM": (
        "Resend Dashboard > Domains > add and verify selectadj.app by publishing the shown DNS records.",
        "After Verified, enter SelectaDJ <selectadjmail@selectadj.app>. Owning the mailbox alone is not enough; the sending domain must show Verified in Resend.",
    ),
    "SELECTA_EMAIL_SITE_URL": (
        "Derived automatically by --set-domain.",
        "Use the public app origin, not the API URL and not a page path.",
    ),
    "CLOUDFLARE_API_TOKEN": (
        "Not needed for the first manual staging deployment. Leave blank until the credential broker is implemented.",
        "Then create a least-privilege Cloudflare API token for DNS/R2 operations required by infra/tofu; never store it as a GitHub secret.",
    ),
    "CLOUDFLARE_ACCOUNT_ID": (
        "Cloudflare Dashboard > account home > right-side account details, or R2 Overview.",
        "Copy Account ID. It is safe metadata and is different from Zone ID.",
    ),
    "CLOUDFLARE_ZONE_ID": (
        "Cloudflare Dashboard > select selectadj.app > Overview > API section.",
        "Copy Zone ID for selectadj.app. Do not enter the account ID.",
    ),
    "BACKUP_API_TOKEN": (
        "Not needed until backup automation/credential broker is implemented.",
        "Create it in the separately owned backup Cloudflare account with only the R2 permissions required by the backup job.",
    ),
    "BACKUP_ACCOUNT_ID": (
        "Backup Cloudflare account > account home/R2 Overview.",
        "Copy that account's Account ID; it must differ from the primary account when separation is in place.",
    ),
    "RENDER_API_KEY": (
        "Not needed for initial dashboard deployment. Leave blank until the credential broker is implemented.",
        "Later: Render Dashboard > Account Settings > API Keys > Create API Key, then restrict/rotate it according to the broker runbook. Do not save a long-lived copy in GitHub.",
    ),
    "RENDER_SERVICE_IDS": (
        "Only available after the Render Blueprint creates the services.",
        "Open each Render service; copy the srv-... ID from Settings or its dashboard URL. Enter the IDs in the format expected by the future broker; leave blank for now.",
    ),
    "TOFU_STATE_ENDPOINT": (
        "Only available after creating the private S3-compatible OpenTofu state store.",
        "Enter its full S3 endpoint URL. Do not use an application-data bucket endpoint unless the infrastructure plan explicitly assigns it.",
    ),
    "TOFU_STATE_ACCESS_KEY_ID": (
        "Create credentials restricted to the OpenTofu state bucket only.",
        "Copy the access-key ID. Leave blank until the state backend exists.",
    ),
    "TOFU_STATE_SECRET_ACCESS_KEY": (
        "Copy the matching state-backend secret from its one-time credentials screen.",
        "Leave blank until the backend exists; never commit or place it in a GitHub variable.",
    ),
}

