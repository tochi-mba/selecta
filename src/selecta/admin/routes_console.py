"""Routes for the redesigned console (doc 07b): change mode, preferences, the customer record,
Billing, System, Staff, Communications, search, and the view-mode middleware.

**View mode is enforced here for every admin write.** A POST, PUT, PATCH or DELETE under
`/api/admin/` from an admin session with no open change window is refused with `view_mode`
before the route runs, whichever team wrote the route. A successful write renews the window.
Entering the console, opening or closing the window, console preferences, dry runs and read-only
measurements are exempt; so are writes to the audit log, which are refused and alerted as
tampering by their own route.
"""

import asyncio
import re
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Body, Depends, FastAPI, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta.admin import (
    account_config,
    actions,
    alerts,
    commands,
    console_reads,
    customers,
    http,
    safety,
)
from selecta.admin import staff_console as staff
from selecta.authz.check import Actor
from selecta.identity.tokens import Claims
from selecta.persistence import transaction

WRITES = frozenset({"POST", "PUT", "PATCH", "DELETE"})
EXEMPT = re.compile(
    r"^/api/admin/(session(/changes)?|me/preferences/[a-z]+|audit/[^/]+|"
    r"overrides/mass/dry-run|flags/[^/]+/impact)$"
)


class Guarded(BaseModel):
    reason: str = Field(default="", max_length=2000)
    version: str | None = Field(default=None, max_length=64)
    read_at: float | None = None
    confirm: str | None = Field(default=None, max_length=320)

    def intent(self) -> safety.Intent:
        return safety.Intent(version=self.version, read_at=self.read_at, confirm=self.confirm)


class NoteBody(Guarded):
    body: str = Field(min_length=1, max_length=4000)


class RoleBody(Guarded):
    user_id: str = Field(min_length=1, max_length=64)
    role: str = Field(min_length=1, max_length=32)
    scope: str = "platform:*"
    expires_at: float | None = None


class OwnerBody(Guarded):
    user_id: str = Field(min_length=1, max_length=64)


class BannerBody(Guarded):
    text: str = Field(min_length=1, max_length=280)
    level: str = Field(default="info", max_length=16)
    starts_at: float | None = None
    ends_at: float | None = None
    dismissable: bool = True


class ExportBody(Guarded):
    actor_id: str | None = Field(default=None, max_length=64)
    action: str | None = Field(default=None, max_length=128)
    result: str | None = Field(default=None, max_length=16)
    since: float | None = None


class ModeBody(Guarded):
    mode: str = Field(min_length=1, max_length=16)


class SwitchBody(Guarded):
    value: str = Field(min_length=1, max_length=16)


def _invalidate_rules(app: FastAPI) -> None:
    """This process sees a flag rule change at once; others within the rule cache's age."""
    cache = getattr(app.state, "flag_rules", None) or getattr(app.state, "rule_cache", None)
    if cache is not None and hasattr(cache, "invalidate"):
        cache.invalidate()


class MassBody(BaseModel):
    workspace_ids: list[str] = Field(min_length=2, max_length=10_000)
    plan_id: str = Field(min_length=1, max_length=32)
    expires_at: float


def _change_window_check(engine: Engine, app: FastAPI, request: Request) -> JSONResponse | None:
    session_id = (request.headers.get(http.HEADER) or "").strip()
    if not session_id:
        return None  # the route answers "enter the admin console" itself
    with transaction(engine) as conn:
        if safety.change_window(conn, session_id) is not None:
            return None
    return JSONResponse(status_code=403, content={"detail": {
        "code": "view_mode",
        "message": "The console is in view mode. Press Make changes first."}})


def _renew(engine: Engine, request: Request) -> None:
    session_id = (request.headers.get(http.HEADER) or "").strip()
    if not session_id:
        return
    from selecta.identity.schema import privileged_sessions as s

    with transaction(engine) as conn:
        ends = conn.execute(s.select().with_only_columns(s.c.expires_at)
                            .where(s.c.id == session_id)).scalar()
        safety.renew(conn, session_id, ends)


def install_view_mode(app: FastAPI, engine: Engine) -> None:
    @app.middleware("http")
    async def admin_view_mode(request: Request, call_next):
        path = request.url.path
        if (request.method not in WRITES or not path.startswith("/api/admin/")
                or EXEMPT.match(path)):
            return await call_next(request)
        refused = await asyncio.to_thread(_change_window_check, engine, app, request)
        if refused is not None:
            return refused
        response = await call_next(request)
        if response.status_code < 400:
            await asyncio.to_thread(_renew, engine, request)
        return response


