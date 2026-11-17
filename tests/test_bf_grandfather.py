"""Grandfather detection and rule audit for BF-0465-01."""

from __future__ import annotations

import pytest

from selecta.flags.matching import MAX_IDS, RuleKind
from selecta.identity.schema import users, workspaces
from selecta.lf_migration.grandfather import audit_grandfather_rules, build_grandfather_rules
from selecta.persistence import transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets


def _asset(conn, workspace: str, suffix: str, created_at: float, *, deleted: bool = False):
    conn.execute(
        assets.insert().values(
            id=f"asset-{suffix}",
            workspace_id=workspace,
            original_key=original_key(workspace, f"asset-{suffix}"),
            size=100,
            sha256=suffix[0] * 64,
            format="wav",
            created_at=created_at,
            deleted_at=created_at + 1 if deleted else None,
        )
    )


def test_audit_finds_every_workspace_that_ever_completed_an_upload(cloud_engine):
    with transaction(cloud_engine) as conn:
        conn.execute(
            users.insert(),
            [
                {
                    "id": "user-a",
                    "auth_subject": "auth-a",
                    "email_verified": True,
                    "timezone": "UTC",
                    "age_confirmed": True,
                    "created_at": 1,
                },
                {
                    "id": "user-b",
                    "auth_subject": "auth-b",
                    "email_verified": True,
                    "timezone": "UTC",
                    "age_confirmed": True,
                    "created_at": 1,
                },
            ],
        )
        conn.execute(
            workspaces.insert(),
            [
                {
                    "id": "ws-a",
                    "name": "A",
                    "kind": "personal",
                    "owner_user_id": "user-a",
                    "created_at": 1,
                },
                {
                    "id": "ws-b",
                    "name": "B",
                    "kind": "personal",
                    "owner_user_id": "user-b",
                    "created_at": 1,
                },
            ],
        )
        _asset(conn, "ws-a", "a1", 10)
        _asset(conn, "ws-a", "a2", 20, deleted=True)
        _asset(conn, "ws-b", "b1", 30)
        rules = build_grandfather_rules(["ws-a", "ws-stale"])
        audit = audit_grandfather_rules(conn, rules)

    assert [(row.workspace_id, row.uploaded_assets, row.granted) for row in audit.workspaces] == [
        ("ws-a", 2, True),
        ("ws-b", 1, False),
    ]
    assert audit.workspaces[0].first_upload_at == 10
    assert audit.workspaces[0].last_upload_at == 20
    assert audit.missing == ("ws-b",)
    assert audit.stale_grants == ("ws-stale",)
    assert audit.complete is False
    assert audit.as_dict() == {
        "complete": False,
        "missing": ["ws-b"],
        "stale_grants": ["ws-stale"],
        "workspaces": [
            {
                "workspace_id": "ws-a",
                "uploaded_assets": 2,
                "first_upload_at": 10,
                "last_upload_at": 20,
                "granted": True,
                "reason": "completed_upload",
            },
            {
                "workspace_id": "ws-b",
                "uploaded_assets": 1,
                "first_upload_at": 30,
                "last_upload_at": 30,
                "granted": False,
                "reason": "completed_upload_missing_grant",
            },
        ],
    }


def test_audit_is_complete_only_for_an_exact_population(cloud_engine):
    with transaction(cloud_engine) as conn:
        conn.execute(
            users.insert().values(
                id="user-a",
                auth_subject="auth-a",
                email_verified=True,
                timezone="UTC",
                age_confirmed=True,
                created_at=1,
            )
        )
        conn.execute(
            workspaces.insert().values(
                id="ws-a", name="A", kind="personal", owner_user_id="user-a", created_at=1
            )
        )
        _asset(conn, "ws-a", "a1", 10)
        exact = audit_grandfather_rules(conn, build_grandfather_rules(["ws-a"]))
        stale = audit_grandfather_rules(conn, build_grandfather_rules(["ws-a", "ws-stale"]))

    assert exact.complete is True
    assert exact.as_dict()["complete"] is True
    assert stale.missing == ()
    assert stale.complete is False


def test_rule_builder_chunks_grants_and_always_finishes_with_catch_all_off():
    ids = [f"ws-{index:05d}" for index in range(MAX_IDS + 1)]
    rules = build_grandfather_rules(ids)
    assert [rule.kind for rule in rules] == [
        RuleKind.WORKSPACES,
        RuleKind.WORKSPACES,
        RuleKind.PERCENTAGE,
    ]
    assert len(rules[0].params["ids"]) == MAX_IDS
    assert rules[1].params["ids"] == (ids[-1],)
    assert rules[-1].params["percent"] == 0
    assert not rules[-1].problems


@pytest.mark.parametrize("ids", [[""], ["ws-a", "ws-a"]])
def test_rule_builder_refuses_an_unauditable_population(ids):
    with pytest.raises(ValueError):
        build_grandfather_rules(ids)
