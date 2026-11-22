"""The venue activity route (ADR-0452 BZ-0452-12) on a small app.

`GET /api/business/venues/{venue_id}/activity` reads the 90-day everyday-control log that
`audit.activity()` writes, newest first, for a member holding `business.activity.read` at that
venue. Another organisation's venue answers 404, exactly like a missing one.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta.business import orgs, venues
from selecta.business import routes as business_routes
from selecta.business.access import audit
from selecta.business.people.schema import business_members, business_venue_roles
from selecta.flags.rules import RulesCache
from selecta.identity.schema import users, workspace_members
from selecta.identity.tokens import Claims
from selecta.persistence import transaction

OWNER = "user-owner"


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
        for user in (OWNER, "user-else", "user-sam"):
            conn.execute(users.insert().values(
                id=user, auth_subject=f"auth|{user}", email_verified=True, timezone="UTC",
                age_confirmed=True, created_at=0.0,
            ))
        crown = orgs.create(conn, owner_user_id=OWNER, name="The Crown Group", now=1)["id"]
        other = orgs.create(conn, owner_user_id="user-else", name="Harbour Cafes", now=1)["id"]
    with transaction(sqlite_engine, crown) as conn:
        camden = venues.create(
            conn, crown, name="Camden", timezone="Europe/London", country="GB", now=1
        )["id"]
        soho = venues.create(
            conn, crown, name="Soho", timezone="Europe/London", country="GB", now=1
        )["id"]
        for at, words in ((100.0, "Skipped a song"), (200.0, "Approved a request")):
            audit.activity(conn, None, "control", words, organisation_id=crown,
                           workspace_id=crown, venue_id=camden, now=at)
        audit.activity(conn, None, "control", "Soho line", organisation_id=crown,
                       workspace_id=crown, venue_id=soho, now=150.0)
    with transaction(sqlite_engine, other) as conn:
        harbour = venues.create(
            conn, other, name="Quay", timezone="Europe/London", country="GB", now=1
        )["id"]
    return {"crown": crown, "camden": camden, "soho": soho, "harbour": harbour}


@pytest.fixture
def make_client(sqlite_engine, world):
    def build(user_id: str = OWNER, workspace_id: str | None = None) -> TestClient:
        app = FastAPI()

        def principal_for(_engine, _claims, header):
            return _Principal(_Workspace(header or workspace_id or world["crown"]), _User(user_id))

        business_routes.install_routes(
            app, engine=sqlite_engine,
            current_claims=lambda: Claims(subject=user_id, issued_at=0.0, expires_at=9e12),
            principal_for=principal_for, rules=RulesCache(sqlite_engine),
        )
        return TestClient(app, headers={"X-Workspace-ID": workspace_id or world["crown"]})

    return build


def test_the_owner_reads_the_venue_activity_newest_first(make_client, world):
    response = make_client().get(f"/api/business/venues/{world['camden']}/activity")

    assert response.status_code == 200
    lines = response.json()["activity"]
    assert [line["words"] for line in lines] == ["Approved a request", "Skipped a song"]
    assert set(lines[0]) == {"id", "at", "venue_id", "zone_id", "kind", "words"}
    assert lines[0]["venue_id"] == world["camden"]


def test_another_organisations_venue_answers_404(make_client, world):
    response = make_client().get(f"/api/business/venues/{world['harbour']}/activity")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"


def test_a_manager_reads_only_their_own_venue(sqlite_engine, make_client, world, clock):
    crown, camden = world["crown"], world["camden"]
    with transaction(sqlite_engine, crown) as conn:
        conn.execute(workspace_members.insert().values(
            workspace_id=crown, user_id="user-sam", role="business_member", created_at=1))
        conn.execute(business_members.insert().values(
            id="member-sam", workspace_id=crown, organisation_id=crown, user_id="user-sam",
            email="sam@example.test", org_role=None, status="active", source="invite",
            display_name="Sam", joined_at=1))
        conn.execute(business_venue_roles.insert().values(
            id="role-sam", workspace_id=crown, organisation_id=crown, user_id="user-sam",
            venue_id=camden, role="venue_manager", created_at=1))
    sam = make_client("user-sam")

    assert sam.get(f"/api/business/venues/{camden}/activity").status_code == 200
    assert sam.get(f"/api/business/venues/{world['soho']}/activity").status_code == 404


def test_the_route_is_owned_by_the_business_orgs_flag():
    from selecta import flags

    owners = flags.route_owners()
    assert owners["GET /api/business/venues/{venue_id}/activity"] == "business.orgs"
