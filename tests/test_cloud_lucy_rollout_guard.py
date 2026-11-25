"""The rollout guard on `lucy.usage_windows` (ADR-0487 rule 5, LM-0487-07,
`flags.lucy_rollout_guard`).

One salt for every percentage step, the staff rule in front of the percentage rule, and a raise
only after a week and with a person's word that the gates are green. Going back is never
refused. The pure check is covered as tables first, then the stored history, then the real admin
change path.
"""

from __future__ import annotations

import pytest
from cloud_admin_kit import audit_actions, make_due, make_world

from selecta import flags
from selecta.flags import lucy_rollout_guard as guard
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.persistence import transaction

NOW = 1_800_000_000.0
DAY = 86_400.0
GREEN = f"LM step, ledger entry 2027-01-15 {guard.MARKER}"
STAFF = Rule(RuleKind.WORKSPACES, {"ids": ["ws-staff"], "on": True})
MORE_STAFF = Rule(RuleKind.WORKSPACES, {"ids": ["ws-staff", "ws-staff-2"], "on": True})
ONE_OFF = Rule(RuleKind.WORKSPACES, {"ids": ["ws-unhappy"], "on": False})
KILL = Rule(RuleKind.KILL_SWITCH, {})


def pct(value: float, salt: str = guard.SALT, **extra) -> Rule:
    return Rule(RuleKind.PERCENTAGE, {"percent": value, "salt": salt, **extra})


def off(rule: Rule) -> Rule:
    return Rule(rule.kind, dict(rule.params), enabled=False)


def check(before, after, *, reason=GREEN, last=None, now=NOW) -> list[str]:
    return guard.check(before, after, reason=reason, last_raise_at=last, now=now)


def test_the_salt_and_the_wait_are_the_ones_the_runbook_names():
    assert (guard.FLAG, guard.SALT, guard.DWELL_DAYS) == ("lucy.usage_windows",
                                                          "lm-usage-windows", 7)
    assert guard.MARKER == "[lm-gates-green]"


ALLOWED = {
    "staff accounts alone need no marker": ([], [STAFF], "LM step 1: staff", None),
    "the first raise with the marker": ([STAFF], [STAFF, pct(5)], GREEN, None),
    "a raise a full week after the last": ([STAFF, pct(5)], [STAFF, pct(25)], GREEN,
                                           NOW - 7 * DAY),
    "a raise to everyone after a week": ([STAFF, pct(25)], [STAFF, pct(100)], GREEN,
                                         NOW - 30 * DAY),
    "adding a staff account at the same percentage": ([STAFF, pct(5)], [MORE_STAFF, pct(5)],
                                                      "new staff member", NOW - DAY),
    "an off rule for one account in front": ([STAFF, pct(5)], [ONE_OFF, STAFF, pct(5)],
                                             "asked to go back", NOW - DAY),
    "a percentage rule limited to a plan": ([STAFF], [STAFF, pct(5, plans=["premium"])],
                                            GREEN, None),
}


@pytest.mark.parametrize(("before", "after", "reason", "last"), ALLOWED.values(),
                         ids=ALLOWED.keys())
def test_a_change_that_keeps_the_rules_is_allowed(before, after, reason, last):
    assert check(before, after, reason=reason, last=last) == []


GOING_BACK = {
    "lowering the percentage": ([STAFF, pct(25)], [STAFF, pct(5)]),
    "lowering to nothing": ([STAFF, pct(25)], [STAFF, pct(0)]),
    "removing the percentage rule": ([STAFF, pct(25)], [STAFF]),
    "removing every rule": ([STAFF, pct(25)], []),
    "a kill switch in front": ([STAFF, pct(25)], [KILL, STAFF, pct(25)]),
    "disabling the percentage rule": ([STAFF, pct(25)], [STAFF, off(pct(25))]),
    "saving the same rules again": ([STAFF, pct(25)], [STAFF, pct(25, note="held")]),
    # rules saved wrongly before the guard existed can still be taken back
    "lowering a rule that has a wrong salt": ([pct(25, "old")], [pct(5, "old")]),
    "removing staff from in front of a percentage": ([STAFF, pct(25)], [pct(25)]),
    "a kill switch on rules with a wrong salt": ([pct(25, "old")], [KILL, pct(25, "old")]),
    "an off rule on rules with no staff rule": ([pct(25)], [ONE_OFF, pct(25)]),
}


@pytest.mark.parametrize(("before", "after"), GOING_BACK.values(), ids=GOING_BACK.keys())
def test_going_back_is_never_refused(before, after):
    # no marker, and the last raise a minute ago: nothing can stand in the way of a rollback
    assert check(before, after, reason="going back", last=NOW - 60) == []
    assert guard.is_retreat(before, after)


