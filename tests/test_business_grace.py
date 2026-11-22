"""Billing, grace and pilots edge cases (ADR-0454 "Billing, grace and pilots", BZ-0454-04).

Each named test drives the real dunning pass (`dunning.tick`), the stop plan the kiosk caches
(`dunning.stop_plan`), recovery (`dunning.recover`), the pilot stop (`pilot.pilot_stop`) and the
self-serve sign-up route, with venue hours from `FixedHours` and a frozen clock. Nothing is sent:
notices are rows.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import sqlalchemy as sa

from selecta.business import dunning, pilot
from selecta.business.commercial_facts import FixedHours, OrgFacts, VenueFacts
from selecta.business.commercial_schema import biz_notices, biz_subscriptions
from selecta.persistence import transaction

ORG = "org-grace"
LONDON = ZoneInfo("Europe/London")
HOURS = FixedHours(daily={"v0": ("10:00", "23:00")})
VENUE = VenueFacts("v0", "Harbour Street")
FACTS = OrgFacts(ORG, ORG, "Harbour Group", (VENUE,))
HOUR, DAY = 3600, 86_400


def local(y: int, m: int, d: int, h: int, mi: int = 0) -> float:
    return datetime(y, m, d, h, mi, tzinfo=LONDON).timestamp()


def in_grace(engine, *, grace_ends_at: float) -> None:
    with transaction(engine) as conn:
        conn.execute(sa.insert(biz_subscriptions).values(
            id="sub-row", workspace_id=ORG, organisation_id=ORG, stripe_customer_id="cus_1",
            stripe_subscription_id="sub_1", currency="GBP", interval="month", status="past_due",
            quantities={}, raw={}, created_at=grace_ends_at - 20 * DAY,
            updated_at=grace_ends_at - 20 * DAY, past_due_since=grace_ends_at - 14 * DAY,
            grace_ends_at=grace_ends_at))


def run_ticks(engine, start: float, end: float, step: float = HOUR, hours=HOURS) -> list[str]:
    stopped: list[str] = []
    now = start
    while now <= end:
        with transaction(engine) as conn:
            stopped += dunning.tick(conn, FACTS, now=now, hours=hours).stopped
        now += step
    return stopped


def stop_at(engine, now: float, hours=HOURS) -> float | None:
    with transaction(engine) as conn:
        plan = dunning.stop_plan(conn, FACTS, hours, now)
    return plan[0].stop_at if plan else None


def stopped(engine) -> bool:
    with transaction(engine) as conn:
        return dunning.is_venue_stopped(conn, ORG, "v0")


def test_grace_ends_mid_service_music_continues_to_close(sqlite_engine):
    grace_end = local(2026, 11, 20, 15)
    in_grace(sqlite_engine, grace_ends_at=grace_end)
    run_ticks(sqlite_engine, grace_end - 4 * DAY, grace_end + 60)
    assert stop_at(sqlite_engine, grace_end) == local(2026, 11, 20, 23)
    assert not stopped(sqlite_engine)  # still playing through service
    assert run_ticks(sqlite_engine, local(2026, 11, 20, 23), local(2026, 11, 20, 23)) == ["v0"]


def test_grace_ends_after_close_music_does_not_start_next_opening(sqlite_engine):
    grace_end = local(2026, 11, 20, 23, 30)
    in_grace(sqlite_engine, grace_ends_at=grace_end)
    run_ticks(sqlite_engine, grace_end - 4 * DAY, grace_end + 2 * HOUR, step=1800)
    assert stop_at(sqlite_engine, grace_end) == grace_end  # closed already: the stop is then
    assert stopped(sqlite_engine)
    assert stopped(sqlite_engine) and local(2026, 11, 21, 10) > grace_end


def test_payment_one_minute_before_close_cancels_the_stop(sqlite_engine):
    grace_end = local(2026, 11, 20, 15)
    in_grace(sqlite_engine, grace_ends_at=grace_end)
    run_ticks(sqlite_engine, grace_end - 4 * DAY, grace_end)
    with transaction(sqlite_engine) as conn:
        assert dunning.recover(conn, FACTS, now=local(2026, 11, 20, 22, 59))
    assert stop_at(sqlite_engine, local(2026, 11, 20, 22, 59)) is None
    assert run_ticks(sqlite_engine, local(2026, 11, 20, 23), local(2026, 11, 21, 12)) == []
    assert not stopped(sqlite_engine)


def test_webhook_arrives_during_the_closing_fade(sqlite_engine):
    grace_end = local(2026, 11, 20, 15)
    in_grace(sqlite_engine, grace_ends_at=grace_end)
    run_ticks(sqlite_engine, grace_end - 4 * DAY, local(2026, 11, 20, 23))
    assert stopped(sqlite_engine)
    with transaction(sqlite_engine) as conn:  # the payment lands 10 s into the closing fade
        assert dunning.recover(conn, FACTS, now=local(2026, 11, 20, 23) + 10)
    assert not stopped(sqlite_engine)  # the next opening plays
    assert stop_at(sqlite_engine, local(2026, 11, 21, 9)) is None


def test_warnings_at_72_and_24_hours_sent_once_each(sqlite_engine):
    grace_end = local(2026, 11, 20, 15)
    in_grace(sqlite_engine, grace_ends_at=grace_end)
    run_ticks(sqlite_engine, grace_end - 6 * DAY, local(2026, 11, 21, 1), step=600)
    with transaction(sqlite_engine) as conn:
        rows = conn.execute(sa.select(biz_notices.c.kind, biz_notices.c.channel, biz_notices.c.
                                      created_at).where(biz_notices.c.venue_id == "v0")).all()
    stop = local(2026, 11, 20, 23)
    for hours in (72, 24):
        sent = [r for r in rows if r.kind == f"dunning.stop_warning.{hours}h"]
        assert sorted(r.channel for r in sent) == ["email", "in_app"]
        assert all(r.created_at <= stop - hours * HOUR for r in sent)


def test_grace_end_on_a_dst_night(sqlite_engine):
    # Europe/London falls back on 2026-10-25: 01:00 to 02:00 happens twice that night.
    overnight = FixedHours(daily={"v0": ("18:00", "02:00")})
    grace_end = local(2026, 10, 25, 0, 30)
    in_grace(sqlite_engine, grace_ends_at=grace_end)
    run_ticks(sqlite_engine, grace_end - 4 * DAY, grace_end, hours=overnight)
    planned = stop_at(sqlite_engine, grace_end, hours=overnight)
    assert planned == local(2026, 10, 25, 2)
    assert planned - grace_end == 2.5 * HOUR  # the repeated hour is counted, not skipped
    assert run_ticks(sqlite_engine, planned - HOUR, planned - 60, step=600,
                     hours=overnight) == []


def test_stay_open_late_disabled_after_grace_end(sqlite_engine):
    grace_end = local(2026, 11, 20, 15)
    in_grace(sqlite_engine, grace_ends_at=grace_end)
    with transaction(sqlite_engine) as conn:
        assert dunning.stay_open_late_refusal(conn, ORG, grace_end - 60) is None
        refusal = dunning.stay_open_late_refusal(conn, ORG, grace_end + 60)
    assert refusal and "cannot stay open late" in refusal
    with transaction(sqlite_engine) as conn:
        dunning.recover(conn, FACTS, now=grace_end + 120)
        assert dunning.stay_open_late_refusal(conn, ORG, grace_end + 180) is None


def test_pilot_end_follows_the_same_stop_at_close_rule(sqlite_engine, monkeypatch):
    from selecta.business import commercial_facts
    from selecta.identity.schema import users

    with transaction(sqlite_engine) as conn:
        conn.execute(users.insert().values(id="owner-1", auth_subject="auth|owner-1",
                                           email_verified=True, timezone="UTC",
                                           age_confirmed=True, created_at=0.0))
        made = pilot.create_pilot(conn, owner_user_id="owner-1", org_name="Pilot Bars",
                                  venues=[{"name": "Dock", "timezone": "Europe/London",
                                           "country": "GB", "zones": ["Bar"]}],
                                  now=int(local(2026, 11, 1, 9)))
    workspace, venue = made["org"]["id"], made["venues"][0]["id"]
    hours = FixedHours(daily={venue: ("10:00", "23:00")})
    # The venue's opening hours as BZ-3 would store them.
    monkeypatch.setattr(commercial_facts.Bz3Hours, "openings",
                        lambda _self, conn, facts, start, end: hours.openings(
                            conn, facts, start, end))
    with transaction(sqlite_engine) as conn:
        ends_mid_service = local(2026, 11, 20, 15)
        assert pilot.pilot_stop(conn, workspace, venue, ends_mid_service) == local(
            2026, 11, 20, 23)
        after_close = local(2026, 11, 20, 23, 30)
        assert pilot.pilot_stop(conn, workspace, venue, after_close) == after_close


def test_pilot_converted_on_last_day_never_goes_read_only(sqlite_engine):
    from selecta.business import workspace_view
    from selecta.business.people.schema import business_pilots

    last_day = local(2026, 11, 20, 12)
    with transaction(sqlite_engine) as conn:
        conn.execute(sa.insert(business_pilots).values(
            id="p1", organisation_id=ORG, name="Pilot", owner_email="owner@example.test",
            venue_allowance=1, zone_allowance=3, ends_at=last_day + 6 * HOUR,
            status="converted", created_by="staff", created_at=last_day - 30 * DAY,
            updated_at=last_day, converted_at=last_day))
        view = workspace_view._pilot(conn, ORG, last_day + 6 * HOUR, last_day + 2 * DAY)
        billing = workspace_view.billing_view(conn, ORG, view, last_day + 2 * DAY)
    assert view["status"] == "converted"  # past its end date, still not "ended"
    assert billing["plan"] != "pilot" and billing["status"] == "ok"


def test_signups_flag_off_refuses_public_organisation_creation(sqlite_engine):
    from dataclasses import dataclass, field

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from selecta import flags
    from selecta.business import routes as business_routes
    from selecta.flags.rules import RulesCache
    from selecta.identity.schema import users
    from selecta.identity.tokens import Claims

    @dataclass
    class Workspace:
        id: str
        kind: str = "personal"

    @dataclass
    class User:
        id: str
        created_at: float = 0.0

    @dataclass
    class Principal:
        workspace: Workspace
        user: User
        workspace_role: str = "owner"
        staff_roles: frozenset = field(default_factory=frozenset)

    with transaction(sqlite_engine) as conn:
        conn.execute(users.insert().values(id="visitor", auth_subject="auth|visitor",
                                           email_verified=True, timezone="UTC",
                                           age_confirmed=True, created_at=0.0))
    app = FastAPI()
    business_routes.install_routes(
        app, engine=sqlite_engine,
        current_claims=lambda: Claims(subject="visitor", issued_at=0.0, expires_at=9e12),
        principal_for=lambda _e, _c, _h: Principal(Workspace("ws-visitor"), User("visitor")),
        rules=RulesCache(sqlite_engine),
    )
    http = TestClient(app)
    try:
        flags.use("+business.orgs -business.signups")
        refused = http.post("/api/business/orgs", json={"name": "Walk-in Bars"})
        assert refused.status_code == 403
        assert refused.json()["detail"]["code"] == "flag_off"
        flags.use("+business.orgs +business.signups")
        assert http.post("/api/business/orgs", json={"name": "Walk-in Bars"}).status_code == 201
    finally:
        flags.use(None)
