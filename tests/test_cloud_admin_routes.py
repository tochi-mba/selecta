"""Cloud wiring, authorization and command evidence for the staff console."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

import pytest
import sqlalchemy as sa
from cloud_helpers import cloud_settings
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from selecta import flags
from selecta.api_cloud import create_cloud_app
from selecta.authz.schema import audit_events, role_assignments
from selecta.identity import accounts, privileged
from selecta.identity.tokens import BadSignature, Claims
from selecta.persistence import db_now, new_id, transaction
from selecta.scheduling.policy import WorkerCaps
from selecta.work.enqueue import JobSpec
from selecta.work.model import ErrorClass
from selecta.work.store import JobStore


class Tokens:
    def __init__(self) -> None:
        self.claims: dict[str, Claims] = {}

    def add(self, token: str, subject: str, *, session_id: str) -> Claims:
        now = time.time()
        claims = Claims(
            subject,
            now,
            now + 600,
            email=f"{subject}@example.test",
            email_verified=True,
            session_id=session_id,
            organization_id="staff-org",
        )
        self.claims[token] = claims
        return claims

    def verify(self, token: str) -> Claims:
        try:
            return self.claims[token]
        except KeyError:
            raise BadSignature("unknown test token") from None


@dataclass
class AdminWorld:
    http: TestClient
    engine: object
    headers: dict[str, str]
    denied_headers: dict[str, str]
    workspace_id: str
    customer_workspace_id: str
    store: JobStore
    tokens: Tokens


def _staff(conn, claims: Claims, role: str) -> tuple[str, str]:
    principal = accounts.provision(conn, claims, age_confirmed=True)
    now = db_now(conn)
    conn.execute(
        role_assignments.insert().values(
            id=new_id(),
            user_id=principal.user.id,
            role=role,
            scope_type="platform",
            scope_id="*",
            issued_by=principal.user.id,
            reason="route test",
            created_at=now,
        )
    )
    session = privileged.start(conn, claims, staff_organization_id="staff-org", lifetime=3600)
    return principal.workspace.id, session.id


@pytest.fixture
def admin_world(cloud_engine):
    tokens = Tokens()
    owner_claims = tokens.add("owner", "staff-owner", session_id="owner-workos-session")
    auditor_claims = tokens.add("auditor", "staff-auditor", session_id="audit-workos-session")
    customer_claims = tokens.add("customer", "customer", session_id="customer-session")
    with transaction(cloud_engine) as conn:
        workspace_id, owner_session = _staff(conn, owner_claims, "owner")
        _, auditor_session = _staff(conn, auditor_claims, "auditor")
        customer = accounts.provision(conn, customer_claims, age_confirmed=True)
    app = create_cloud_app(cloud_settings(), engine=cloud_engine, verifier=tokens)
    store = JobStore(cloud_engine)
    with TestClient(app) as http:
        yield AdminWorld(
            http=http,
            engine=cloud_engine,
            headers={
                "Authorization": "Bearer owner",
                "X-Admin-Session": owner_session,
            },
            denied_headers={
                "Authorization": "Bearer auditor",
                "X-Admin-Session": auditor_session,
            },
            workspace_id=workspace_id,
            customer_workspace_id=customer.workspace.id,
            store=store,
            tokens=tokens,
        )


def test_every_installed_admin_route_is_owned_by_the_admin_flag(admin_world):
    owners = flags.route_owners()
    routes = {
        f"{method} {route.path}"
        for route in admin_world.http.app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/api/admin/")
        for method in route.methods - {"HEAD"}
    }
    assert routes
    assert {route: owners.get(route) for route in routes} == {
        route: "admin.console" for route in routes
    }


def test_admin_routes_require_the_server_side_privileged_session(admin_world):
    answer = admin_world.http.get(
        "/api/admin/overview", headers={"Authorization": "Bearer customer"}
    )
    assert (answer.status_code, answer.json()["detail"]["code"]) == (
        401,
        "admin_session_required",
    )

    flags.use("-admin.console")
    disabled = admin_world.http.get("/api/admin/me", headers=admin_world.headers)
    assert (disabled.status_code, disabled.json()["code"]) == (403, "flag_off")


def test_job_worker_and_override_routes_use_commands_and_write_audits(admin_world):
    store = admin_world.store
    workspace = admin_world.workspace_id
    failed = store.enqueue(JobSpec(workspace, "analyse.song")).job
    claim = store.claim("cpu-heavy", WorkerCaps(pool="cpu-heavy", worker_id="worker-1"))
    assert claim is not None and claim.job.id == failed.id
    store.fail(claim.attempt_id, claim.fencing_token, ErrorClass.INPUT_INVALID, "bad input")

    cancelled = store.enqueue(JobSpec(workspace, "analyse.song")).job
    quarantined = store.enqueue(JobSpec(workspace, "analyse.song")).job
    worker_id = store.register_worker(
        WorkerCaps(pool="cpu-heavy", worker_id="worker-admin", slots=2)
    )

    retry = admin_world.http.post(
        f"/api/admin/jobs/{failed.id}/retry",
        headers=admin_world.headers,
        json={"reason": "input corrected"},
    )
    cancel = admin_world.http.post(
        f"/api/admin/jobs/{cancelled.id}/cancel",
        headers=admin_world.headers,
        json={"reason": "customer request"},
    )
    quarantine = admin_world.http.post(
        f"/api/admin/jobs/{quarantined.id}/quarantine",
        headers=admin_world.headers,
        json={"reason": "inspect output"},
    )
    drain = admin_world.http.post(
        f"/api/admin/workers/{worker_id}/drain",
        headers=admin_world.headers,
        json={"reason": "deploying"},
    )
    override = admin_world.http.post(
        "/api/admin/overrides",
        headers=admin_world.headers,
        json={
            "workspace_id": admin_world.customer_workspace_id,
            "plan_id": "premium",
            "expires_at": time.time() + 86_400,
            "reason": "service recovery",
        },
    )

    for answer in (retry, cancel, quarantine, drain, override):
        assert answer.status_code < 300, answer.text
    assert cancel.json()["job"]["state"] == "cancelled"
    assert quarantine.json()["job"]["state"] == "blocked"
    assert drain.json()["hold"] == "drain"
    assert override.json()["plan_id"] == "premium"

    with admin_world.engine.connect() as conn:
        actions = set(
            conn.execute(
                sa.select(audit_events.c.action).where(
                    audit_events.c.action.in_(
                        (
                            "admin.job.retry",
                            "admin.job.cancel",
                            "admin.job.quarantine",
                            "admin.worker.drain",
                            "admin.override.grant",
                        )
                    )
                )
            ).scalars()
        )
    assert actions == {
        "admin.job.retry",
        "admin.job.cancel",
        "admin.job.quarantine",
        "admin.worker.drain",
        "admin.override.grant",
    }


def test_a_role_without_command_permission_is_denied_and_audited(admin_world):
    worker_id = admin_world.store.register_worker(
        WorkerCaps(pool="cpu-heavy", worker_id="worker-denied")
    )
    answer = admin_world.http.post(
        f"/api/admin/workers/{worker_id}/drain",
        headers=admin_world.denied_headers,
        json={"reason": "I should not be able to"},
    )
    assert (answer.status_code, answer.json()["detail"]["code"]) == (403, "forbidden")
    with admin_world.engine.connect() as conn:
        denied = conn.execute(
            sa.select(audit_events.c.action, audit_events.c.result).where(
                audit_events.c.result == "deny",
                audit_events.c.action == "workers.drain",
            )
        ).all()
    assert denied == [("workers.drain", "deny")]


# Every command each `/{command}` route accepts; a route missing here fails the test below.
COMMANDS = {
    "/api/admin/jobs/{job_id}/{command}": ("retry", "cancel", "quarantine", "release"),
    "/api/admin/workers/{worker_id}/{command}": ("drain", "pause", "resume"),
    "/api/admin/accounts/{user_id}/{command}": ("suspend", "restore"),
    "/api/admin/actions/{action_id}/{command}": ("approve", "cancel", "execute"),
    "/api/admin/emergency/{control}/{command}": ("engage", "release"),
    "/api/admin/takedowns/{notice_id}/{command}": ("act", "reject"),
}
# One body that satisfies every admin request model, so validation never answers first.
EVERY_FIELD = {
    "reason": "permission sweep",
    "workspace_id": "w-none",
    "workspace_ids": ["w-1", "w-2"],
    "plan_id": "standard",
    "expires_at": time.time() + 3600,
    "user_id": "u-none",
    "role": "support",
    "version": 1,
    "on": True,
    "action": "kill_switch",
    "params": {},
    "asset_id": "a-none",
    "complainant": "A label",
    "work": "A song",
    "payload_hash": "0" * 64,
    "owner_user_id": "u-none",
    "org_name": "Permission sweep pilot",
    "venues": [{"name": "Test venue", "timezone": "Europe/London", "country": "GB"}],
}
# Routes any signed-in staff member may call: starting the admin session and reading who you are.
SELF_ONLY = {"POST /api/admin/session", "GET /api/admin/me"}
# The audit log refuses every change, to everyone, before any check.
APPEND_ONLY = {"PATCH /api/admin/audit/{event_id}", "DELETE /api/admin/audit/{event_id}"}


def _staff_without_roles(admin_world) -> dict[str, str]:
    claims = admin_world.tokens.add("roleless", "staff-roleless", session_id="roleless-session")
    with transaction(admin_world.engine) as conn:
        accounts.provision(conn, claims, age_confirmed=True)
        session = privileged.start(conn, claims, staff_organization_id="staff-org", lifetime=3600)
    return {"Authorization": "Bearer roleless", "X-Admin-Session": session.id}



def test_business_pilot_requires_staff_permission_before_rollout_flag(admin_world):
    """An admin route needs RBAC even when its independently controlled feature is off."""
    headers = _staff_without_roles(admin_world)
    body = {**EVERY_FIELD}
    with transaction(admin_world.engine) as conn:
        body["owner_user_id"] = accounts.provision(
            conn, admin_world.tokens.claims["customer"], age_confirmed=True
        ).user.id
    try:
        flags.use("-business.pilots")
        no_role = admin_world.http.post("/api/admin/business/pilots", headers=headers, json=body)
        assert (no_role.status_code, no_role.json()["detail"]["code"]) == (403, "forbidden")
        assert no_role.json()["detail"]["permission"] == "business.pilots.create"

        off = admin_world.http.post(
            "/api/admin/business/pilots", headers=admin_world.headers, json=body
        )
        assert (off.status_code, off.json()["detail"]["code"]) == (403, "flag_off")
        assert off.json()["detail"]["flag"] == "business.pilots"

        flags.use("+business.pilots -business.orgs")
        blocked_dependency = admin_world.http.post(
            "/api/admin/business/pilots", headers=admin_world.headers, json=body
        )
        assert blocked_dependency.json()["detail"]["code"] == "flag_off"

        flags.use("+business.orgs +business.pilots")
        still_denied = admin_world.http.post(
            "/api/admin/business/pilots", headers=headers, json=body
        )
        assert still_denied.status_code == 403
        assert still_denied.json()["detail"]["permission"] == "business.pilots.create"

        allowed = admin_world.http.post(
            "/api/admin/business/pilots", headers=admin_world.headers, json=body
        )
        assert allowed.status_code == 201, allowed.text
        assert allowed.json()["pilot"]["org"]["name"] == body["org_name"]
    finally:
        flags.use(None)


@pytest.mark.parametrize("command", ["retry", "cancel", "quarantine", "release"])
def test_roleless_staff_cannot_probe_job_workspace(admin_world, monkeypatch, command):
    """The job's tenant isn't queried until a caller has a matching command role."""
    from selecta.admin import commands

    headers = _staff_without_roles(admin_world)

    def forbidden_lookup(*_args, **_kwargs):
        pytest.fail("looked up job workspace before checking command role")

    monkeypatch.setattr(commands, "job_workspace", forbidden_lookup)
    response = admin_world.http.post(
        f"/api/admin/jobs/no-such-job/{command}",
        headers=headers,
        json={"reason": "permission probe"},
    )
    assert (response.status_code, response.json()["detail"]["code"]) == (403, "forbidden")
    assert response.json()["detail"]["permission"] in {"jobs.retry", "jobs.cancel"}


@pytest.mark.parametrize("command", ["act", "reject"])
def test_roleless_staff_cannot_probe_notice_workspace(admin_world, monkeypatch, command):
    """The notice's tenant is not looked up before legal.takedowns.manage."""
    from selecta.admin import takedowns

    headers = _staff_without_roles(admin_world)

    def forbidden_lookup(*_args, **_kwargs):
        pytest.fail("queried notice workspace before permission check")

    monkeypatch.setattr(takedowns, "notice_workspace", forbidden_lookup)
    response = admin_world.http.post(
        f"/api/admin/takedowns/no-such-notice/{command}",
        headers=headers,
        json={"reason": "permission probe"},
    )
    assert (response.status_code, response.json()["detail"]["code"]) == (403, "forbidden")
    assert response.json()["detail"]["permission"] == "legal.takedowns.manage"


