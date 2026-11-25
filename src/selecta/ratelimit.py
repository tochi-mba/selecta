"""The Cloud API's own rate limits: per account and per IP, with stricter buckets for the routes an
abuser would hammer (docs/saas/12-security-privacy-legal.md §12.1, product audit area H).

**In memory, per process, on purpose.** A database row per request would add a write and a lock
to every call the API answers, doubling database load to stop the rare abuser. These buckets
cost a dictionary lookup. The price is that each API process counts on its own: with N processes
behind the load balancer a caller can reach N times each limit. The limits below are set so that
even at N = 4 they stay far below what hurts the service, and Cloudflare's WAF rules in front of
the API (an owner setting) cap the total. A process restart forgets the counts, which only ever
lets a caller through sooner.

**Who is counted.** Every `/api/` request counts against its IP (the address in the header named
by `SELECTA_CLIENT_IP_HEADER`, such as `cf-connecting-ip`, else the socket's). A request with a
bearer token also counts against the account named in the token, but only once the request was
not refused as unauthenticated: a forged token naming someone else is refused with 401 before it
costs that person anything, so nobody can empty another account's bucket.

**What is left out.** Health checks, signed webhooks, and the guest, display, kiosk and venue room
routes, which have their own per-guest and per-device limits (`rooms/`, `business/rooms/`).

A refused request gets 429, `Retry-After` in whole seconds, and the code `rate_limited` with
plain words. The flag is `cloud.rate_limits`; off, nothing is counted.
"""

from __future__ import annotations

import base64
import json
import math
import os
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

FLAG = "cloud.rate_limits"
CLIENT_IP_HEADER = "SELECTA_CLIENT_IP_HEADER"
MAX_KEYS = 100_000
"""Buckets kept per process; the least recently used go first, so memory stays bounded."""

EXEMPT = re.compile(
    r"^/api/(status|ready|webhooks/|business/billing/stripe-webhook|guest/|display/|kiosk/"
    r"|venue-rooms/)"
)


@dataclass(frozen=True)
class Rule:
    """`per_minute` requests a minute on average, and up to `burst` at once."""

    name: str
    per_minute: float
    burst: float


# Everyday use: a page load is about ten calls; a playing device heartbeats once a second.
IP = Rule("ip", per_minute=1_200, burst=300)
ACCOUNT = Rule("account", per_minute=600, burst=200)

# Stricter buckets, on top of the two above, per account (per IP when signed out).
STRICT: tuple[tuple[re.Pattern[str], str | None, Rule], ...] = (
    (re.compile(r"^/api/billing/(checkout|portal)$"), "POST", Rule("billing", 10, 5)),
    (re.compile(r"^/api/(onboarding/complete|account/sign-out-everywhere)$"), "POST",
     Rule("account_change", 10, 5)),
    (re.compile(r"^/api/account$"), "DELETE", Rule("account_change", 10, 5)),
    (re.compile(r"^/api/uploads/plan$"), "POST", Rule("upload_plan", 60, 20)),
    # Hosted processing (cloud.hosted_render): planning reads up to 60 analyses from storage
    # and runs the planner, so a few a minute; the mix and export routes are polled every 3 s
    # by the hosted card (HostedMix.tsx POLL_MS), so room for several tabs and no more.
    (re.compile(r"^/api/hosted/mixes/plan$"), "POST", Rule("hosted_plan", 10, 5)),
    (re.compile(r"^/api/hosted/mixes/(render|export)$"), "POST", Rule("hosted_mix", 90, 30)),
    (re.compile(r"^/api/hosted/songs/(prepare|[^/]+/retry)$"), "POST",
     Rule("hosted_prepare", 30, 10)),
    (re.compile(r"/search(/|$)"), None, Rule("search", 120, 30)),
)

WORDS = "That's a lot of requests at once. Wait {seconds} and try again."


class Buckets:
    """Token buckets by key, least recently used dropped past `MAX_KEYS`. Thread safe."""

    def __init__(self, clock: Callable[[], float] = time.monotonic, max_keys: int = MAX_KEYS):
        self._clock = clock
        self._max = max_keys
        self._lock = threading.Lock()
        self._kept: OrderedDict[str, tuple[float, float]] = OrderedDict()

    def _level(self, key: str, rule: Rule, now: float) -> float:
        tokens, at = self._kept.get(key, (rule.burst, now))
        return min(rule.burst, tokens + max(0.0, now - at) * rule.per_minute / 60.0)

    def wait(self, key: str, rule: Rule) -> float:
        """Seconds until one request would be allowed; 0 when it would be now. Takes nothing."""
        with self._lock:
            tokens = self._level(key, rule, self._clock())
        return 0.0 if tokens >= 1.0 else (1.0 - tokens) * 60.0 / rule.per_minute

    def take(self, key: str, rule: Rule) -> float:
        """Take one token: 0 when there was one, else the seconds to wait (nothing taken)."""
        with self._lock:
            now = self._clock()
            tokens = self._level(key, rule, now)
            if tokens < 1.0:
                self._kept[key] = (tokens, now)
                self._kept.move_to_end(key)
                return (1.0 - tokens) * 60.0 / rule.per_minute
            self._kept[key] = (tokens - 1.0, now)
            self._kept.move_to_end(key)
            while len(self._kept) > self._max:
                self._kept.popitem(last=False)
            return 0.0

    def charge(self, key: str, rule: Rule) -> None:
        """Take one token after the request was answered (never below zero)."""
        with self._lock:
            now = self._clock()
            self._kept[key] = (max(0.0, self._level(key, rule, now) - 1.0), now)
            self._kept.move_to_end(key)
            while len(self._kept) > self._max:
                self._kept.popitem(last=False)