REFUSED = {
    "a made-up salt": ([STAFF], [STAFF, pct(5, "a1b2c3d4")], GREEN, None, ["a new place"]),
    "no salt at all": ([STAFF], [STAFF, Rule(RuleKind.PERCENTAGE, {"percent": 5})], GREEN,
                       None, ["a new place"]),
    "a new salt at the same percentage": ([STAFF, pct(5)], [STAFF, pct(5, "fresh")], GREEN,
                                          NOW - 30 * DAY, ["a new place"]),
    "a second percentage rule with another salt": (
        [STAFF, pct(5)], [STAFF, pct(5), pct(1, "other")], GREEN, NOW - 30 * DAY,
        ["rule 3 is a percentage rule with the salt 'other'"]),
    "the first raise without the marker": ([STAFF], [STAFF, pct(5)], "LM step 2", None,
                                           [guard.MARKER]),
    "a later raise without the marker": ([STAFF, pct(5)], [STAFF, pct(25)], "LM step 3",
                                         NOW - 30 * DAY, [guard.MARKER]),
    "a raise a second short of a week": ([STAFF, pct(5)], [STAFF, pct(25)], GREEN,
                                         NOW - 7 * DAY + 1, ["held for at least 7 days"]),
    "a raise the day after the last": ([STAFF, pct(5)], [STAFF, pct(25)], GREEN, NOW - DAY,
                                       ["1.0 days ago"]),
    "too soon and no marker": ([STAFF, pct(5)], [STAFF, pct(25)], "hurry", NOW - DAY,
                               [guard.MARKER, "held for at least 7 days"]),
    "a percentage rule with no staff rule": ([], [pct(5)], GREEN, None,
                                             ["no staff rule in front of it"]),
    "the percentage rule placed first": ([STAFF], [pct(5), STAFF], GREEN, None,
                                         ["rule 1 is a percentage rule with no staff rule"]),
    "a staff rule that is switched off": ([STAFF], [off(STAFF), pct(5)], GREEN, None,
                                          ["no staff rule in front of it"]),
    "only an off rule in front": ([STAFF], [ONE_OFF, pct(5)], GREEN, None,
                                  ["no staff rule in front of it"]),
    "turning a disabled wrong-salt rule on": ([STAFF, off(pct(5, "old"))],
                                              [STAFF, pct(5, "old")], GREEN, None,
                                              ["a new place"]),
    "a raise hidden behind a kill switch": ([STAFF, pct(5)], [KILL, STAFF, pct(100)],
                                            "stop and widen", NOW - DAY,
                                            [guard.MARKER, "held for at least 7 days"]),
}


@pytest.mark.parametrize(("before", "after", "reason", "last", "says"), REFUSED.values(),
                         ids=REFUSED.keys())
def test_a_change_that_breaks_a_rule_is_refused_in_a_sentence(before, after, reason, last, says):
    refusals = check(before, after, reason=reason, last=last)
    assert len(refusals) == len(says), refusals
    for refusal, words in zip(refusals, says, strict=True):
        assert words in refusal
        assert chr(0x2014) not in refusal


def test_a_raise_names_the_register_and_both_percentages():
    (refusal,) = check([STAFF, pct(5)], [STAFF, pct(25)], reason="go", last=NOW - 30 * DAY)
    assert "from 5% to 25%" in refusal and guard.GATE_REGISTER in refusal


# The stored history ------------------------------------------------------------------------------


def save(engine, rules, reason="test") -> float:
    with transaction(engine) as conn:
        saved = flag_rules.save(conn, guard.FLAG, rules, author="setup", reason=reason)
        return flag_rules.get_version(conn, saved.version).created_at


def last_raise(engine) -> float | None:
    with transaction(engine) as conn:
        return guard.last_raise_at(conn)


def test_the_last_raise_is_read_from_the_rule_history(cloud_engine):
    assert last_raise(cloud_engine) is None
    save(cloud_engine, [STAFF])
    assert last_raise(cloud_engine) is None  # staff accounts are not a percentage
    first = save(cloud_engine, [STAFF, pct(5)])
    assert last_raise(cloud_engine) == first
    save(cloud_engine, [MORE_STAFF, pct(5)])  # the same percentage is not a raise
    save(cloud_engine, [MORE_STAFF, pct(0)])  # nor is going back
    assert last_raise(cloud_engine) == first
    again = save(cloud_engine, [MORE_STAFF, pct(5)])  # coming back up is
    assert last_raise(cloud_engine) == again
    with transaction(cloud_engine) as conn:  # another flag's raise is not this flag's
        flag_rules.save(conn, "rooms", [pct(50, "rooms")], author="setup", reason="other")
    assert last_raise(cloud_engine) == again


# The admin change path ---------------------------------------------------------------------------


@pytest.fixture
def world(cloud_engine):
    flags.use("+lucy.cloud_conversation")
    built = make_world(cloud_engine, staff=("owner", "auditor"))
    yield built
    built.http.__exit__(None, None, None)
    flags.use(None)


