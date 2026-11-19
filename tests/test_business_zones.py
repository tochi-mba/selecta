"""Zones and sessions edge cases under their ADR-0454 names (BZ-0454-02).

The zone lease, volume and scope tests run `playback.zone_session` with the fixtures of
`test_business_zone_sessions`; the removed-zone and downgrade tests run `business.zones` and
`business.billing_plan` on the real tables.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from test_business_zone_sessions import BAR, ELSEWHERE
from test_cloud_playback_fakes import USER, WORKSPACE

from selecta.persistence import transaction
from selecta.playback import zone_session
from selecta.playback.model import LEASE_SECONDS, Position, UnknownZone
from selecta.playback.session import HeartbeatOutcome

# The zone-session fixtures (engine, zones, phone, tablet) without redefining them here.
pytest_plugins = ("test_business_zone_sessions",)


def test_two_kiosks_paired_to_one_zone_one_holds_the_lease(engine, zones, clock):
    home = zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, "kiosk-home",
                                       Position(0, 0))
    standby = zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, "kiosk-standby",
                                          Position(0, 0))
    assert home.session.active_device_id == "kiosk-home"
    assert standby.outcome is HeartbeatOutcome.REFUSED  # the standby stays quiet
    for _ in range(5):
        clock.advance(5)
        for device in ("kiosk-home", "kiosk-standby"):
            beat = zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, device,
                                               Position(0, 0), fence=home.session.fence)
            assert beat.session.active_device_id == "kiosk-home"


def test_remote_controls_only_zones_in_scope(engine, zones, phone):
    zones.hidden[USER] = {ELSEWHERE}
    with pytest.raises(UnknownZone):
        zone_session.zone_submit_command(engine, zones, WORKSPACE, ELSEWHERE, phone.id,
                                         "pause", {}, 0, "cmd-1", user_id=USER)
    with pytest.raises(UnknownZone):
        zone_session.zone_view(engine, zones, WORKSPACE, ELSEWHERE, phone.id, user_id=USER)


def test_play_here_as_emergency_speaker_takes_the_zone_lease(engine, zones, phone):
    kiosk = zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, "kiosk-home",
                                        Position(2, 0))
    with pytest.raises(zone_session.ConfirmNeeded):
        zone_session.zone_take_over(engine, zones, WORKSPACE, BAR, phone.id, user_id=USER)
    taken = zone_session.zone_take_over(engine, zones, WORKSPACE, BAR, phone.id, user_id=USER,
                                        confirm=True)
    assert taken.session.active_device_id == phone.id
    assert taken.session.fence > kiosk.session.fence
    after = zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, "kiosk-home",
                                        Position(2, 0), fence=kiosk.session.fence)
    assert after.session.active_device_id == phone.id  # the kiosk stops; one speaker


def test_zone_volume_is_session_state_shared_by_remotes(engine, zones, phone, tablet):
    taken = zone_session.zone_take_over(engine, zones, WORKSPACE, BAR, phone.id, user_id=USER,
                                        confirm=True)
    changed = zone_session.zone_submit_command(
        engine, zones, WORKSPACE, BAR, tablet.id, "set_volume", {"volume": 40},
        taken.session.seq, "vol-40", fence=taken.session.fence, user_id=USER)
    assert changed.session.volume == 40
    seen_by_phone = zone_session.zone_view(engine, zones, WORKSPACE, BAR, phone.id, user_id=USER)
    seen_by_tablet = zone_session.zone_view(engine, zones, WORKSPACE, BAR, tablet.id,
                                            user_id=USER)
    assert seen_by_phone.session.volume == seen_by_tablet.session.volume == 40


def test_reconnect_after_lease_taken_fades_out(engine, zones, phone, tablet, clock):
    first = zone_session.zone_take_over(engine, zones, WORKSPACE, BAR, phone.id, user_id=USER,
                                        confirm=True)
    clock.advance(LEASE_SECONDS + 1)  # the phone lost its network; its lease ran out
    second = zone_session.zone_take_over(engine, zones, WORKSPACE, BAR, tablet.id, user_id=USER,
                                         confirm=True)
    back = zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, phone.id, Position(1, 0),
                                       fence=first.session.fence, user_id=USER)
    assert back.outcome is HeartbeatOutcome.REFUSED  # the phone must stop (fade out)
    assert back.session.active_device_id == tablet.id
    assert back.session.fence == second.session.fence


# --- zone removal and downgrade on the business tables ---------------------------------------


def _org(sqlite_engine):
    from selecta.business import orgs, venues
    from selecta.business import zones as zone_store
    from selecta.identity.schema import users

    with transaction(sqlite_engine) as conn:
        conn.execute(users.insert().values(id="owner", auth_subject="auth|owner",
                                           email_verified=True, timezone="UTC",
                                           age_confirmed=True, created_at=0.0))
        org = orgs.create(conn, owner_user_id="owner", name="Crown Group", now=1)["id"]
    with transaction(sqlite_engine, org) as conn:
        venue = venues.create(conn, org, name="Camden", timezone="Europe/London",
                              country="GB", now=1)["id"]
        made = [zone_store.create(conn, org, venue, name=name, now=1 + n)["id"]
                for n, name in enumerate(("Bar", "Terrace", "Garden"))]
    return org, venue, made


def test_removed_zone_stops_at_its_next_close(sqlite_engine):
    from selecta.business import zones as zone_store

    org, _venue, (bar, terrace, _garden) = _org(sqlite_engine)
    close = 10_000
    with transaction(sqlite_engine, org) as conn:
        kept = zone_store.archive(conn, org, terrace, when="closing", now=5_000,
                                  closing_at=close)
        assert kept["status"] == "active"  # still playing through service
        assert zone_store.apply_due(conn, org, now=close - 1) == []
        assert zone_store.apply_due(conn, org, now=close) == [terrace]
        assert zone_store.get(conn, org, terrace)["status"] == "archived"
        assert zone_store.get(conn, org, bar)["status"] == "active"


def test_downgrade_pauses_zones_over_the_paid_count_owner_picks(sqlite_engine):
    """The owner picks how many zones stay paid; the rest pause at the venue's close, never
    mid-service. Gap noted in ADR-0454: the owner cannot yet pick which zones (the newest
    pause first)."""
    from selecta.business import billing_plan
    from selecta.business.commercial_facts import FixedHours, OrgFacts, VenueFacts
    from selecta.business.schema import zones as zone_table

    org_id, venue_id, (bar, terrace, garden) = _org(sqlite_engine)
    org = OrgFacts(org_id, org_id, "Crown Group", (VenueFacts(venue_id, "Camden", zones=3),))
    hours = FixedHours(daily={venue_id: ("10:00", "23:00")})
    noon = 1_795_000_000.0 - (1_795_000_000.0 % 86_400) + 12 * 3600  # 12:00 UTC, open
    with transaction(sqlite_engine, org_id) as conn:
        billing_plan.downgrade(conn, None, org, keep_venue_ids=[venue_id],
                               paid_zones={venue_id: 1}, hours=hours, now=noon, actor="owner")
        assert billing_plan.apply_due_pauses(conn, org, now=noon + 60, hours=hours) == []
        status = dict(conn.execute(sa.select(zone_table.c.id, zone_table.c.status)).all())
        assert set(status.values()) == {"active"}  # nothing pauses during service
        billing_plan.apply_due_pauses(conn, org, now=noon + 12 * 3600, hours=hours)
        status = dict(conn.execute(sa.select(zone_table.c.id, zone_table.c.status)).all())
    assert status[bar] == "active"
    assert status[terrace] == status[garden] == "paused"
