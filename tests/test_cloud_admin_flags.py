"""The admin Flags page service (ADR-0414 SC-0414-06, §11B.5 and §11B.9): kill switch, tier,
user, rollout and schedule actions with impact preview, trace, history and rollback, and broad
changes delayed. Every change is audited; a kill switch alerts.
"""

from __future__ import annotations

import time

import pytest
import sqlalchemy as sa
from cloud_admin_kit import audit_actions, make_due, make_world

from selecta.admin import alerts
from selecta.admin.schema import platform_alerts
from selecta.flags import rules as flag_rules
from selecta.persistence import transaction

FLAG = "rooms"


@pytest.fixture
def world(cloud_engine):
    built = make_world(cloud_engine, staff=("owner", "operator", "support", "ai_admin"))
    yield built
    built.http.__exit__(None, None, None)


def change(world, action: str, who: str = "owner", flag: str = FLAG, **params):
    return world.post(f"/api/admin/flags/{flag}/change", who, action=action, reason="test",
                      params=params)


def rules_of(world, flag: str = FLAG) -> list[str]:
    with transaction(world.engine) as conn:
        return [rule.kind for rule in flag_rules.current_rules(conn, flag)]


def test_a_kill_switch_is_instant_audited_and_alerted(world):
    answer = change(world, "kill_switch", "operator")
    assert answer.status_code == 200 and answer.json()["applied"] is True, answer.text
    assert rules_of(world) == ["kill_switch"]
    assert audit_actions(world.engine, action="flags.rules.change", resource_id=FLAG)
    with world.engine.connect() as conn:
        kinds = conn.execute(sa.select(platform_alerts.c.kind)).scalars().all()
    assert alerts.KILL_SWITCH in kinds
    again = change(world, "kill_switch", "operator")
    assert again.json()["applied"] is True and rules_of(world) == ["kill_switch"]


def test_switching_a_feature_off_for_a_whole_tier_waits_as_a_broad_change(world):
    preview = world.post(f"/api/admin/flags/{FLAG}/impact", action="off_for_tier",
                         params={"plan": "free"})
    assert preview.json()["broad"] is True
    queued = change(world, "off_for_tier", plan="free").json()
    assert queued["applied"] is False and queued["action_id"]
    assert rules_of(world) == []
    make_due(world.engine, queued["action_id"])
    done = world.post(f"/api/admin/actions/{queued['action_id']}/execute")
    assert done.json()["ok"] is True, done.text
    assert rules_of(world) == ["segment"]
    proposed = audit_actions(world.engine, action="dangerous_action.proposed")
    assert proposed[0]["metadata"]["kind"] == "flags.rules.broad"


def test_impact_preview_counts_accounts_by_plan_and_lists_dependents(world):
    preview = world.post(f"/api/admin/flags/{FLAG}/impact", action="kill_switch").json()
    assert preview["accounts"] == len(world.users)
    assert "rooms.votes" in preview["dependents"]
    assert set(preview["flags"][FLAG]["by_plan"]) == {"free"}


def test_one_account_is_a_per_workspace_override_and_many_need_the_rules_power(world):
    one = change(world, "off_for_users", "support", user_ids=[world.users["customer"]])
    assert one.json()["applied"] is True, one.text
    many = change(world, "off_for_users", "support",
                  user_ids=[world.users["customer"], world.users["customer2"]])
    assert (many.status_code, many.json()["detail"]["code"]) == (403, "forbidden")
    assert audit_actions(world.engine, action="flags.rules.propose", result="deny")


def test_ai_admin_changes_only_lucy_flags(world):
    refused = change(world, "kill_switch", "ai_admin")
    assert refused.status_code == 403
    denied = audit_actions(world.engine, action="flags.kill_switch", result="deny")
    assert denied and "may not change rooms" in denied[-1]["reason"]
    allowed = change(world, "kill_switch", "ai_admin", flag="lucy.deep_plan")
    assert allowed.json()["applied"] is True, allowed.text


def test_core_and_admin_flags_cannot_be_targeted(world):
    for flag in ("core.library", "admin.console"):
        answer = change(world, "kill_switch", flag=flag)
        assert (answer.status_code, answer.json()["detail"]["code"]) == (400, "invalid_rules")


def test_a_small_rollout_and_a_schedule_apply_at_once_and_rollback_restores(world):
    rollout = change(world, "rollout", percent=0, plans=["premium"]).json()
    assert rollout["applied"] is True
    later = time.time() + 3600
    scheduled = change(world, "schedule", **{"from": later, "on": True, "plans": ["premium"]})
    assert scheduled.json()["applied"] is True, scheduled.text
    assert rules_of(world) == ["schedule", "percentage"]
    history = world.get("/api/admin/flags/history", flag_id=FLAG).json()["versions"]
    assert [v["change"] for v in history][:2] == ["rules", "rules"]
    back = world.post("/api/admin/flags/rollback", version=rollout["version"], reason="undo")
    assert back.json()["applied"] is True
    assert rules_of(world) == ["percentage"]
    assert world.get("/api/admin/flags/history", flag_id=FLAG).json()["versions"][0]["reason"] \
        .startswith("rollback to version")


def test_the_trace_explains_every_flag_for_one_account(world):
    change(world, "kill_switch")
    trace = world.get(f"/api/admin/flags/explain/{world.users['customer']}").json()
    rooms = next(item for item in trace["flags"] if item["flag_id"] == FLAG)
    assert rooms["on"] is False
    assert [step["layer"] for step in rooms["steps"]][:2] == ["build", "mode"]
    assert any(step["layer"] == "rules" and step["on"] is False for step in rooms["steps"])
    assert world.get("/api/admin/flags/explain/nobody").status_code == 404


def test_preview_on_my_account_is_for_the_staff_member_only(world):
    answer = world.post(f"/api/admin/flags/{FLAG}/preview", "support", on=True, reason="qa")
    assert answer.status_code == 200, answer.text
    with transaction(world.engine) as conn:
        snapshot = flag_rules.load_snapshot(conn)
        assert snapshot.previewing(FLAG, world.users["support"], time.time())
        assert not snapshot.previewing(FLAG, world.users["customer"], time.time())
