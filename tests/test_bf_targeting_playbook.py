"""The targeting playbook (ADR-0456, BF-0456-04), each recipe checked through the admin explain
endpoint exactly as docs/operations/bf-rollout-runbook.md tells an operator to.

The recipes run on `cloud.local_first` staged the way the runbook stages it before step 5: on at
the build layer (`+cloud.local_first`) with a trailing catch-all off rule (0 percent), so every
account is off unless a rule above the catch-all says otherwise. Changes go through the real
admin change path: a narrow change applies at once, a broad one waits as a delayed action and is
executed once due, as an operator would.

- grant one account: a USERS rule with `on: true`;
- grant one workspace: a WORKSPACES rule with `on: true`;
- staff preview with expiry: a SCHEDULE rule with the `staff` segment and an `until` time, which
  answers on for staff inside the window and off (mechanically, with no clean-up) after it;
- kill switch: off for everyone, grants and previews included; undone by rollback.
"""

from __future__ import annotations

import time

import pytest
from cloud_admin_kit import make_due, make_world

from selecta import flags
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.persistence import transaction

FLAG = "cloud.local_first"
CATCH_ALL = {"kind": "percentage", "params": {"percent": 0, "salt": "bf-local-first",
             "note": "catch-all off"}, "enabled": True}


@pytest.fixture
def world(cloud_engine):
    flags.use(f"+{FLAG}")
    built = make_world(cloud_engine, staff=("owner", "auditor"))
    with transaction(cloud_engine) as conn:
        flag_rules.save(conn, FLAG, [Rule.from_dict(CATCH_ALL)], author="setup",
                        reason="step 1 staging: catch-all off")
    yield built
    built.http.__exit__(None, None, None)
    flags.use(None)


def apply(world, rules: list[dict], reason: str = "playbook") -> dict:
    """Save rules through the admin change path; a broad change is executed once due."""
    answer = world.post(f"/api/admin/flags/{FLAG}/change", action="set_rules", reason=reason,
                        params={"rules": rules})
    assert answer.status_code == 200, answer.text
    out = answer.json()
    if not out["applied"]:
        make_due(world.engine, out["action_id"])
        done = world.post(f"/api/admin/actions/{out['action_id']}/execute")
        assert done.json()["ok"] is True, done.text
    return out


def explain(world, who: str) -> dict:
    """The explain endpoint's entry for the flag, as the runbook reads it."""
    answer = world.get(f"/api/admin/flags/explain/{world.users[who]}")
    assert answer.status_code == 200, answer.text
    entry = next(item for item in answer.json()["flags"] if item["flag_id"] == FLAG)
    rules_step = next(step for step in entry["steps"] if step["layer"] == "rules")
    return {"on": entry["on"], "reason": entry["reason"], "detail": rules_step["detail"]}


def test_the_staging_baseline_answers_off_for_everyone_from_the_catch_all(world):
    for who in ("owner", "customer", "customer2"):
        assert explain(world, who) == {
            "on": False, "reason": "rule_off", "detail": "rule 1 (percentage) decided"
        }


def test_recipe_grant_one_account(world):
    grant = {"kind": "users", "params": {"ids": [world.users["customer"]], "on": True,
             "note": "grant one account"}}
    apply(world, [grant, CATCH_ALL])
    assert explain(world, "customer") == {
        "on": True, "reason": "rule_on", "detail": "rule 1 (users) decided"
    }
    assert explain(world, "customer2")["on"] is False


def test_recipe_grant_one_workspace(world):
    grant = {"kind": "workspaces", "params": {"ids": [world.workspaces["customer2"]], "on": True,
             "note": "grant one workspace"}}
    apply(world, [grant, CATCH_ALL])
    assert explain(world, "customer2") == {
        "on": True, "reason": "rule_on", "detail": "rule 1 (workspaces) decided"
    }
    assert explain(world, "customer")["on"] is False


def _staff_preview(until: float) -> dict:
    return {"kind": "schedule", "params": {"staff": True, "until": until, "on": True,
            "note": "staff preview, expires"}}


def test_recipe_staff_preview_with_expiry_is_on_for_staff_inside_the_window(world):
    apply(world, [_staff_preview(time.time() + 3600), CATCH_ALL])
    for staff in ("owner", "auditor"):
        assert explain(world, staff) == {
            "on": True, "reason": "rule_on", "detail": "rule 1 (schedule) decided"
        }
    for member in ("customer", "customer2"):
        assert explain(world, member) == {
            "on": False, "reason": "rule_off", "detail": "rule 2 (percentage) decided"
        }


def test_recipe_staff_preview_expires_by_itself(world):
    apply(world, [_staff_preview(time.time() - 60), CATCH_ALL])
    # Past `until` the schedule answers the opposite of `on` for staff: off, with no clean-up.
    assert explain(world, "owner") == {
        "on": False, "reason": "rule_off", "detail": "rule 1 (schedule) decided"
    }
    assert explain(world, "customer")["detail"] == "rule 2 (percentage) decided"


def test_recipe_kill_switch_beats_grants_and_previews_and_rolls_back(world):
    grant = {"kind": "users", "params": {"ids": [world.users["customer"]], "on": True}}
    apply(world, [_staff_preview(time.time() + 3600), grant, CATCH_ALL])
    assert explain(world, "owner")["on"] is True and explain(world, "customer")["on"] is True

    killed = world.post(f"/api/admin/flags/{FLAG}/change", action="kill_switch",
                        reason="incident: stop browser-first for everyone")
    assert killed.json()["applied"] is True, killed.text
    for who in ("owner", "customer", "customer2"):
        assert explain(world, who) == {
            "on": False, "reason": "rule_off", "detail": "kill switch: off for everyone"
        }

    undo = world.post("/api/admin/flags/rollback", version=killed.json()["version"],
                      reason="incident over", before=True)
    assert undo.status_code == 200, undo.text
    if not undo.json()["applied"]:
        make_due(world.engine, undo.json()["action_id"])
        assert world.post(f"/api/admin/actions/{undo.json()['action_id']}/execute").json()["ok"]
    assert explain(world, "owner")["detail"] == "rule 1 (schedule) decided"
    assert explain(world, "customer") == {
        "on": True, "reason": "rule_on", "detail": "rule 2 (users) decided"
    }
    with transaction(world.engine) as conn:
        kinds = [rule.kind for rule in flag_rules.current_rules(conn, FLAG)]
    assert RuleKind.KILL_SWITCH not in kinds
