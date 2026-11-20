#!/usr/bin/env python3
# ruff: noqa: E501
"""Interactive SelectaDJ cloud configuration inventory and local encrypted vault.

Run ``python setup_cloud.py`` for the guided wizard. Values are kept outside the
repository. On Windows the vault is encrypted with DPAPI for the current user.
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import getpass
import json
import os
import secrets
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path


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
        "Exact iss claim: normally https://api.workos.com/user_management/<client-id>; use "
        "https://<custom-auth-domain>/user_management/<client-id> after adding that domain",
        secret=False,
    ),
    s(
        "SELECTA_AUTH_AUDIENCE",
        "WorkOS",
        "Render value",
        "Exact aud claim; for AuthKit sessions this is normally the WorkOS client ID",
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
        "For the issuer, open https://api.workos.com/user_management/<client-id>/.well-known/"
        "openid-configuration and copy its issuer field; audience is normally the client ID. "
        "Confirm both against the iss and aud claims of a real staging access token. API Keys has "
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
        "Replace <client-id> in https://api.workos.com/user_management/<client-id>/.well-known/openid-configuration and open it in a browser.",
        "Copy the JSON issuer value exactly, without the /.well-known/openid-configuration suffix. Do not switch to auth.selectadj.app until WorkOS has verified that custom auth domain.",
    ),
    "SELECTA_AUTH_AUDIENCE": (
        "For normal AuthKit sessions, enter the same client_... value as SELECTA_WORKOS_CLIENT_ID.",
        "Before launch, decode a real access token and confirm its aud claim matches exactly.",
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


def vault_root() -> Path:
    override = os.environ.get("SELECTA_SETUP_HOME")
    if override:
        return Path(override).expanduser().resolve()
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "SelectaDJ" / "cloud-setup"
    return (
        Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
        / "selectadj"
        / "cloud-setup"
    )


class Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def _blob(data: bytes) -> tuple[Blob, ctypes.Array[ctypes.c_char]]:
    buffer = ctypes.create_string_buffer(data)
    return Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), buffer


def dpapi(data: bytes, *, decrypt: bool) -> bytes:
    source, source_buffer = _blob(data)
    output = Blob()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    if decrypt:
        ok = crypt32.CryptUnprotectData(
            ctypes.byref(source), None, None, None, None, 0, ctypes.byref(output)
        )
    else:
        ok = crypt32.CryptProtectData(
            ctypes.byref(source), "SelectaDJ cloud setup", None, None, None, 0, ctypes.byref(output)
        )
    del source_buffer
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel32.LocalFree(output.pbData)


def vault_path(environment: str) -> Path:
    suffix = "bin" if os.name == "nt" else "json"
    return vault_root() / f"{environment}.{suffix}"


def load_values(environment: str) -> dict[str, str]:
    path = vault_path(environment)
    if not path.exists():
        return {}
    raw = path.read_bytes()
    if os.name == "nt":
        raw = dpapi(base64.b64decode(raw), decrypt=True)
    values = json.loads(raw)
    if not isinstance(values, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in values.items()
    ):
        raise ValueError(f"Invalid vault: {path}")
    return values


def save_values(environment: str, values: dict[str, str]) -> None:
    root = vault_root()
    root.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(values, sort_keys=True, indent=2).encode()
    if os.name == "nt":
        raw = base64.b64encode(dpapi(raw, decrypt=False))
    path = vault_path(environment)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_bytes(raw)
    if os.name != "nt":
        os.chmod(temp, stat.S_IRUSR | stat.S_IWUSR)
    temp.replace(path)


def status(environment: str, values: dict[str, str]) -> None:
    print(f"\nSelectaDJ {environment} configuration")
    print(f"Vault: {vault_path(environment)}")
    for group in dict.fromkeys(item.group for item in SETTINGS):
        group_items = [item for item in SETTINGS if item.group == group]
        configured = sum(item.name in values for item in group_items)
        print(f"  {group:<20} {configured:>2}/{len(group_items):<2} configured")
    unknown = sorted(set(values) - set(BY_NAME))
    if unknown:
        print(f"  Legacy/unknown         {len(unknown)} configured")
    print(f"\nTotal: {len(set(values) & set(BY_NAME))}/{len(SETTINGS)} configured")


def print_guide(group: str) -> None:
    url, instructions = SETUP_GUIDES[group]
    print(f"\n{group}")
    print(f"  Get it from: {url}")
    print(f"  How: {instructions}")


def print_field_guide(item: Setting, *, indent: str = "  ") -> None:
    """Print actionable acquisition instructions for one setting without its value."""
    for index, instruction in enumerate(FIELD_GUIDES[item.name], 1):
        print(f"{indent}{index}. {instruction}")


def checklist(
    environment: str, values: dict[str, str], *, include_configured: bool = False
) -> None:
    """Print a value-free acquisition checklist safe to paste into a ticket."""
    print(f"SelectaDJ {environment} acquisition checklist (no secret values shown)")
    for group in dict.fromkeys(item.group for item in SETTINGS):
        items = [item for item in SETTINGS if item.group == group]
        visible = [item for item in items if include_configured or item.name not in values]
        if not visible:
            continue
        print_guide(group)
        for item in visible:
            state = "configured" if item.name in values else "missing"
            timing = "; after domain" if item.after_domain else ""
            generated = "; wizard can generate" if item.generated else ""
            print(f"  [{state}] {item.name} -> {item.destination}")
            print(f"      {item.description}{timing}{generated}")
            print_field_guide(item, indent="      ")


def prompt_value(item: Setting) -> str | None:
    flags = []
    if item.after_domain:
        flags.append("after domain")
    if item.generated:
        flags.append("G = generate")
    note = f" [{', '.join(flags)}]" if flags else ""
    print(f"\n{item.name}{note}")
    print(f"  {item.description}")
    print(f"  Save to: {item.destination}")
    print("  How to get or choose it:")
    print_field_guide(item, indent="    ")
    try:
        prompt = (
            "  Secret value (hidden; blank = skip, q = finish): "
            if item.secret
            else "  Value (blank = skip, q = finish): "
        )
        value = (getpass.getpass(prompt) if item.secret else input(prompt)).strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return None
    if value.lower() == "q":
        raise StopIteration
    if not value:
        return None
    if item.generated and value.lower() == "g":
        return secrets.token_urlsafe(48)
    return value


def configure_group(environment: str, values: dict[str, str], group: str, *, update: bool) -> int:
    candidates = [
        item for item in SETTINGS if item.group == group and (update or item.name not in values)
    ]
    if not candidates:
        print("Everything in this provider is configured. Run with --update to replace values.")
        return 0
    print_guide(group)
    print("  Every entry is optional. Blank skips it; q returns to the dashboard.")
    changed = 0
    try:
        for item in candidates:
            value = prompt_value(item)
            if value is not None:
                values[item.name] = value
                save_values(environment, values)
                changed += 1
                print("  Saved securely; value hidden.")
    except StopIteration:
        pass
    return changed


def wizard(environment: str, values: dict[str, str], *, update: bool, group: str | None) -> None:
    if group:
        matches = [name for name in SETUP_GUIDES if name.casefold() == group.casefold()]
        if not matches:
            choices = ", ".join(SETUP_GUIDES)
            raise ValueError(f"unknown group {group!r}; choose one of: {choices}")
        changed = configure_group(environment, values, matches[0], update=update)
        print(f"\nSaved {changed} change(s).")
        return

    print(f"SelectaDJ cloud setup - {environment}")
    print("Values are encrypted outside the repo. Configured names are counted, never revealed.")
    changed = 0
    groups = list(dict.fromkeys(item.group for item in SETTINGS))
    while True:
        print("\nChoose a provider or component:")
        actionable = False
        for index, name in enumerate(groups, 1):
            items = [item for item in SETTINGS if item.group == name]
            configured = sum(item.name in values for item in items)
            remaining = len(items) - configured
            if remaining or update:
                actionable = True
                label = f"{remaining} needed" if remaining else "complete; update mode"
                print(f"  {index:>2}. {name:<20} {label}")
        if not actionable:
            print("Everything is configured. Re-run with --update to replace a value.")
            break
        print("   c. Print the full missing-values checklist")
        print("   q. Save and quit")
        try:
            choice = input("Selection: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if choice == "q":
            break
        if choice == "c":
            checklist(environment, values)
            continue
        if not choice.isdigit() or not 1 <= int(choice) <= len(groups):
            print("Choose a displayed number, c, or q.")
            continue
        changed += configure_group(environment, values, groups[int(choice) - 1], update=update)
    print(f"\nSaved {changed} change(s). Values configured: {len(values)}/{len(SETTINGS)}.")


def dotenv_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def export_env(path: Path, values: dict[str, str]) -> None:
    if path.exists():
        answer = input(f"{path} exists. Overwrite it? [y/N] ").strip().lower()
        if answer != "y":
            print("Cancelled.")
            return
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Generated by setup_cloud.py. Contains secrets; never commit this file."]
    lines.extend(f"{name}={dotenv_quote(value)}" for name, value in sorted(values.items()))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if os.name != "nt":
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    print(f"Wrote {len(values)} values to {path}. Delete it when no longer needed.")


def sync_github(environment: str, values: dict[str, str]) -> None:
    mapping = {
        "SELECTA_CREDENTIAL_BROKER_URL": "SELECTA_CREDENTIAL_BROKER_URL",
        "SELECTA_API_URL": f"SELECTA_{environment.upper()}_API_URL",
        "SELECTA_GATEWAY_URL": f"SELECTA_{environment.upper()}_GATEWAY_URL",
    }
    available = [(source, target) for source, target in mapping.items() if source in values]
    if not available:
        print("No GitHub variables are configured in the vault.")
        return
    print(f"Will update {len(available)} non-secret GitHub variable(s) for {environment}.")
    if input("Continue using the authenticated gh CLI? [y/N] ").strip().lower() != "y":
        print("Cancelled.")
        return
    for source, target in available:
        subprocess.run(
            ["gh", "variable", "set", target, "--env", environment, "--body", values[source]],
            check=True,
        )
        print(f"  Updated {target}")


def values_for_domain(domain: str, environment: str) -> dict[str, str]:
    """Return non-secret configuration derived from an owned apex domain."""
    domain = domain.strip().lower().rstrip(".")
    if not domain or any(character in domain for character in "/: @") or "." not in domain:
        raise ValueError("domain must be an apex hostname such as selectadj.app")
    environment_prefix = "" if environment == "production" else "staging."
    app_host = f"app.{environment_prefix}{domain}"
    api_host = f"api.{environment_prefix}{domain}"
    gateway_host = f"gateway.{environment_prefix}{domain}"
    auth_host = f"auth.{environment_prefix}{domain}"
    return {
        "SELECTA_API_URL": f"https://{api_host}",
        "SELECTA_GATEWAY_URL": f"https://{gateway_host}",
        "SELECTA_ALLOWED_HOSTS": api_host,
        "SELECTA_ALLOWED_ORIGINS": f"https://{app_host}",
        "SELECTA_GATEWAY_ALLOWED_HOSTS": gateway_host,
        "SELECTA_WORKER_GATEWAY_URL": f"https://{gateway_host}",
        "VITE_SELECTA_API_ORIGIN": f"https://{api_host}",
        "VITE_WORKOS_API_HOSTNAME": auth_host,
        "SELECTA_EMAIL_SITE_URL": f"https://{app_host}",
    }


def apply_domain(domain: str) -> None:
    """Populate domain-derived values in both vaults without touching credentials."""
    for environment in ("staging", "production"):
        values = load_values(environment)
        derived = values_for_domain(domain, environment)
        values.update(derived)
        save_values(environment, values)
        print(f"Updated {len(derived)} {environment} domain-derived values.")
    print(
        "SELECTA_AUTH_ISSUER was not changed. Update it only after WorkOS verifies the custom "
        "auth domain, then confirm the exact iss claim from a real access token."
    )


def fill_known_values(email_provider: str | None, email_from: str | None) -> None:
    """Fill deterministic defaults and generate missing deployment secrets in both vaults."""
    generated_names = {item.name for item in SETTINGS if item.generated}
    for environment in ("staging", "production"):
        values = load_values(environment)
        additions = {
            "SELECTA_R2_BUCKET_ORIGINALS": f"selecta-{environment}-originals",
            "SELECTA_R2_BUCKET_DERIVED": f"selecta-{environment}-derived",
            "SELECTA_R2_BUCKET_EXPORTS": f"selecta-{environment}-exports",
            "SELECTA_R2_BUCKET_STAGING": f"selecta-{environment}-staging",
            "SELECTA_R2_BUCKET_DELETION_LEDGER": f"selecta-{environment}-deletion-ledger",
            "SELECTA_MODAL_APP": f"selecta-workers-{environment}",
        }
        if email_provider:
            additions["SELECTA_EMAIL_PROVIDER"] = email_provider.strip().lower()
        if email_from:
            additions["SELECTA_EMAIL_FROM"] = email_from.strip()
        client_id = values.get("SELECTA_WORKOS_CLIENT_ID")
        if client_id:
            additions["VITE_WORKOS_CLIENT_ID"] = client_id
        consent = values.get("SELECTA_CHECKOUT_CONSENT_VERSION")
        if consent:
            additions["VITE_CHECKOUT_CONSENT_VERSION"] = consent

        added = 0
        for name, value in additions.items():
            if value and name not in values:
                values[name] = value
                added += 1
        generated = 0
        for name in generated_names:
            if name not in values:
                values[name] = secrets.token_urlsafe(48)
                generated += 1
        save_values(environment, values)
        print(
            f"Filled {added} known value(s) and generated {generated} secret(s) for "
            f"{environment}; existing values were preserved."
        )


def stripe_request(
    key: str,
    method: str,
    path: str,
    fields: dict[str, str] | None = None,
    *,
    idempotency_key: str | None = None,
) -> dict[str, object]:
    """Call Stripe without ever putting the API key in a command or URL."""
    encoded = urllib.parse.urlencode(fields or {}).encode()
    url = f"https://api.stripe.com{path}"
    if method == "GET" and fields:
        url = f"{url}?{encoded.decode()}"
        encoded = None
    headers = {"Authorization": f"Bearer {key}", "User-Agent": "SelectaDJ-setup/1"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    request = urllib.request.Request(url, data=encoded, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"Stripe API returned HTTP {exc.code}: {detail}") from exc
    if not isinstance(result, dict):
        raise RuntimeError("Stripe API returned an unexpected response")
    return result


def _stripe_list(key: str, path: str, fields: dict[str, str]) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    query = {**fields, "limit": "100"}
    while True:
        page = stripe_request(key, "GET", path, query)
        data = page.get("data")
        if not isinstance(data, list):
            raise RuntimeError("Stripe list response has no data array")
        items.extend(item for item in data if isinstance(item, dict))
        if not page.get("has_more") or not data:
            return items
        last = data[-1]
        if not isinstance(last, dict) or not isinstance(last.get("id"), str):
            raise RuntimeError("Stripe pagination response has no final object ID")
        query["starting_after"] = last["id"]


def provision_stripe_test_catalog() -> dict[str, dict[str, object]]:
    """Create/reuse the ADR v1 consumer catalogue and save its staging price map."""
    values = load_values("staging")
    key = values.get("SELECTA_STRIPE_SECRET_KEY", "")
    if not key.startswith("sk_test_"):
        raise ValueError("staging vault needs a Stripe sk_test_ key; live keys are refused")

    products = _stripe_list(key, "/v1/products", {"active": "true"})
    price_map: dict[str, dict[str, object]] = {}
    for plan, definition in STRIPE_TEST_CATALOG.items():
        product = next(
            (
                item
                for item in products
                if isinstance(item.get("metadata"), dict)
                and item["metadata"].get("selecta_plan") == plan
                and item["metadata"].get("plan_version") == "1"
            ),
            None,
        )
        if product is None:
            product = stripe_request(
                key,
                "POST",
                "/v1/products",
                {
                    "name": str(definition["name"]),
                    "description": str(definition["description"]),
                    "metadata[selecta_plan]": plan,
                    "metadata[plan_version]": "1",
                    "metadata[environment]": "staging",
                },
                idempotency_key=f"selectadj-staging-product-{plan}-v1",
            )
            products.append(product)
            print(f"Created Stripe test product: {definition['name']}")
        else:
            print(f"Reused Stripe test product: {definition['name']}")
        product_id = product.get("id")
        if not isinstance(product_id, str):
            raise RuntimeError(f"Stripe product for {plan} has no ID")

        prices = _stripe_list(key, "/v1/prices", {"active": "true", "product": product_id})
        configured_prices = definition["prices"]
        if not isinstance(configured_prices, dict):
            raise RuntimeError(f"Invalid local price definition for {plan}")
        for interval, amount in configured_prices.items():
            price = next(
                (
                    item
                    for item in prices
                    if item.get("currency") == "gbp"
                    and item.get("unit_amount") == amount
                    and isinstance(item.get("recurring"), dict)
                    and item["recurring"].get("interval") == interval
                ),
                None,
            )
            if price is None:
                price = stripe_request(
                    key,
                    "POST",
                    "/v1/prices",
                    {
                        "product": product_id,
                        "currency": "gbp",
                        "unit_amount": str(amount),
                        "recurring[interval]": interval,
                        "nickname": f"{definition['name']} {interval} v1",
                        "lookup_key": f"selectadj_{plan}_{interval}_v1",
                        "metadata[selecta_plan]": plan,
                        "metadata[plan_version]": "1",
                        "metadata[environment]": "staging",
                    },
                    idempotency_key=f"selectadj-staging-price-{plan}-{interval}-v1",
                )
                prices.append(price)
                print(f"Created Stripe test price: {plan} {interval} GBP {amount / 100:.2f}")
            else:
                print(f"Reused Stripe test price: {plan} {interval} GBP {amount / 100:.2f}")
            price_id = price.get("id")
            if not isinstance(price_id, str):
                raise RuntimeError(f"Stripe price for {plan}/{interval} has no ID")
            price_map[price_id] = {"plan": plan, "version": 1, "interval": interval}

    values["SELECTA_STRIPE_PRICES"] = json.dumps(price_map, separators=(",", ":"), sort_keys=True)
    save_values("staging", values)
    print("Saved four Stripe test prices to the encrypted staging vault.")
    return price_map


def provision_stripe_business_test_catalog() -> dict[str, dict[str, object]]:
    """Create/reuse the accepted GBP business catalogue and save its staging map."""
    values = load_values("staging")
    key = values.get("SELECTA_STRIPE_SECRET_KEY", "")
    if not key.startswith("sk_test_"):
        raise ValueError("staging vault needs a Stripe sk_test_ key; live keys are refused")

    products = _stripe_list(key, "/v1/products", {"active": "true"})
    price_map: dict[str, dict[str, object]] = {}
    for item, definition in STRIPE_BUSINESS_TEST_CATALOG.items():
        product = next(
            (
                candidate
                for candidate in products
                if isinstance(candidate.get("metadata"), dict)
                and candidate["metadata"].get("selecta_business_item") == item
                and candidate["metadata"].get("plan_version") == "1"
            ),
            None,
        )
        if product is None:
            product = stripe_request(
                key,
                "POST",
                "/v1/products",
                {
                    "name": str(definition["name"]),
                    "description": "SelectaDJ for Business quantity subscription item",
                    "metadata[selecta_business_item]": item,
                    "metadata[plan_version]": "1",
                    "metadata[environment]": "staging",
                },
                idempotency_key=f"selectadj-staging-product-{item}-v1",
            )
            products.append(product)
            print(f"Created Stripe test product: {definition['name']}")
        else:
            print(f"Reused Stripe test product: {definition['name']}")
        product_id = product.get("id")
        if not isinstance(product_id, str):
            raise RuntimeError(f"Stripe business product for {item} has no ID")

        prices = _stripe_list(key, "/v1/prices", {"active": "true", "product": product_id})
        configured_prices = definition["prices"]
        if not isinstance(configured_prices, dict):
            raise RuntimeError(f"Invalid local business price definition for {item}")
        for interval, amount in configured_prices.items():
            price = next(
                (
                    candidate
                    for candidate in prices
                    if candidate.get("currency") == "gbp"
                    and candidate.get("unit_amount") == amount
                    and isinstance(candidate.get("recurring"), dict)
                    and candidate["recurring"].get("interval") == interval
                ),
                None,
            )
            if price is None:
                price = stripe_request(
                    key,
                    "POST",
                    "/v1/prices",
                    {
                        "product": product_id,
                        "currency": "gbp",
                        "unit_amount": str(amount),
                        "recurring[interval]": interval,
                        "nickname": f"{definition['name']} {interval} v1",
                        "lookup_key": f"selectadj_{item}_{interval}_gbp_v1",
                        "metadata[selecta_business_item]": item,
                        "metadata[plan_version]": "1",
                        "metadata[environment]": "staging",
                    },
                    idempotency_key=f"selectadj-staging-price-{item}-{interval}-gbp-v1",
                )
                prices.append(price)
                print(f"Created Stripe test price: {item} {interval} GBP {amount / 100:.2f}")
            else:
                print(f"Reused Stripe test price: {item} {interval} GBP {amount / 100:.2f}")
            price_id = price.get("id")
            if not isinstance(price_id, str):
                raise RuntimeError(f"Stripe price for {item}/{interval} has no ID")
            price_map[price_id] = {
                "item": item,
                "version": 1,
                "currency": "GBP",
                "interval": interval,
            }

    try:
        stripe_request(key, "GET", "/v1/coupons/selectadj_business_volume_10")
        print("Reused Stripe test coupon: 10% business volume discount")
    except RuntimeError as exc:
        if "HTTP 404" not in str(exc):
            raise
        stripe_request(
            key,
            "POST",
            "/v1/coupons",
            {
                "id": "selectadj_business_volume_10",
                "name": "SelectaDJ Business 10-24 venue discount",
                "percent_off": "10",
                "duration": "forever",
                "metadata[environment]": "staging",
            },
            idempotency_key="selectadj-staging-business-volume-10-v1",
        )
        print("Created Stripe test coupon: 10% business volume discount")

    values["SELECTA_BUSINESS_STRIPE_PRICES"] = json.dumps(
        price_map, separators=(",", ":"), sort_keys=True
    )
    save_values("staging", values)
    print("Saved six GBP Stripe business test prices to the encrypted staging vault.")
    return price_map


def audit_stripe_test_webhook() -> bool:
    """Check the staging destination without changing or revealing its signing secret."""
    values = load_values("staging")
    key = values.get("SELECTA_STRIPE_SECRET_KEY", "")
    if not key.startswith("sk_test_"):
        raise ValueError("staging vault needs a Stripe sk_test_ key; live keys are refused")
    expected_url = (
        values.get("SELECTA_API_URL", "https://api.staging.selectadj.app").rstrip("/")
        + "/api/webhooks/stripe"
    )
    endpoints = _stripe_list(key, "/v1/webhook_endpoints", {})
    endpoint = next((item for item in endpoints if item.get("url") == expected_url), None)
    if endpoint is None:
        print(f"Stripe test webhook is missing for {expected_url}")
        return False
    enabled = endpoint.get("enabled_events")
    enabled_set = set(enabled) if isinstance(enabled, list) else set()
    missing = sorted(STRIPE_REQUIRED_WEBHOOK_EVENTS - enabled_set)
    status = endpoint.get("status")
    print(f"Stripe test webhook found; status={status}; URL is correct.")
    if missing:
        print("Missing webhook events: " + ", ".join(missing))
        return False
    print("All required Stripe webhook events are enabled.")
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--environment", "-e", choices=("staging", "production"), default="staging")
    parser.add_argument("--update", action="store_true", help="include already configured settings")
    parser.add_argument("--group", help="only visit one exact group name")
    parser.add_argument(
        "--status", action="store_true", help="show counts without revealing values"
    )
    parser.add_argument(
        "--checklist", action="store_true", help="show what is missing and exactly where to get it"
    )
    parser.add_argument(
        "--all", action="store_true", help="with --checklist, include configured names too"
    )
    parser.add_argument("--unset", metavar="NAME", help="remove one stored setting")
    parser.add_argument(
        "--export-env", type=Path, metavar="PATH", help="explicitly export a plaintext .env"
    )
    parser.add_argument(
        "--sync-github", action="store_true", help="set the three non-secret GitHub variables"
    )
    parser.add_argument(
        "--set-domain",
        metavar="DOMAIN",
        help="populate derived URLs/hosts in both staging and production vaults",
    )
    parser.add_argument(
        "--fill-known",
        action="store_true",
        help="fill deterministic defaults and generate missing internal secrets in both vaults",
    )
    parser.add_argument("--email-provider", help="provider to save with --fill-known")
    parser.add_argument("--email-from", help="verified sender to save with --fill-known")
    parser.add_argument(
        "--provision-stripe-test",
        action="store_true",
        help="create/reuse the ADR v1 Stripe test catalogue and save its price map",
    )
    parser.add_argument(
        "--provision-stripe-business-test",
        action="store_true",
        help="create/reuse the GBP business test catalogue and save its price map",
    )
    parser.add_argument(
        "--audit-stripe-webhook",
        action="store_true",
        help="check the staging Stripe destination URL and required events",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.set_domain:
            apply_domain(args.set_domain)
            return 0
        if args.fill_known:
            fill_known_values(args.email_provider, args.email_from)
            return 0
        if args.provision_stripe_test:
            provision_stripe_test_catalog()
            return 0
        if args.provision_stripe_business_test:
            provision_stripe_business_test_catalog()
            return 0
        if args.audit_stripe_webhook:
            return 0 if audit_stripe_test_webhook() else 1
        values = load_values(args.environment)
        if args.unset:
            if args.unset not in values:
                print(f"{args.unset} is not configured for {args.environment}.")
                return 1
            del values[args.unset]
            save_values(args.environment, values)
            print(f"Removed {args.unset} from {args.environment}.")
            return 0
        if args.status:
            status(args.environment, values)
            return 0
        if args.checklist:
            checklist(args.environment, values, include_configured=args.all)
            return 0
        if args.export_env:
            export_env(args.export_env.resolve(), values)
            return 0
        if args.sync_github:
            sync_github(args.environment, values)
            return 0
        wizard(args.environment, values, update=args.update, group=args.group)
        status(args.environment, values)
        return 0
    except (OSError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
