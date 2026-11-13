"""Error reporting to Sentry for the API, gateway, maintenance service and workers.

docs/saas/13-hosting-and-cost.md names Sentry for errors; traces and metrics stay with
OpenTelemetry (`tracing`, `metrics`), so Sentry sends errors only, never performance data.

It is off unless `SELECTA_SENTRY_DSN` is set, the `cloud.error_reporting` flag is on and the
`observability` extra (which brings `sentry-sdk`) is installed. Setting it up never fails a
service start.

Nothing private leaves the process (docs/saas/launch-operator-checklist.md section 9): no request
bodies (so no audio), cookies, headers or local variables are attached, and every string in an
event or breadcrumb goes through `scrub_text`, which removes email addresses, bearer tokens,
JWTs, provider secrets and the whole query string of any URL (signed R2 links carry their
signature there). Values under keys that name a secret are replaced outright (`scrub`).
"""

from __future__ import annotations

import logging
import os
import re
from collections.abc import Mapping
from typing import Any

from selecta import flags

FLAG = "cloud.error_reporting"
DSN_ENV = "SELECTA_SENTRY_DSN"
SCRUBBED = "[scrubbed]"

log = logging.getLogger(__name__)

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_BEARER = re.compile(r"(?i)\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*")
_SECRET = re.compile(r"\b(?:sk|rk|pk|whsec|sk_org|rt)_[A-Za-z0-9_]{8,}")
_URL_QUERY = re.compile(r"(?i)\b((?:https?|wss?)://[^\s?#\"'<>]+)\?[^\s#\"'<>]*")
_SIGNED_PARAM = re.compile(
    r"(?i)\b(x-amz-(?:signature|credential|security-token)|signature|sig|token|access_token|"
    r"refresh_token|code|key|expires)=[^&\s\"'<>]+"
)
_SECRET_KEY = re.compile(
    r"(?i)(authori[sz]ation|cookie|token|secret|password|passwd|dsn|api[_-]?key|signature|"
    r"credential|session|email|e-mail|pepper|private)"
)


def scrub_text(text: str) -> str:
    """`text` with emails, tokens, secrets and URL query strings removed."""
    text = _URL_QUERY.sub(lambda match: f"{match.group(1)}?{SCRUBBED}", text)
    text = _SIGNED_PARAM.sub(lambda match: f"{match.group(1)}={SCRUBBED}", text)
    text = _JWT.sub(SCRUBBED, text)
    text = _BEARER.sub(lambda match: f"{match.group(1)} {SCRUBBED}", text)
    text = _SECRET.sub(SCRUBBED, text)
    return _EMAIL.sub("[email]", text)


def scrub(value: Any, key: str = "") -> Any:
    """A copy of `value` with every string scrubbed and every value under a secret-looking key
    replaced. Works on any JSON-like structure (a Sentry event, a breadcrumb)."""
    if key and _SECRET_KEY.search(key) and value not in (None, "", [], {}):
        return SCRUBBED
    if isinstance(value, str):
        return scrub_text(value)
    if isinstance(value, Mapping):
        return {name: scrub(item, str(name)) for name, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub(item) for item in value]
    return value


def scrub_event(event: dict[str, Any], hint: Any = None) -> dict[str, Any]:
    """Sentry's `before_send`: drop what may hold private data, then scrub the rest."""
    request = event.get("request")
    if isinstance(request, dict):
        for field in ("data", "cookies", "headers", "env", "query_string"):
            request.pop(field, None)
    user = event.get("user")
    if isinstance(user, dict):
        event["user"] = {"id": user["id"]} if user.get("id") else {}
    for frame_holder in _frames(event):
        frame_holder.pop("vars", None)
    return scrub(event)


def scrub_breadcrumb(crumb: dict[str, Any], hint: Any = None) -> dict[str, Any]:
    return scrub(crumb)


def _frames(event: dict[str, Any]):
    for exception in (event.get("exception") or {}).get("values") or []:
        yield from ((exception.get("stacktrace") or {}).get("frames") or [])
    for thread in (event.get("threads") or {}).get("values") or []:
        yield from ((thread.get("stacktrace") or {}).get("frames") or [])


def enabled() -> bool:
    try:
        return flags.on(FLAG)
    except KeyError:
        return False


def options(service: str, env: Mapping[str, str]) -> dict[str, Any] | None:
    """The `sentry_sdk.init` arguments for this service, or None when reporting is off."""
    dsn = env.get(DSN_ENV, "").strip()
    if not dsn or not enabled():
        return None
    return {
        "dsn": dsn,
        "environment": env.get("SELECTA_ENV", "").strip() or "production",
        "server_name": service,
        "send_default_pii": False,
        "max_request_body_size": "never",
        "include_local_variables": False,
        "attach_stacktrace": False,
        "traces_sample_rate": 0.0,
        "before_send": scrub_event,
        "before_breadcrumb": scrub_breadcrumb,
    }


def configure_from_environment(service: str, env: Mapping[str, str] | None = None) -> bool:
    """Report errors to Sentry when the deployment asks for it. Returns whether it did."""
    settings = options(service, os.environ if env is None else env)
    if settings is None:
        return False
    try:
        import sentry_sdk
    except ImportError:
        log.warning("%s is set but the 'observability' extra isn't installed.", DSN_ENV)
        return False
    try:
        sentry_sdk.init(**settings)
        sentry_sdk.set_tag("service", service)
    except Exception:  # a bad DSN must not stop the service
        log.exception("Sentry error reporting could not start; carrying on without it.")
        return False
    return True


__all__ = [
    "DSN_ENV",
    "FLAG",
    "configure_from_environment",
    "options",
    "scrub",
    "scrub_breadcrumb",
    "scrub_event",
    "scrub_text",
]
