"""The ADR-0450 content control routes, the zone volume cap and upload tag readings, wired.

`content.api` is installed on a bare app with a planted actor and a recording permission check,
so these tests prove each route reaches its `editing` write (and the store reads), checks the
right permission, and stays off while `business.content_controls` is off.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta.authz.schema import audit_events
from selecta.business import controls_wiring
from selecta.business.access import BusinessActor, BusinessForbidden
from selecta.business.access.directory import StaticDirectory, VenueRef, ZoneRef
from selecta.business.content import api as content_api
from selecta.business.content import schema as t
from selecta.business.content import store
from selecta.business.people.schema import business_activity
from selecta.persistence import make_engine, metadata, transaction

WS = "ws-1"  # an organisation's id is its workspace id (BZ-1)
VENUE, BAR, ELSEWHERE = "venue-1", "zone-bar", "zone-other"
HEADERS = {"X-Workspace-ID": WS}


def directory() -> StaticDirectory:
    return StaticDirectory(
        venues=[VenueRef(VENUE, WS, WS, "The Crown"), VenueRef("venue-2", "ws-2", "ws-2", "Away")],
        zones=[ZoneRef(BAR, VENUE, WS, WS, "Bar"), ZoneRef(ELSEWHERE, "venue-2", "ws-2", "ws-2", "X")],
    )


def owner() -> BusinessActor:
    return BusinessActor(kind="person", id="user-owner", organisation_id=WS, workspace_id=WS,
                         org_role="owner", display_name="Olu")


@pytest.fixture
def engine(tmp_path):
    built = make_engine(f"sqlite:///{tmp_path / 'content.sqlite'}")
    metadata.create_all(built, tables=[*t.TABLES, business_activity, audit_events])
    yield built
    built.dispose()


@pytest.fixture
def setup(engine):
    checked: list[tuple[str, str | None, str | None]] = []
    state = {"on": True, "refuse": set()}

    def authorize(conn, actor, permission, *, venue_id=None, zone_id=None, directory):
        checked.append((permission, venue_id, zone_id))
        if permission in state["refuse"]:
            raise BusinessForbidden(code="forbidden")

    app = FastAPI()
    content_api.install_routes(
        app, engine=engine, current_claims=lambda request: None, directory=directory(),
        authorize=authorize, actor_resolver=lambda request, conn, **_: owner(),
        flag_on=lambda flag: state["on"])
    return TestClient(app), checked, state


def audit_actions(engine) -> list[str]:
    with engine.connect() as conn:
        return list(conn.execute(sa.select(audit_events.c.action)).scalars())


def test_every_route_answers_flag_off_while_content_controls_is_off(setup):
    client, checked, state = setup
    state["on"] = False
    answer = client.get("/api/business/content/rules", headers=HEADERS)
    assert answer.status_code == 404
    assert answer.json()["detail"]["code"] == "flag_off"
    assert checked == []


def test_organisation_rules_save_and_read_back_with_a_version_and_audit(setup, engine):
    client, checked, _ = setup
    saved = client.put("/api/business/content/rules", headers=HEADERS,
                       json={"filter_mode": "no_explicit", "bpm_max": 130})
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"version": 1}
    read = client.get("/api/business/content/rules", headers=HEADERS).json()
    assert read["rules"]["filter_mode"] == "no_explicit"
    assert read["rules"]["bpm_max"] == 130
    assert read["version"] == 1
    assert ("business.rules.edit", None, None) in checked
    assert ("business.rules.read", None, None) in checked
    assert "business.content.rules.organisation" in audit_actions(engine)


def test_venue_rules_save_zone_dayparts_and_volume_then_read_back(setup):
    client, checked, _ = setup
    body = {
        "venue": {"filter_mode": "clean_only"},
        "zones": {BAR: {"energy_max": 0.7, "dayparts": {
            "brunch": {"label": "Brunch", "windows": [[6, 600, 720]], "bpm_max": 110}}}},
        "volume": {BAR: {"cap": 0.8, "quiet_hours": [{"start": "22:00", "end": "07:00", "cap": 0.4}]}},
    }
    saved = client.put(f"/api/business/venues/{VENUE}/content/rules", headers=HEADERS, json=body)
    assert saved.status_code == 200, saved.text
    read = client.get(f"/api/business/venues/{VENUE}/content/rules", headers=HEADERS).json()
    assert read["venue"]["filter_mode"] == "clean_only"
    assert read["zones"][BAR]["rules"]["energy_max"] == 0.7
    assert read["zones"][BAR]["dayparts"][0]["daypart_label"] == "Brunch"
    assert read["volume"][BAR]["cap"] == 0.8
    assert ("business.rules.edit", VENUE, None) in checked


def test_a_venue_of_another_organisation_is_not_found(setup):
    client, _, _ = setup
    answer = client.get("/api/business/venues/venue-2/content/rules", headers=HEADERS)
    assert answer.status_code == 404


def test_blocklist_entries_are_added_listed_and_removed(setup, engine):
    client, _, _ = setup
    added = client.post("/api/business/content/blocklist", headers=HEADERS,
                        json={"kind": "artist", "value": "Loud Band", "reason": "Brand"})
    assert added.status_code == 201, added.text
    entry_id = added.json()["id"]
    listed = client.get("/api/business/content/blocklist", headers=HEADERS).json()["entries"]
    assert [entry["value"] for entry in listed] == ["Loud Band"]
    removed = client.delete(f"/api/business/content/blocklist/{entry_id}", headers=HEADERS)
    assert removed.status_code == 200
    assert client.get("/api/business/content/blocklist", headers=HEADERS).json()["entries"] == []
    assert {"business.content.blocklist.add", "business.content.blocklist.remove"} <= set(audit_actions(engine))


def test_an_override_is_created_and_ended_in_one_zone(setup):
    client, checked, _ = setup
    made = client.post(f"/api/business/zones/{BAR}/content/overrides", headers=HEADERS,
                       json={"kind": "song", "value": "song-1", "reason": "Birthday", "minutes": 30})
    assert made.status_code == 201, made.text
    override_id = made.json()["id"]
    assert ("business.rules.override", None, BAR) in checked
    ended = client.delete(f"/api/business/zones/{BAR}/content/overrides/{override_id}",
                          headers=HEADERS)
    assert ended.status_code == 200, ended.text
    other = client.post(f"/api/business/zones/{ELSEWHERE}/content/overrides", headers=HEADERS,
                        json={"kind": "song", "value": "x", "reason": "r", "minutes": 5})
    assert other.status_code == 404


def test_a_song_flag_is_set_by_hand(setup, engine):
    client, checked, _ = setup
    answer = client.put("/api/business/content/songs/song-9/explicit", headers=HEADERS,
                        json={"explicit": "explicit"})
    assert answer.status_code == 200, answer.text
    with engine.connect() as conn:
        assert store.get_flag(conn, WS, "song-9")["source"] == "manual"
    assert ("business.songs.flag", None, None) in checked
    bad = client.put("/api/business/content/songs/song-9/explicit", headers=HEADERS,
                     json={"explicit": "rude"})
    assert bad.status_code == 422


def test_a_refused_permission_is_403(setup):
    client, _, state = setup
    state["refuse"] = {"business.rules.edit"}
    answer = client.put("/api/business/content/rules", headers=HEADERS, json={"bpm_max": 120})
    assert answer.status_code == 403


def test_the_zone_volume_cap_follows_the_saved_cap_and_the_flag(engine, monkeypatch):
    from selecta.business.rooms import service

    with transaction(engine) as conn:
        store.save_volume(conn, organisation_id=WS, workspace_id=WS, venue_id=VENUE,
                          zone_id=BAR, cap=0.6, quiet_hours=[], actor=None, now=0)
    noon = datetime(2026, 11, 19, 12, tzinfo=UTC).timestamp()
    monkeypatch.setattr(service, "default_flag_on", lambda flag: True)
    with engine.connect() as conn:
        cap = controls_wiring.zone_volume_cap(conn, WS, VENUE, BAR, noon, directory=directory())
        assert cap == 60
        assert controls_wiring.zone_volume_cap(conn, "ws-2", VENUE, BAR, noon,
                                               directory=directory()) is None
    monkeypatch.setattr(service, "default_flag_on", lambda flag: False)
    with engine.connect() as conn:
        assert controls_wiring.zone_volume_cap(conn, WS, VENUE, BAR, noon,
                                               directory=directory()) is None


def test_an_upload_tag_reading_lands_only_in_an_organisation(engine, monkeypatch):
    from selecta.business import orgs
    from selecta.business.errors import NotFound
    from selecta.business.rooms import service

    def get(conn, workspace_id):
        if workspace_id != WS:
            raise NotFound("not a business")
        return {"id": WS}

    monkeypatch.setattr(service, "default_flag_on", lambda flag: True)
    monkeypatch.setattr(orgs, "get", get)
    with transaction(engine) as conn:
        assert store.record_upload_tag(conn, WS, "song-1", "explicit", now=1.0) is True
        assert store.record_upload_tag(conn, "personal", "song-2", "explicit", now=1.0) is False
        assert store.get_flag(conn, WS, "song-1")["source"] == "tag"
        store.set_flag(conn, organisation_id=WS, workspace_id=WS, song_id="song-1",
                       explicit="clean", source="manual", set_by="u", now=2.0)
        assert store.record_upload_tag(conn, WS, "song-1", "explicit", now=3.0) is False
        assert store.get_flag(conn, WS, "song-1")["explicit"] == "clean"
    monkeypatch.setattr(service, "default_flag_on", lambda flag: False)
    with transaction(engine) as conn:
        assert store.record_upload_tag(conn, WS, "song-3", "clean", now=1.0) is False