def client_ip(request: Request) -> str:
    header = os.environ.get(CLIENT_IP_HEADER, "").strip().lower()
    if header:
        value = request.headers.get(header, "").split(",")[0].strip()
        if value:
            return value
    return request.client.host if request.client else "unknown"


def claimed_subject(request: Request) -> str | None:
    """The `sub` a bearer token names, read without checking it: used only to find a bucket,
    and charged only after the request passed sign-in (see the module notes)."""
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    parts = token.strip().split(".")
    if scheme.lower() != "bearer" or len(parts) != 3:
        return None
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        subject = json.loads(base64.urlsafe_b64decode(padded)).get("sub")
    except (ValueError, TypeError, AttributeError):
        return None
    return str(subject)[:200] if subject else None


def _strict(path: str, method: str) -> Rule | None:
    for pattern, wanted, rule in STRICT:
        if (wanted is None or wanted == method) and pattern.search(path):
            return rule
    return None


def refused(seconds: float) -> JSONResponse:
    whole = max(1, math.ceil(seconds))
    said = f"{whole} second{'s' if whole != 1 else ''}"
    return JSONResponse(
        {"detail": {"code": "rate_limited", "message": WORDS.format(seconds=said),
                    "retry_after_s": whole}},
        status_code=429,
        headers={"Retry-After": str(whole)},
    )


def install(app: FastAPI, on: Callable[[], bool] | None = None,
            buckets: Buckets | None = None) -> Buckets:
    """Add the limits to the Cloud app. Returns the buckets, for tests."""
    kept = buckets or Buckets()
    app.state.rate_limits = kept

    def enabled() -> bool:
        if on is not None:
            return on()
        from selecta import flags

        try:
            return flags.on(FLAG)
        except KeyError:
            return False

    @app.middleware("http")
    async def rate_limits(request: Request, call_next):
        path, method = request.url.path, request.method
        if not path.startswith("/api/") or method == "OPTIONS" or EXEMPT.match(path):
            return await call_next(request)
        if not enabled():
            return await call_next(request)
        ip_key = f"ip:{client_ip(request)}"
        subject = claimed_subject(request)
        account_key = f"acct:{subject}" if subject else None
        strict = _strict(path, method)
        strict_key = f"{strict.name}:{account_key or ip_key}" if strict else None
        # Peek first: an account or strict bucket that is already empty refuses at once.
        waits = [kept.wait(account_key, ACCOUNT) if account_key else 0.0,
                 kept.wait(strict_key, strict) if strict and strict_key else 0.0]
        waits.append(kept.take(ip_key, IP))
        if max(waits) > 0:
            from selecta.observability import metrics

            names = ["account", strict.name if strict else "strict", "ip"]
            metrics.add("selecta_rate_limited_total", bucket=names[waits.index(max(waits))])
            return refused(max(waits))
        response = await call_next(request)
        if response.status_code != 401:
            if account_key:
                kept.charge(account_key, ACCOUNT)
            if strict and strict_key:
                kept.charge(strict_key, strict)
        return response

    return kept


MAX_BODY_BYTES = 8 * 1024 * 1024
"""The largest request body the Cloud API reads. Music goes straight to storage by signed URL, so
the biggest API body is a library catalogue of a 20,000-song library, well under this."""
TOO_LARGE = "That is too much to send at once. Try a smaller part, or contact support."


class BodyLimit:
    """Refuse a body over `MAX_BODY_BYTES` with 413, by its Content-Length or, when it has none,
    by counting what arrives, so a field with no length limit of its own still has one."""

    def __init__(self, app, limit: int = MAX_BODY_BYTES) -> None:
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api/"):
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        length = headers.get(b"content-length", b"").decode() or None
        if length is not None and (not length.isdigit() or int(length) > self.limit):
            await self._refuse(scope, receive, send)
            return
        seen = 0

        async def counted():
            nonlocal seen
            message = await receive()
            if message.get("type") == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.limit:
                    raise _TooLarge
            return message

        try:
            await self.app(scope, counted, send)
        except _TooLarge:
            await self._refuse(scope, receive, send)

    @staticmethod
    async def _refuse(scope, receive, send) -> None:
        await JSONResponse(
            {"detail": {"code": "request_too_large", "message": TOO_LARGE}}, status_code=413
        )(scope, receive, send)


class _TooLarge(Exception):
    pass


def install_guards(app: FastAPI) -> Buckets:
    """The request guards that run before any route: keyed writes are replayed
    (`replay.middleware`, inner), the rate limits run first (outer), so a flood costs nothing
    more than a dictionary lookup, and no body over `MAX_BODY_BYTES` is read at all."""
    from selecta.replay import middleware as replay

    replay.install(app)
    kept = install(app)
    app.add_middleware(BodyLimit)
    return kept


__all__ = [
    "ACCOUNT", "EXEMPT", "FLAG", "IP", "STRICT", "Buckets", "Rule", "install", "install_guards",
    "refused",
]
