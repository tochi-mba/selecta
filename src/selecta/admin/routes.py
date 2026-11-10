"""The admin API: every route is staff only, reads through a read model, and acts through a command.

All routes live under `/api/admin/` and belong to the `admin.console` flag. Each one:

1. checks the bearer token and the admin session (`admin.http.staff_actor`);
2. runs one read model or command in one transaction (`admin.http.run`), which authorizes it,
   audits it, keeps a refusal's audit row and alerts on attacks;
3. answers with the command's result, or a refusal with a stable `code`.

Nothing here edits a row directly. The emergency controls, flags and takedown routes are in
`admin.routes_controls`, so neither file grows past a few hundred lines.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta.admin import actions, alerts, commands, http, pages, read_models
from selecta.admin import state as emergency_state
from selecta.admin.http import CommandRefused
from selecta.authz import assignments, audit
from selecta.authz.check import Actor, authorize
from selecta.authz.scopes import Scope
from selecta.identity.tokens import Claims
from selecta.persistence import transaction

JOB_COMMANDS: dict[str, Callable[..., Any]] = {
    "retry": commands.retry_job,
    "cancel": commands.cancel_job,
    "quarantine": commands.quarantine_job,
    "release": commands.release_job,
}


class Reason(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class OverrideRequest(Reason):
    workspace_id: str = Field(min_length=1, max_length=64)
    plan_id: str = Field(min_length=1, max_length=32)
    expires_at: float


class MassOverrideRequest(Reason):
    workspace_ids: list[str] = Field(min_length=2, max_length=10_000)
    plan_id: str = Field(min_length=1, max_length=32)
    expires_at: float


class RoleRequest(Reason):
    user_id: str = Field(min_length=1, max_length=64)
    role: str = Field(min_length=1, max_length=32)
    scope: str = "platform:*"
    expires_at: float | None = None


class ApproveRequest(BaseModel):
    payload_hash: str = Field(min_length=64, max_length=64)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    emergency: emergency_state.EmergencyCache,
) -> None:
    SignedIn = Annotated[Claims, Depends(current_claims)]

    def staff(request: Request, claims: Claims) -> Actor:
        return http.staff_actor(engine, request, claims)

    def run(request: Request, claims: Claims, command: Callable[[Connection, Actor], Any], *,
            workspace_id: str | None = None, self_kind: str = alerts.SELF_APPROVAL) -> Any:
        actor = staff(request, claims)
        return http.run(engine, actor, lambda conn: command(conn, actor),
                        workspace_id=workspace_id, self_kind=self_kind)

    @app.get("/api/admin/me")
    def admin_me(request: Request, claims: SignedIn):
        return run(request, claims, pages.me)

    @app.get("/api/admin/overview")
    def admin_overview(request: Request, claims: SignedIn):
        def read(conn: Connection, actor: Actor) -> dict:
            authorize(conn, actor, "platform.dashboard.read")
            read_models.maybe_refresh(conn)
            out = read_models.overview(conn)
            out["emergency"] = [
                {"control": c, "target": t}
                for c, t in sorted(emergency_state.load(conn).engaged)
            ]
            out["alerts"] = [vars(a) for a in alerts.recent(conn, limit=10)]
            return out

        return run(request, claims, read)

    @app.get("/api/admin/jobs")
    def admin_jobs(
        request: Request, claims: SignedIn, job_id: str | None = None,
        workspace_id: str | None = None, type: str | None = None,  # noqa: A002 - query name
        state: str | None = None, limit: int = Query(default=50, ge=1),
    ):
        return {"jobs": run(request, claims, lambda conn, actor: read_models.search_jobs(
            conn, actor, job_id=job_id, workspace_id=workspace_id, job_type=type, state=state,
            limit=limit))}

    @app.get("/api/admin/jobs/{job_id}")
    def admin_job(job_id: str, request: Request, claims: SignedIn):
        return run(request, claims, lambda conn, actor: read_models.job_detail(conn, actor, job_id))

    @app.post("/api/admin/jobs/{job_id}/{command}")
    def admin_job_command(job_id: str, command: str, body: Reason, request: Request,
                          claims: SignedIn):
        do = JOB_COMMANDS.get(command)
        if do is None:
            raise HTTPException(404, detail={"code": "unknown_command"})
        actor = staff(request, claims)
        with transaction(engine) as conn:
            try:
                workspace_id = commands.job_workspace(conn, job_id)
            except LookupError:
                workspace_id = None
        job = http.run(engine, actor, lambda conn: do(conn, actor, job_id, reason=body.reason),
                       workspace_id=workspace_id)
        return {"job": {"id": job.id, "state": str(job.state), "workspace_id": job.workspace_id,
                        "error_class": job.error_class}}

    @app.get("/api/admin/workers")
    def admin_workers(request: Request, claims: SignedIn):
        return {"workers": run(request, claims, read_models.list_workers)}

    @app.post("/api/admin/workers/{worker_id}/{command}")
    def admin_worker_command(worker_id: str, command: str, body: Reason, request: Request,
                             claims: SignedIn):
        if command == "resume":
            return run(request, claims, lambda conn, actor: commands.resume_worker(
                conn, actor, worker_id, reason=body.reason))
        if command not in commands.WORKER_HOLDS:
            raise HTTPException(404, detail={"code": "unknown_command"})
        return run(request, claims, lambda conn, actor: commands.hold_worker(
            conn, actor, worker_id, command, reason=body.reason))

    @app.get("/api/admin/accounts")
    def admin_accounts(request: Request, claims: SignedIn, q: str = "",
                       limit: int = Query(default=25, ge=1)):
        return {"accounts": run(request, claims, lambda conn, actor: read_models.search_accounts(
            conn, actor, query=q[:200], limit=limit))}

    @app.get("/api/admin/accounts/{user_id}")
    def admin_account(user_id: str, request: Request, claims: SignedIn):
        return run(request, claims, lambda conn, actor: pages.account(conn, actor, user_id))

    @app.post("/api/admin/accounts/{user_id}/{command}")
    def admin_account_command(user_id: str, command: str, body: Reason, request: Request,
                              claims: SignedIn):
        do = {"suspend": commands.suspend_account, "restore": commands.restore_account}.get(
            command)
        if do is None:
            raise HTTPException(404, detail={"code": "unknown_command"})
        return run(request, claims, lambda conn, actor: do(conn, actor, user_id,
                                                           reason=body.reason))

    @app.post("/api/admin/overrides", status_code=201)
    def admin_override(body: OverrideRequest, request: Request, claims: SignedIn):
        return run(request, claims, lambda conn, actor: commands.grant_override(
            conn, actor, workspace_id=body.workspace_id, plan_id=body.plan_id,
            reason=body.reason, expires_at=body.expires_at), workspace_id=body.workspace_id)

    @app.post("/api/admin/overrides/mass", status_code=202)
    def admin_mass_override(body: MassOverrideRequest, request: Request, claims: SignedIn):
        action = run(request, claims, lambda conn, actor: commands.propose_mass_override(
            conn, actor, workspace_ids=body.workspace_ids, plan_id=body.plan_id,
            reason=body.reason, expires_at=body.expires_at))
        return {"action": actions.action_json(action)}

    @app.delete("/api/admin/overrides/{override_id}")
    def admin_revoke_override(override_id: str, request: Request, claims: SignedIn,
                              reason: str = Query(min_length=1, max_length=2000)):
        return run(request, claims, lambda conn, actor: commands.revoke_override(
            conn, actor, override_id, reason=reason))

    @app.get("/api/admin/ai")
    def admin_ai(request: Request, claims: SignedIn):
        return run(request, claims, pages.ai_routing)

    @app.get("/api/admin/security")
    def admin_security(request: Request, claims: SignedIn):
        return run(request, claims, pages.security)

    @app.post("/api/admin/security/roles", status_code=201)
    def admin_assign_role(body: RoleRequest, request: Request, claims: SignedIn):
        def assign(conn: Connection, actor: Actor) -> dict:
            made = assignments.assign_role(
                conn, actor, user_id=body.user_id, role=body.role, reason=body.reason,
                scope=Scope.parse(body.scope), expires_at=body.expires_at)
            return {"id": made.id, "user_id": made.user_id, "role": made.role.value,
                    "scope": str(made.scope)}

        return run(request, claims, assign, self_kind=alerts.ESCALATION)

    @app.get("/api/admin/audit")
    def admin_audit(request: Request, claims: SignedIn, actor_id: str | None = None,
                    action: str | None = None, workspace_id: str | None = None,
                    result: str | None = None, limit: int = Query(default=100, ge=1)):
        return {"events": run(request, claims, lambda conn, actor: read_models.audit_search(
            conn, actor, actor_id=actor_id, action=action, workspace_id=workspace_id,
            result=result, limit=limit))}

    def tamper(event_id: str, request: Request, claims: Claims) -> None:
        """The audit log is append-only: any attempt to change it is refused, audited and
        alerted, whoever asks."""

        def refuse(conn: Connection, actor: Actor) -> None:
            audit.record_durably(
                conn, actor_id=actor.user_id, action="audit.modify",
                result=audit.AuditResult.DENY, resource_type="audit_event",
                resource_id=event_id[:128], reason="the audit log is append-only",
                request_id=actor.request_id, metadata={"method": request.method})
            raise CommandRefused(405, "audit_append_only", "The audit log can't be changed.",
                                 alert=alerts.AUDIT_TAMPERING)

        run(request, claims, refuse)

    @app.patch("/api/admin/audit/{event_id}")
    def admin_audit_patch(event_id: str, request: Request, claims: SignedIn,
                          _body: Annotated[Any, Body()] = None):
        tamper(event_id, request, claims)

    @app.delete("/api/admin/audit/{event_id}")
    def admin_audit_delete(event_id: str, request: Request, claims: SignedIn):
        tamper(event_id, request, claims)

    @app.get("/api/admin/alerts")
    def admin_alerts(request: Request, claims: SignedIn, limit: int = Query(default=50, ge=1)):
        def read(conn: Connection, actor: Actor) -> list:
            authorize(conn, actor, "platform.dashboard.read")
            return [vars(a) for a in alerts.recent(conn, limit=limit)]

        return {"alerts": run(request, claims, read)}

    @app.get("/api/admin/actions")
    def admin_actions(request: Request, claims: SignedIn):
        return {"actions": run(request, claims, actions.listing)}

    @app.post("/api/admin/actions/{action_id}/{command}")
    def admin_action_command(action_id: str, command: str, request: Request, claims: SignedIn,
                             body: Annotated[dict[str, Any] | None, Body()] = None):
        body = body or {}
        if command == "approve":
            approve = ApproveRequest.model_validate(body)
            return run(request, claims, lambda conn, actor: actions.approve(
                conn, actor, action_id, approve.payload_hash))
        if command == "cancel":
            reason = Reason.model_validate(body)
            return run(request, claims, lambda conn, actor: actions.cancel(
                conn, actor, action_id, reason=reason.reason))
        if command == "execute":
            outcome = run(request, claims, lambda conn, actor: actions.execute(
                conn, actor, action_id))
            emergency.invalidate()
            return outcome
        raise HTTPException(404, detail={"code": "unknown_command"})


__all__ = ["install_routes"]
