"""The BF-0465-01 grandfather audit in the admin console: visible to staff with `flags.read`,
refused to everyone else, read-only, and ids and counts only (ADR-0465)."""

from __future__ import annotations

import json

import pytest
import sqlalchemy as sa
from cloud_admin_kit import make_world

from selecta.flags import rules as flag_rules
from selecta.hosted_coexistence.grandfather import build_grandfather_rules
from selecta.persistence import transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets

PATH = "/api/admin/flags/cloud.hosted_media/grandfather-audit"


@pytest.fixture
def world(cloud_engine):
    built = make_world(cloud_engine, staff=("owner", "support", "auditor"))
    yield built
    built.http.__exit__(None, None, None)


def _asset(conn, workspace_id: str, asset_id: str, *, deleted: bool = False) -> None:
    conn.execute(
        assets.insert().values(
            id=asset_id,
            workspace_id=workspace_id,
            original_key=original_key(workspace_id, asset_id),
            size=100,
            sha256="a" * 64,
            format="wav",
            created_at=10,
            deleted_at=11 if deleted else None,
        )
    )


def _seed(world) -> tuple[str, str]:
    uploaded = world.workspaces["customer"]
    missed = world.workspaces["customer2"]
    with transaction(world.engine) as conn:
        _asset(conn, uploaded, "asset-live")
        _asset(conn, missed, "asset-deleted", deleted=True)
        flag_rules.save(
            conn,
            "cloud.hosted_media",
            build_grandfather_rules([uploaded, "ws-admin-granted"]),
            author="test",
            reason="audit fixture",
        )
    return uploaded, missed


def _rule_state(engine) -> tuple[int, int]:
    with transaction(engine) as conn:
        count = sa.select(sa.func.count())
        versions = conn.execute(count.select_from(flag_rules.flag_rule_versions)).scalar_one()
        rows = conn.execute(count.select_from(flag_rules.flag_rules)).scalar_one()
        return int(versions), int(rows)


@pytest.mark.parametrize("who", ["owner", "support", "auditor"])
def test_staff_with_flags_read_see_the_population_against_the_live_grants(world, who):
    uploaded, missed = _seed(world)
    answer = world.get(PATH, who=who)
    assert answer.status_code == 200, answer.text
    audit = answer.json()["audit"]
    assert audit["complete"] is False
    assert audit["missing"] == [missed]
    assert audit["stale_grants"] == ["ws-admin-granted"]
    assert audit["counts"] == {"detected": 2, "granted": 1, "missing": 1, "stale_grants": 1}
    rows = {row["workspace_id"]: row for row in audit["workspaces"]}
    assert rows[uploaded]["granted"] is True
    assert rows[uploaded]["decided_by"] == "rule 1 (workspaces)"
    assert rows[missed] == {
        "workspace_id": missed,
        "uploaded_assets": 1,
        "deleted_assets": 1,
        "first_upload_at": 10.0,
        "last_upload_at": 10.0,
        "granted": False,
        "decided_by": "rule 2 (percentage)",
        "reason": "completed_upload_missing_grant",
    }


def test_the_audit_never_shows_asset_ids_or_object_keys(world):
    uploaded, _ = _seed(world)
    text = json.dumps(world.get(PATH).json())
    for leak in ("asset-live", "asset-deleted", original_key(uploaded, "asset-live"), "wav"):
        assert leak not in text


def test_the_audit_is_read_only(world):
    _seed(world)
    before = _rule_state(world.engine)
    assert world.get(PATH).status_code == 200
    assert _rule_state(world.engine) == before
    for method in ("post", "put", "delete"):
        refused = getattr(world.http, method)(PATH, headers=world.headers("owner"))
        # Never a write: no handler takes another method here (405, or refused earlier).
        assert refused.status_code in (401, 403, 404, 405)
    assert _rule_state(world.engine) == before


@pytest.mark.parametrize("who", ["customer", "newcomer"])
def test_non_staff_are_refused(world, who):
    _seed(world)
    denied = world.get(PATH, who=who)
    assert denied.status_code in (401, 403)
    assert "audit" not in denied.json()


def test_a_customer_with_a_forged_admin_session_header_is_refused(world):
    _seed(world)
    headers = world.headers("customer") | {"X-Admin-Session": world.sessions["owner"]}
    denied = world.http.get(PATH, headers=headers)
    assert denied.status_code in (401, 403)
    assert "audit" not in denied.json()
