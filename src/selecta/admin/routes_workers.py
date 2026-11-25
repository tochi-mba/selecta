"""Routes for the console's Workers page (doc 07b §7B.4): hosted processing status and actions.

All belong to the `admin.workers` flag (which needs `admin.console`): with it off they answer
`flag_off` and the console hides the page. Reads need `jobs.read`; each action names its own
permission and tier (`admin.tiers`, `admin.hosted_ops`). Writes go through the console's view-mode
middleware like every other admin write.

No `from __future__ import annotations` here: FastAPI must resolve the local `SignedIn` alias.
"""

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Query, Request
from pydantic import Field
from sqlalchemy.engine import Connection, Engine

from selecta.admin import actions, hosted_ops, hosted_status, http
from selecta.admin.routes_console import Guarded
from selecta.admin.state import EmergencyCache
from selecta.authz.check import Actor
from selecta.identity.tokens import Claims


class RetryBody(Guarded):
    type: str = Field(min_length=1, max_length=64)


class ExpireBody(Guarded):
    hours: float = Field(ge=1, le=720)
    pool: str | None = Field(default=None, max_length=32)


class BudgetBody(Guarded):
    monthly_usd: float | None = Field(default=None, ge=0, le=1_000_000)
    warn_percent: int = Field(default=80, ge=10, le=100)


def install_routes(app: FastAPI, *, engine: Engine, current_claims: Callable[..., Claims],
                   emergency: EmergencyCache | None = None) -> None:
    SignedIn = Annotated[Claims, Depends(current_claims)]

    def run(request: Request, claims: Claims, command: Callable[[Connection, Actor], Any]) -> Any:
        actor = http.staff_actor(engine, request, claims)
        return http.run(engine, actor, lambda conn: command(conn, actor))

    @app.get("/api/admin/hosted/status")
    def admin_hosted_status(request: Request, claims: SignedIn):
        return run(request, claims, hosted_status.status)

    @app.get("/api/admin/hosted/preview")
    def admin_hosted_preview(request: Request, claims: SignedIn,
                             kind: str = Query(default="", max_length=32),
                             type: str | None = Query(default=None, max_length=64),  # noqa: A002
                             hours: float | None = None,
                             pool: str | None = Query(default=None, max_length=32)):
        return run(request, claims, lambda conn, actor: hosted_ops.preview(
            conn, actor, kind=kind, job_type=type, hours=hours, pool=pool))

    @app.post("/api/admin/hosted/jobs/retry-failed")
    def admin_hosted_retry(body: RetryBody, request: Request, claims: SignedIn):
        return run(request, claims, lambda conn, actor: hosted_ops.retry_failed(
            conn, actor, body.type, reason=body.reason, intent=body.intent()))

    @app.post("/api/admin/hosted/jobs/expire-queued", status_code=202)
    def admin_hosted_expire(body: ExpireBody, request: Request, claims: SignedIn):
        action = run(request, claims, lambda conn, actor: hosted_ops.propose_expire(
            conn, actor, hours=body.hours, pool=body.pool or None, reason=body.reason,
            intent=body.intent()))
        return {"action": actions.action_json(action)}

    @app.post("/api/admin/hosted/pools/{pool}/{command}")
    def admin_hosted_pool(pool: str, command: str, body: Guarded, request: Request,
                          claims: SignedIn):
        def act(conn: Connection, actor: Actor) -> dict:
            if command == "pause":
                return hosted_ops.pause_pool(conn, actor, pool, reason=body.reason,
                                             intent=body.intent())
            if command == "resume":
                return hosted_ops.resume_pool(conn, actor, pool, reason=body.reason,
                                              intent=body.intent())
            return hosted_ops.request_scale(conn, actor, pool, command, reason=body.reason,
                                            intent=body.intent())

        out = run(request, claims, act)
        if emergency is not None and command in ("pause", "resume"):
            emergency.invalidate()
        return out

    @app.put("/api/admin/hosted/budget")
    def admin_hosted_budget(body: BudgetBody, request: Request, claims: SignedIn):
        return run(request, claims, lambda conn, actor: hosted_ops.set_budget(
            conn, actor, monthly_usd=body.monthly_usd or None, warn_percent=body.warn_percent,
            reason=body.reason, intent=body.intent()))


__all__ = ["install_routes"]
