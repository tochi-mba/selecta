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
import importlib.util
import json
import os
import secrets
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

_CATALOG_SPEC = importlib.util.spec_from_file_location(
    "setup_cloud_catalog", Path(__file__).with_name("setup_cloud_catalog.py")
)
assert _CATALOG_SPEC and _CATALOG_SPEC.loader
_catalog = importlib.util.module_from_spec(_CATALOG_SPEC)
sys.modules[_CATALOG_SPEC.name] = _catalog
_CATALOG_SPEC.loader.exec_module(_catalog)
BY_NAME = _catalog.BY_NAME
FIELD_GUIDES = _catalog.FIELD_GUIDES
SETTINGS = _catalog.SETTINGS
SETUP_GUIDES = _catalog.SETUP_GUIDES
STRIPE_BUSINESS_TEST_CATALOG = _catalog.STRIPE_BUSINESS_TEST_CATALOG
STRIPE_REQUIRED_WEBHOOK_EVENTS = _catalog.STRIPE_REQUIRED_WEBHOOK_EVENTS
STRIPE_TEST_CATALOG = _catalog.STRIPE_TEST_CATALOG
Setting = _catalog.Setting


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
