"""Admin routes for the Browser-first Cloud unit economics and the step-4 readiness check.

- `GET /api/admin/economics/cost-per-mode?month=YYYY-MM`: the per-mode cost dashboard
  (ADR-0464, BF-0464-05), from `usage.unit_economics`.
- `GET /api/admin/economics/lucy-ceiling?days=30`: the Lucy ceiling re-measurement under the 40%
  rule (BF-0464-04), from `usage.lucy_ceiling`.
- `GET /api/admin/flags/cloud.local_first/percentage-readiness`: whether a percentage rollout of
  `cloud.local_first` would be refused right now and why (BF-0467-04, `flags.flip_guard`).

Same rules as the other admin routes: staff only with a live admin session (`admin.http`), owned
by the `admin.console` flag, read-only, and each read is authorized with
`platform.dashboard.read` (economics) or `flags.read` (readiness). Every read is a system
transaction, so the numbers cover every workspace; the answers carry ids and totals only.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Request
from sqlalchemy.engine import Connection, Engine

from selecta.admin import http
from selecta.authz.check import Actor, authorize
from selecta.flags import flip_guard
from selecta.flags.matching import Rule, RuleKind
from selecta.identity.tokens import Claims
from selecta.persistence import db_now
from selecta.usage import lucy_ceiling, unit_economics

MAX_DAYS = 120


def _month(value: str | None, now: float) -> str:
    if value is None:
        return dt.datetime.fromtimestamp(now, dt.UTC).strftime("%Y-%m")
    try:
        unit_economics.month_bounds(value)
    except ValueError as error:
        raise HTTPException(400, detail={"code": "bad_month", "message": "Use YYYY-MM."}) from error
    return value


def install_routes(
    app: FastAPI, *, engine: Engine, current_claims: Callable[..., Claims]
) -> None:
    SignedIn = Annotated[Claims, Depends(current_claims)]

    def run(request: Request, claims: Claims, command: Callable[[Connection, Actor], Any]) -> Any:
        actor = http.staff_actor(engine, request, claims)
        return http.run(engine, actor, lambda conn: command(conn, actor))

    @app.get("/api/admin/economics/cost-per-mode")
    def admin_cost_per_mode(request: Request, claims: SignedIn, month: str | None = None):
        def read(conn: Connection, actor: Actor) -> dict[str, Any]:
            authorize(conn, actor, "platform.dashboard.read")
            return unit_economics.cost_report(conn, _month(month, db_now(conn)))

        return {"dashboard": run(request, claims, read)}

    @app.get("/api/admin/economics/lucy-ceiling")
    def admin_lucy_ceiling(request: Request, claims: SignedIn, days: int = 30):
        if not 1 <= days <= MAX_DAYS:
            raise HTTPException(400, detail={"code": "bad_days", "message": f"1 to {MAX_DAYS}."})

        def read(conn: Connection, actor: Actor) -> dict[str, Any]:
            authorize(conn, actor, "platform.dashboard.read")
            until = db_now(conn)
            return lucy_ceiling.measure(conn, until - days * 86_400, until)

        return {"report": run(request, claims, read)}

    @app.get("/api/admin/flags/cloud.local_first/percentage-readiness")
    def admin_local_first_percentage_readiness(
        request: Request, claims: SignedIn, percent: float = 1.0
    ):
        """Would raising `cloud.local_first` to a `percent` rollout be refused now? Read-only:
        the same check the flag change path runs, against a hypothetical extra rule."""

        def read(conn: Connection, actor: Actor) -> dict[str, Any]:
            authorize(conn, actor, "flags.read")
            from selecta.flags import rules as rule_store

            current = rule_store.current_rules(conn, flip_guard.LOCAL_FIRST)
            probe = Rule(RuleKind.PERCENTAGE, {"percent": percent, "salt": "readiness-probe"})
            refusals = flip_guard.check_percentage_step_now(conn, (probe, *current))
            return {
                "flag": flip_guard.LOCAL_FIRST,
                "percent": percent,
                "current_percent": flip_guard.highest_percentage(current),
                "ready": not refusals,
                "refusals": refusals,
                "dashboards": {
                    "cost_per_mode": flip_guard.COST_DASHBOARD,
                    "error_rate_per_cohort": flip_guard.ERROR_RATE_VIEW,
                },
            }

        if not 0 < percent <= 100:
            raise HTTPException(400, detail={"code": "bad_percent", "message": "0 to 100."})
        return {"readiness": run(request, claims, read)}


__all__ = ["install_routes"]
