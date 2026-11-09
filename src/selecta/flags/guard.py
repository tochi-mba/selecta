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
            return owners.get(f"{scope['method']} {route.path}")
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


def install(app: FastAPI) -> None:
    """Add the check. `create_app` adds it after the mix-order check and before the local-only
    one, so it runs straight after local-only: a refusal is never stored and replayed under an
    operation id, and never opens the database."""

    @app.middleware("http")
    async def feature_flags(request, call_next):
        if request.url.path.startswith("/api/"):
            flag_id = owner_of(request.app, request.scope)
            if flag_id is not None and not flags.on(flag_id):
                return refusal(flag_id)
        return await call_next(request)
