"""Cloud Lucy exposes personal choices, never server/provider policy (ADR-0404)."""

from __future__ import annotations

import pytest
from cloud_party import ALICE, BOB, auth

from selecta.lucy import cloud_settings
from selecta.persistence import transaction

pytest_plugins = ("cloud_party",)


def test_cloud_lucy_defaults_expose_only_personal_choices_and_meter(party):
    answer = party.client.get("/api/account/lucy", headers=auth(ALICE))

    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["enabled"] is True
    assert body["phases"] == cloud_settings.DEFAULTS["phases"]
    assert body["privacy"] == cloud_settings.DEFAULTS["privacy"]
    assert body["tier"] == "Lucy Advanced"
    assert set(body) == {"enabled", "phases", "privacy", "tier", "usage"}
    assert not ({"provider", "model", "api_key", "budgets", "spend_cap_usd"} & set(body))


def test_choices_are_partial_persistent_and_scoped_to_the_person(party):
    changed = party.client.put(
        "/api/account/lucy",
        headers=auth(ALICE),
        json={
            "enabled": False,
            "phases": {"memory": True},
            "privacy": {"share_lyrics": True},
        },
    )

    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert body["enabled"] is False
    assert body["phases"]["memory"] is True
    assert body["phases"]["chat"] is True
    assert body["privacy"] == {"share_lyrics": True, "share_history": False}
    again = party.client.get("/api/account/lucy", headers=auth(ALICE)).json()
    assert again["enabled"] is False and again["phases"]["memory"] is True
    bob = party.client.get("/api/account/lucy", headers=auth(BOB)).json()
    assert {key: bob[key] for key in cloud_settings.DEFAULTS} == cloud_settings.DEFAULTS


@pytest.mark.parametrize("hidden", ["provider", "model", "api_key", "budgets", "spend_cap_usd"])
def test_server_owned_lucy_settings_are_refused(party, hidden):
    answer = party.client.put(
        "/api/account/lucy", headers=auth(ALICE), json={hidden: "caller-controlled"}
    )

    assert answer.status_code == 422
    assert answer.json()["detail"][0]["type"] == "extra_forbidden"


@pytest.mark.parametrize(
    ("section", "name"), [("phases", "provider"), ("privacy", "share_everything")]
)
def test_unknown_nested_choices_get_a_stable_domain_error(party, section, name):
    answer = party.client.put(
        "/api/account/lucy", headers=auth(ALICE), json={section: {name: True}}
    )

    assert answer.status_code == 400
    assert answer.json()["detail"]["code"] == "invalid_lucy_choice"
    assert name in answer.json()["detail"]["message"]


def test_lucy_rows_use_a_reserved_namespace_and_do_not_leak_into_flag_choices(party):
    party.client.put(
        "/api/account/lucy", headers=auth(ALICE), json={"privacy": {"share_history": True}}
    )
    with transaction(party.engine) as conn:
        user_id = conn.execute(
            cloud_settings.user_flag_preferences.select()
            .with_only_columns(cloud_settings.user_flag_preferences.c.user_id)
            .where(cloud_settings.user_flag_preferences.c.flag_id.like("lucy:%"))
        ).scalar_one()
        stored = cloud_settings.choices(conn, user_id)

    assert stored["privacy"]["share_history"] is True
