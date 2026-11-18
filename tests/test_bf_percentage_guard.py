"""Dashboards before percentage (ADR-0467 step 4, BF-0467-04).

A rule change that raises `cloud.local_first`'s percentage is refused until the per-mode cost
dashboard shows real data, an error-rate view per flag cohort exists, and the owner recorded them
green (`[dashboards-green]`). Lowering or freezing is never refused. The pure check is covered
first, then the real admin change path and the read-only readiness endpoint.
"""

from __future__ import annotations

import pytest
from cloud_admin_kit import make_world

from selecta import flags
from selecta.flags import flip_guard
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.persistence import transaction

FLAG = flip_guard.LOCAL_FIRST
LIVE = {"cost_per_mode": True, "error_rate_per_cohort": True}


def pct(value: float, **extra) -> Rule:
    return Rule(RuleKind.PERCENTAGE, {"percent": value, "salt": "bf", **extra})


def test_only_a_raise_is_checked():
    assert flip_guard.highest_percentage([pct(0), pct(5)]) == 5
    assert flip_guard.highest_percentage([Rule(RuleKind.PERCENTAGE, {"percent": 5},
                                                enabled=False)]) == 0
    for current, proposed in (([pct(5)], [pct(5)]), ([pct(5)], [pct(2)]), ([pct(5)], [])):
        assert flip_guard.check_percentage_step(
            current, proposed, dashboards_live={}, dashboards_green=False
        ) == []


def test_a_raise_names_every_missing_dashboard_and_the_missing_marker():
    refusals = flip_guard.check_percentage_step(
        [pct(0)], [pct(1)], dashboards_live={}, dashboards_green=False
    )
    assert len(refusals) == 3
    assert "cost per mode" in refusals[0] and flip_guard.COST_DASHBOARD in refusals[0]
    assert "error rate per cohort" in refusals[1]
    assert flip_guard.DASHBOARDS_MARKER in refusals[2]


def test_live_and_recorded_green_dashboards_let_the_raise_through():
    assert flip_guard.check_percentage_step(
        [pct(0)], [pct(10)], dashboards_live=LIVE, dashboards_green=True
    ) == []
    assert flip_guard.check_percentage_step(
        [pct(0)], [pct(10)], dashboards_live=LIVE, dashboards_green=False
    )


def test_the_marker_is_read_from_history_or_this_change():
    class Version:
        def __init__(self, flag_id, change, reason):
            self.flag_id, self.change, self.reason = flag_id, change, reason

    marked = [Version(FLAG, "rules", "reviewed [dashboards-green]")]
    assert flip_guard.dashboards_marker_recorded(marked)
    other = [Version("other", "rules", "[dashboards-green]")]
    assert not flip_guard.dashboards_marker_recorded(other)
    assert not flip_guard.dashboards_marker_recorded([Version(FLAG, "preview_on",
                                                              "[dashboards-green]")])
    assert flip_guard.dashboards_marker_recorded([], "go [dashboards-green]")


@pytest.fixture
def world(cloud_engine):
    flags.use(f"+{FLAG}")
    built = make_world(cloud_engine, staff=("owner", "auditor"))
    with transaction(cloud_engine) as conn:
        flag_rules.save(conn, FLAG, [pct(0)], author="setup", reason="staging")
    yield built
    built.http.__exit__(None, None, None)
    flags.use(None)


def stored(world) -> tuple[Rule, ...]:
    with transaction(world.engine) as conn:
        return flag_rules.current_rules(conn, FLAG)


def test_the_admin_change_path_refuses_a_percentage_step(world):
    answer = world.post(f"/api/admin/flags/{FLAG}/change", action="rollout",
                        reason="step 4 [dashboards-green]", params={"percent": 5, "salt": "bf"})
    assert answer.status_code == 400, answer.text
    problems = " ".join(answer.json()["detail"].get("problems", []))
    assert "error rate per cohort" in problems and "cost per mode" in problems
    assert stored(world) == (pct(0),)


def test_lowering_a_percentage_is_never_refused(world):
    with transaction(world.engine) as conn:
        flag_rules.save(conn, FLAG, [pct(5)], author="setup", reason="already at 5")
    answer = world.post(f"/api/admin/flags/{FLAG}/change", action="set_rules",
                        reason="freeze lower", params={"rules": [pct(2).to_dict()]})
    assert answer.status_code == 200, answer.text


def test_other_flags_are_not_checked(world):
    answer = world.post("/api/admin/flags/rooms/change", action="rollout", reason="test",
                        params={"percent": 5, "salt": "bf"})
    assert answer.status_code == 200, answer.text


def test_the_readiness_endpoint_says_why_without_changing_anything(world):
    answer = world.get(f"/api/admin/flags/{FLAG}/percentage-readiness", who="auditor", percent=5)
    assert answer.status_code == 200, answer.text
    body = answer.json()["readiness"]
    assert body["ready"] is False and body["current_percent"] == 0
    assert len(body["refusals"]) == 3
    assert body["dashboards"]["cost_per_mode"] == flip_guard.COST_DASHBOARD
    assert stored(world) == (pct(0),)
    assert world.get(f"/api/admin/flags/{FLAG}/percentage-readiness", who="customer").status_code \
        in (401, 403)