@pytest.mark.parametrize("command", ["approve", "cancel", "execute"])
def test_roleless_staff_cannot_probe_action_ids(admin_world, monkeypatch, command):
    """Read authorization precedes fetching the action or returning its absence."""
    from selecta.admin import actions

    headers = _staff_without_roles(admin_world)

    def forbidden_lookup(*_args, **_kwargs):
        pytest.fail("queried action before permission check")

    monkeypatch.setattr(actions.delayed, "get", forbidden_lookup)
    response = admin_world.http.post(
        f"/api/admin/actions/no-such-action/{command}",
        headers=headers,
        json=EVERY_FIELD,
    )
    assert (response.status_code, response.json()["detail"]["code"]) == (403, "forbidden")
    assert response.json()["detail"]["permission"] == "platform.dashboard.read"


def test_every_admin_route_and_command_checks_a_registered_permission_first(admin_world):
    """SC-0401-01: a staff member holding no role is refused by every admin route and command,
    each refusal naming a permission from the registry, and an id that doesn't exist reveals
    nothing (the refusal comes before the lookup)."""
    from selecta.authz import permissions

    headers = _staff_without_roles(admin_world)
    seen: dict[str, str] = {}
    wrong: list[str] = []
    for route in admin_world.http.app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/admin/"):
            continue
        for method in sorted(route.methods - {"HEAD"}):
            name = f"{method} {route.path}"
            if name in SELF_ONLY | APPEND_ONLY:
                continue
            commands = COMMANDS.get(route.path, ("",))
            assert "{command}" not in route.path or route.path in COMMANDS, name
            for command in commands:
                path = route.path.replace("{command}", command)
                path = path.replace("{control}", "uploads.paused").replace("{flag_id}", "requests")
                path = re.sub(r"\{\w+\}", "id-that-does-not-exist", path)
                answer = admin_world.http.request(
                    method,
                    path,
                    headers=headers,
                    json=EVERY_FIELD,
                    params={"reason": "permission sweep"},
                )
                detail = answer.json().get("detail", {})
                if (answer.status_code, detail.get("code")) == (403, "forbidden"):
                    seen[f"{method} {path}"] = detail["permission"]
                else:
                    wrong.append(f"{method} {path}: {answer.status_code} {detail}")
    assert not wrong, "; ".join(wrong)
    assert len(seen) > 30
    assert set(seen.values()) <= permissions.all_names()