def install_routes(app: FastAPI, *, engine: Engine,
                   current_claims: Callable[..., Claims]) -> None:
    SignedIn = Annotated[Claims, Depends(current_claims)]
    install_view_mode(app, engine)

    def run(request: Request, claims: Claims, command: Callable[[Connection, Actor], Any], *,
            workspace_id: str | None = None, self_kind: str = alerts.SELF_APPROVAL) -> Any:
        actor = http.staff_actor(engine, request, claims)
        return http.run(engine, actor, lambda conn: command(conn, actor),
                        workspace_id=workspace_id, self_kind=self_kind)

    # --- change mode and preferences ---------------------------------------------------------

    @app.post("/api/admin/session/changes")
    def admin_open_changes(request: Request, claims: SignedIn):
        def open_(conn: Connection, actor: Actor) -> dict:
            from selecta.authz.check import authorize

            authorize(conn, actor, "platform.dashboard.read")
            return {"changes_until": safety.open_changes(conn, actor)}

        return run(request, claims, open_)

    @app.delete("/api/admin/session/changes")
    def admin_close_changes(request: Request, claims: SignedIn):
        def close(conn: Connection, actor: Actor) -> dict:
            safety.close_changes(conn, actor)
            return {"changes_until": None}

        return run(request, claims, close)

    @app.put("/api/admin/me/preferences/{key}")
    def admin_set_preference(key: str, request: Request, claims: SignedIn,
                             body: Annotated[dict[str, Any] | None, Body()] = None):
        payload = (body or {}).get("value")
        return run(request, claims,
                   lambda conn, actor: staff.set_preference(conn, actor, key, payload))

    @app.get("/api/admin/checklist")
    def admin_checklist(request: Request, claims: SignedIn):
        return {"items": run(request, claims, staff.owner_checklist)}

    # --- search ------------------------------------------------------------------------------

    @app.get("/api/admin/lookup")
    def admin_lookup(request: Request, claims: SignedIn, q: str = Query(min_length=1,
                                                                        max_length=200)):
        return run(request, claims, lambda conn, actor: console_reads.lookup(conn, actor, q))

    # --- customers ---------------------------------------------------------------------------

    @app.get("/api/admin/customers/{user_id}")
    def admin_customer(user_id: str, request: Request, claims: SignedIn):
        return run(request, claims, lambda conn, actor: customers.record(conn, actor, user_id))

    @app.post("/api/admin/customers/{user_id}/sign-out")
    def admin_customer_sign_out(user_id: str, body: Guarded, request: Request,
                                claims: SignedIn):
        return run(request, claims, lambda conn, actor: customers.sign_out_everywhere(
            conn, actor, user_id, reason=body.reason, intent=body.intent()))

    @app.post("/api/admin/customers/{user_id}/notes", status_code=201)
    def admin_customer_note(user_id: str, body: NoteBody, request: Request, claims: SignedIn):
        return run(request, claims, lambda conn, actor: customers.add_note(
            conn, actor, user_id, body=body.body, intent=body.intent()))

    @app.post("/api/admin/customers/{user_id}/delete", status_code=202)
    def admin_customer_delete(user_id: str, body: Guarded, request: Request, claims: SignedIn):
        action = run(request, claims, lambda conn, actor: customers.propose_deletion(
            conn, actor, user_id, reason=body.reason, intent=body.intent()))
        return {"action": actions.action_json(action)}

    @app.get("/api/admin/customers/{user_id}/storage-mode")
    def admin_storage_mode(user_id: str, request: Request, claims: SignedIn):
        return run(request, claims,
                   lambda conn, actor: account_config.storage_mode(conn, actor, user_id))

    @app.put("/api/admin/customers/{user_id}/storage-mode")
    def admin_set_storage_mode(user_id: str, body: ModeBody, request: Request,
                               claims: SignedIn):
        out = run(request, claims, lambda conn, actor: account_config.set_storage_mode(
            conn, actor, user_id, mode=body.mode, reason=body.reason, intent=body.intent()))
        _invalidate_rules(app)
        return out

    @app.get("/api/admin/customers/{user_id}/flags")
    def admin_account_flags(user_id: str, request: Request, claims: SignedIn):
        return run(request, claims,
                   lambda conn, actor: account_config.account_flags(conn, actor, user_id))

    @app.put("/api/admin/customers/{user_id}/flags/{flag_id}")
    def admin_set_account_flag(user_id: str, flag_id: str, body: SwitchBody, request: Request,
                               claims: SignedIn):
        out = run(request, claims, lambda conn, actor: account_config.set_account_flag(
            conn, actor, user_id, flag_id, value=body.value, reason=body.reason,
            intent=body.intent()))
        _invalidate_rules(app)
        return out

    @app.post("/api/admin/customers/{user_id}/{command}")
    def admin_customer_command(user_id: str, command: str, body: Guarded, request: Request,
                               claims: SignedIn):
        do = {"suspend": commands.suspend_account, "restore": commands.restore_account}.get(
            command)
        if do is None:
            return JSONResponse(status_code=404, content={"detail": {"code": "unknown_command"}})
        return run(request, claims, lambda conn, actor: do(
            conn, actor, user_id, reason=body.reason, intent=body.intent()))

    @app.post("/api/admin/overrides/mass/dry-run")
    def admin_mass_dry_run(body: MassBody, request: Request, claims: SignedIn):
        return run(request, claims, lambda conn, actor: commands.mass_override_dry_run(
            conn, actor, workspace_ids=body.workspace_ids, plan_id=body.plan_id,
            expires_at=body.expires_at))

    # --- billing and system --------------------------------------------------------------------

    @app.get("/api/admin/billing")
    def admin_billing(request: Request, claims: SignedIn, view: str = "reconciliation",
                      limit: int = Query(default=50, ge=1, le=50)):
        return run(request, claims, lambda conn, actor: console_reads.billing(
            conn, actor, view=view, limit=limit))

    @app.get("/api/admin/system")
    def admin_system(request: Request, claims: SignedIn):
        return run(request, claims, console_reads.system)

    # --- staff ---------------------------------------------------------------------------------

    @app.get("/api/admin/staff")
    def admin_staff(request: Request, claims: SignedIn):
        def read(conn: Connection, actor: Actor) -> dict:
            return {"staff": staff.staff_list(conn, actor),
                    "sessions": staff.sessions(conn, actor)}

        return run(request, claims, read)

    @app.post("/api/admin/staff/roles", status_code=201)
    def admin_staff_assign(body: RoleBody, request: Request, claims: SignedIn):
        return run(request, claims, lambda conn, actor: staff.assign_role(
            conn, actor, user_id=body.user_id, role=body.role, scope=body.scope,
            reason=body.reason, expires_at=body.expires_at, intent=body.intent()),
            self_kind=alerts.ESCALATION)

    @app.post("/api/admin/staff/roles/{assignment_id}/revoke")
    def admin_staff_revoke(assignment_id: str, body: Guarded, request: Request,
                           claims: SignedIn):
        return run(request, claims, lambda conn, actor: staff.revoke_role(
            conn, actor, assignment_id, reason=body.reason, intent=body.intent()),
            self_kind=alerts.ESCALATION)

    @app.post("/api/admin/staff/owners", status_code=202)
    def admin_staff_owner(body: OwnerBody, request: Request, claims: SignedIn):
        action = run(request, claims, lambda conn, actor: staff.propose_owner(
            conn, actor, user_id=body.user_id, reason=body.reason, intent=body.intent()),
            self_kind=alerts.ESCALATION)
        return {"action": actions.action_json(action)}

    @app.post("/api/admin/staff/sessions/{session_id}/end")
    def admin_staff_end_session(session_id: str, body: Guarded, request: Request,
                                claims: SignedIn):
        return run(request, claims, lambda conn, actor: staff.end_session(
            conn, actor, session_id, reason=body.reason, intent=body.intent()))

    @app.post("/api/admin/alerts/{alert_id}/acknowledge")
    def admin_ack_alert(alert_id: str, request: Request, claims: SignedIn):
        return run(request, claims,
                   lambda conn, actor: staff.acknowledge_alert(conn, actor, alert_id))

    @app.post("/api/admin/audit-export")
    def admin_audit_export(body: ExportBody, request: Request, claims: SignedIn):
        text = run(request, claims, lambda conn, actor: staff.export_audit(
            conn, actor, actor_id=body.actor_id, action=body.action, result=body.result,
            since=body.since, intent=body.intent()))
        return Response(text, media_type="text/csv", headers={
            "Content-Disposition": 'attachment; filename="selectadj-audit.csv"'})

    # --- communications ------------------------------------------------------------------------

    @app.get("/api/admin/banners")
    def admin_banners(request: Request, claims: SignedIn):
        return run(request, claims, staff.banners)

    @app.post("/api/admin/banners", status_code=201)
    def admin_publish_banner(body: BannerBody, request: Request, claims: SignedIn):
        def publish(conn: Connection, actor: Actor) -> dict:
            from selecta.persistence import db_now

            return staff.publish_banner(
                conn, actor, text=body.text, level=body.level,
                starts_at=body.starts_at or db_now(conn), ends_at=body.ends_at,
                dismissable=body.dismissable, intent=body.intent())

        return run(request, claims, publish)

    @app.post("/api/admin/banners/{banner_id}/end")
    def admin_end_banner(banner_id: str, body: Guarded, request: Request, claims: SignedIn):
        return run(request, claims, lambda conn, actor: staff.end_banner(
            conn, actor, banner_id, intent=body.intent()))

    @app.get("/api/status-banner")
    def status_banner():
        """The banner every signed-in customer sees. Public: it holds nothing private."""
        with transaction(engine) as conn:
            return {"banner": staff.current_banner(conn)}


__all__ = ["Guarded", "install_routes", "install_view_mode"]
