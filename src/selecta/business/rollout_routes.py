"""Business pricing and release-gate routes (ADR-0441 BZ-0441-05 and -09, ADR-0454 BZ-0454-13/14).

- `GET /api/business/pricing?currency=GBP`: the per-venue price ex VAT, extra zones and seats,
  annual prices, the volume tier, the Enterprise threshold and the trial, from
  `plan_catalogue.pricing_view`. Selling is a flag: the build guard refuses it while
  `business.signups` is off, and `cloud_gate` refuses an account the targeting rules do not
  reach (a named pilot only, until Gate S). Catalogue figures only, nothing per workspace.
- `GET /api/admin/business/rollout`: staff only (`flags.read`), read-only. The phase the records
  allow, Gate P and Gate S verdicts with every reason, the selling prerequisites and whether the
  current `business.signups` rules would be refused (`business.rollout.report`).

No `from __future__ import annotations` here: FastAPI must resolve the local `SignedIn` alias.
"""

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Request
from sqlalchemy.engine import Connection, Engine

from selecta.admin import http
from selecta.authz.check import Actor, authorize
from selecta.business import plan_catalogue, rollout
from selecta.flags import cloud_gate
from selecta.flags.rules import RulesCache
from selecta.identity.tokens import Claims
from selecta.persistence import transaction


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    rules: RulesCache,
) -> None:
    SignedIn = Annotated[Claims, Depends(current_claims)]

    @app.get("/api/business/pricing")
    def business_pricing(request: Request, claims: SignedIn, currency: str = "GBP"):
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        with transaction(engine, found.workspace.id) as conn:
            cloud_gate.require(conn, found, rollout.SIGNUPS, rules)
        try:
            return {"pricing": plan_catalogue.pricing_view(currency)}
        except ValueError as error:
            raise HTTPException(
                400, detail={"code": "bad_currency", "message": "Use GBP, USD or EUR."}
            ) from error

    @app.get("/api/admin/business/rollout")
    def admin_business_rollout(request: Request, claims: SignedIn):
        actor = http.staff_actor(engine, request, claims)

        def read(conn: Connection, who: Actor) -> dict[str, Any]:
            authorize(conn, who, "flags.read")
            return rollout.report(conn)

        return {"rollout": http.run(engine, actor, lambda conn: read(conn, actor))}


__all__ = ["install_routes"]
