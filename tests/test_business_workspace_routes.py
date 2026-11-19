"""Schedules across venues, the library list, licences and Play here's music routes.

`selecta.business.workspace_routes` and `selecta.business.zone_speaker_routes` on a small app
with a fake principal. Each route checks one business permission per venue (ADR-0452), so staff
cannot apply schedules, a venue outside the caller's scope answers 404, and Play here's music is
only for people who may control that zone.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta.business import orgs, venues, workspace_routes, zone_speaker_routes, zones
from selecta.business.people.schema import business_members, business_venue_roles
from selecta.identity.schema import users, workspace_members
from selecta.identity.tokens import Claims
from selecta.persistence import transaction

OWNER, SAM, OTHER = "user-owner", "user-sam", "user-else"


@dataclass
class _Workspace:
    id: str
    kind: str = "business"


@dataclass
class _User:
    id: str


@dataclass
class _Principal:
    workspace: _Workspace
    user: _User


@pytest.fixture
def world(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        for user in (OWNER, SAM, OTHER):
            conn.execute(users.insert().values(
                id=user, auth_subject=f"auth|{user}", email=f"{user}@example.test",
                email_verified=True, timezone="UTC", age_confirmed=True, created_at=0.0))
        crown = orgs.create(conn, owner_user_id=OWNER, name="The Crown Group", now=1)["id"]
        other = orgs.create(conn, owner_user_id=OTHER, name="Harbour Cafes", now=1)["id"]
    with transaction(sqlite_engine, crown) as conn:
        camden = venues.create(conn, crown, name="Camden", timezone="Europe/London",
                               country="GB", now=1)["id"]
        soho = venues.create(conn, crown, name="Soho", timezone="Europe/London",
                             country="GB", now=1)["id"]
        bar = zones.create(conn, crown, camden, name="Bar", now=1)["id"]
        terrace = zones.create(conn, crown, soho, name="Terrace", now=1)["id"]
        conn.execute(workspace_members.insert().values(
            workspace_id=crown, user_id=SAM, role="business_member", created_at=1))
        conn.execute(business_members.insert().values(
            id="m-sam", workspace_id=crown, organisation_id=crown, user_id=SAM,
            email="sam@example.test", status="active", source="invite", joined_at=1))
        conn.execute(business_venue_roles.insert().values(
            id="r-sam", workspace_id=crown, organisation_id=crown, user_id=SAM,
            venue_id=camden, role="staff", created_at=1))
    with transaction(sqlite_engine, other) as conn:
        quay = venues.create(conn, other, name="Quay", timezone="Europe/London",
                             country="GB", now=1)["id"]
    return {"crown": crown, "camden": camden, "soho": soho, "bar": bar, "terrace": terrace,
            "quay": quay}


HORIZON = [{"id": "s1", "key": "originals/ws/a.mp3", "song_index": 3, "song_id": 7,
            "title": "Song", "artist": "Band", "duration_s": 200.0, "starts_at": 0.0}]


@pytest.fixture
def client_for(sqlite_engine, world):
    def build(user_id: str = OWNER) -> TestClient:
        app = FastAPI()

        def principal_for(_engine, _claims, header):
            return _Principal(_Workspace(header or world["crown"]), _User(user_id))

        claims = lambda: Claims(subject=user_id, issued_at=0.0, expires_at=9e12)  # noqa: E731
        workspace_routes.install_routes(app, engine=sqlite_engine, current_claims=claims,
                                        principal_for=principal_for)
        zone_speaker_routes.install_routes(
            app, engine=sqlite_engine, current_claims=claims, principal_for=principal_for,
            presign=lambda ws, key: f"https://files.test/{key}?ws={ws}",
            horizon_for=lambda _engine, _ws, zone: HORIZON if zone == world["bar"] else [],
        )
        return TestClient(app, headers={"X-Workspace-ID": world["crown"]})

    return build


PARTS = [{"name": "Brunch", "start": 600, "energy": "calm"},
         {"name": "Evening", "start": 1080, "energy": "lifted"}]


def test_blocks_and_parts_round_trip():
    blocks = workspace_routes.blocks_of([workspace_routes.Part(**p) for p in PARTS])
    assert blocks[0] == {"start": "10:00", "name": "Brunch", "crates": [], "energy": 25}
    parts = workspace_routes.parts_of(blocks)
    assert [(p["name"], p["start"], p["end"], p["energy"]) for p in parts] == [
        ("Brunch", 600, 1080, "calm"), ("Evening", 1080, 1440, "lifted")]


def test_apply_previews_then_writes_every_zone(client_for, world, sqlite_engine):
    owner = client_for()
    venues_chosen = [world["camden"], world["soho"]]
    preview = owner.post("/api/business/schedules/apply",
                         json={"venue_ids": venues_chosen, "dayparts": PARTS, "preview": True})
    assert preview.status_code == 200, preview.text
    assert preview.json() == {"venues": 2, "open_now": 0, "conflicts": []}
    applied = owner.post("/api/business/schedules/apply",
                         json={"venue_ids": venues_chosen, "dayparts": PARTS})
    assert applied.json()["applied"] == 2
    from selecta.routes.business_zones import current_programme

    with transaction(sqlite_engine, world["crown"]) as conn:
        row = current_programme(conn, world["crown"], world["bar"])
    assert [b["name"] for b in row["blocks_json"]["weekly"]["0"]] == ["Brunch", "Evening"]
    assert set(row["blocks_json"]["weekly"]) == {str(d) for d in range(7)}


def test_apply_reports_someone_elses_change_as_a_conflict(client_for, world, clock):
    owner = client_for()
    owner.post("/api/business/schedules/apply",
               json={"venue_ids": [world["camden"]], "dayparts": PARTS})
    clock.advance(60)
    stale = {world["bar"]: 1.0}
    preview = owner.post("/api/business/schedules/apply", json={
        "venue_ids": [world["camden"]], "dayparts": PARTS, "versions": stale, "preview": True})
    conflict = preview.json()["conflicts"][0]
    assert conflict["zone_id"] == world["bar"] and conflict["updated_by"] == OWNER
    refused = owner.post("/api/business/schedules/apply", json={
        "venue_ids": [world["camden"]], "dayparts": PARTS, "versions": stale})
    assert refused.status_code == 409


def test_staff_cannot_apply_and_other_organisations_venues_are_404(client_for, world):
    assert client_for(SAM).post("/api/business/schedules/apply", json={
        "venue_ids": [world["camden"]], "dayparts": PARTS}).status_code == 403
    assert client_for().post("/api/business/schedules/apply", json={
        "venue_ids": [world["quay"]], "dayparts": PARTS}).status_code == 404


def test_the_library_lists_this_organisations_songs(client_for):
    answer = client_for().get("/api/business/library/songs")
    assert answer.status_code == 200
    assert answer.json() == {"songs": []}
    refused = client_for().post("/api/business/library/explicit",
                                json={"song_ids": ["nope"], "explicit": "clean"})
    assert refused.status_code == 422


def test_a_past_licence_date_is_refused_and_staff_cannot_record_one(client_for, world):
    past = client_for().put(f"/api/business/venues/{world['camden']}/licence", json={
        "kind": "themusiclicence", "number": "TML-1", "expires_on": "2020-01-01",
        "rights_confirmed": True})
    assert past.status_code == 422
    assert past.json()["detail"]["code"] == "licence_expired"
    staff = client_for(SAM).put(f"/api/business/venues/{world['camden']}/licence", json={
        "kind": "themusiclicence", "number": "TML-1", "expires_on": "2099-01-01",
        "rights_confirmed": True})
    assert staff.status_code == 403


def test_a_licence_is_recorded(client_for, world):
    saved = client_for().put(f"/api/business/venues/{world['camden']}/licence", json={
        "kind": "themusiclicence", "number": "TML-1", "expires_on": "2099-01-01",
        "rights_confirmed": True})
    assert saved.status_code == 200, saved.text
    assert saved.json()["licence"]["number"] == "TML-1"


def test_staff_read_their_zones_music_for_play_here(client_for, world):
    staff = client_for(SAM)
    horizon = staff.get(f"/api/business/zones/{world['bar']}/speaker/horizon")
    assert horizon.status_code == 200
    assert horizon.json()["segments"][0]["song_index"] == 3
    url = staff.post(f"/api/business/zones/{world['bar']}/speaker/segment-url",
                     json={"key": "originals/ws/a.mp3"})
    assert url.json()["url"].startswith("https://files.test/")
    assert staff.post(f"/api/business/zones/{world['bar']}/speaker/segment-url",
                      json={"key": "originals/ws/other.mp3"}).status_code == 404
    # Terrace is at Soho, outside Sam's scope: it answers like a missing zone.
    assert staff.get(f"/api/business/zones/{world['terrace']}/speaker/horizon").status_code == 404
