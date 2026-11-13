"""rc-saz: staff can't use the admin console on their own customer workspace.

A staff member's own library is a customer workspace (docs/saas/07, "staff browsing their own
library act as a customer"). The console must not let them hand that workspace a paid plan or
lift its upload restriction: either would bypass billing or a copyright decision with nobody
else involved. Suspending yourself is already refused the same way.
"""

from __future__ import annotations

import time

import pytest
import sqlalchemy as sa
from cloud_admin_kit import audit_actions, make_world

from selecta.admin.schema import upload_restrictions
from selecta.billing.schema import entitlement_overrides
from selecta.persistence import db_now, transaction


@pytest.fixture
def world(cloud_engine):
    built = make_world(cloud_engine, staff=("owner", "auditor"))
    yield built
    built.http.__exit__(None, None, None)


def _overrides(engine, workspace_id: str) -> int:
    with engine.connect() as conn:
        return conn.execute(
            sa.select(sa.func.count())
            .select_from(entitlement_overrides)
            .where(entitlement_overrides.c.workspace_id == workspace_id)
        ).scalar_one()


def test_staff_cannot_grant_their_own_workspace_a_plan(world):
    own = world.workspaces["owner"]
    answer = world.post("/api/admin/overrides", workspace_id=own, plan_id="premium",
                        reason="treat myself", expires_at=time.time() + 86_400)
    assert answer.status_code == 403, answer.text
    assert answer.json()["detail"]["code"] == "self_approval"
    assert _overrides(world.engine, own) == 0
    assert world.get("/api/account", "owner").json()["entitlement"]["plan"] == "free"
    denies = audit_actions(world.engine, actor_id=world.users["owner"], result="deny")
    assert any(row["action"] == "billing.overrides.create" for row in denies)
    # Someone else's workspace still works.
    other = world.post("/api/admin/overrides", workspace_id=world.workspaces["customer"],
                       plan_id="premium", reason="service recovery",
                       expires_at=time.time() + 86_400)
    assert other.status_code == 201, other.text


def test_a_mass_override_cannot_include_the_proposers_own_workspace(world):
    targets = [world.workspaces["owner"], world.workspaces["customer"]]
    answer = world.post("/api/admin/overrides/mass", workspace_ids=targets, plan_id="premium",
                        reason="outage credit", expires_at=time.time() + 86_400)
    assert answer.status_code == 403, answer.text
    assert answer.json()["detail"]["code"] == "self_approval"


def test_staff_cannot_lift_their_own_upload_restriction(world):
    own = world.workspaces["owner"]
    with transaction(world.engine, own) as conn:
        conn.execute(upload_restrictions.insert().values(
            workspace_id=own, reason="repeat infringer", restricted_at=db_now(conn),
            restricted_by="legal"))
    answer = world.post(f"/api/admin/upload-restrictions/{own}/lift", reason="appeal")
    assert answer.status_code == 403, answer.text
    assert answer.json()["detail"]["code"] == "self_approval"
    with world.engine.connect() as conn:
        lifted = conn.execute(sa.select(upload_restrictions.c.lifted_at).where(
            upload_restrictions.c.workspace_id == own)).scalar_one()
    assert lifted is None
