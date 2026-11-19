"""The grandfather population, its rules and their audit (ADR-0465, BF-0465-01).

Detection reads the real `assets` table (soft-deleted rows included); the rules are the real
`flags.matching` shapes, so these tests break if the rule language moves; the audit evaluates the
rules layer in order, and its output must carry ids and counts only. The flip guard's use of the
audit (`grandfather_missing`) is covered at the end."""

from __future__ import annotations

import json

import pytest

from selecta.flags import State
from selecta.flags import rules as flag_rules
from selecta.flags.flip_guard import HOSTED_MEDIA, check_flip, check_flip_now
from selecta.flags.matching import MAX_IDS, Rule, RuleKind
from selecta.hosted_coexistence.grandfather import (
    GRANDFATHER_SALT,
    audit_grandfather_rules,
    build_grandfather_rules,
    detected_workspaces,
)
from selecta.identity.schema import users, workspaces
from selecta.persistence import transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets

BUILD_ON = {HOSTED_MEDIA: State(on=True, why="SELECTA_FLAGS")}


def _account(conn, workspace: str, user: str) -> None:
    conn.execute(
        users.insert().values(
            id=user,
            auth_subject=f"auth-{user}",
            email_verified=True,
            timezone="UTC",
            age_confirmed=True,
            created_at=1,
        )
    )
    conn.execute(
        workspaces.insert().values(
            id=workspace, name="Name", kind="personal", owner_user_id=user, created_at=1
        )
    )


def _asset(conn, workspace: str, asset_id: str, created_at: float, *, deleted: bool = False):
    conn.execute(
        assets.insert().values(
            id=asset_id,
            workspace_id=workspace,
            original_key=original_key(workspace, asset_id),
            size=100,
            sha256=asset_id[-1] * 64,
            format="wav",
            created_at=created_at,
            deleted_at=created_at + 1 if deleted else None,
        )
    )


@pytest.fixture
def seeded(cloud_engine):
    """ws-a: one live and one soft-deleted upload; ws-b: one live upload; ws-gone: only
    soft-deleted uploads; ws-none: an account that never uploaded."""
    with transaction(cloud_engine) as conn:
        for workspace, user in (
            ("ws-a", "user-a"),
            ("ws-b", "user-b"),
            ("ws-gone", "user-gone"),
            ("ws-none", "user-none"),
        ):
            _account(conn, workspace, user)
        _asset(conn, "ws-a", "asset-a1", 10)
        _asset(conn, "ws-a", "asset-a2", 20, deleted=True)
        _asset(conn, "ws-b", "asset-b1", 30)
        _asset(conn, "ws-gone", "asset-g1", 40, deleted=True)
    return cloud_engine


# Detection


def test_detection_finds_every_workspace_that_ever_completed_an_upload(seeded):
    with transaction(seeded) as conn:
        found = detected_workspaces(conn)
    assert [
        (row.workspace_id, row.owner_user_id, row.uploaded_assets, row.deleted_assets)
        for row in found
    ] == [
        ("ws-a", "user-a", 2, 1),
        ("ws-b", "user-b", 1, 0),
        ("ws-gone", "user-gone", 1, 1),
    ]
    assert (found[0].first_upload_at, found[0].last_upload_at) == (10, 20)


def test_detection_keeps_a_workspace_whose_every_upload_was_deleted(seeded):
    with transaction(seeded) as conn:
        ids = [row.workspace_id for row in detected_workspaces(conn)]
    assert "ws-gone" in ids
    assert "ws-none" not in ids


# Rules


def test_rules_are_workspace_grants_then_user_exceptions_then_the_catch_all_off():
    rules = build_grandfather_rules(["ws-b", "ws-a"], user_ids=["user-x"], note="query 2026-11-17")
    assert [rule.kind for rule in rules] == [
        RuleKind.WORKSPACES,
        RuleKind.USERS,
        RuleKind.PERCENTAGE,
    ]
    assert rules[0].params["ids"] == ("ws-a", "ws-b")
    assert rules[0].params["on"] is True
    assert rules[0].params["note"] == "query 2026-11-17"
    assert rules[1].params["ids"] == ("user-x",)
    assert dict(rules[-1].params) == {
        "percent": 0,
        "salt": GRANDFATHER_SALT,
        "note": "catch-all off: hosted media is grant-only below this line",
    }
    assert all(not rule.problems and rule.enabled for rule in rules)


def test_rules_chunk_the_grants_under_the_id_limit():
    ids = [f"ws-{index:05d}" for index in range(2 * MAX_IDS + 1)]
    rules = build_grandfather_rules(ids)
    assert [rule.kind for rule in rules] == [RuleKind.WORKSPACES] * 3 + [RuleKind.PERCENTAGE]
    assert [len(rule.params["ids"]) for rule in rules[:3]] == [MAX_IDS, MAX_IDS, 1]
    assert [item for rule in rules[:3] for item in rule.params["ids"]] == ids
    assert all(not rule.problems for rule in rules)


def test_a_population_of_exactly_the_limit_is_one_grant():
    rules = build_grandfather_rules([f"ws-{index:05d}" for index in range(MAX_IDS)])
    assert [rule.kind for rule in rules] == [RuleKind.WORKSPACES, RuleKind.PERCENTAGE]


