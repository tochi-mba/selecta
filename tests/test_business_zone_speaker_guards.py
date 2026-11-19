"""Zone speaker guards (ADR-0443) through the real Cloud app.

- A browser that is a zone's live speaker is refused personal "Play here" with
  `holding_zone_lease` until it hands the zone back (`HoldingZoneLease`).
- A paused venue plays nothing in any of its zones: zone playback reads the zone as paused
  (`business.zones.is_playable`) and answers `zone_paused`.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, auth, made_up

from selecta.billing import stripe_sync
from selecta.business import orgs, venues, zones
from selecta.identity.schema import users
from selecta.persistence import db_now, transaction
from selecta.playback.schema import playback_sessions
from selecta.playback.zones import ZONE_PAUSED, _playable_status

pytest_plugins = ("cloud_party",)


@pytest.fixture
def venue(party):
    with transaction(party.engine) as conn:
        now = int(db_now(conn))
        alice = conn.execute(
            sa.select(users.c.id).where(users.c.auth_subject == "user_alice")
        ).scalar_one()
        org = orgs.create(conn, owner_user_id=alice, name="Alice bars", now=now)
        stripe_sync.grant_override(
            conn,
            workspace_id=org["id"],
            plan_id="premium",
            reason="test org",
            actor="tests",
            expires_at=db_now(conn) + 86_400,
        )
    with transaction(party.engine, org["id"]) as conn:
        now = int(db_now(conn))
        place = venues.create(
            conn, org["id"], name="High Street", timezone="Europe/London", country="GB", now=now
        )
        bar = zones.create(conn, org["id"], place["id"], name="Bar", now=now)
    return {"org": org["id"], "venue": place["id"], "zone": bar["id"]}


def _org_device(party, org: str) -> str:
    """Register this browser in the organisation; the per-workspace cookie is kept."""
    answer = party.client.post(
        "/api/devices",
        headers=auth(ALICE, org),
        json={"name": "Phone", "kind": "phone", "device_id": made_up()},
    )
    assert answer.status_code == 201, answer.text
    return answer.json()["device"]["id"]


def _take_zone(party, org: str, zone: str, device: str):
    return party.client.post(
        f"/api/zones/{zone}/playback/take-over",
        headers=auth(ALICE, org),
        json={"device_id": device, "confirm": True},
    )


def test_a_zone_speaker_is_refused_personal_play_here_until_it_hands_back(party, venue):
    org, zone = venue["org"], venue["zone"]
    phone = _org_device(party, org)
    taken = _take_zone(party, org, zone, phone)
    assert taken.status_code == 200, taken.text

    held = party.client.get("/api/zones/holding", headers=auth(ALICE, org))
    assert held.json() == {"zone_id": zone}

    personal = party.register(ALICE, "Phone")["device"]["id"]
    refused = party.client.post(
        "/api/playback/take-over", headers=auth(ALICE), json={"device_id": personal}
    )
    assert refused.status_code == 409, refused.text
    detail = refused.json()["detail"]
    assert detail["code"] == "holding_zone_lease"
    assert detail["zone_id"] == zone
    assert "Bar" in detail["message"]

    # Once the zone's lease has lapsed (the phone left or gave it up), personal music is fine.
    with transaction(party.engine, org) as conn:
        conn.execute(
            playback_sessions.update()
            .where(playback_sessions.c.zone_id == zone)
            .values(lease_expires_at=db_now(conn) - 1)
        )
    allowed = party.client.post(
        "/api/playback/take-over", headers=auth(ALICE), json={"device_id": personal}
    )
    assert allowed.status_code == 200, allowed.text


def test_a_browser_with_no_zone_lease_plays_personal_music(party, venue):
    _org_device(party, venue["org"])
    personal = party.register(ALICE, "Laptop")["device"]["id"]
    answer = party.client.post(
        "/api/playback/take-over", headers=auth(ALICE), json={"device_id": personal}
    )
    assert answer.status_code == 200, answer.text


def test_a_paused_venue_pauses_its_zones_for_playback(party, venue):
    org, zone = venue["org"], venue["zone"]
    phone = _org_device(party, org)
    with transaction(party.engine, org) as conn:
        venues.pause(conn, org, venue["venue"])
    refused = _take_zone(party, org, zone, phone)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"]["code"] == "zone_paused"

    with transaction(party.engine, org) as conn:
        venues.resume(conn, org, venue["venue"])
    assert _take_zone(party, org, zone, phone).status_code == 200


@pytest.mark.parametrize(
    ("zone_status", "venue_status", "expected"),
    [
        ("active", "active", "active"),
        ("active", "paused", ZONE_PAUSED),
        ("active", "archived", ZONE_PAUSED),
        ("paused", "active", "paused"),
        ("archived", "active", "archived"),
        (None, None, "active"),
    ],
)
def test_playable_status_follows_the_venue(zone_status, venue_status, expected):
    assert _playable_status(zone_status, venue_status) == expected
