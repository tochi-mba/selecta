"""Zone events reach only people with that zone in scope (ADR-0443 BZ-0443-09)."""

from __future__ import annotations

from selecta.business import orgs, venues, zones
from selecta.business.event_scope import zone_filter
from selecta.business.people.schema import business_members, business_venue_roles
from selecta.identity.schema import users, workspace_members
from selecta.persistence import transaction


def test_zone_events_follow_venue_scope(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        for user in ("owner", "sam", "stranger"):
            conn.execute(users.insert().values(
                id=user, auth_subject=f"auth|{user}", email_verified=True, timezone="UTC",
                age_confirmed=True, created_at=0.0))
        crown = orgs.create(conn, owner_user_id="owner", name="Crown", now=1)["id"]
        personal = orgs.create(conn, owner_user_id="sam", name="Sam", now=1)["id"]
    with transaction(sqlite_engine, crown) as conn:
        camden = venues.create(conn, crown, name="Camden", timezone="Europe/London",
                               country="GB", now=1)["id"]
        soho = venues.create(conn, crown, name="Soho", timezone="Europe/London", country="GB",
                             now=1)["id"]
        bar = zones.create(conn, crown, camden, name="Bar", now=1)["id"]
        lounge = zones.create(conn, crown, soho, name="Lounge", now=1)["id"]
        conn.execute(workspace_members.insert().values(
            workspace_id=crown, user_id="sam", role="business_member", created_at=1))
        conn.execute(business_members.insert().values(
            id="m-sam", workspace_id=crown, organisation_id=crown, user_id="sam",
            email="sam@example.test", status="active", source="invite", joined_at=1))
        conn.execute(business_venue_roles.insert().values(
            id="r-sam", workspace_id=crown, organisation_id=crown, user_id="sam",
            venue_id=camden, role="staff", created_at=1))
        owner = zone_filter(conn, crown, "owner")
        sam = zone_filter(conn, crown, "sam")
        stranger = zone_filter(conn, crown, "stranger")
    assert owner({"zone_id": lounge}) and owner({"zone_id": bar})
    assert sam({"zone_id": bar}) and not sam({"zone_id": lounge})
    assert sam({"no": "zone"}) and sam(None)
    assert not stranger({"zone_id": bar}) and stranger({"topic": "x"})
    with transaction(sqlite_engine, personal) as conn:
        assert zone_filter(conn, personal, "sam")({"zone_id": lounge})
