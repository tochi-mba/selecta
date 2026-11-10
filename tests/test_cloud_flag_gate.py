"""Route guard coverage for ADR-0414's account-targeted Cloud flags."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from cloud_party import ALICE, CAROL, auth
from fastapi import HTTPException
from fastapi.routing import APIRoute

from selecta.flags import cloud_gate, targeting
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.persistence import transaction
from selecta.work.catalogue import CATALOGUE

pytest_plugins = ("cloud_party",)


def test_every_cloud_route_and_worker_job_has_a_valid_owned_cloud_flag(party):
    registry = cloud_gate.flags.registry()
    owners = cloud_gate.flags.route_owners()
    served = {
        f"{method} {route.path}"
        for route in party.app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/api/")
        for method in route.methods
    }

    assert served, "the Cloud API should serve customer and staff routes"
    assert served <= set(owners), f"Cloud routes without a flag: {sorted(served - set(owners))}"
    for route in served:
        flag_id = owners[route]
        assert flag_id in registry
        assert "cloud" in registry[flag_id].modes, f"{route} belongs to non-Cloud flag {flag_id}"
    for job in CATALOGUE.values():
        assert job.flag_id is not None, f"{job.name} needs an owning feature flag"
        assert job.flag_id in registry, f"{job.name} names unknown flag {job.flag_id}"
        assert "cloud" in registry[job.flag_id].modes, (
            f"{job.name} is Cloud work but {job.flag_id} is not a Cloud flag"
        )


def test_a_plan_locked_route_names_the_plan_that_unlocks_it(party):
    answer = party.client.post(
        "/api/rooms", headers=auth(CAROL), json={"name": "Free account room"}
    )

    assert answer.status_code == 403
    assert answer.json()["detail"] == {
        "code": "plan_required",
        "message": "Rooms is part of Premium.",
        "flag": "rooms",
        "plan": "premium",
    }


@pytest.mark.parametrize(
    "layer",
    [
        targeting.Layer.BUILD,
        targeting.Layer.MODE,
        targeting.Layer.RULES,
        targeting.Layer.REQUIRES,
        targeting.Layer.USER,
    ],
)
def test_non_plan_refusals_use_the_stable_flag_off_code(monkeypatch, layer):
    monkeypatch.setattr(
        cloud_gate,
        "decide",
        lambda *_args, **_kwargs: targeting.Decision(False, layer, "test_off"),
    )

    with pytest.raises(HTTPException) as raised:
        cloud_gate.require(None, None, "rooms", None)

    assert raised.value.status_code == 403
    assert raised.value.detail == {
        "code": "flag_off",
        "message": "Rooms isn't available on this account right now.",
        "flag": "rooms",
    }


def test_an_allowed_decision_returns_without_an_error(monkeypatch):
    monkeypatch.setattr(
        cloud_gate,
        "decide",
        lambda *_args, **_kwargs: targeting.Decision(True, targeting.Layer.RULES, "default"),
    )

    assert cloud_gate.require(None, SimpleNamespace(), "rooms", None) is None


def _rules(party, flag_id: str, rules) -> None:
    with transaction(party.engine) as conn:
        flag_rules.save(conn, flag_id, rules, author="tests", reason="account gate test")
    party.app.state.flag_rules.invalidate()


def test_a_kill_switch_refuses_every_routes_feature_for_every_account(party):
    """SC-0414-03/05: the API agrees with the page. A rule or kill switch that switches a feature
    off for an account refuses that feature's routes for it, not only the build's flags; found
    by the admin Flags page browser test, where Labs stayed reachable under a kill switch."""
    assert party.client.get("/api/account/labs", headers=auth(ALICE)).status_code == 200
    _rules(party, "account.labs", [Rule(RuleKind.KILL_SWITCH, {})])
    for token in (ALICE, CAROL):
        answer = party.client.get("/api/account/labs", headers=auth(token))
        assert answer.status_code == 403
        assert answer.json()["detail"]["code"] == "flag_off"
    _rules(party, "account.labs", [])
    assert party.client.get("/api/account/labs", headers=auth(CAROL)).status_code == 200


def test_a_rule_for_one_account_refuses_only_that_account(party):
    carol = party.client.get("/api/account", headers=auth(CAROL)).json()["user"]["id"]
    _rules(party, "cloud.uploads", [Rule(RuleKind.USERS, {"ids": [carol], "on": False})])
    refused = party.client.get("/api/uploads", headers=auth(CAROL))
    assert refused.status_code == 403
    assert refused.json()["detail"] == {
        "code": "flag_off",
        "message": "Cloud uploads isn't available on this account right now.",
        "flag": "cloud.uploads",
    }
    assert party.client.get("/api/uploads", headers=auth(ALICE)).status_code == 200
    # Core features can't be targeted, so the account page always answers.
    assert party.client.get("/api/account", headers=auth(CAROL)).status_code == 200
