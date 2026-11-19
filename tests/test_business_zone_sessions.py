"""Zone playback sessions (ADR-0443) at the service level: one speaker per zone.

Two zones of one organisation keep independent leases; a device holds at most one zone lease;
the home kiosk outranks its standby and takes the zone back at a song boundary; a staff phone
plays a zone only after a confirm while a kiosk is playing, and never when the zone turned that
off; a zone outside a person's scope looks missing; zone volume is clamped to the zone's cap;
a kiosk moves between zones of its venue now, never across venues. The zones come from a
`StaticZones` directory, so these run without the venue tables.
"""

from __future__ import annotations

import pytest
from test_cloud_playback_fakes import USER, WORKSPACE, follow_clock

from selecta.persistence import transaction
from selecta.playback import devices, zone_session
from selecta.playback.model import (
    LEASE_SECONDS,
    DeviceInOtherZone,
    PersonSpeakerOff,
    Position,
    UnknownZone,
)
from selecta.playback.schema import devices as device_table
from selecta.playback.session import HeartbeatOutcome
from selecta.playback.zones import StaticZones, ZoneInfo, set_allow_person_speakers

BAR, TERRACE, ELSEWHERE = "zone-bar", "zone-terrace", "zone-elsewhere"


@pytest.fixture
def engine(cloud_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    return cloud_engine


def _kiosk(engine, clock, device_id: str, zone_id: str) -> str:
    with transaction(engine, WORKSPACE) as conn:
        conn.execute(device_table.insert().values(
            id=device_id, workspace_id=WORKSPACE, user_id=None, principal="kiosk",
            zone_id=zone_id, name=f"Player {device_id}", kind="desktop", capabilities={},
            created_at=clock.now, last_seen_at=clock.now))
    return device_id


@pytest.fixture
def zones(engine, clock):
    found = StaticZones(caps={BAR: 60})
    found.add(ZoneInfo(BAR, WORKSPACE, "venue-camden", "Bar", venue_name="Camden",
                       home_device_id="kiosk-home", standby_device_id="kiosk-standby"))
    found.add(ZoneInfo(TERRACE, WORKSPACE, "venue-camden", "Terrace", venue_name="Camden"))
    found.add(ZoneInfo(ELSEWHERE, WORKSPACE, "venue-soho", "Lounge", venue_name="Soho"))
    _kiosk(engine, clock, "kiosk-home", BAR)
    _kiosk(engine, clock, "kiosk-standby", BAR)
    return found


@pytest.fixture
def phone(engine):
    return devices.register(engine, WORKSPACE, USER, name="Phone", kind="phone").device


@pytest.fixture
def tablet(engine):
    return devices.register(engine, WORKSPACE, USER, name="Tablet", kind="tablet").device


def test_two_zones_keep_independent_leases(engine, zones, phone, tablet):
    bar = zone_session.zone_take_over(engine, zones, WORKSPACE, BAR, phone.id, user_id=USER)
    terrace = zone_session.zone_take_over(engine, zones, WORKSPACE, TERRACE, tablet.id,
                                          user_id=USER)
    assert bar.session.zone_id == BAR and bar.session.active_device_id == phone.id
    assert terrace.session.zone_id == TERRACE and terrace.session.active_device_id == tablet.id
    beat = zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, phone.id, Position(2, 0),
                                       fence=bar.session.fence, user_id=USER)
    assert beat.session.song_index == 2
    with transaction(engine, WORKSPACE) as conn:
        from selecta.playback.store import load_session

        assert load_session(conn, WORKSPACE, TERRACE).song_index == 0


def test_a_device_holds_one_zone_lease_at_a_time(engine, zones, phone):
    zone_session.zone_take_over(engine, zones, WORKSPACE, BAR, phone.id, user_id=USER)
    with pytest.raises(DeviceInOtherZone):
        zone_session.zone_take_over(engine, zones, WORKSPACE, TERRACE, phone.id, user_id=USER)
    refused = zone_session.zone_heartbeat(engine, zones, WORKSPACE, TERRACE, phone.id,
                                          Position(0, 0), user_id=USER)
    assert refused.outcome is HeartbeatOutcome.REFUSED
    assert refused.playing_zone_id == BAR and refused.playing_zone_name == "Bar"


