"""The compromised-admin drill (ADR-0401 SC-0401-05): a staff session in the wrong hands.

A stolen or limited staff session tries five things an attacker would. Each is blocked, leaves a
deny in the audit log, and (as §7.6 and ADR-0401 require for escalation, content access and
audit tampering) raises a platform alert:

1. raising its own powers, or an accomplice's;
2. reading a customer's audio without a content grant;
3. changing or deleting audit rows, through the API and (on PostgreSQL) in the database itself;
4. bulk-exporting accounts through the console;
5. approving its own dangerous action.

It also checks the session itself: a session signed out everywhere, or used without its admin
session header, gets nothing.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_admin_kit import audit_actions, make_world
from fastapi import HTTPException
from fastapi.routing import APIRoute

from selecta.admin import alerts, http
from selecta.admin.read_models import BULK_SEARCHES
from selecta.admin.schema import platform_alerts
from selecta.authz import audit, grants
from selecta.authz.check import authorize
from selecta.authz.schema import audit_events, role_assignments
from selecta.identity import accounts
from selecta.persistence import is_postgres, transaction


@pytest.fixture
def world(cloud_engine):
    built = make_world(cloud_engine, staff=("owner", "support", "auditor"))
    yield built
    built.http.__exit__(None, None, None)


def alert_kinds(world) -> list[str]:
    with world.engine.connect() as conn:
        return list(conn.execute(sa.select(platform_alerts.c.kind)
                                 .order_by(platform_alerts.c.created_at)).scalars())


def roles_of(world, name: str) -> set[str]:
    with world.engine.connect() as conn:
        return set(conn.execute(sa.select(role_assignments.c.role).where(
            role_assignments.c.user_id == world.users[name])).scalars())


def test_a_limited_session_cannot_raise_its_own_or_an_accomplices_powers(world):
    own = world.post("/api/admin/security/roles", "support", user_id=world.users["support"],
                     role="admin", reason="please")
    assert (own.status_code, own.json()["detail"]["code"]) == (403, "self_approval")
    accomplice = world.post("/api/admin/security/roles", "support",
                            user_id=world.users["customer"], role="admin", reason="friend")
    assert (accomplice.status_code, accomplice.json()["detail"]["code"]) == (403, "forbidden")
    owner_self = world.post("/api/admin/security/roles", "owner", user_id=world.users["owner"],
                            role="operator", reason="more roles")
    assert owner_self.json()["detail"]["code"] == "self_approval"

    assert roles_of(world, "support") == {"support"}
    assert roles_of(world, "customer") == set()
    denies = audit_actions(world.engine, action="security.roles.assign", result="deny")
    assert {row["actor_id"] for row in denies} == {world.users["support"], world.users["owner"]}
    assert alert_kinds(world).count(alerts.ESCALATION) == 3


def test_customer_audio_needs_a_content_grant_whoever_asks(world):
    workspace = world.workspaces["customer"]
    for who in ("owner", "support"):
        actor = http.staff_actor(world.engine, _request(world, who), _claims(world, who))
        with pytest.raises(HTTPException) as refused:
            http.run(world.engine, actor, lambda conn, a=actor: authorize(
                conn, a, "storage.content.read", grants.content_resource(workspace)))
        assert refused.value.status_code == 403
    denies = audit_actions(world.engine, action="storage.content.read", result="deny")
    assert len(denies) == 2 and all(row["reason"] == "no active support grant" for row in denies)
    assert alert_kinds(world).count(alerts.CONTENT_ACCESS) == 2

    # No admin route hands out audio, and staff tokens are customers elsewhere: naming the
    # customer's workspace on a customer route is "no such workspace".
    admin_paths = [r.path for r in world.http.app.routes
                   if isinstance(r, APIRoute) and r.path.startswith("/api/admin/")]
    assert not [p for p in admin_paths if "playback" in p or "content" in p or "download" in p]
    listing = world.http.get("/api/assets", headers={**world.headers("owner"),
                                                     "X-Workspace-ID": workspace})
    assert (listing.status_code, listing.json()["detail"]["code"]) == (404,
                                                                       "workspace_not_found")


def test_audit_rows_cannot_be_changed_through_the_console(world):
    target = audit_actions(world.engine)[0]["id"]
    for method in ("PATCH", "DELETE"):
        answer = world.http.request(method, f"/api/admin/audit/{target}",
                                    headers=world.headers("owner"), json={"reason": "x"})
        assert (answer.status_code, answer.json()["detail"]["code"]) == (405,
                                                                         "audit_append_only")
    assert len(audit_actions(world.engine, action="audit.modify", result="deny")) == 2
    assert alert_kinds(world).count(alerts.AUDIT_TAMPERING) == 2
    assert audit_actions(world.engine, id=target), "the row is still there"


def test_audit_rows_cannot_be_changed_in_postgresql_even_by_the_owner(world):
    with world.engine.connect() as conn:
        if not is_postgres(conn):
            pytest.skip("the append-only triggers are PostgreSQL's")
    with transaction(world.engine) as conn:
        for statement in audit.APPEND_ONLY_SQL:
            if not statement.startswith(("REVOKE", "GRANT")):
                conn.exec_driver_sql(statement)
    target = audit_actions(world.engine)[0]["id"]
    for change in (
        audit_events.update().where(audit_events.c.id == target).values(reason="edited"),
        audit_events.delete().where(audit_events.c.id == target),
    ):
        with pytest.raises(sa.exc.DBAPIError), transaction(world.engine) as conn:
            conn.execute(change)
    assert audit_actions(world.engine, id=target)[0]["reason"] != "edited"


def test_the_console_refuses_to_work_as_a_bulk_account_export(world):
    huge = world.get("/api/admin/accounts", "support", limit=10_000)
    assert (huge.status_code, huge.json()["detail"]["code"]) == (400, "page_too_large")
    for _ in range(BULK_SEARCHES):
        assert world.get("/api/admin/accounts", "support", limit=50).status_code == 200
    paged = world.get("/api/admin/accounts", "support", limit=50)
    assert (paged.status_code, paged.json()["detail"]["code"]) == (429, "bulk_export_refused")

    refused = audit_actions(world.engine, action="admin.accounts.search", result="deny")
    assert [row["reason"] for row in refused] == ["page too large", "bulk export refused"]
    assert alert_kinds(world).count(alerts.BULK_EXPORT) == 2
    audit_page = world.get("/api/admin/audit", "auditor", limit=100_000)
    assert audit_page.json()["detail"]["code"] == "page_too_large"


def test_nobody_approves_their_own_dangerous_action(world):
    assert world.post("/api/admin/emergency/app.read_only/engage", reason="drill").status_code \
        == 200
    action = world.post("/api/admin/emergency/app.read_only/release", reason="done").json()
    action_id, digest = action["action"]["id"], action["action"]["payload_hash"]
    approved = world.post(f"/api/admin/actions/{action_id}/approve", payload_hash=digest)
    assert (approved.status_code, approved.json()["detail"]["code"]) == (403, "self_approval")
    assert audit_actions(world.engine, action="dangerous_action.approve", result="deny")
    assert alerts.SELF_APPROVAL in alert_kinds(world)
    running = world.post(f"/api/admin/actions/{action_id}/execute")
    assert running.json()["detail"]["code"] == "not_ready"


def test_a_stolen_session_stops_working_once_signed_out_everywhere(world):
    assert world.get("/api/admin/me", "support").status_code == 200
    with transaction(world.engine) as conn:
        accounts.revoke_sessions(conn, world.users["support"], actor_id=world.users["owner"],
                                 reason="stolen laptop")
    ended = world.get("/api/admin/me", "support")
    assert ended.status_code == 401
    assert ended.json()["detail"]["code"] == "session_revoked"
    bare = world.http.get("/api/admin/me", headers={"Authorization": "Bearer auditor"})
    assert bare.json()["detail"]["code"] == "admin_session_required"
    # Someone else's admin session id is worth nothing with your own token.
    other = world.http.get("/api/admin/me", headers={
        "Authorization": "Bearer auditor", "X-Admin-Session": world.sessions["owner"]})
    assert (other.status_code, other.json()["detail"]["code"]) == (401, "admin_session_ended")


def _claims(world, who: str):
    return world.http.app.state.token_verifier.verify(who)


def _request(world, who: str):
    class Fake:
        headers = {"x-admin-session": world.sessions[who]}

    return Fake()


