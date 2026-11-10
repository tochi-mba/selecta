"""Lucy's Cloud settings (SC-0404-05; docs/saas/09-lucy-ai-gateway.md §9.5): only the person's
own choices can be read or changed, and the answer carries the plan's Lucy level and this month's
turn meter. Provider, model, key and spend fields don't exist here, and a body naming them fails."""

from __future__ import annotations

import pytest
from cloud_world import HEADERS, signed_up

from selecta.billing.plans import plan_for
from selecta.lucy import cloud_settings
from selecta.persistence import transaction
from selecta.usage import allowances


def test_the_defaults_match_local_lucy_without_the_server_owned_parts(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        answer = world.client.get("/api/account/lucy", headers=HEADERS)
        assert answer.status_code == 200, answer.text
        body = answer.json()
        assert body["enabled"] is True
        assert body["phases"] == {
            "chat": True, "proposals": True, "commit": True, "memory": False, "voice": False,
        }
        assert body["privacy"] == {"share_lyrics": False, "share_history": False}
        assert body["tier"] == "Lucy Basic"
        assert (body["usage"]["used"], body["usage"]["limit"]) == (0, 40)
        for hidden in ("provider", "model", "api_key", "budgets", "spend_cap_usd", "base_url"):
            assert hidden not in body


def test_choices_are_saved_and_read_back(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        saved = world.client.put(
            "/api/account/lucy",
            headers=HEADERS,
            json={"phases": {"memory": True}, "privacy": {"share_history": True}},
        )
        assert saved.status_code == 200, saved.text
        again = world.client.get("/api/account/lucy", headers=HEADERS).json()
        assert again["phases"]["memory"] is True
        assert again["privacy"]["share_history"] is True
        assert again["enabled"] is True  # untouched choices keep their value


@pytest.mark.parametrize(
    "body",
    [
        {"provider": {"kind": "anthropic"}},
        {"model": "a-better-model"},
        {"api_key": "sk-test"},
        {"budgets": {"spend_cap_usd": 1000}},
    ],
)
def test_a_body_that_names_a_server_owned_setting_is_refused(tmp_path, monkeypatch, body):
    with signed_up(tmp_path, monkeypatch) as world:
        answer = world.client.put("/api/account/lucy", headers=HEADERS, json=body)
        assert answer.status_code == 422, answer.text


def test_an_unknown_phase_is_refused_by_name(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        answer = world.client.put(
            "/api/account/lucy", headers=HEADERS, json={"phases": {"telepathy": True}}
        )
        assert answer.status_code == 400
        assert answer.json()["detail"]["code"] == "invalid_lucy_choice"
        assert "telepathy" in answer.json()["detail"]["message"]


def test_the_turn_meter_counts_this_months_turns(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        with transaction(world.engine, world.workspace_id) as conn:
            allowances.try_consume(
                conn, world.workspace_id, "lucy_turn.haiku", 7,
                plan_for("free").lucy_turns("haiku"),
            )
        usage = world.client.get("/api/account/lucy", headers=HEADERS).json()["usage"]
        assert (usage["used"], usage["limit"]) == (7, 40)
        assert usage["resets_at"] > 0


def test_lucy_choices_never_show_up_as_labs_features(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        world.client.put("/api/account/lucy", headers=HEADERS, json={"enabled": False})
        labs = world.client.get("/api/account/labs", headers=HEADERS).json()["flags"]
        assert not [flag for flag in labs if flag["id"].startswith(cloud_settings.PREFIX)]
