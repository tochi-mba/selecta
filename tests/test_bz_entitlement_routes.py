"""ADR-0448 wired into the product: usage meters, continuity, paid zones and processing weight.

`selecta.business.entitlement_routes` on a small app with a fake principal over a real
organisation (two venues, an owner and a staff member), plus the gates other parts of the
server call (`entitlement_gates`) and the maintenance pass (`entitlement_jobs`). The database
clock starts at 2027-01-15 08:00 UTC (London is on GMT).
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta import flags
from selecta.business import (
    entitlement_gates,
    entitlement_jobs,
    entitlement_routes,
    orgs,
    venues,
    weight,
    zones,
)
from selecta.business import entitlements as ent
from selecta.business.commercial_facts import Bz3Hours, SqlFacts
from selecta.business.commercial_schema import biz_venue_billing
from selecta.business.hours_schema import venue_hours
from selecta.business.people.schema import business_members, business_venue_roles
from selecta.identity.schema import users, workspace_members
from selecta.identity.tokens import Claims
from selecta.persistence import transaction
from selecta.playback.schema import playback_sessions
from selecta.playback.zone_schema import device_health_history
from selecta.scheduling.policy import Lane
from selecta.usage import quota

OWNER, SAM = "user-owner", "user-sam"
ON = "+business.orgs,+business.schedules,+business.entitlements"
GB = ent.GB


@dataclass
class _Workspace:
    id: str
    kind: str = "business"


@dataclass
class _Principal:
    workspace: _Workspace


@pytest.fixture(autouse=True)
def flags_on():
    flags.use(ON)
    yield
    flags.use(None)


@pytest.fixture
def world(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        for user in (OWNER, SAM):
            conn.execute(users.insert().values(
                id=user, auth_subject=f"auth|{user}", email=f"{user}@example.test",
                email_verified=True, timezone="UTC", age_confirmed=True, created_at=0.0))
        crown = orgs.create(conn, owner_user_id=OWNER, name="The Crown Group", now=1)["id"]
    with transaction(sqlite_engine, crown) as conn:
        camden = venues.create(conn, crown, name="Camden", timezone="Europe/London",
                               country="GB", now=1)["id"]
        soho = venues.create(conn, crown, name="Soho", timezone="Europe/London",
                             country="GB", now=1)["id"]
        bar = zones.create(conn, crown, camden, name="Bar", now=1)["id"]
        snug = zones.create(conn, crown, camden, name="Snug", now=1)["id"]
        conn.execute(workspace_members.insert().values(
            workspace_id=crown, user_id=SAM, role="business_member", created_at=1))
        conn.execute(business_members.insert().values(
            id="m-sam", workspace_id=crown, organisation_id=crown, user_id=SAM,
            email="sam@example.test", status="active", source="invite", joined_at=1))
        conn.execute(business_venue_roles.insert().values(
            id="r-sam", workspace_id=crown, organisation_id=crown, user_id=SAM,
            venue_id=camden, role="staff", created_at=1))
        for day in range(7):
            conn.execute(venue_hours.insert().values(
                id=f"h-{day}", workspace_id=crown, venue_id=camden, weekday=day,
                opens="10:00", closes="23:00", all_day=False))
    return {"crown": crown, "camden": camden, "soho": soho, "bar": bar, "snug": snug}


@pytest.fixture
def client_for(sqlite_engine, world):
    def build(user_id: str = OWNER) -> TestClient:
        app = FastAPI()

        def principal_for(_engine, _claims, header):
            return _Principal(_Workspace(header or world["crown"]))

        claims = lambda: Claims(subject=user_id, issued_at=0.0, expires_at=9e12)  # noqa: E731
        entitlement_routes.install_routes(app, engine=sqlite_engine, current_claims=claims,
                                          principal_for=principal_for)
        return TestClient(app, headers={"X-Workspace-ID": world["crown"]})

    return build


def test_usage_shows_pooled_meters_and_sets_the_storage_limit(client_for, sqlite_engine, world):
    answer = client_for().get("/api/business/usage")

    assert answer.status_code == 200
    body = answer.json()
    assert body["storage"]["limit"] == 350 * GB  # 250 GB + 50 GB for each of two venues
    assert body["seats"]["limit"] == 6
    assert body["zones"] == {"used": 2, "limit": 2}
    assert body["lucy"]["quick"]["limit"] == 600
    assert body["always_open_confirmed"] is False
    assert {v["name"] for v in body["venues"]} == {"Camden", "Soho"}
    with transaction(sqlite_engine, world["crown"]) as conn:
        assert quota.usage(conn, world["crown"]).limit_bytes == 350 * GB


def test_staff_do_not_see_usage(client_for):
    refused = client_for(SAM).get("/api/business/usage")

    assert refused.status_code == 403
    assert "owners, admins and venue managers" in refused.json()["detail"]["message"]


def test_pausing_a_venue_lowers_the_pooled_limit_and_deletes_nothing(sqlite_engine, world, clock):
    with transaction(sqlite_engine, world["crown"]) as conn:
        conn.execute(biz_venue_billing.insert().values(
            venue_id=world["soho"], workspace_id=world["crown"], organisation_id=world["crown"],
            state="paused", paid_zones=0, updated_at=1))
        limit = entitlement_gates.sync_storage_for(conn, world["crown"], clock.time())
        assert limit == 300 * GB
        assert quota.usage(conn, world["crown"]).limit_bytes == 300 * GB


def test_always_open_is_for_owners_and_admins(client_for, sqlite_engine, world):
    assert client_for(SAM).put("/api/business/always-open",
                               json={"confirmed": True}).status_code == 403
    saved = client_for().put("/api/business/always-open", json={"confirmed": True})

    assert saved.status_code == 200
    assert client_for().get("/api/business/usage").json()["always_open_confirmed"] is True
    with transaction(sqlite_engine, world["crown"]) as conn:
        assert weight.always_open_confirmed(conn, world["crown"])


def _playing(conn, crown, zone_id, now):
    conn.execute(playback_sessions.insert().values(
        id=f"s-{zone_id}", workspace_id=crown, zone_id=zone_id, state="playing",
        lease_expires_at=now + 60, updated_at=now))


def test_a_second_zone_past_the_paid_count_is_refused_plainly(sqlite_engine, world, clock):
    now = clock.time()
    with transaction(sqlite_engine, world["crown"]) as conn:
        _playing(conn, world["crown"], world["bar"], now)
        refused = entitlement_gates.zone_start_refusal(conn, world["crown"], world["snug"], now)
        again = entitlement_gates.zone_start_refusal(conn, world["crown"], world["bar"], now)

    assert refused is not None and "pays for 1 zone" in refused and "settings are kept" in refused
    assert again is None


def test_a_paid_extra_zone_lets_the_second_zone_start(sqlite_engine, world, clock):
    now = clock.time()
    with transaction(sqlite_engine, world["crown"]) as conn:
        conn.execute(biz_venue_billing.insert().values(
            venue_id=world["camden"], workspace_id=world["crown"],
            organisation_id=world["crown"], state="active", paid_zones=1, updated_at=1))
        _playing(conn, world["crown"], world["bar"], now)
        assert entitlement_gates.zone_start_refusal(
            conn, world["crown"], world["snug"], now) is None


def test_with_the_flag_off_nothing_is_refused_or_reweighted(sqlite_engine, world, clock):
    flags.use("+business.orgs")
    now = clock.time()
    with transaction(sqlite_engine, world["crown"]) as conn:
        _playing(conn, world["crown"], world["bar"], now)
        assert entitlement_gates.zone_start_refusal(
            conn, world["crown"], world["snug"], now) is None
        assert entitlement_gates.scheduler_tier(conn, world["crown"], now) is None


def test_open_hours_raise_only_the_interactive_lane(sqlite_engine, world, clock):
    with transaction(sqlite_engine, world["crown"]) as conn:
        before = entitlement_gates.scheduler_tier(conn, world["crown"], clock.time())
    clock.advance(1.5 * 3600)  # 09:30, within 30 minutes of the 10:00 opening
    with transaction(sqlite_engine, world["crown"]) as conn:
        warming = entitlement_gates.scheduler_tier(conn, world["crown"], clock.time())

    assert before == weight.TIER_CLOSED
    assert warming == weight.TIER_OPEN
    policy = weight.business_policy()
    assert policy.weight(entitlement_gates.lane_tier(warming, Lane.INTERACTIVE)) == 8.0
    assert policy.weight(entitlement_gates.lane_tier(warming, Lane.STANDARD)) == 6.0
    assert policy.weight(entitlement_gates.lane_tier("premium", Lane.INTERACTIVE)) == \
        policy.weight("premium")


def test_continuity_counts_unknown_minutes_apart_and_the_route_shows_them(
    client_for, sqlite_engine, world, clock
):
    clock.advance(4 * 3600)  # 12:00 on 15 January
    now = clock.time()
    with transaction(sqlite_engine, world["crown"]) as conn:
        conn.execute(device_health_history.insert().values(
            device_id="kiosk-1", bucket_at=now - 600, workspace_id=world["crown"],
            zone_id=world["bar"], reports=5, playing_reports=5, silent_reports=0,
            blocked_reports=0, no_wake_lock_reports=0))
        org = SqlFacts().organisation(conn, world["crown"])
        saved = entitlement_jobs.measure_org(conn, org, "2027-01", now, Bz3Hours())

    assert saved == 2  # Camden's two zones; Soho has no zones
    body = client_for().get("/api/business/slo", params={"month": "2027-01"}).json()
    bar = next(row for row in body["zones"] if row["zone_id"] == world["bar"])
    assert bar["playing_minutes"] == 5
    assert bar["unknown_minutes"] == bar["scheduled_minutes"] - 5
    assert bar["continuity"] == 1.0
    assert bar["readiness"] is None  # no transition record exists yet: unmeasured, no credit
    assert body["targets"]["continuity"] == 0.999


def test_a_bad_month_is_refused(client_for):
    assert client_for().get("/api/business/slo", params={"month": "2027-13"}).status_code == 400


def test_the_maintenance_pass_runs_every_business_organisation(sqlite_engine, world, clock):
    clock.advance(4 * 3600)
    done = entitlement_jobs.run_pass(sqlite_engine)

    assert done["organisations"] == 1 and done["failed"] == 0
    with transaction(sqlite_engine, world["crown"]) as conn:
        assert quota.usage(conn, world["crown"]).limit_bytes == 350 * GB
        months = conn.execute(sa.text("SELECT COUNT(*) FROM biz_slo_months")).scalar()
    assert months == 4  # two zones, this month and last


def test_month_keys_cross_the_new_year():
    assert entitlement_jobs.month_keys("Europe/London", 1_798_761_600.0) == ("2027-01", "2026-12")
