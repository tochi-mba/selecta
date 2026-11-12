"""Admin routes for the emergency controls, the Flags page and copyright takedowns.

Same rules as `admin.routes`: staff only, one audited command per action, owned by the
`admin.console` flag. Engaging an emergency control or changing a flag also refreshes this
process's caches at once, so the change is visible on the next request here; other processes
see it within their cache's age (two seconds for controls, five for flag rules).
"""

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta.admin import actions, emergency, flags_admin, http, takedowns
from selecta.admin import state as emergency_state
from selecta.authz.check import Actor
from selecta.flags.matching import Rule
from selecta.flags.rules import RulesCache
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction


class ControlRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    target: str | None = Field(default=None, max_length=64)


class FlagChange(BaseModel):
    action: str = Field(min_length=1, max_length=32)
    reason: str = Field(default="", max_length=2000)
    params: dict[str, Any] = Field(default_factory=dict)


class Rollback(BaseModel):
    version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=2000)
    before: bool = False
    """Restore what was in effect before `version` (no rules, for a flag's first change)."""


class Preview(BaseModel):
    on: bool
    reason: str = Field(min_length=1, max_length=2000)


class NoticeRequest(BaseModel):
    workspace_id: str = Field(min_length=1, max_length=64)
    asset_id: str = Field(min_length=1, max_length=64)
    complainant: str = Field(min_length=1, max_length=200)
    work: str = Field(min_length=1, max_length=4000)
    received_at: float | None = None