def test_the_standby_waits_for_a_dead_lease_and_the_home_kiosk_takes_it_back(engine, zones,
                                                                            clock):
    home = zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, "kiosk-home",
                                       Position(0, 0))
    assert home.session.active_device_id == "kiosk-home"
    early = zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, "kiosk-standby",
                                        Position(0, 0))
    assert early.session.active_device_id == "kiosk-home"
    clock.advance(LEASE_SECONDS + 1)
    took = zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, "kiosk-standby",
                                       Position(3, 1000), fence=home.session.fence)
    assert took.session.active_device_id == "kiosk-standby"
    back = zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, "kiosk-home",
                                       Position(0, 0), fence=took.session.fence)
    assert back.session.active_device_id == "kiosk-standby"
    assert back.hand_back_to_device_id == "kiosk-home"
    # Same song: no cut. The next song is the boundary where the zone goes home.
    same = zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, "kiosk-standby",
                                       Position(3, 5000), fence=took.session.fence)
    assert same.session.active_device_id == "kiosk-standby"
    handed = zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, "kiosk-standby",
                                         Position(4, 0), fence=took.session.fence)
    assert handed.outcome is HeartbeatOutcome.HANDED_BACK
    assert handed.session.active_device_id == "kiosk-home"
    assert handed.session.song_index == 4 and handed.session.fence > took.session.fence


def test_a_staff_phone_asks_first_and_obeys_the_zone_setting(engine, zones, phone, clock):
    zone_session.zone_heartbeat(engine, zones, WORKSPACE, BAR, "kiosk-home", Position(0, 0))
    with pytest.raises(zone_session.ConfirmNeeded):
        zone_session.zone_take_over(engine, zones, WORKSPACE, BAR, phone.id, user_id=USER)
    taken = zone_session.zone_take_over(engine, zones, WORKSPACE, BAR, phone.id, user_id=USER,
                                        confirm=True)
    assert taken.session.active_device_id == phone.id
    handed = zone_session.hand_back(engine, zones, WORKSPACE, BAR, phone.id, Position(1, 0),
                                    user_id=USER)
    assert handed.active_device_id == "kiosk-home"
    with transaction(engine, WORKSPACE) as conn:
        set_allow_person_speakers(conn, WORKSPACE, TERRACE, False, clock.now)
    with pytest.raises(PersonSpeakerOff):
        zone_session.zone_take_over(engine, zones, WORKSPACE, TERRACE, phone.id, user_id=USER)


def test_a_zone_out_of_scope_looks_missing(engine, zones, phone):
    zones.hidden[USER] = {ELSEWHERE}
    with pytest.raises(UnknownZone):
        zone_session.zone_take_over(engine, zones, WORKSPACE, ELSEWHERE, phone.id, user_id=USER)
    with pytest.raises(UnknownZone):
        zone_session.zone_take_over(engine, zones, WORKSPACE, "zone-nowhere", phone.id,
                                    user_id=USER)


def test_zone_volume_is_shared_and_clamped_to_the_cap(engine, zones, phone, tablet):
    taken = zone_session.zone_take_over(engine, zones, WORKSPACE, BAR, phone.id, user_id=USER,
                                        confirm=True)
    session = taken.session
    result = zone_session.zone_submit_command(
        engine, zones, WORKSPACE, BAR, tablet.id, "set_volume", {"volume": 90}, session.seq,
        "vol-1", fence=session.fence, user_id=USER)
    assert result.session.volume == 60


def test_a_kiosk_moves_within_its_venue_but_not_across_venues(engine, zones, clock):
    moved = zone_session.move_device(engine, zones, WORKSPACE, "kiosk-standby", TERRACE)
    assert moved.to_zone_id == TERRACE and not moved.scheduled
    with pytest.raises(zone_session.MoveAcrossVenues):
        zone_session.move_device(engine, zones, WORKSPACE, "kiosk-home", ELSEWHERE)
    with pytest.raises(zone_session.NotAKiosk):
        phone = devices.register(engine, WORKSPACE, USER, name="Phone", kind="phone").device
        zone_session.move_device(engine, zones, WORKSPACE, phone.id, TERRACE)
