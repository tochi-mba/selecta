#!/usr/bin/env python3
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
        "Open the environment's API service > Environment. Render supplies the pooled Internal "
        "Database URL; host/origin values come from your final DNS plan.",
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
        "Keep test mode enabled for staging. Developers > API keys provides the secret key; "
        "Developers > Webhooks provides each endpoint signing secret. Product catalog provides "
        "price IDs used to build the JSON maps.",
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
