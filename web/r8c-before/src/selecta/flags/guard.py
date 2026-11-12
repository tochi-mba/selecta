"""The server's side of feature flags: a request to a route whose feature is off is refused.

Each route belongs to one flag in the registry. The refusal is a 403 with the code `flag_off`
and the flag's id, never a 404: the site reads a 404 as "this server is older than me", which
is a different thing to say.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.routing import Match

from selecta import flags


def owner_of(app: FastAPI, scope: dict) -> str | None:
    """The flag that owns the route this request is for, matched on the route's template so
    `/api/memory` and `/api/lucy/memory` can't be mistaken for each other."""
    owners = flags.route_owners()
    for route in app.router.routes:
        if not isinstance(route, APIRoute):
            continue
        match, _ = route.matches(scope)
        if match is Match.FULL:
            method = scope["method"]
            owner = owners.get(f"{method} {route.path}")
            if owner is None and method == "HEAD":
                owner = owners.get(f"GET {route.path}")
            return owner
    return None


def refusal(flag_id: str) -> JSONResponse:
    flag = flags.registry()[flag_id]
    return JSONResponse(
        {
            "detail": f"{flag.label} is turned off in this build.",
            "code": "flag_off",
            "flag": flag_id,
        },
        status_code=403,
    )


def unowned_api_routes(app: FastAPI) -> list[str]:
    """Return mounted API method/path pairs that have no registry owner."""
    owners = flags.route_owners()
    missing: set[str] = set()
    for route in app.router.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/"):
            continue
        for method in route.methods or ():
            owner_key = f"{'GET' if method == 'HEAD' else method} {route.path}"
            if owner_key not in owners:
                missing.add(owner_key)
    return sorted(missing)


def assert_cloud_api_routes_owned(app: FastAPI) -> None:
    """Fail Cloud app construction if any mounted customer API route lacks a flag owner."""
    missing = unowned_api_routes(app)
    if missing:
        raise RuntimeError("Cloud API routes need feature-flag owners: " + ", ".join(missing))


def install(app: FastAPI, *, strict: bool = False) -> None:
    """Add the route check. Local mode retains the historical permissive coverage behavior;
    Cloud sets strict mode so a mounted, unowned API route fails closed before its handler runs."""

    @app.middleware("http")
    async def feature_flags(request, call_next):
        if request.url.path.startswith("/api/"):
            flag_id = owner_of(request.app, request.scope)
            if flag_id is None and strict:
                matched_api_route = any(
                    isinstance(route, APIRoute)
                    and route.path.startswith("/api/")
                    and route.matches(request.scope)[0] is Match.FULL
                    for route in request.app.router.routes
                )
                if matched_api_route:
                    return JSONResponse(
                        {
                            "code": "feature_flag_owner_missing",
                            "detail": "This Cloud route has no feature-flag owner.",
                        },
                        status_code=500,
                    )
            if flag_id is not None and not flags.on(flag_id):
                return refusal(flag_id)
        return await call_next(request)


__all__ = [
    "assert_cloud_api_routes_owned",
    "install",
    "owner_of",
    "refusal",
    "unowned_api_routes",
]
