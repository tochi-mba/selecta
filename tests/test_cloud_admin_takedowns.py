"""Copyright takedowns and the repeat-infringer policy (ADR-0413 SC-0413-02/03, §12.3).

A notice is logged with when it arrived and when it must be decided by; acting on it hides the
asset and starts its deletion through the storage deletion ledger; each step is audited. When a
workspace reaches the configured number of valid notices its uploads are suspended, an Owner is
alerted, and the upload API refuses it until staff lift the restriction.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_admin_kit import audit_actions, make_world

from selecta.admin import alerts
from selecta.admin.schema import platform_alerts
from selecta.admin.takedowns import RESPONSE_HOURS
from selecta.persistence import db_now, new_id, transaction
from selecta.storage.schema import assets, deletions


@pytest.fixture
def world(cloud_engine, monkeypatch):
    monkeypatch.setenv("SELECTA_REPEAT_INFRINGER_NOTICES", "2")
    built = make_world(cloud_engine)
    yield built
    built.http.__exit__(None, None, None)


def add_asset(world, who: str = "customer") -> str:
    asset_id = new_id()
    workspace_id = world.workspaces[who]
    with transaction(world.engine, workspace_id) as conn:
        conn.execute(
            assets.insert().values(
                id=asset_id,
                workspace_id=workspace_id,
                original_key=f"originals/{asset_id}",
                size=1000,
                sha256="0" * 64,
                format="flac",
                created_at=db_now(conn),
            )
        )
    return asset_id


def log(world, asset_id: str, who: str = "owner", workspace: str = "customer"):
    return world.post(
        "/api/admin/takedowns",
        who,
        workspace_id=world.workspaces[workspace],
        asset_id=asset_id,
        complainant="Rights Holder Ltd",
        work="Song Title by Artist",
    )


@pytest.mark.invariants_off("its asset rows use test keys outside w/{workspace}/")
def test_a_notice_is_logged_with_its_deadline_and_audited(world):
    asset_id = add_asset(world)
    answer = log(world, asset_id)
    assert answer.status_code == 201, answer.text
    notice = answer.json()["notice"]
    assert notice["status"] == "received" and notice["overdue"] is False
    assert notice["due_by"] - notice["received_at"] == RESPONSE_HOURS * 3600
    logged = audit_actions(world.engine, action="legal.takedown.logged")
    assert [row["resource_id"] for row in logged] == [notice["id"]]
    listed = world.get("/api/admin/takedowns").json()["notices"]
    assert [item["id"] for item in listed] == [notice["id"]]


@pytest.mark.invariants_off("its asset rows use test keys outside w/{workspace}/")
def test_acting_hides_the_asset_and_starts_its_deletion(world):
    asset_id = add_asset(world)
    notice = log(world, asset_id).json()["notice"]
    acted = world.post(f"/api/admin/takedowns/{notice['id']}/act", reason="valid notice")
    assert acted.status_code == 200, acted.text
    body = acted.json()
    assert body["notice"]["status"] == "actioned" and body["valid_notices"] == 1
    assert body["uploads_restricted"] is False
    with world.engine.connect() as conn:
        hidden = conn.execute(sa.select(assets.c.deleted_at).where(assets.c.id == asset_id))
        assert hidden.scalar_one() is not None
        ledger = conn.execute(
            sa.select(deletions.c.id, deletions.c.kind).where(deletions.c.ref == asset_id)
        ).one()
    assert ledger.kind == "song" and body["notice"]["deletion_id"] == ledger.id
    actioned = audit_actions(world.engine, action="legal.takedown.actioned")
    assert actioned[0]["metadata"]["within_target"] is True
    again = world.post(f"/api/admin/takedowns/{notice['id']}/act", reason="twice")
    assert again.status_code == 400


@pytest.mark.invariants_off("its asset rows use test keys outside w/{workspace}/")
def test_a_rejected_notice_leaves_the_asset_alone(world):
    asset_id = add_asset(world)
    notice = log(world, asset_id).json()["notice"]
    rejected = world.post(f"/api/admin/takedowns/{notice['id']}/reject", reason="no rights shown")
    assert rejected.json()["notice"]["status"] == "rejected"
    with world.engine.connect() as conn:
        assert (
            conn.execute(sa.select(assets.c.deleted_at).where(assets.c.id == asset_id)).scalar_one()
            is None
        )
    assert audit_actions(world.engine, action="legal.takedown.rejected")


@pytest.mark.invariants_off("its asset rows use test keys outside w/{workspace}/")
def test_repeated_valid_notices_suspend_uploads_until_lifted(world):
    for _ in range(2):
        notice = log(world, add_asset(world)).json()["notice"]
        last = world.post(f"/api/admin/takedowns/{notice['id']}/act", reason="valid")
    assert last.json()["uploads_restricted"] is True
    assert audit_actions(world.engine, action="legal.uploads.restricted")
    with world.engine.connect() as conn:
        kinds = conn.execute(sa.select(platform_alerts.c.kind)).scalars().all()
    assert alerts.REPEAT_INFRINGER in kinds

    plan = world.post("/api/uploads/plan", "customer", files=[{"name": "a.flac", "size": 10}])
    assert (plan.status_code, plan.json()["detail"]["code"]) == (403, "uploads_restricted")
    other = world.post("/api/uploads/plan", "customer2", files=[{"name": "a.flac", "size": 10}])
    assert other.json().get("detail", {}).get("code") != "uploads_restricted"
    account = world.get(f"/api/admin/accounts/{world.users['customer']}").json()
    assert account["uploads_restricted"] is True and account["valid_takedown_notices"] == 2

    lifted = world.post(
        f"/api/admin/upload-restrictions/{world.workspaces['customer']}/lift",
        reason="counter-notice accepted",
    )
    assert lifted.json()["lifted"] is True
    plan = world.post("/api/uploads/plan", "customer", files=[{"name": "a.flac", "size": 10}])
    assert plan.json().get("detail", {}).get("code") != "uploads_restricted"
    assert audit_actions(world.engine, action="legal.uploads.restriction_lifted")


@pytest.mark.invariants_off("its asset rows use test keys outside w/{workspace}/")
def test_a_role_without_the_takedown_permission_is_denied_and_audited(world):
    asset_id = add_asset(world)
    answer = log(world, asset_id, who="auditor")
    assert (answer.status_code, answer.json()["detail"]["code"]) == (403, "forbidden")
    denied = audit_actions(world.engine, action="legal.takedowns.manage", result="deny")
    assert [row["actor_id"] for row in denied] == [world.users["auditor"]]


@pytest.mark.invariants_off("its asset rows use test keys outside w/{workspace}/")
def test_a_notice_must_name_an_asset_in_that_workspace(world):
    asset_id = add_asset(world, "customer2")
    answer = log(world, asset_id)
    assert answer.status_code == 404


@pytest.mark.invariants_off("its asset rows use test keys outside w/{workspace}/")
@pytest.mark.parametrize("command", ["act", "reject"])
def test_deciding_a_notice_runs_as_the_notice_workspace(world, monkeypatch, command):
    """Acting on or rejecting a notice writes that workspace's rows, so its transaction names the
    workspace and PostgreSQL's row-level security applies, as other workspace writes do."""
    from selecta.admin import http as admin_http

    asset_id = add_asset(world)
    notice = log(world, asset_id).json()["notice"]
    real = admin_http.transaction
    named: list[str | None] = []

    def recording(engine, workspace_id=None):
        named.append(workspace_id)
        return real(engine, workspace_id)

    monkeypatch.setattr(admin_http, "transaction", recording)
    answer = world.post(f"/api/admin/takedowns/{notice['id']}/{command}", reason="decided")
    assert answer.status_code == 200, answer.text
    assert world.workspaces["customer"] in named
