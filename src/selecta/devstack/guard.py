"""The rule that keeps the local Cloud stack on a developer's machine.

`require_development()` refuses to start anything in `selecta.devstack` unless all of these hold:

- `SELECTA_ENV` is exactly `development` (the launcher sets it; staging and production never do);
- it binds to a loopback address only, so nobody else on the network can reach it;
- no live payment key is present (`sk_live_...` / `rk_live_...`);
- no real WorkOS API key is present: the local provider uses its own made-up key.

The other half lives in the production settings: `api_cloud.CloudSettings.from_environment`
refuses `SELECTA_LOCAL_IDENTITY` and any identity address on plain HTTP or a loopback host, so a
deployment can't be pointed at the local identity provider either. `tests/test_devstack_guard.py`
holds both halves.
"""

from __future__ import annotations

import ipaddress
import os
from collections.abc import Mapping

DEVELOPMENT = "development"
LOCAL_IDENTITY_ENV = "SELECTA_LOCAL_IDENTITY"
LOCAL_WORKOS_KEY = "sk_dev_local_identity"
LOOPBACK_NAMES = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})


class DevOnlyError(RuntimeError):
    """The local Cloud stack was asked to run somewhere that isn't a developer's machine."""


def is_loopback(host: str) -> bool:
    name = (host or "").strip().lower()
    if name in LOOPBACK_NAMES or name.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(name.strip("[]")).is_loopback
    except ValueError:
        return False


def problems(environ: Mapping[str, str] | None = None, *, host: str = "127.0.0.1") -> list[str]:
    """Every reason this environment must not run the local stack (empty when it may)."""
    env = os.environ if environ is None else environ
    found: list[str] = []
    stage = env.get("SELECTA_ENV", "").strip().lower()
    if stage != DEVELOPMENT:
        found.append(
            f"SELECTA_ENV is {stage or 'unset'!r}; the local Cloud stack runs only with "
            "SELECTA_ENV=development (dev.cmd cloud sets it)."
        )
    if not is_loopback(host):
        found.append(f"It may listen on this machine only (127.0.0.1), not on {host!r}.")
    for name in ("SELECTA_STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY", "STRIPE_API_KEY"):
        if env.get(name, "").strip().startswith(("sk_live_", "rk_live_")):
            found.append(f"{name} is a live Stripe key; use a test key (sk_test_) or none.")
    workos_key = env.get("SELECTA_WORKOS_API_KEY", "").strip()
    if workos_key and workos_key != LOCAL_WORKOS_KEY:
        found.append(
            "SELECTA_WORKOS_API_KEY holds a real WorkOS key; unset it, the local identity "
            "provider needs none."
        )
    return found


def require_development(environ: Mapping[str, str] | None = None, *, host: str = "127.0.0.1"):
    """Raise `DevOnlyError` naming every problem, or return quietly."""
    found = problems(environ, host=host)
    if found:
        raise DevOnlyError(
            "Refusing to start the local SelectaDJ Cloud stack: " + " ".join(found)
        )


def production_identity_problem(environ: Mapping[str, str] | None = None) -> str | None:
    """Why production settings must refuse this environment's identity setup, or None.

    Called by `api_cloud.CloudSettings.from_environment`, which every deployment uses.
    """
    env = os.environ if environ is None else environ
    if env.get(LOCAL_IDENTITY_ENV, "").strip():
        return (
            f"{LOCAL_IDENTITY_ENV} is set: the local identity provider is for dev.cmd cloud "
            "only and can't run in a deployment. Unset it and configure WorkOS AuthKit."
        )
    if env.get("SELECTA_WORKOS_API_KEY", "").strip() == LOCAL_WORKOS_KEY:
        return "SELECTA_WORKOS_API_KEY is the local identity provider's made-up key."
    for name in ("SELECTA_AUTH_ISSUER", "SELECTA_WORKOS_API_BASE"):
        value = env.get(name, "").strip().lower()
        if not value:
            continue
        host = value.split("://", 1)[-1].split("/", 1)[0].rsplit(":", 1)[0]
        if value.startswith("http://") or is_loopback(host):
            return f"{name} points at {value!r}; production identity must be HTTPS and hosted."
    return None


__all__ = [
    "DEVELOPMENT",
    "DevOnlyError",
    "LOCAL_IDENTITY_ENV",
    "LOCAL_WORKOS_KEY",
    "is_loopback",
    "problems",
    "production_identity_problem",
    "require_development",
]
