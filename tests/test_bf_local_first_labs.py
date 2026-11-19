"""The Labs opening for browser-first Cloud (ADR-0467 step 3, BF-0467-05).

End to end through the real Cloud app: a member opts in (a per-user rule on `cloud.local_first`),
sees the truthful experience on their account, gives feedback (an audit event) and opts out;
every layer is respected: the build layer of both flags, the companion's own rules (the owner's
plan cohort), and the kill switch on either flag. Staging matches the runbook: `cloud.local_first`
on at the build layer with a trailing catch-all off rule.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_admin_kit import make_world

from selecta import flags
from selecta.authz.schema import audit_events
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.hosted_coexistence import local_first_labs as labs
from selecta.persistence import transaction

BASE = "/api/account/labs/local-first"
CATCH_ALL = Rule(RuleKind.PERCENTAGE, {"percent": 0, "salt": "bf-local-first"})


def stage(engine, *extra: Rule, flag: str = labs.LOCAL_FIRST) -> None:
    with transaction(engine) as conn:
        rules = (*extra, CATCH_ALL) if flag == labs.LOCAL_FIRST else extra
        flag_rules.save(conn, flag, rules, author="setup", reason="staging")


@pytest.fixture
def world(cloud_engine):
    flags.use(f"+{labs.LOCAL_FIRST},+{labs.LABS_FLAG}")
    built = make_world(cloud_engine, staff=("owner",))
    stage(cloud_engine)
    yield built
    built.http.__exit__(None, None, None)
    flags.use(None)


def local_first(world, who: str) -> bool:
    answer = world.get("/api/account", who=who)
    assert answer.status_code == 200, answer.text
    return answer.json()["experience"]["local_first"]


def current(world) -> tuple[Rule, ...]:
    with transaction(world.engine) as conn:
        return flag_rules.current_rules(conn, labs.LOCAL_FIRST)


def test_opt_in_turns_the_real_experience_on_for_that_member_only(world):
    assert local_first(world, "customer") is False
    before = world.get(BASE, who="customer").json()
    assert before["labs_open"] is True and before["enrolled"] is False and before["on"] is False

    joined = world.post(f"{BASE}/join", who="customer")
    assert joined.status_code == 200, joined.text
    assert joined.json()["enrolled"] is True and joined.json()["on"] is True

    assert local_first(world, "customer") is True
    assert local_first(world, "customer2") is False
    rules = current(world)
    assert labs.is_cohort_rule(rules[0]) and rules[-1] == CATCH_ALL
    assert labs.cohort(rules) == {world.users["customer"]}
    with transaction(world.engine) as conn:
        latest = flag_rules.history(conn, labs.LOCAL_FIRST, limit=1)[0]
    assert latest.author == world.users["customer"] and "Labs opt-in" in latest.reason

    again = world.post(f"{BASE}/join", who="customer")
    assert again.status_code == 200 and labs.cohort(current(world)) == {world.users["customer"]}


def test_the_explain_endpoint_names_the_cohort_rule(world):
    world.post(f"{BASE}/join", who="customer")
    trace = world.get(f"/api/admin/flags/explain/{world.users['customer']}").json()
    entry = next(item for item in trace["flags"] if item["flag_id"] == labs.LOCAL_FIRST)
    assert entry["on"] is True and entry["reason"] == "rule_on"


def test_opt_out_returns_the_member_and_removes_the_emptied_rule(world):
    world.post(f"{BASE}/join", who="customer")
    left = world.post(f"{BASE}/leave", who="customer")
    assert left.status_code == 200, left.text
    assert left.json()["enrolled"] is False
    assert local_first(world, "customer") is False
    assert current(world) == (CATCH_ALL,)
    assert world.post(f"{BASE}/leave", who="customer").json()["rule_version"] is None


def test_two_members_share_one_cohort_rule_and_leave_independently(world):
    world.post(f"{BASE}/join", who="customer")
    world.post(f"{BASE}/join", who="customer2")
    assert len(current(world)) == 2
    world.post(f"{BASE}/leave", who="customer")
    assert local_first(world, "customer") is False and local_first(world, "customer2") is True


def test_feedback_is_captured_as_an_audit_event(world):
    world.post(f"{BASE}/join", who="customer")
    sent = world.post(f"{BASE}/feedback", who="customer", text="The library loaded fast.")
    assert sent.status_code == 201, sent.text
    with world.engine.connect() as conn:
        row = conn.execute(
            sa.select(audit_events).where(audit_events.c.action == labs.FEEDBACK_ACTION)
        ).mappings().one()
    assert row["actor_id"] == world.users["customer"]
    assert row["workspace_id"] == world.workspaces["customer"]
    assert row["reason"] == "The library loaded fast."
    assert row["metadata"] == {"enrolled": True}
    assert world.post(f"{BASE}/feedback", who="customer", text="").status_code == 422


def test_a_kill_switch_on_local_first_refuses_opt_in_and_saves_nothing(world):
    stage(world.engine, Rule(RuleKind.KILL_SWITCH))
    before = current(world)
    refused = world.post(f"{BASE}/join", who="customer")
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"]["reason"] == "rule_off"
    assert current(world) == before
    assert world.get(BASE, who="customer").json()["on"] is False


def test_the_kill_switch_beats_an_existing_member(world):
    world.post(f"{BASE}/join", who="customer")
    with transaction(world.engine) as conn:
        rules = flag_rules.current_rules(conn, labs.LOCAL_FIRST)
        flag_rules.save(conn, labs.LOCAL_FIRST, (Rule(RuleKind.KILL_SWITCH), *rules),
                        author="setup", reason="incident")
    status = world.get(BASE, who="customer").json()
    assert status["enrolled"] is True and status["on"] is False
    assert local_first(world, "customer") is False


def test_without_the_build_layer_opt_in_is_refused_truthfully(world):
    flags.use(f"+{labs.LABS_FLAG}")
    refused = world.post(f"{BASE}/join", who="customer")
    assert refused.status_code == 409
    assert refused.json()["detail"]["reason"] == "build_off"
    assert current(world) == (CATCH_ALL,)


def test_labs_closed_in_the_build_refuses_opt_in_but_never_opt_out(world):
    world.post(f"{BASE}/join", who="customer")
    flags.use(f"+{labs.LOCAL_FIRST}")
    closed = world.post(f"{BASE}/join", who="customer2")
    assert closed.status_code == 403 and closed.json()["code"] == "flag_off"
    assert world.get(BASE, who="customer").json()["labs_open"] is False
    left = world.post(f"{BASE}/leave", who="customer")
    assert left.status_code == 200 and local_first(world, "customer") is False


def test_the_companion_rules_choose_the_cohort(world):
    # The owner opens Labs to paid plans only: free members are refused before any rule change.
    stage(world.engine, Rule(RuleKind.SEGMENT, {"plans": ["free"], "on": False}),
          flag=labs.LABS_FLAG)
    refused = world.post(f"{BASE}/join", who="customer")
    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"]["code"] == "flag_off"
    assert current(world) == (CATCH_ALL,)
    assert world.post(f"{BASE}/leave", who="customer").status_code == 200


def test_a_kill_switch_on_the_companion_closes_labs(world):
    stage(world.engine, Rule(RuleKind.KILL_SWITCH), flag=labs.LABS_FLAG)
    assert world.post(f"{BASE}/join", who="customer").status_code == 403
    assert world.get(BASE, who="customer").json()["labs_open"] is False


def test_the_cohort_helpers_keep_other_rules_in_place():
    grant = Rule(RuleKind.USERS, {"ids": ["someone"], "on": True})
    rules = labs.with_member((grant, CATCH_ALL), "u1")
    assert labs.is_cohort_rule(rules[0]) and rules[1:] == (grant, CATCH_ALL)
    assert labs.with_member(rules, "u1") == rules
    assert labs.cohort(labs.with_member(rules, "u2")) == {"u1", "u2"}
    assert labs.without_member(rules, "u1") == (grant, CATCH_ALL)
    assert labs.without_member((grant,), "someone") == (grant,)
