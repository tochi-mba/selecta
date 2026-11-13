"""The API side of the emergency controls that act on whole requests (§14, `admin.state`).

One middleware, installed by `api_cloud`, answers before a route runs:

- **Read-only app**: every customer request that would change something is refused with 503
  `read_only`. Reads still work, and so do signing out everywhere (a security action), the
  signed webhooks (Stripe and WorkOS must still be heard, so nothing is lost) and the admin
  console (staff need it to recover).
- **Pause uploads**: planning an upload and signing its parts answer 503 `uploads_paused`.
  Finishing an upload whose bytes are already sent still works, so nobody loses a half-done file.
- **Billing safe mode**: checkout and the billing portal answer 503 `billing_safe_mode`. Stripe
  events are still received and stored; `billing.api` and `billing.maintenance` hold them until
  safe mode ends.

The state comes from `EmergencyCache`, so a hot path reads the table at most every two seconds.
Each refusal carries `Retry-After`, since every one of these is temporary.
"""

import re

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from selecta.admin.state import EmergencyCache

READS = frozenset({"GET", "HEAD", "OPTIONS"})
ALWAYS_WRITABLE = (
    re.compile(r"^/api/admin/"),
    re.compile(r"^/api/webhooks/"),
    re.compile(r"^/api/account/sign-out-everywhere$"),
)
UPLOAD_STARTS = (
    re.compile(r"^/api/uploads/plan$"),
    re.compile(r"^/api/uploads/[^/]+/parts$"),
)
BILLING_CHANGES = (
    re.compile(r"^/api/billing/checkout$"),
    re.compile(r"^/api/billing/portal$"),
)


def _refuse(code: str, message: str) -> JSONResponse:
    return JSONResponse(
        {"detail": {"code": code, "message": message}},
        status_code=503,
        headers={"Retry-After": "60"},
    )


def refusal_for(state, method: str, path: str) -> JSONResponse | None:
    """The answer for this request under these controls, or None to let it through."""
    if not path.startswith("/api/") or method in READS:
        return None
    if state.read_only and not any(p.match(path) for p in ALWAYS_WRITABLE):
        return _refuse("read_only", "SelectaDJ is read-only for a short while. Try again soon.")
    if method == "POST" and state.uploads_paused and any(p.match(path) for p in UPLOAD_STARTS):
        return _refuse("uploads_paused", "Uploads are paused for a short while.")
    if method == "POST" and state.billing_safe_mode and any(p.match(path) for p in BILLING_CHANGES):
        return _refuse("billing_safe_mode", "Billing changes are paused for a short while.")
    return None


def install(app: FastAPI, cache: EmergencyCache) -> None:
    @app.middleware("http")
    async def emergency_controls(request, call_next):
        method, path = request.method, request.url.path
        if path.startswith("/api/") and method not in READS:
            answer = refusal_for(cache.state(), method, path)
            if answer is not None:
                return answer
        return await call_next(request)


__all__ = ["install", "refusal_for"]
