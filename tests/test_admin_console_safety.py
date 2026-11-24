"""The console's safety rules, enforced by the server (doc 07b §7B.7), through the real API.

- view mode: every admin write is refused until "Make changes" opens a window;
- dangerous actions need the target typed back and a fresh session;
- a stale record version is refused;
- nobody gives a role holding a permission they lack; the last Owner can't be revoked;
- staff can't act on their own account;
- the hourly blast limit refuses and alerts;
- the storage-mode switch writes one console grant on cloud.hosted_media and takes it back;
- a published banner is what customers read from the public endpoint.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_admin_kit import make_world

from selecta.admin import alerts
from selecta.admin.account_config import HOSTED, NOTE_ON
from selecta.admin.schema import platform_alerts
from selecta.flags import rules as flag_rules
from selecta.persistence import transaction


@pytest.fixture
def world(cloud_engine):
    built = make_world(cloud_engine, staff=("owner", "support", "auditor"))
    yield built
    built.http.__exit__(None, None, None)


@pytest.fixture
def viewing(cloud_engine):
    built = make_world(cloud_engine, staff=("owner",), changes=False)
    yield built
    built.http.__exit__(None, None, None)


def code(answer) -> str:
    return answer.json()["detail"]["code"]


def record(world, who: str = "customer") -> dict:
    answer = world.get(f"/api/admin/customers/{world.users[who]}")
    assert answer.status_code == 200, answer.text
    return answer.json()


def test_writes_are_refused_in_view_mode_until_make_changes(viewing):
    target = viewing.users["customer"]
    refused = viewing.post(f"/api/admin/customers/{target}/sign-out", reason="test")
    assert (refused.status_code, code(refused)) == (403, "view_mode")
    opened = viewing.post("/api/admin/session/changes")
    assert opened.status_code == 200 and opened.json()["changes_until"]
    done = viewing.post(f"/api/admin/customers/{target}/sign-out", reason="test")
    assert done.status_code == 200, done.text
    closed = viewing.http.delete("/api/admin/session/changes", headers=viewing.headers("owner"))
    assert closed.status_code == 200
    again = viewing.post(f"/api/admin/customers/{target}/sign-out", reason="test")
    assert code(again) == "view_mode"


def test_a_dangerous_action_needs_the_target_typed_and_a_current_version(world):
    seen = record(world)
    target = world.users["customer"]
    wrong = world.post(f"/api/admin/customers/{target}/suspend", reason="abuse",
                       version=seen["version"], read_at=seen["read_at"], confirm="nope")
    assert code(wrong) == "confirm_mismatch"
    stale = world.post(f"/api/admin/customers/{target}/suspend", reason="abuse",
                       version="0" * 20, read_at=seen["read_at"],
                       confirm=seen["user"]["email"])
    assert code(stale) == "record_changed"
    unread = world.post(f"/api/admin/customers/{target}/suspend", reason="abuse",
                        confirm=seen["user"]["email"])
    assert code(unread) == "record_changed"
    done = world.post(f"/api/admin/customers/{target}/suspend", reason="abuse",
                      version=seen["version"], read_at=seen["read_at"],
                      confirm=seen["user"]["email"])
    assert done.status_code == 200, done.text
    after = record(world)
    assert after["user"]["suspended_at"] and after["version"] != seen["version"]


def test_staff_cannot_act_on_their_own_account(world):
    mine = world.users["owner"]
    answer = world.post(f"/api/admin/customers/{mine}/sign-out", reason="me")
    assert (answer.status_code, code(answer)) == (403, "self_approval")


def test_nobody_gives_a_role_above_their_own(world, cloud_engine):
    with transaction(cloud_engine) as conn:
        conn.execute(sa.text("INSERT INTO role_assignments (id, user_id, role, scope_type, "
                             "scope_id, issued_by, reason, created_at) VALUES "
                             "('ra-billing', :u, 'billing', 'platform', '*', 'setup', 't', 1)"),
                     {"u": world.users["support"]})
    # Support (now also Billing) holds no security.roles.assign: refused before anything.
    refused = world.post("/api/admin/staff/roles", "auditor", user_id=world.users["customer"],
                         role="support", reason="x", confirm="x")
    assert refused.status_code == 403


def test_the_owner_gives_a_role_with_the_email_typed(world):
    email = record(world)["user"]["email"]
    made = world.post("/api/admin/staff/roles", user_id=world.users["customer"], role="analyst",
                      reason="new analyst", confirm=email)
    assert made.status_code == 201, made.text
    staff = world.get("/api/admin/staff").json()["staff"]
    assert any(p["user_id"] == world.users["customer"] for p in staff)


def test_the_last_owner_cannot_be_revoked_from_the_console(world):
    staff = world.get("/api/admin/staff").json()["staff"]
    owner = next(p for p in staff if p["user_id"] == world.users["owner"])
    assignment = next(r for r in owner["roles"] if r["role"] == "owner")
    answer = world.post(f"/api/admin/staff/roles/{assignment['id']}/revoke", reason="leave",
                        confirm=owner["email"])
    assert answer.status_code in (403, 409)


def test_the_blast_limit_refuses_and_alerts(world, monkeypatch):
    import dataclasses

    from selecta.admin import tiers

    one = dataclasses.replace(tiers.ACTIONS["account.sign_out"], per_hour=1)
    monkeypatch.setattr(tiers, "ACTIONS", {**tiers.ACTIONS, "account.sign_out": one})
    target = world.users["customer"]
    assert world.post(f"/api/admin/customers/{target}/sign-out", reason="one").status_code == 200
    second = world.post(f"/api/admin/customers/{target}/sign-out", reason="two")
    assert (second.status_code, code(second)) == (429, "blast_limit")
    with world.engine.connect() as conn:
        kinds = set(conn.execute(sa.select(platform_alerts.c.kind)).scalars())
    assert alerts.BLAST_LIMIT in kinds


def test_the_storage_switch_grants_and_removes_hosted_media(world):
    target = world.users["customer"]
    before = world.get(f"/api/admin/customers/{target}/storage-mode").json()
    assert before["grant"]["value"] == "default"
    path = f"/api/admin/customers/{target}/storage-mode"
    on = world.http.put(path, headers=world.headers("owner"),
                        json={"mode": "hosted", "reason": "pilot", "version": before["version"]})
    assert on.status_code == 200, on.text
    with world.engine.connect() as conn:
        rules = flag_rules.current_rules(conn, HOSTED)
    grant = next(r for r in rules if r.params.get("note") == NOTE_ON)
    assert world.workspaces["customer"] in grant.params["ids"] and rules[0] == grant
    off = world.http.put(path, headers=world.headers("owner"),
                         json={"mode": "browser", "reason": "pilot over"})
    assert off.status_code == 200, off.text
    with world.engine.connect() as conn:
        assert all(r.params.get("note") != NOTE_ON for r in flag_rules.current_rules(conn, HOSTED))


def test_support_cannot_change_storage_mode(world):
    target = world.users["customer"]
    answer = world.http.put(f"/api/admin/customers/{target}/storage-mode",
                            headers=world.headers("support"),
                            json={"mode": "hosted", "reason": "x"})
    assert answer.status_code == 403


def test_a_published_banner_is_what_customers_read(world):
    assert world.http.get("/api/status-banner").json() == {"banner": None}
    refused = world.post("/api/admin/banners", text="Maintenance at 22:00", level="maintenance",
                         confirm="nope")
    assert code(refused) == "confirm_mismatch"
    made = world.post("/api/admin/banners", text="Maintenance at 22:00", level="maintenance",
                      confirm="publish")
    assert made.status_code == 201, made.text
    assert world.http.get("/api/status-banner").json()["banner"]["text"] == "Maintenance at 22:00"
    ended = world.post(f"/api/admin/banners/{made.json()['id']}/end")
    assert ended.status_code == 200
    assert world.http.get("/api/status-banner").json() == {"banner": None}


def test_me_describes_the_roles_tiers_and_matrix(world):
    me = world.get("/api/admin/me").json()
    assert me["can_write"] is True
    assert {a["id"] for a in me["actions"]} >= {"account.suspend", "refund.create"}
    assert "accounts.configure" in me["role_matrix"]["billing"]["permissions"]
    assert me["roles"][0]["purpose"]


def test_the_auditor_cannot_write_even_in_change_mode(world):
    answer = world.post(f"/api/admin/customers/{world.users['customer']}/sign-out", "auditor",
                        reason="x")
    assert answer.status_code == 403
