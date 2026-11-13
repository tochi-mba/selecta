"""Cloud Autopilot is a Business/venue capability, never a cross-tenant workspace key.

These HTTP tests use the real Cloud app, principal lookup and migrated SQLite/PostgreSQL schema.
The standalone in-memory Autopilot tests deliberately inject a scope to exercise its engine.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from cloud_party import ALICE, BOB, auth, made_up
from selecta import flags
from selecta.business import orgs, venues
from selecta.identity.schema import users, workspace_members
from selecta.persistence import db_now, transaction

pytest_plugins = ("cloud_party",)


@pytest.fixture
def tenants(party):
    flags.use("+autopilot.venue_mode +autopilot.venue_policy")
    with transaction(party.engine) as conn:
        now = int(db_now(conn))
        alice_user = conn.execute(
            sa.select(users.c.id).where(users.c.auth_subject == "user_alice")
        ).scalar_one()
        bob_user = conn.execute(
            sa.select(users.c.id).where(users.c.auth_subject == "user_bob")
        ).scalar_one()
        alice_org = orgs.create(conn, owner_user_id=alice_user, name="Alice venue org", now=now)
        bob_org = orgs.create(conn, owner_user_id=bob_user, name="Bob venue org", now=now)
    ids = {}
    for owner, org in ((ALICE, alice_org), (BOB, bob_org)):
        with transaction(party.engine, org["id"]) as conn:
            venue = venues.create(
                conn, org["id"], name=f"{owner} venue",
                timezone="Europe/London", country="GB", now=int(db_now(conn)),
            )
        ids[owner] = {"org": org["id"], "venue": venue["id"]}
    return {"party": party, "ids": ids, "alice_user": alice_user, "bob_user": bob_user}


def _routes(venue_id: str, session_id: str):
    base = f"/api/autopilot/venues/{venue_id}"
    session = f"/api/autopilot/sessions/{session_id}"
    return (
        ("GET", "/api/autopilot/availability", None),
        ("GET", "/api/autopilot/maturity", None),
        ("POST", "/api/autopilot/sessions", {"venue_id": venue_id, "level": 0}),
        ("GET", session, None),
        ("POST", session + "/controls/pause", {}),
        ("POST", session + "/transitions", {"to": "warming"}),
        ("GET", base + "/setup", None),
        ("PUT", base + "/setup/venue", {"name": "Hush", "timezone": "UTC"}),
        ("GET", base + "/policies", None),
        ("POST", base + "/policies", {}),
        ("GET", base + "/overrides", None),
        ("POST", base + "/overrides", {"minutes": 30}),
        ("DELETE", base + "/overrides/ovr-unknown", None),
        ("POST", base + "/candidates", {"candidates": []}),
    )


def test_all_fourteen_autopilot_routes_refuse_foreign_workspace_and_missing_login(tenants):
    party = tenants["party"]
    own = tenants["ids"][ALICE]
    routes = _routes(own["venue"], made_up())
    assert len(routes) == 14
    for method, path, body in routes:
        unauthenticated = party.client.request(method, path, json=body)
        assert unauthenticated.status_code == 401, (method, path, unauthenticated.text)
        crossed = party.client.request(
            method, path, headers=auth(BOB, own["org"]), json=body,
        )
        assert crossed.status_code == 404, (method, path, crossed.text)
        assert crossed.json()["detail"]["code"] == "workspace_not_found"


def test_personal_workspace_cannot_start_or_read_autopilot(tenants):
    party = tenants["party"]
    venue_id = tenants["ids"][ALICE]["venue"]
    for method, path, body in (
        ("GET", "/api/autopilot/availability", None),
        ("GET", "/api/autopilot/maturity", None),
        ("GET", f"/api/autopilot/venues/{venue_id}/setup", None),
        ("POST", "/api/autopilot/sessions", {"venue_id": venue_id, "level": 0}),
    ):
        answer = party.client.request(method, path, headers=auth(ALICE), json=body)
        assert answer.status_code == 404, (method, path, answer.text)
        assert answer.json()["detail"]["code"] == "not_found"


def test_foreign_venue_and_guessed_venue_are_indistinguishable(tenants):
    party = tenants["party"]
    own = tenants["ids"][ALICE]
    other = tenants["ids"][BOB]
    for method, suffix, body in (
        ("GET", "/setup", None),
        ("PUT", "/setup/venue", {"name": "Hijack", "timezone": "UTC"}),
        ("GET", "/policies", None),
        ("POST", "/policies", {}),
        ("GET", "/overrides", None),
        ("POST", "/overrides", {"minutes": 10}),
        ("DELETE", "/overrides/unknown", None),
        ("POST", "/candidates", {"candidates": []}),
    ):
        def ask(venue, method=method, suffix=suffix, body=body):
            return party.client.request(
                method, f"/api/autopilot/venues/{venue}{suffix}",
                headers=auth(ALICE, own["org"]), json=body,
            )

        foreign = ask(other["venue"])
        missing = ask(made_up())
        assert foreign.status_code == 404, (method, suffix, foreign.text)
        assert foreign.json() == missing.json()
    for venue in (other["venue"], made_up()):
        answer = party.client.post(
            "/api/autopilot/sessions",
            headers=auth(ALICE, own["org"]), json={"venue_id": venue, "level": 0},
        )
        assert answer.status_code == 404 and answer.json()["detail"]["code"] == "not_found"
    # A rejected request must not populate Alice's or Bob's venue policy stores.
    stores = party.app.state.autopilot_stores
    for store in stores.values():
        assert other["venue"] not in repr(store.__dict__)


def test_session_ids_are_scoped_and_writes_cannot_mutate_another_org(tenants):
    party = tenants["party"]
    alice = tenants["ids"][ALICE]
    bob = tenants["ids"][BOB]
    created = party.client.post(
        "/api/autopilot/sessions",
        headers=auth(ALICE, alice["org"]),
        json={"venue_id": alice["venue"], "level": 0},
    )
    assert created.status_code == 201, created.text
    session = created.json()["id"]
    assert party.client.get(
        f"/api/autopilot/sessions/{session}", headers=auth(ALICE, alice["org"]),
    ).status_code == 200
    for suffix, method, body in (
        ("", "GET", None),
        ("/transitions", "POST", {"to": "warming"}),
        ("/controls/stop", "POST", {}),
    ):
        def ask(session_id, method=method, suffix=suffix, body=body):
            return party.client.request(
                method, f"/api/autopilot/sessions/{session_id}{suffix}",
                headers=auth(BOB, bob["org"]), json=body,
            )

        foreign = ask(session)
        guessed = ask(made_up())
        assert foreign.status_code == 404, foreign.text
        assert foreign.json() == guessed.json()
    unchanged = party.client.get(
        f"/api/autopilot/sessions/{session}", headers=auth(ALICE, alice["org"]),
    ).json()
    assert unchanged["state"] == "setup"


def test_viewer_may_read_but_cannot_modify_venue_policies_or_sessions(tenants):
    party = tenants["party"]
    own = tenants["ids"][ALICE]
    with transaction(party.engine) as conn:
        conn.execute(workspace_members.insert().values(
            workspace_id=own["org"], user_id=tenants["bob_user"],
            role="viewer", created_at=db_now(conn),
        ))
    read = party.client.get(
        f"/api/autopilot/venues/{own['venue']}/setup", headers=auth(BOB, own["org"]),
    )
    assert read.status_code == 200, read.text
    for method, path, body in (
        ("PUT", f"/api/autopilot/venues/{own['venue']}/setup/venue",
         {"name": "Unauthorised", "timezone": "UTC"}),
        ("POST", f"/api/autopilot/venues/{own['venue']}/policies", {}),
        ("POST", f"/api/autopilot/venues/{own['venue']}/overrides", {"minutes": 5}),
        ("DELETE", f"/api/autopilot/venues/{own['venue']}/overrides/guessed", None),
        ("POST", "/api/autopilot/sessions", {"venue_id": own["venue"], "level": 0}),
    ):
        answer = party.client.request(
            method, path, headers=auth(BOB, own["org"]), json=body,
        )
        assert answer.status_code == 403, (method, path, answer.text)
        assert answer.json()["detail"]["code"] == "not_allowed"
    after = party.client.get(
        f"/api/autopilot/venues/{own['venue']}/setup", headers=auth(ALICE, own["org"]),
    )
    assert after.json() == read.json()
