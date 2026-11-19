"""Roles, SSO and offboarding edge cases under their ADR-0454 names (BZ-0454-04).

The permission cases run `business.access` (the role bundles and `guard.can`) directly; the
people cases run the ADR-0452 people routes with the fixtures of `test_business_people_routes`.
Where that suite already holds exactly the same check, the named test runs it and says which.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
import test_business_people_routes as pr
from test_business_people_routes import OWNER, SAM, _join, _sso

from selecta.business import orgs
from selecta.business.access import BusinessActor, BusinessNotFound, guard, roles
from selecta.business.access import permissions as perms
from selecta.persistence import transaction

pytest_plugins = ("test_business_people_routes",)
VENUE, OTHER_VENUE, ZONE = "v-camden", "v-soho", "z-bar"


def person(org_role=None, venue_roles=None) -> BusinessActor:
    return BusinessActor(kind=guard.PERSON, id="u1", organisation_id="org", workspace_id="org",
                         org_role=org_role, venue_roles=venue_roles or {})


def holds(actor: BusinessActor, venue: str = VENUE) -> frozenset[str]:
    names = perms.all_names()
    return frozenset(n for n in names if guard.can(actor, n, venue_id=venue)
                     or (perms.get(n).scope == perms.ORG and guard.can(actor, n)))


@pytest.mark.parametrize("role", roles.ROLES)
def test_each_role_holds_exactly_its_permissions(role):
    actor = person(org_role=role) if role in roles.ORG_ROLES else person(
        venue_roles={VENUE: role})
    expected = roles.BUNDLES[role]
    if role not in roles.ORG_ROLES:  # a venue role never reaches organisation-wide permissions
        expected = frozenset(n for n in expected if perms.get(n).scope != perms.ORG)
    assert holds(actor) == expected


def test_out_of_scope_venue_is_404(sqlite_engine):
    class Directory:
        def venue(self, _conn, venue_id):
            return type("V", (), {"organisation_id": "org", "id": venue_id})()

        def zone(self, _conn, _zone_id):
            return None

    manager = person(venue_roles={VENUE: roles.VENUE_MANAGER})
    with transaction(sqlite_engine) as conn:
        guard.require(conn, manager, "business.venue.read", venue_id=VENUE,
                      directory=Directory())
        with pytest.raises(BusinessNotFound):  # exists, but outside the manager's scope
            guard.require(conn, manager, "business.venue.read", venue_id=OTHER_VENUE,
                          directory=Directory())


def test_staff_destructive_routes_are_all_refused():
    destructive = perms.destructive()
    assert destructive  # the registry marks them
    staff = person(venue_roles={VENUE: roles.STAFF})
    tablet = BusinessActor(kind=guard.DEVICE, id="tab", organisation_id="org",
                           workspace_id="org", device_kind=roles.SHARED_TABLET,
                           device_venue_id=VENUE)
    for name in destructive:
        assert not guard.can(staff, name, venue_id=VENUE), name
        assert not guard.can(tablet, name, venue_id=VENUE), name


def test_manager_cannot_self_promote(client_for, world, sqlite_engine):
    assert not roles.outranks(roles.VENUE_MANAGER, roles.VENUE_MANAGER)
    assert not roles.outranks(roles.VENUE_MANAGER, roles.ADMIN)
    assert roles.outranks(roles.VENUE_MANAGER, roles.STAFF)
    _join(sqlite_engine, world["crown"], pr.ALEX, venue_roles={world["camden"]: "venue_manager"})
    manager = client_for(pr.ALEX)
    for role, venues in (("venue_manager", [world["camden"]]), ("admin", None)):
        refused = manager.post("/api/business/invitations", json={
            "email": pr.EMAILS[pr.ALEX], "role": role, "venue_ids": venues})
        assert refused.status_code == 403, role


def test_removed_member_loses_access_within_thirty_seconds(client_for, world, sqlite_engine,
                                                            clock):
    crown = world["crown"]
    _join(sqlite_engine, crown, SAM, venue_roles={world["camden"]: "staff"})
    with transaction(sqlite_engine, crown) as conn:
        assert guard.actor_for(conn, user_id=SAM, organisation_id=crown, workspace_id=crown)
    assert client_for().delete(f"/api/business/people/{SAM}").status_code == 200
    with transaction(sqlite_engine, crown) as conn, pytest.raises(BusinessNotFound):
        guard.actor_for(conn, user_id=SAM, organisation_id=crown, workspace_id=crown)  # at once
    assert client_for(SAM).get(f"/api/business/orgs/{crown}/overview").status_code == 404


def test_kiosk_survives_its_pairing_person_leaving(client_for, world, sqlite_engine, clock):
    """Removing a person signs out their phone and keeps the venue's kiosk (BZ-0452 check)."""
    pr.test_removing_someone_signs_them_out_and_keeps_kiosks(client_for, world, sqlite_engine,
                                                             clock)


def test_scim_deactivation_offboards(world, sqlite_engine):
    pr.test_directory_sync_deactivation_offboards_the_member(world, sqlite_engine)


def test_sso_user_without_mapped_group_gets_no_role(world, sqlite_engine):
    crown = world["crown"]
    _sso(sqlite_engine, crown, verified=True)  # SAM's address is on the verified domain
    with transaction(sqlite_engine, crown) as conn, pytest.raises(BusinessNotFound):
        guard.actor_for(conn, user_id=SAM, organisation_id=crown, workspace_id=crown)
    with transaction(sqlite_engine, crown) as conn:
        assert not orgs.is_member(conn, crown, SAM)


def test_last_owner_cannot_leave(client_for, world, sqlite_engine):
    refused = client_for().delete(f"/api/business/people/{OWNER}")
    assert refused.status_code in (403, 409)
    with transaction(sqlite_engine, world["crown"]) as conn:
        assert orgs.is_member(conn, world["crown"], OWNER)
    pr.test_the_last_owner_cannot_be_removed(client_for, world, sqlite_engine)


def test_personal_workspace_untouched_by_leaving(client_for, world, sqlite_engine):
    from selecta.identity.schema import session_revocations, workspace_members

    crown, personal = world["crown"], world["personal"]
    _join(sqlite_engine, crown, SAM, venue_roles={world["camden"]: "staff"})
    with transaction(sqlite_engine) as conn:
        before = conn.execute(sa.select(workspace_members).where(
            workspace_members.c.workspace_id == personal)).all()
    assert client_for().delete(f"/api/business/people/{SAM}").status_code == 200
    with transaction(sqlite_engine) as conn:
        after = conn.execute(sa.select(workspace_members).where(
            workspace_members.c.workspace_id == personal)).all()
        assert after == before and any(row.user_id == SAM for row in after)
        assert conn.execute(sa.select(session_revocations).where(
            session_revocations.c.user_id == SAM)).first() is None


def test_wrong_pin_five_times_locks_that_pin(client_for, world, sqlite_engine):
    pr.test_pin_names_the_person_and_locks_after_five_wrong_tries(client_for, world,
                                                                  sqlite_engine)