def test_built_rules_pass_the_flip_guard_shape_checks():
    rules = build_grandfather_rules(["ws-a"])
    assert check_flip(rules, BUILD_ON, grandfather_verified=True, gates_green=True) == []


@pytest.mark.parametrize("ids", [[""], ["  "], ["ws-a", "ws-a"]])
def test_rule_builder_refuses_an_unauditable_population(ids):
    with pytest.raises(ValueError):
        build_grandfather_rules(ids)


# Audit


def test_audit_reports_missing_and_stale_with_the_deciding_rule(seeded):
    with transaction(seeded) as conn:
        audit = audit_grandfather_rules(conn, build_grandfather_rules(["ws-a", "ws-stale"]))
    assert audit.missing == ("ws-b", "ws-gone")
    assert audit.stale_grants == ("ws-stale",)
    assert audit.complete is False
    decided = {row.workspace_id: (row.granted, row.decided_by) for row in audit.workspaces}
    assert decided == {
        "ws-a": (True, "rule 1 (workspaces)"),
        "ws-b": (False, "rule 2 (percentage)"),
        "ws-gone": (False, "rule 2 (percentage)"),
    }


def test_audit_is_complete_when_every_detected_workspace_is_granted(seeded):
    with transaction(seeded) as conn:
        exact = audit_grandfather_rules(conn, build_grandfather_rules(["ws-a", "ws-b", "ws-gone"]))
        extra = audit_grandfather_rules(
            conn, build_grandfather_rules(["ws-a", "ws-b", "ws-gone", "ws-admin-granted"])
        )
    assert exact.complete is True
    # A grant beyond the population is an owner's ADR-0456 grant: reported, never a failure.
    assert extra.complete is True
    assert extra.stale_grants == ("ws-admin-granted",)


def test_a_user_exception_for_the_owner_counts_as_the_workspace_grant(seeded):
    with transaction(seeded) as conn:
        audit = audit_grandfather_rules(
            conn, build_grandfather_rules(["ws-a", "ws-gone"], user_ids=["user-b"])
        )
    assert audit.complete is True


def test_a_grant_below_the_catch_all_is_missing_not_granted(seeded):
    catch_all, *_ = build_grandfather_rules([])
    grant = Rule(RuleKind.WORKSPACES, {"ids": ["ws-a", "ws-b", "ws-gone"], "on": True})
    with transaction(seeded) as conn:
        audit = audit_grandfather_rules(conn, [catch_all, grant])
    assert audit.missing == ("ws-a", "ws-b", "ws-gone")


def test_a_kill_switch_or_disabled_grant_leaves_the_population_missing(seeded):
    rules = build_grandfather_rules(["ws-a", "ws-b", "ws-gone"])
    disabled = Rule(rules[0].kind, rules[0].params, enabled=False)
    with transaction(seeded) as conn:
        killed = audit_grandfather_rules(conn, [Rule(RuleKind.KILL_SWITCH, {}), *rules])
        off = audit_grandfather_rules(conn, [disabled, rules[-1]])
    assert killed.missing == ("ws-a", "ws-b", "ws-gone")
    assert {row.decided_by for row in killed.workspaces} == {"kill switch"}
    assert off.missing == ("ws-a", "ws-b", "ws-gone")


def test_audit_output_holds_ids_counts_and_times_only(seeded):
    with transaction(seeded) as conn:
        view = audit_grandfather_rules(conn, build_grandfather_rules(["ws-a"])).as_dict()
    assert view["counts"] == {"detected": 3, "granted": 1, "missing": 2, "stale_grants": 0}
    assert set(view) == {"complete", "counts", "missing", "stale_grants", "workspaces"}
    assert set(view["workspaces"][0]) == {
        "workspace_id",
        "uploaded_assets",
        "deleted_assets",
        "first_upload_at",
        "last_upload_at",
        "granted",
        "decided_by",
        "reason",
    }
    text = json.dumps(view)
    for leak in ("asset-a1", "asset-b1", "originals/", "wav", original_key("ws-a", "asset-a1")):
        assert leak not in text


# The flip guard consumes the audit


def test_check_flip_refuses_while_the_audit_names_missing_workspaces():
    refusals = check_flip(
        build_grandfather_rules(["ws-a"]),
        BUILD_ON,
        grandfather_verified=True,
        gates_green=True,
        grandfather_missing=("ws-b",),
    )
    assert len(refusals) == 1
    assert "ws-b" in refusals[0] and "1 workspace" in refusals[0]


def test_check_flip_now_reruns_the_audit_over_the_stored_rules(seeded):
    with transaction(seeded) as conn:
        flag_rules.save(
            conn,
            HOSTED_MEDIA,
            build_grandfather_rules(["ws-a"]),
            author="test",
            reason="first pass [grandfather-verified]",
        )
    with transaction(seeded) as conn:
        partial = check_flip_now(conn, gates_green=True, flags_effective=BUILD_ON)
    assert len(partial) == 1 and "ws-b" in partial[0] and "ws-gone" in partial[0]

    with transaction(seeded) as conn:
        flag_rules.save(
            conn,
            HOSTED_MEDIA,
            build_grandfather_rules(["ws-a", "ws-b", "ws-gone"]),
            author="test",
            reason="complete [grandfather-verified]",
        )
    with transaction(seeded) as conn:
        assert check_flip_now(conn, gates_green=True, flags_effective=BUILD_ON) == []
