"""The BF-0465 grandfather population is visible, exact and permission-protected in admin."""

from __future__ import annotations

import pytest
from cloud_admin_kit import make_world

from selecta.flags import rules as flag_rules
from selecta.lf_migration.grandfather import build_grandfather_rules
from selecta.persistence import transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets


@pytest.fixture
def world(cloud_engine):
    built = make_world(cloud_engine, staff=("owner", "support"))
    yield built
    built.http.__exit__(None, None, None)


def _asset(conn, workspace_id: str, asset_id: str) -> None:
    conn.execute(
        assets.insert().values(
            id=asset_id,
            workspace_id=workspace_id,
            original_key=original_key(workspace_id, asset_id),
            size=100,
            sha256="a" * 64,
            format="wav",
            created_at=10,
        )
    )


def test_admin_view_compares_completed_uploads_with_live_grants(world):
    uploaded = world.workspaces["customer"]
    stale = world.workspaces["customer2"]
    with transaction(world.engine) as conn:
        _asset(conn, uploaded, "asset-a")
        flag_rules.save(
            conn,
            "cloud.hosted_media",
            build_grandfather_rules([uploaded, stale]),
            author="test",
            reason="audit fixture",
        )

    answer = world.get("/api/admin/flags/cloud.hosted_media/grandfather-audit")
    assert answer.status_code == 200, answer.text
    audit = answer.json()["audit"]
    assert audit["complete"] is False
    assert audit["missing"] == []
    assert audit["stale_grants"] == [stale]
    assert audit["workspaces"] == [
        {
            "workspace_id": uploaded,
            "uploaded_assets": 1,
            "first_upload_at": 10.0,
            "last_upload_at": 10.0,
            "granted": True,
            "reason": "completed_upload",
        }
    ]


def test_admin_view_requires_flags_read(world):
    denied = world.get(
        "/api/admin/flags/cloud.hosted_media/grandfather-audit", who="customer"
    )
    assert denied.status_code in (401, 403)
