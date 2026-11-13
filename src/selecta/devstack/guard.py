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
import socket
from collections.abc import Mapping
from urllib.parse import urlsplit

DEVELOPMENT = "development"
LOCAL_IDENTITY_ENV = "SELECTA_LOCAL_IDENTITY"
LOCAL_WORKOS_KEY = "sk_dev_local_identity"
LOOPBACK_NAMES = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})


class DevOnlyError(RuntimeError):
    """The local Cloud stack was asked to run somewhere that isn't a developer's machine."""


def _address(name: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    """The IP address `name` spells, including short IPv4 forms such as `127.1`."""
    try:
        return ipaddress.ip_address(name.strip("[]"))
    except ValueError:
        pass
    try:
        return ipaddress.IPv4Address(socket.inet_aton(name))
    except (OSError, ValueError):
        return None


def is_loopback(host: str) -> bool:
    name = (host or "").strip().lower().rstrip(".")
    if name in LOOPBACK_NAMES or name.endswith(".localhost"):
        return True
    address = _address(name)
    return bool(address and address.is_loopback)


def _is_this_machine(host: str) -> bool:
    """Loopback, or an address such as 0.0.0.0 that a client also sends to this machine."""
    address = _address((host or "").strip().lower().rstrip("."))
    return is_loopback(host) or bool(address and address.is_unspecified)


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
        try:
            host = urlsplit(value).hostname or ""
        except ValueError:
            host = ""
        if not value.startswith("https://") or not host or _is_this_machine(host):
            return f"{name} points at {value!r}; production identity must be HTTPS and hosted."
    return None


class LoopbackOnly:
    """ASGI middleware: answer only this machine, whatever address the server was bound to.

    `require_development` checks the address the launcher binds, but a factory run by hand
    (`uvicorn ... --host 0.0.0.0`) never tells the app where it listens. This refuses any
    request from another machine, and any request whose Host isn't a loopback name, so a
    web page can't reach the stack through DNS rebinding either.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] in ("http", "websocket") and not self._local(scope):
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
                return
            await send(
                {
                    "type": "http.response.start",
                    "status": 403,
                    "headers": [(b"content-type", b"text/plain; charset=utf-8")],
                }
            )
            await send(
                {"type": "http.response.body", "body": b"The local SelectaDJ stack answers "
                 b"this computer only."}
            )
            return
        await self.app(scope, receive, send)

    @staticmethod
    def _local(scope) -> bool:
        client = scope.get("client")
        if not client or not is_loopback(str(client[0])):
            return False
        headers = dict(scope.get("headers") or [])
        host = headers.get(b"host", b"").decode("latin-1")
        try:
            name = urlsplit(f"//{host}").hostname or ""
        except ValueError:
            return False
        return is_loopback(name)


__all__ = [
    "DEVELOPMENT",
    "DevOnlyError",
    "LoopbackOnly",
    "LOCAL_IDENTITY_ENV",
    "LOCAL_WORKOS_KEY",
    "is_loopback",
    "problems",
    "production_identity_problem",
    "require_development",
]
