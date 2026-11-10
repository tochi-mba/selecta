"""Route guard coverage for ADR-0414's account-targeted Cloud flags."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from cloud_party import CAROL, auth
from fastapi import HTTPException
from fastapi.routing import APIRoute

from selecta.flags import cloud_gate, targeting
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
