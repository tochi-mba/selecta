"""People, invitations, offboarding, the overview and setup (ADR-0452, ADR-0453 D2/D6).

A small app over the real tables with a fake principal, so each case names who is asking.
Roles follow ADR-0452: owners and admins manage everyone, a venue manager invites staff and
viewers at their own venue only, staff manage nobody. Another organisation, or a venue outside
the caller's scope, answers 404 exactly like a missing one.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta.business import orgs, venues, zones
from selecta.business.health import pin_hash
from selecta.business.people import routes as people_routes
from selecta.business.people.schema import (
    business_invitations,
    business_members,
    business_staff_pins,
    business_venue_roles,
)
from selecta.flags.rules import RulesCache
from selecta.identity.schema import session_revocations, users, workspace_members
from selecta.identity.tokens import Claims
from selecta.notify.mail import RecordingSender
from selecta.persistence import transaction
from selecta.playback.schema import devices

OWNER, SAM, ALEX, OTHER = "user-owner", "user-sam", "user-alex", "user-else"
EMAILS = {OWNER: "owner@example.test", SAM: "sam@example.test", ALEX: "alex@example.test",
          OTHER: "else@example.test"}


@dataclass
class _Workspace:
    id: str
    kind: str = "business"


@dataclass
class _User:
    id: str
    email: str
    email_verified: bool = True


@dataclass
class _Principal:
    workspace: _Workspace
    user: _User
    workspace_role: str = "owner"


@pytest.fixture
def world(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        for user, email in EMAILS.items():
            conn.execute(users.insert().values(
                id=user, auth_subject=f"auth|{user}", email=email, email_verified=True,
                timezone="UTC", age_confirmed=True, created_at=0.0))
        crown = orgs.create(conn, owner_user_id=OWNER, name="The Crown Group", now=1)["id"]
        other = orgs.create(conn, owner_user_id=OTHER, name="Harbour Cafes", now=1)["id"]
        personal = orgs.create(conn, owner_user_id=SAM, name="Sam's music", now=1)["id"]
    with transaction(sqlite_engine, crown) as conn:
        camden = venues.create(conn, crown, name="Camden", timezone="Europe/London",
                               country="GB", now=1)["id"]
        soho = venues.create(conn, crown, name="Soho", timezone="Europe/London",
                             country="GB", now=1)["id"]
        bar = zones.create(conn, crown, camden, name="Bar", now=1)["id"]
    with transaction(sqlite_engine, other) as conn:
        quay = venues.create(conn, other, name="Quay", timezone="Europe/London",
                             country="GB", now=1)["id"]
    return {"crown": crown, "other": other, "personal": personal, "camden": camden,
            "soho": soho, "bar": bar, "quay": quay}


@pytest.fixture
def flags_on():
    return {"business.roles": True, "business.orgs": True}


@pytest.fixture
def outbox():
    return RecordingSender()


@pytest.fixture
def client_for(sqlite_engine, world, flags_on, outbox):
    def build(user_id: str = OWNER, workspace_id: str | None = None) -> TestClient:
        app = FastAPI()
        default = workspace_id or world["crown"]

        def principal_for(_engine, _claims, header):
            return _Principal(_Workspace(header or default), _User(user_id, EMAILS[user_id]))

        people_routes.install_routes(
            app, engine=sqlite_engine,
            current_claims=lambda: Claims(subject=user_id, issued_at=0.0, expires_at=9e12),
            principal_for=principal_for, rules=RulesCache(sqlite_engine),
            flag_on=lambda _conn, _found, flag: flags_on.get(flag, False),
            site_url="https://app.test", sender=outbox,
        )
        return TestClient(app, headers={"X-Workspace-ID": default})

    return build


def _join(engine, org: str, user: str, *, org_role=None, venue_roles=None) -> None:
    with transaction(engine, org) as conn:
        conn.execute(workspace_members.insert().values(
            workspace_id=org, user_id=user, role="business_member", created_at=1))
        conn.execute(business_members.insert().values(
            id=f"m-{user}", workspace_id=org, organisation_id=org, user_id=user,
            email=EMAILS[user], org_role=org_role, status="active", source="invite",
            display_name=user, joined_at=1))
        for venue, role in (venue_roles or {}).items():
            conn.execute(business_venue_roles.insert().values(
                id=str(uuid4()), workspace_id=org, organisation_id=org, user_id=user,
                venue_id=venue, role=role, created_at=1))


def _token(response) -> str:
    return response.json()["accept_url"].split("#", 1)[1]


# -- invitations ------------------------------------------------------------------------------


def test_owner_invites_and_the_invited_person_joins(client_for, world, sqlite_engine, outbox):
    owner = client_for()
    made = owner.post("/api/business/invitations", json={
        "email": EMAILS[SAM], "role": "staff", "venue_ids": [world["camden"]]})
    assert made.status_code == 201, made.text
    body = made.json()
    assert body["emailed"] is True
    assert body["accept_url"].startswith("https://app.test/business/join#")
    [mail] = outbox.sent
    assert mail.to == EMAILS[SAM]
    assert mail.subject == "Join The Crown Group on SelectaDJ"
    assert body["accept_url"] in mail.text and "Camden" in mail.text
    assert mail.idempotency_key == f"business_invitation:{body['invitation']['id']}"
    assert body["invitation"]["expires_at"] - body["invitation"]["created_at"] == 7 * 24 * 3600

    listed = owner.get("/api/business/people").json()
    assert [i["email"] for i in listed["invitations"]] == [EMAILS[SAM]]
    assert listed["seats"] == {"included": 6, "paid": 0, "held": 1}

    joined = client_for(SAM, world["personal"]).post(
        "/api/business/invitations/accept", json={"token": _token(made)})
    assert joined.status_code == 200, joined.text
    assert joined.json()["org_id"] == world["crown"]

    people = owner.get("/api/business/people").json()
    sam = next(p for p in people["people"] if p["id"] == SAM)
    assert sam["role"] == "staff" and sam["venue_ids"] == [world["camden"]]
    assert people["invitations"] == []
    with transaction(sqlite_engine, world["crown"]) as conn:
        assert conn.execute(sa.select(workspace_members.c.role).where(
            workspace_members.c.workspace_id == world["crown"],
            workspace_members.c.user_id == SAM)).scalar() == "business_member"


def test_a_different_email_cannot_accept(client_for, world):
    made = client_for().post("/api/business/invitations", json={
        "email": EMAILS[SAM], "role": "viewer", "venue_ids": None})
    refused = client_for(ALEX).post("/api/business/invitations/accept",
                                    json={"token": _token(made)})
    assert refused.status_code == 403
    assert refused.json()["detail"]["code"] == "wrong_email"


def test_an_expired_invitation_is_refused(client_for, world, clock):
    made = client_for().post("/api/business/invitations", json={
        "email": EMAILS[SAM], "role": "viewer", "venue_ids": None})
    clock.advance(7 * 24 * 3600 + 1)
    refused = client_for(SAM).post("/api/business/invitations/accept",
                                   json={"token": _token(made)})
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "expired"


def test_resending_replaces_the_old_link(client_for, world):
    owner = client_for()
    first = owner.post("/api/business/invitations", json={
        "email": EMAILS[SAM], "role": "staff", "venue_ids": [world["camden"]]})
    second = owner.post("/api/business/invitations", json={
        "email": EMAILS[SAM], "role": "staff", "venue_ids": [world["camden"]]})
    assert len(owner.get("/api/business/people").json()["invitations"]) == 1
    sam = client_for(SAM)
    assert sam.post("/api/business/invitations/accept",
                    json={"token": _token(first)}).status_code == 404
    assert sam.post("/api/business/invitations/accept",
                    json={"token": _token(second)}).status_code == 200


def test_revoking_withdraws_the_link(client_for, world):
    owner = client_for()
    made = owner.post("/api/business/invitations", json={
        "email": EMAILS[SAM], "role": "staff", "venue_ids": [world["camden"]]})
    invitation = made.json()["invitation"]["id"]
    assert owner.post(f"/api/business/invitations/{invitation}/revoke").status_code == 200
    assert client_for(SAM).post("/api/business/invitations/accept",
                                json={"token": _token(made)}).status_code == 404


def test_ownership_is_never_given_by_invitation(client_for):
    refused = client_for().post("/api/business/invitations", json={
        "email": EMAILS[SAM], "role": "owner", "venue_ids": None})
    assert refused.status_code == 422


def test_a_manager_invites_staff_at_their_venue_only(client_for, world, sqlite_engine):
    _join(sqlite_engine, world["crown"], ALEX, venue_roles={world["camden"]: "venue_manager"})
    manager = client_for(ALEX)
    ok = manager.post("/api/business/invitations", json={
        "email": EMAILS[SAM], "role": "staff", "venue_ids": [world["camden"]]})
    assert ok.status_code == 201
    other_venue = manager.post("/api/business/invitations", json={
        "email": "x@example.test", "role": "staff", "venue_ids": [world["soho"]]})
    assert other_venue.status_code == 404
    too_broad = manager.post("/api/business/invitations", json={
        "email": "y@example.test", "role": "venue_manager", "venue_ids": [world["camden"]]})
    assert too_broad.status_code == 403
    admin = manager.post("/api/business/invitations", json={
        "email": "z@example.test", "role": "admin", "venue_ids": None})
    assert admin.status_code == 403
    another_org = manager.post("/api/business/invitations", json={
        "email": "q@example.test", "role": "staff", "venue_ids": [world["quay"]]})
    assert another_org.status_code == 404


def test_staff_manage_nobody(client_for, world, sqlite_engine):
    _join(sqlite_engine, world["crown"], SAM, venue_roles={world["camden"]: "staff"})
    staff = client_for(SAM)
    assert staff.get("/api/business/people").status_code == 403
    assert staff.post("/api/business/invitations", json={
        "email": "x@example.test", "role": "staff",
        "venue_ids": [world["camden"]]}).status_code == 403
    assert staff.delete(f"/api/business/people/{OWNER}").status_code in (403, 409)


def test_no_free_seat_refuses_a_staff_invitation(client_for, world):
    owner = client_for()
    for n in range(6):
        assert owner.post("/api/business/invitations", json={
            "email": f"p{n}@example.test", "role": "staff",
            "venue_ids": [world["camden"]]}).status_code == 201
    full = owner.post("/api/business/invitations", json={
        "email": "late@example.test", "role": "staff", "venue_ids": [world["camden"]]})
    assert full.status_code == 409
    assert full.json()["detail"]["code"] == "no_free_seat"
    viewer = owner.post("/api/business/invitations", json={
        "email": "watch@example.test", "role": "viewer", "venue_ids": None})
    assert viewer.status_code == 201  # viewers use no seat


def test_accepting_needs_business_roles_on_for_that_organisation(client_for, world, flags_on):
    made = client_for().post("/api/business/invitations", json={
        "email": EMAILS[SAM], "role": "viewer", "venue_ids": None})
    flags_on["business.roles"] = False
    refused = client_for(SAM).post("/api/business/invitations/accept",
                                   json={"token": _token(made)})
    assert refused.status_code == 403
    assert refused.json()["detail"]["code"] == "flag_off"


# -- offboarding ------------------------------------------------------------------------------


def test_removing_someone_signs_them_out_and_keeps_kiosks(client_for, world, sqlite_engine,
                                                          clock):
    crown = world["crown"]
    _join(sqlite_engine, crown, SAM, venue_roles={world["camden"]: "staff"})
    with transaction(sqlite_engine, crown) as conn:
        for device_id, user, principal in (("phone", SAM, "person"), ("kiosk", None, "kiosk")):
            conn.execute(devices.insert().values(
                id=device_id, workspace_id=crown, user_id=user, principal=principal,
                name=device_id, kind="phone" if user else "desktop", capabilities={},
                created_at=1, last_seen_at=1))
        conn.execute(business_staff_pins.insert().values(
            id="pin-sam", workspace_id=crown, organisation_id=crown, venue_id=world["camden"],
            user_id=SAM, pin_hash=pin_hash("1234", "salt"), salt="salt", failures=0,
            created_at=1))

    removed = client_for().delete(f"/api/business/people/{SAM}")
    assert removed.status_code == 200, removed.text
    assert removed.json()["devices_signed_out"] == 1

    with transaction(sqlite_engine, crown) as conn:
        member = conn.execute(sa.select(business_members).where(
            business_members.c.user_id == SAM)).mappings().one()
        assert member["status"] == "removed"
        assert conn.execute(sa.select(business_venue_roles).where(
            business_venue_roles.c.user_id == SAM)).first() is None
        assert conn.execute(sa.select(business_staff_pins)).first() is None
        assert conn.execute(sa.select(workspace_members).where(
            workspace_members.c.workspace_id == crown,
            workspace_members.c.user_id == SAM)).first() is None
        signed_out = dict(conn.execute(sa.select(devices.c.id, devices.c.signed_out_at)).all())
        assert signed_out["phone"] is not None and signed_out["kiosk"] is None
    with transaction(sqlite_engine) as conn:
        # ADR-0452: removal never touches the personal workspace, so no account-wide cut-off.
        assert conn.execute(sa.select(session_revocations).where(
            session_revocations.c.user_id == SAM)).first() is None
    assert client_for(SAM).get("/api/business/orgs/" + crown + "/overview").status_code == 404


def test_the_last_owner_cannot_be_removed(client_for, world, sqlite_engine):
    _join(sqlite_engine, world["crown"], ALEX, org_role="admin")
    refused = client_for(ALEX).delete(f"/api/business/people/{OWNER}")
    assert refused.status_code in (403, 409)
    with transaction(sqlite_engine, world["crown"]) as conn:
        assert conn.execute(sa.select(business_invitations)).first() is None
        assert orgs.is_member(conn, world["crown"], OWNER)


def test_another_organisations_people_stay_hidden(client_for, world):
    assert client_for().delete(f"/api/business/people/{OTHER}").status_code == 404
    outsider = client_for(OTHER, world["crown"])
    assert outsider.get("/api/business/people").status_code == 404


# -- overview, details and setup --------------------------------------------------------------


def test_overview_names_role_scope_and_flags(client_for, world, sqlite_engine, flags_on):
    owner = client_for().get(f"/api/business/orgs/{world['crown']}/overview")
    assert owner.status_code == 200, owner.text
    org = owner.json()["org"]
    assert org["role"] == "owner" and org["venue_scope"] is None
    assert org["workspace_id"] == world["crown"]
    assert org["features"]["business.roles"] is True
    assert org["features"]["business.console"] is False
    names = sorted(v["name"] for v in owner.json()["venues"])
    assert names == ["Camden", "Soho"]
    camden = next(v for v in owner.json()["venues"] if v["name"] == "Camden")
    assert camden["zones"][0]["state"] in {"closed", "not_paired", "silent"}

    _join(sqlite_engine, world["crown"], SAM, venue_roles={world["camden"]: "staff"})
    staff = client_for(SAM).get(f"/api/business/orgs/{world['crown']}/overview").json()
    assert staff["org"]["role"] == "staff"
    assert staff["org"]["venue_scope"] == [world["camden"]]
    assert [v["name"] for v in staff["venues"]] == ["Camden"]

    flags_on["business.roles"] = False
    off = client_for().get(f"/api/business/orgs/{world['crown']}/overview").json()
    assert off["org"]["features"]["business.roles"] is False


def test_overview_of_another_organisation_is_404(client_for, world):
    response = client_for().get(f"/api/business/orgs/{world['other']}/overview")
    assert response.status_code == 404


def test_setup_and_details_save_and_come_back(client_for, world):
    owner = client_for()
    saved = owner.put(f"/api/business/orgs/{world['crown']}/setup",
                      json={"done": ["business", "venue"], "skipped": [], "current": "hours",
                            "venue_id": world["camden"]})
    assert saved.status_code == 200, saved.text
    details = owner.patch(f"/api/business/orgs/{world['crown']}",
                          json={"name": "Crown Pubs", "country": "gb",
                                "billing_email": "accounts@example.test"})
    assert details.status_code == 200, details.text
    org = owner.get(f"/api/business/orgs/{world['crown']}/overview").json()["org"]
    assert org["name"] == "Crown Pubs" and org["country"] == "GB"
    assert org["setup"]["current"] == "hours"
    assert org["setup"]["done"] == ["business", "venue"]


def test_staff_cannot_change_setup_or_details(client_for, world, sqlite_engine):
    _join(sqlite_engine, world["crown"], SAM, venue_roles={world["camden"]: "staff"})
    staff = client_for(SAM)
    assert staff.put(f"/api/business/orgs/{world['crown']}/setup",
                     json={"current": "hours"}).status_code == 403
    assert staff.patch(f"/api/business/orgs/{world['crown']}",
                       json={"name": "Mine"}).status_code == 403


# -- staff PIN --------------------------------------------------------------------------------


def test_pin_names_the_person_and_locks_after_five_wrong_tries(client_for, world,
                                                               sqlite_engine):
    crown, camden = world["crown"], world["camden"]
    _join(sqlite_engine, crown, SAM, venue_roles={camden: "staff"})
    with transaction(sqlite_engine, crown) as conn:
        conn.execute(business_staff_pins.insert().values(
            id="pin-sam", workspace_id=crown, organisation_id=crown, venue_id=camden,
            user_id=SAM, pin_hash=pin_hash("2468", "pepper"), salt="pepper", failures=0,
            created_at=1))
    tablet = client_for(SAM)
    right = tablet.post(f"/api/business/venues/{camden}/pin", json={"pin": "2468"})
    assert right.json() == {"ok": True, "member_name": SAM, "role": "staff"}
    for _ in range(5):
        assert tablet.post(f"/api/business/venues/{camden}/pin",
                           json={"pin": "0000"}).json() == {"ok": False}
    locked = tablet.post(f"/api/business/venues/{camden}/pin", json={"pin": "2468"})
    assert locked.status_code == 429
    assert tablet.post(f"/api/business/venues/{world['quay']}/pin",
                       json={"pin": "2468"}).status_code == 404


def test_without_a_mail_sender_the_link_is_still_given(sqlite_engine, world, flags_on):
    app = FastAPI()
    people_routes.install_routes(
        app, engine=sqlite_engine,
        current_claims=lambda: Claims(subject=OWNER, issued_at=0.0, expires_at=9e12),
        principal_for=lambda _e, _c, header: _Principal(
            _Workspace(header or world["crown"]), _User(OWNER, EMAILS[OWNER])),
        rules=RulesCache(sqlite_engine), site_url="https://app.test", sender=None,
        flag_on=lambda _conn, _found, flag: flags_on.get(flag, False),
    )
    made = TestClient(app, headers={"X-Workspace-ID": world["crown"]}).post(
        "/api/business/invitations",
        json={"email": EMAILS[SAM], "role": "viewer", "venue_ids": None})
    assert made.status_code == 201
    assert made.json()["emailed"] is False
    assert made.json()["accept_url"].startswith("https://app.test/business/join#")


def _sso(engine, org: str, *, verified: bool) -> None:
    from selecta.business.people.schema import business_sso_connections

    with transaction(engine, org) as conn:
        conn.execute(business_sso_connections.insert().values(
            id="sso-1", workspace_id=org, organisation_id=org, kind="saml",
            domains=[{"domain": "example.test", "verified": verified}], require_sso=False,
            allow_domain_join=True, status="active", directory_id="directory_1",
            created_at=1, updated_at=1))


def test_a_verified_sso_domain_lets_another_address_join(client_for, world, sqlite_engine):
    made = client_for().post("/api/business/invitations", json={
        "email": "sam@elsewhere.test", "role": "viewer", "venue_ids": None})
    _sso(sqlite_engine, world["crown"], verified=True)
    joined = client_for(ALEX).post("/api/business/invitations/accept",
                                   json={"token": _token(made)})
    assert joined.status_code == 200, joined.text


def test_an_unverified_domain_does_not_let_another_address_join(client_for, world,
                                                                sqlite_engine):
    made = client_for().post("/api/business/invitations", json={
        "email": "sam@elsewhere.test", "role": "viewer", "venue_ids": None})
    _sso(sqlite_engine, world["crown"], verified=False)
    refused = client_for(ALEX).post("/api/business/invitations/accept",
                                    json={"token": _token(made)})
    assert refused.status_code == 403


def test_owners_buy_paid_seats_only_with_business_billing_on(client_for, world, flags_on,
                                                            sqlite_engine):
    owner = client_for()
    assert owner.put("/api/business/seats", json={"paid_seats": 2}).status_code == 403
    flags_on["business.billing"] = True
    bought = owner.put("/api/business/seats", json={"paid_seats": 2})
    assert bought.status_code == 200, bought.text
    assert bought.json() == {"included": 6, "paid": 2, "held": 0}
    _join(sqlite_engine, world["crown"], SAM, venue_roles={world["camden"]: "venue_manager"})
    assert client_for(SAM).put("/api/business/seats", json={"paid_seats": 5}).status_code == 403
    from selecta.business import billing
    from selecta.business.commercial_facts import SqlFacts

    with transaction(sqlite_engine, world["crown"]) as conn:
        facts = SqlFacts().organisation(conn, world["crown"])
    assert facts.paid_seats == 2
    assert billing.quantities_for(facts)["business_extra_seat"] == 2


def test_paid_seats_cannot_drop_below_the_seats_in_use(client_for, world, flags_on):
    flags_on["business.billing"] = True
    owner = client_for()
    owner.put("/api/business/seats", json={"paid_seats": 1})
    for n in range(7):
        assert owner.post("/api/business/invitations", json={
            "email": f"p{n}@example.test", "role": "staff",
            "venue_ids": [world["camden"]]}).status_code == 201
    refused = owner.put("/api/business/seats", json={"paid_seats": 0})
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "seats_in_use"


def test_overview_reads_billing_activity_and_kiosks(client_for, world, sqlite_engine, clock):
    from selecta.business.access import audit
    from selecta.business.commercial_schema import biz_subscriptions

    crown = world["crown"]
    plain = client_for().get(f"/api/business/orgs/{crown}/overview").json()
    assert plain["org"]["billing"]["plan"] == "none"
    assert plain["org"]["billing"]["status"] == "ok"
    with transaction(sqlite_engine, crown) as conn:
        conn.execute(biz_subscriptions.insert().values(
            id="sub-1", workspace_id=crown, organisation_id=crown,
            stripe_subscription_id="sub_123", currency="eur", interval="year", status="past_due",
            past_due_since=clock.now - 3600, grace_ends_at=clock.now + 86_400, quantities={},
            raw={}, created_at=1, updated_at=1))
        audit.activity(conn, None, "control", "Skipped a song", organisation_id=crown,
                       workspace_id=crown, venue_id=world["camden"], now=clock.now - 10)
        conn.execute(devices.insert().values(
            id="kiosk-1", workspace_id=crown, user_id=None, principal="kiosk",
            zone_id=world["bar"], name="Bar player", kind="desktop", capabilities={},
            created_at=1, last_seen_at=clock.now - 5))
    answer = client_for().get(f"/api/business/orgs/{crown}/overview").json()
    billing = answer["org"]["billing"]
    assert billing["plan"] == "business_annual" and billing["currency"] == "EUR"
    assert billing["status"] == "grace" and billing["grace_ends_at"] == clock.now + 86_400
    assert [line["words"] for line in answer["activity"]] == ["Skipped a song"]
    assert [(d["id"], d["kind"], d["online"]) for d in answer["devices"]] == [
        ("kiosk-1", "kiosk", True)]


class _Directory:
    def __init__(self, users):
        self.users = users

    def get_directory_user(self, directory_user_id):
        from selecta.identity.workos import WorkOSNotFound

        if directory_user_id not in self.users:
            raise WorkOSNotFound("gone")
        return self.users[directory_user_id]


def test_directory_sync_deactivation_offboards_the_member(world, sqlite_engine):
    from selecta.business.people import directory_sync

    crown = world["crown"]
    _sso(sqlite_engine, crown, verified=True)
    _join(sqlite_engine, crown, SAM, venue_roles={world["camden"]: "staff"})
    active = _Directory({"dir_user_sam": {"id": "dir_user_sam", "directory_id": "directory_1",
                                           "state": "active",
                                           "emails": [{"value": EMAILS[SAM]}]}})
    assert directory_sync.handle(sqlite_engine, active, "dsync.user.updated",
                                 {"id": "dir_user_sam", "directory_id": "directory_1"}) \
        == "processed"
    with transaction(sqlite_engine, crown) as conn:
        assert orgs.is_member(conn, crown, SAM)

    inactive = _Directory({"dir_user_sam": {**active.users["dir_user_sam"], "state": "inactive"}})
    directory_sync.handle(sqlite_engine, inactive, "dsync.user.updated",
                          {"id": "dir_user_sam", "directory_id": "directory_1"})
    with transaction(sqlite_engine, crown) as conn:
        assert not orgs.is_member(conn, crown, SAM)
        status = conn.execute(sa.select(business_members.c.status).where(
            business_members.c.user_id == SAM)).scalar()
        assert status == "removed"


def test_a_deleted_directory_user_is_offboarded_by_email(world, sqlite_engine):
    from selecta.business.people import directory_sync

    crown = world["crown"]
    _sso(sqlite_engine, crown, verified=True)
    _join(sqlite_engine, crown, SAM, venue_roles={world["camden"]: "staff"})
    directory_sync.handle(sqlite_engine, _Directory({}), "dsync.user.deleted", {
        "id": "dir_user_sam", "directory_id": "directory_1", "emails": [{"value": EMAILS[SAM]}]})
    with transaction(sqlite_engine, crown) as conn:
        assert not orgs.is_member(conn, crown, SAM)
    # A directory that is not this organisation's touches nothing.
    _join(sqlite_engine, crown, ALEX, venue_roles={world["camden"]: "staff"})
    directory_sync.handle(sqlite_engine, _Directory({}), "dsync.user.deleted", {
        "id": "dir_user_alex", "directory_id": "directory_other",
        "emails": [{"value": EMAILS[ALEX]}]})
    with transaction(sqlite_engine, crown) as conn:
        assert orgs.is_member(conn, crown, ALEX)
