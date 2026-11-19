"""The server side of the business terms gate (ADR-0449 BZ-0449-09), while `business.licensing`
is on.

When the current SelectaDJ business terms are not accepted, every request that changes an
organisation (POST, PUT, PATCH or DELETE under `/api/business/`) is refused with 403
`terms_required` and a message the page shows, until an owner or admin accepts them. Reading
always works, and so does everything that keeps music playing or lets someone accept:

- accepting the terms, and the checkout that records them;
- staff controls at a venue (zone commands, stay open late, close now and its undo, the staff PIN,
  acknowledging an alert) and what players report (speaker segments, cache reports);
- Stripe's webhook, which proves itself by signature.
"""

from __future__ import annotations

import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.engine import Engine
from starlette.concurrency import run_in_threadpool

from selecta import flags
from selecta.persistence import transaction

FLAG = "business.licensing"
CHANGES = frozenset({"POST", "PUT", "PATCH", "DELETE"})
ALWAYS_ALLOWED = tuple(re.compile(p) for p in (
    r"^/api/business/terms/accept$",
    r"^/api/business/billing/checkout(/complete)?$",
    r"^/api/business/billing/stripe-webhook$",
    r"^/api/business/orgs$",
    r"^/api/business/invitations/accept$",
    r"^/api/business/zones/[^/]+/commands$",
    r"^/api/business/zones/[^/]+/speaker/segment-url$",
    r"^/api/business/zones/[^/]+/cache-report$",
    r"^/api/business/venues/[^/]+/stay-open-late$",
    r"^/api/business/venues/[^/]+/close-now(/[^/]+/undo)?$",
    r"^/api/business/venues/[^/]+/pin$",
    r"^/api/business/zone-alerts/[^/]+/acknowledge$",
))
MESSAGE = ("The SelectaDJ business terms have changed. An owner or admin needs to accept them "
           "on the Settings page before anything else is changed. Music keeps playing.")


def guarded(method: str, path: str) -> bool:
    """Whether this request changes an organisation and so waits on the terms."""
    return (method in CHANGES and path.startswith("/api/business/")
            and not any(p.match(path) for p in ALWAYS_ALLOWED))


def needs_terms(engine: Engine, workspace_id: str) -> bool:
    from selecta.business import terms
    from selecta.business.upload_rights import is_business

    with transaction(engine, workspace_id) as conn:
        return is_business(conn, workspace_id) and terms.needs_acceptance(conn, workspace_id)


def install(app: FastAPI, *, engine: Engine) -> None:
    @app.middleware("http")
    async def business_terms(request: Request, call_next):
        workspace_id = request.headers.get("x-workspace-id")
        if workspace_id and guarded(request.method, request.url.path) and _on():
            try:
                blocked = await run_in_threadpool(needs_terms, engine, workspace_id)
            except Exception:  # noqa: BLE001 - a bad id is the route's own 404 to give
                blocked = False
            if blocked:
                return JSONResponse(status_code=403, content={"detail": {
                    "code": "terms_required", "message": MESSAGE}})
        return await call_next(request)


def _on() -> bool:
    try:
        return flags.on(FLAG)
    except KeyError:
        return False


__all__ = ["ALWAYS_ALLOWED", "MESSAGE", "guarded", "install", "needs_terms"]
