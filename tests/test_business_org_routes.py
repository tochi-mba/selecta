"""Organisations, venues, zones and crates through their routes (ADR-0442 BZ-0442-01 to -04).

A small app over the real tables with a fake principal: a business workspace and its owner,
venues with a real IANA time zone, zones unique per venue ignoring case, paused zones that are
not paid for, archives that keep the rows, and crates that a venue sees only for itself and the
organisation. Another organisation's ids answer 404 exactly like missing ones.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta.business import orgs, venues
from selecta.business import routes as business_routes
from selecta.business.schema import venues as venue_table
from selecta.flags.rules import RulesCache
from selecta.identity.schema import users, workspace_members, workspaces
from selecta.identity.tokens import Claims
from selecta.persistence import transaction

OWNER, OTHER = "user-owner", "user-else"


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
    workspace_role: str = "owner"


@pytest.fixture
def world(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        for user in (OWNER, OTHER):
            conn.execute(users.insert().values(
                id=user, auth_subject=f"auth|{user}", email_verified=True, timezone="UTC",
                age_confirmed=True, created_at=0.0))
        crown = orgs.create(conn, owner_user_id=OWNER, name="The Crown Group",
                            legal_name="Crown Pubs Ltd", now=1)
        other = orgs.create(conn, owner_user_id=OTHER, name="Harbour Cafes", now=1)["id"]
    with transaction(sqlite_engine, other) as conn:
        quay = venues.create(conn, other, name="Quay", timezone="Europe/London", country="GB",
                             now=1)["id"]
    return {"crown": crown, "other": other, "quay": quay}


@pytest.fixture
def client(sqlite_engine, world):
    app = FastAPI()
    crown = world["crown"]["id"]
    business_routes.install_routes(
        app, engine=sqlite_engine,
        current_claims=lambda: Claims(subject=OWNER, issued_at=0.0, expires_at=9e12),
        principal_for=lambda _e, _c, header: _Principal(_Workspace(header or crown),
                                                        _User(OWNER)),
        rules=RulesCache(sqlite_engine),
    )
    return TestClient(app, headers={"X-Workspace-ID": crown})


def test_an_organisation_is_a_business_workspace_with_its_owner(sqlite_engine, world):
    crown = world["crown"]
    assert crown["kind"] == "business" and crown["legal_name"] == "Crown Pubs Ltd"
    with transaction(sqlite_engine) as conn:
        assert conn.execute(sa.select(workspaces.c.kind).where(
            workspaces.c.id == crown["id"])).scalar() == "business"
        assert conn.execute(sa.select(workspace_members.c.role).where(
            workspace_members.c.workspace_id == crown["id"],
            workspace_members.c.user_id == OWNER)).scalar() == "owner"


def test_venues_need_a_real_time_zone_and_keep_rows_when_archived(client, sqlite_engine,
                                                                  world):
    bad = client.post("/api/business/venues", json={
        "name": "Camden", "timezone": "Mars/Olympus", "country": "GB"})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_timezone"
    made = client.post("/api/business/venues", json={
        "name": "Camden", "timezone": "Europe/London", "country": "GB",
        "address": {"line1": "1 High Street", "city": "London"}}).json()["venue"]
    assert made["address"] == {"line1": "1 High Street", "city": "London"}
    renamed = client.patch(f"/api/business/venues/{made['id']}", json={"name": "Camden Town"})
    assert renamed.json()["venue"]["name"] == "Camden Town"
    paused = client.patch(f"/api/business/venues/{made['id']}", json={"status": "paused"})
    assert paused.json()["venue"]["status"] == "paused"
    archived = client.post(f"/api/business/venues/{made['id']}/archive", json={"when": "now"})
    assert archived.status_code == 200
    assert [v["id"] for v in client.get("/api/business/venues").json()["venues"]] == []
    with transaction(sqlite_engine, world["crown"]["id"]) as conn:
        row = conn.execute(sa.select(venue_table).where(
            venue_table.c.id == made["id"])).mappings().one()
        assert row["status"] == "archived"
        assert row["purge_after"] - row["archived_at"] == 90 * 24 * 3600


def test_zone_names_are_unique_per_venue_and_paused_zones_are_not_paid(client):
    venue = client.post("/api/business/venues", json={
        "name": "Camden", "timezone": "Europe/London", "country": "GB"}).json()["venue"]
    bar = client.post("/api/business/zones", json={"venue_id": venue["id"], "name": "Bar"})
    assert bar.status_code == 201
    clash = client.post("/api/business/zones", json={"venue_id": venue["id"], "name": "BAR"})
    assert clash.status_code == 409
    terrace = client.post("/api/business/zones", json={
        "venue_id": venue["id"], "name": "Terrace"}).json()["zone"]
    paid_before = client.get(f"/api/business/orgs/{venue['workspace_id']}").json()["org"]
    paused = client.patch(f"/api/business/zones/{terrace['id']}", json={"status": "paused"})
    assert paused.json()["zone"]["status"] == "paused"
    paid_after = client.get(f"/api/business/orgs/{venue['workspace_id']}").json()["org"]
    assert paid_after["paid_zones"] == paid_before["paid_zones"] - 1
    gone = client.post(f"/api/business/zones/{terrace['id']}/archive", json={"when": "now"})
    assert gone.json()["zone"]["status"] == "archived"


def test_another_organisations_venue_and_zone_answer_404(client, world):
    assert client.get(f"/api/business/venues/{world['quay']}").status_code == 404
    assert client.post("/api/business/zones", json={
        "venue_id": world["quay"], "name": "Bar"}).status_code == 404
    assert client.get("/api/business/venues", headers={
        "X-Workspace-ID": world["other"]}).status_code == 404


def test_a_venue_sees_organisation_crates_and_its_own_never_another_venues(client):
    camden = client.post("/api/business/venues", json={
        "name": "Camden", "timezone": "Europe/London", "country": "GB"}).json()["venue"]
    soho = client.post("/api/business/venues", json={
        "name": "Soho", "timezone": "Europe/London", "country": "GB"}).json()["venue"]
    brand = client.post("/api/business/crates", json={"name": "Brand core"}).json()["crate"]
    mine = client.post("/api/business/crates", json={
        "name": "Camden brunch", "venue_id": camden["id"]}).json()["crate"]
    theirs = client.post("/api/business/crates", json={
        "name": "Soho late", "venue_id": soho["id"]}).json()["crate"]
    seen = {c["id"] for c in client.get(
        f"/api/business/crates?venue_id={camden['id']}").json()["crates"]}
    assert seen == {brand["id"], mine["id"]}
    assert client.get(
        f"/api/business/crates/{theirs['id']}?venue_id={camden['id']}").status_code == 404
    unknown = client.put(f"/api/business/crates/{brand['id']}/songs",
                         json={"song_ids": ["not-a-song"]})
    assert unknown.status_code == 422 and unknown.json()["detail"]["code"] == "unknown_songs"


def test_staff_see_only_their_venue_and_change_nothing(sqlite_engine, world, client):
    from selecta.business.people.schema import business_members, business_venue_roles

    crown = world["crown"]["id"]
    camden = client.post("/api/business/venues", json={
        "name": "Camden", "timezone": "Europe/London", "country": "GB"}).json()["venue"]
    soho = client.post("/api/business/venues", json={
        "name": "Soho", "timezone": "Europe/London", "country": "GB"}).json()["venue"]
    bar = client.post("/api/business/zones", json={
        "venue_id": camden["id"], "name": "Bar"}).json()["zone"]
    with transaction(sqlite_engine, crown) as conn:
        conn.execute(workspace_members.insert().values(
            workspace_id=crown, user_id=OTHER, role="business_member", created_at=1))
        conn.execute(business_members.insert().values(
            id="m-staff", workspace_id=crown, organisation_id=crown, user_id=OTHER,
            email="staff@example.test", status="active", source="invite", joined_at=1))
        conn.execute(business_venue_roles.insert().values(
            id="r-staff", workspace_id=crown, organisation_id=crown, user_id=OTHER,
            venue_id=camden["id"], role="staff", created_at=1))
    app = FastAPI()
    business_routes.install_routes(
        app, engine=sqlite_engine,
        current_claims=lambda: Claims(subject=OTHER, issued_at=0.0, expires_at=9e12),
        principal_for=lambda _e, _c, header: _Principal(_Workspace(header or crown),
                                                        _User(OTHER)),
        rules=RulesCache(sqlite_engine),
    )
    staff = TestClient(app, headers={"X-Workspace-ID": crown})
    assert [v["id"] for v in staff.get("/api/business/venues").json()["venues"]] == [camden["id"]]
    assert staff.get(f"/api/business/venues/{soho['id']}").status_code == 404
    assert staff.get(f"/api/business/venues/{camden['id']}").status_code == 200
    assert staff.post("/api/business/venues", json={
        "name": "Mine", "timezone": "Europe/London", "country": "GB"}).status_code == 403
    assert staff.patch(f"/api/business/zones/{bar['id']}", json={"name": "X"}).status_code == 403
    assert staff.post(f"/api/business/venues/{camden['id']}/archive",
                      json={"when": "now"}).status_code == 403
    assert staff.post("/api/business/crates", json={
        "name": "Mine", "venue_id": camden["id"]}).status_code == 403