def stored(world) -> tuple[Rule, ...]:
    with transaction(world.engine) as conn:
        return flag_rules.current_rules(conn, guard.FLAG)


def change(world, action: str, reason: str, **params):
    return world.post(f"/api/admin/flags/{guard.FLAG}/change", action=action, reason=reason,
                      params=params)


def problems(answer) -> str:
    assert answer.status_code == 400, answer.text
    return " ".join(answer.json()["detail"].get("problems", []))


def staff_rule(world) -> Rule:
    return Rule(RuleKind.WORKSPACES, {"ids": [world.workspaces["owner"]], "on": True})


def test_the_admin_change_path_refuses_a_new_salt_and_a_missing_marker(world):
    staff = staff_rule(world)
    answer = change(world, "set_rules", "LM step 2",
                    rules=[staff.to_dict(), pct(5, "a1b2c3d4").to_dict()])
    said = problems(answer)
    assert guard.SALT in said and guard.MARKER in said
    assert stored(world) == ()


def test_the_admin_change_path_lets_the_first_percentage_through_with_the_marker(world):
    staff = staff_rule(world)
    save(world.engine, [staff], "LM step 1: staff accounts")
    wanted = [staff.to_dict(), pct(5).to_dict()]

    assert guard.MARKER in problems(change(world, "set_rules", "LM step 2", rules=wanted))
    answer = change(world, "set_rules", GREEN, rules=wanted)

    assert answer.status_code == 200, answer.text
    body = answer.json()
    outcome = body.get("outcome", body)
    # with so few accounts the step may move more than a tenth of them, and then it waits as a
    # delayed action; either way the guard let it through
    if outcome["applied"]:
        assert stored(world) == (staff, pct(5))
    else:
        assert outcome["action_id"] and stored(world) == (staff,)


def test_the_admin_change_path_holds_a_second_raise_for_a_week(world):
    staff = staff_rule(world)
    save(world.engine, [staff, pct(5)], GREEN)
    answer = change(world, "set_rules", GREEN, rules=[staff.to_dict(), pct(25).to_dict()])
    assert "held for at least 7 days" in problems(answer)
    assert stored(world) == (staff, pct(5))

    back = change(world, "set_rules", "going back", rules=[staff.to_dict(), pct(0).to_dict()])
    assert back.status_code == 200, back.text  # lowering is never held


def test_the_rollout_action_is_refused_for_this_flag_even_with_the_fixed_salt(world):
    answer = change(world, "rollout", GREEN, percent=5, salt=guard.SALT)
    said = problems(answer)
    assert "set_rules" in said and guard.SALT in said
    assert stored(world) == ()


def test_the_kill_switch_is_never_refused(world):
    save(world.engine, [pct(25, "old")], "saved wrongly before the guard")
    answer = change(world, "kill_switch", "stop now")
    assert answer.status_code == 200, answer.text
    assert stored(world)[0].kind == RuleKind.KILL_SWITCH


def test_other_flags_are_not_checked(world):
    answer = world.post("/api/admin/flags/rooms/change", action="rollout", reason="test",
                        params={"percent": 5})
    assert answer.status_code == 200, answer.text


# A raise that waited as a delayed action ---------------------------------------------------------


def queue(world, reason: str, rules: list[Rule]) -> str:
    answer = change(world, "set_rules", reason, rules=[rule.to_dict() for rule in rules])
    assert answer.status_code == 200, answer.text
    body = answer.json()
    outcome = body.get("outcome", body)
    assert outcome["applied"] is False and outcome["action_id"], outcome
    return outcome["action_id"]


def carry_out(world, action_id: str) -> dict:
    make_due(world.engine, action_id)
    answer = world.post(f"/api/admin/actions/{action_id}/execute")
    assert answer.status_code == 200, answer.text
    return answer.json()


def test_a_waiting_raise_is_checked_again_when_it_is_carried_out(world):
    staff = staff_rule(world)
    save(world.engine, [staff], "LM step 1: staff accounts")
    first = queue(world, GREEN, [staff, pct(50)])
    # proposed back to back: nothing was saved yet, so this one passed the first check too
    second = queue(world, GREEN, [staff, pct(100)])

    assert carry_out(world, first)["ok"] is True
    assert stored(world) == (staff, pct(50))
    refused = carry_out(world, second)

    assert refused["ok"] is False
    assert "held for at least 7 days" in refused["action"]["note"]
    assert stored(world) == (staff, pct(50))
    assert not audit_actions(world.engine, action="flags.rules.change", approval_id=second)


def test_a_waiting_step_back_is_carried_out_whatever_the_guard_would_say(world):
    staff = staff_rule(world)
    save(world.engine, [staff, pct(100)], GREEN)  # the last raise was a moment ago
    back = queue(world, "going back", [staff])  # and the reason has no marker

    assert carry_out(world, back)["ok"] is True
    assert stored(world) == (staff,)