class Decision(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    emergency_cache: emergency_state.EmergencyCache,
    rule_cache: RulesCache,
) -> None:
    SignedIn = Annotated[Claims, Depends(current_claims)]

    def run(
        request: Request,
        claims: Claims,
        command: Callable[[Connection, Actor], Any],
        *,
        workspace_id: str | None = None,
    ) -> Any:
        actor = http.staff_actor(engine, request, claims)
        return http.run(engine, actor, lambda conn: command(conn, actor), workspace_id=workspace_id)

    @app.get("/api/admin/emergency")
    def admin_emergency(request: Request, claims: SignedIn):
        def read(conn: Connection, actor: Actor) -> list:
            from selecta.authz.check import authorize

            authorize(conn, actor, "platform.dashboard.read")
            return emergency.listing(conn)

        return {"controls": run(request, claims, read)}

    @app.post("/api/admin/emergency/{control}/{command}")
    def admin_emergency_command(
        control: str, command: str, body: ControlRequest, request: Request, claims: SignedIn
    ):
        if command == "engage":
            row = run(
                request,
                claims,
                lambda conn, actor: emergency.engage(
                    conn, actor, control, body.target, reason=body.reason
                ),
            )
            emergency_cache.invalidate()
            return {"control": vars(row)}
        if command == "release":
            action = run(
                request,
                claims,
                lambda conn, actor: emergency.propose_release(
                    conn, actor, control, body.target, reason=body.reason
                ),
            )
            return {"action": actions.action_json(action)}
        raise HTTPException(404, detail={"code": "unknown_command"})

    @app.get("/api/admin/flags")
    def admin_flags(request: Request, claims: SignedIn):
        return {"flags": run(request, claims, flags_admin.listing)}

    @app.get("/api/admin/flags/history")
    def admin_flag_history(
        request: Request, claims: SignedIn, flag_id: str | None = None, limit: int = 50
    ):
        return {
            "versions": run(
                request,
                claims,
                lambda conn, actor: flags_admin.history(conn, actor, flag_id, limit=limit),
            )
        }

    @app.post("/api/admin/flags/rollback")
    def admin_flag_rollback(body: Rollback, request: Request, claims: SignedIn):
        outcome = run(
            request,
            claims,
            lambda conn, actor: flags_admin.rollback(
                conn, actor, body.version, reason=body.reason, before=body.before
            ),
        )
        rule_cache.invalidate()
        return outcome.to_dict()

    @app.get("/api/admin/flags/explain/{user_id}")
    def admin_flag_explain(user_id: str, request: Request, claims: SignedIn):
        return run(
            request, claims, lambda conn, actor: flags_admin.explain_user(conn, actor, user_id)
        )

    @app.post("/api/admin/flags/{flag_id}/impact")
    def admin_flag_impact(flag_id: str, body: FlagChange, request: Request, claims: SignedIn):
        def measure(conn: Connection, actor: Actor) -> dict:
            from selecta.authz.check import authorize

            authorize(conn, actor, "flags.read")
            proposed = flags_admin.proposed_rules(conn, flag_id, body.action, body.params)
            measured = flags_admin.impact(conn, flag_id, proposed)
            return {
                **measured,
                "rules": [rule.to_dict() for rule in proposed],
                "broad": flags_admin._broad(body.action, measured, flag_id),
            }

        return run(request, claims, measure)

    @app.post("/api/admin/flags/{flag_id}/change")
    def admin_flag_change(flag_id: str, body: FlagChange, request: Request, claims: SignedIn):
        outcome = run(
            request,
            claims,
            lambda conn, actor: flags_admin.change(
                conn, actor, flag_id, body.action, body.params, reason=body.reason
            ),
        )
        rule_cache.invalidate()
        return outcome.to_dict()

    @app.post("/api/admin/flags/{flag_id}/preview")
    def admin_flag_preview(flag_id: str, body: Preview, request: Request, claims: SignedIn):
        out = run(
            request,
            claims,
            lambda conn, actor: flags_admin.preview_self(
                conn, actor, flag_id, body.on, reason=body.reason
            ),
        )
        rule_cache.invalidate()
        return out

    @app.get("/api/admin/takedowns")
    def admin_takedowns(request: Request, claims: SignedIn, status: str | None = None):
        return {
            "notices": run(
                request, claims, lambda conn, actor: takedowns.listing(conn, actor, status=status)
            )
        }

    @app.post("/api/admin/takedowns", status_code=201)
    def admin_log_notice(body: NoticeRequest, request: Request, claims: SignedIn):
        def log(conn: Connection, actor: Actor) -> dict:
            notice = takedowns.log_notice(
                conn,
                actor,
                workspace_id=body.workspace_id,
                asset_id=body.asset_id,
                complainant=body.complainant,
                work=body.work,
                received_at=body.received_at,
            )
            return {"notice": notice.to_dict(db_now(conn))}

        return run(request, claims, log, workspace_id=body.workspace_id)

    @app.post("/api/admin/takedowns/{notice_id}/{command}")
    def admin_notice_command(
        notice_id: str, command: str, body: Decision, request: Request, claims: SignedIn
    ):
        if command not in {"act", "reject"}:
            raise HTTPException(404, detail={"code": "unknown_command"})
        # The decision writes that workspace's rows, so it runs as that workspace (row-level
        # security), the way job commands do.
        with transaction(engine) as conn:
            workspace_id = takedowns.notice_workspace(conn, notice_id)
        if command == "act":
            return run(
                request,
                claims,
                lambda conn, actor: takedowns.act_on_notice(
                    conn, actor, notice_id, reason=body.reason
                ),
                workspace_id=workspace_id,
            )

        def reject(conn: Connection, actor: Actor) -> dict:
            notice = takedowns.reject_notice(conn, actor, notice_id, reason=body.reason)
            return {"notice": notice.to_dict(db_now(conn))}

        return run(request, claims, reject, workspace_id=workspace_id)

    @app.post("/api/admin/upload-restrictions/{workspace_id}/lift")
    def admin_lift_restriction(
        workspace_id: str, body: Decision, request: Request, claims: SignedIn
    ):
        lifted = run(
            request,
            claims,
            lambda conn, actor: takedowns.lift_restriction(
                conn, actor, workspace_id, reason=body.reason
            ),
            workspace_id=workspace_id,
        )
        return {"workspace_id": workspace_id, "lifted": lifted}


def parse_rules(items: list[dict[str, Any]]) -> list[Rule]:
    return [Rule.from_dict(item) for item in items]


__all__ = ["install_routes"]
