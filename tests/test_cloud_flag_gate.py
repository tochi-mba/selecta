"""Route guard coverage for ADR-0414's account-targeted Cloud flags."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from cloud_party import CAROL, auth
from fastapi import HTTPException

from selecta.flags import cloud_gate, targeting

pytest_plugins = ("cloud_party",)


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
