"""Rooms for Business edge cases under their ADR-0454 names (BZ-0454-03).

Each named test runs the real `ZoneRooms` service with the shared fixtures of
`test_business_rooms_support`. Where the BZ-0451 suite already holds exactly the same check, the
named test runs that check (and says which); the rest are written here.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
import test_business_rooms_requests as rr
import test_business_rooms_week as rw
from test_business_rooms_support import (  # noqa: F401
    BAR,
    Clock,
    WeekHours,
    code_of,
    configure,
    manager,
    seen,
)

from selecta.business.rooms import settings
from selecta.business.rooms.errors import Refused
from selecta.persistence import transaction

pytest_plugins = ("test_business_rooms_support",)
LONDON = ZoneInfo("Europe/London")


@pytest.fixture
def clock():
    """The callable room-service clock, not the database clock fixture of the same name."""
    return Clock()


def test_standing_room_opens_and_closes_with_hours(make, clock):
    """Open through an overnight opening, closed at its 02:00 close (BZ-0451-01 check)."""
    rw.test_overnight_close_is_open_after_midnight_and_closed_at_two(make, clock)


def test_card_scanned_after_close_shows_opening_time(make, clock):
    svc = make(hours=WeekHours())
    clock.now = datetime(2026, 10, 19, 3, 0, tzinfo=LONDON).timestamp()  # Monday, closed
    token = svc.join(code_of(svc), "10.0.0.9").token  # the card still joins the room
    shown = svc.guest_state(token)
    assert shown["state"] == "closed" and shown["text"] == "Requests open at 17:00"


def test_unapproved_request_expires_after_twenty_minutes(make, clock):
    rr.test_an_unanswered_request_expires_after_twenty_minutes(make, clock)


def test_no_staff_seen_pauses_requests(make, clock):
    rr.test_requests_pause_when_no_staff_device_was_seen_for_ten_minutes(make, clock)


def test_venue_network_crowd_of_500_joins(make):
    rr.test_five_hundred_guests_join_from_the_venue_network(make)


def test_code_guessing_never_locks_out_the_venue_network(make, engine):
    rr.test_code_guessing_on_the_venue_network_locks_the_visitor_not_the_venue(make, engine)


def test_flood_switches_zone_to_staff_approval(make, engine, clock):
    svc = make()
    seen(svc)
    configure(svc, {"mode": settings.AUTO_ACCEPT, "limits": {"accepted_per_hour": 1}})
    crowd = [svc.join(code_of(svc), f"198.51.100.{40 + i}") for i in range(4)]
    for index, person in enumerate(crowd[:3]):
        svc.place(person.token, f"s{30 + index}")
    assert svc.place(crowd[3].token, "s40")["status"] == "sent"  # waits for staff now
    assert configure(svc, {})["effective_mode"] == settings.STAFF_APPROVE
    assert "rooms.flood_switch" in rr.activity_kinds(engine)


def test_request_refused_by_new_rules_is_withdrawn_politely(make, content):
    rr.test_a_refused_song_is_refused_when_placed_and_withdrawn_when_its_slot_comes(make, content)


def test_guest_payload_has_no_staff_or_billing_fields(make):
    rr.test_guest_payloads_carry_no_staff_device_billing_or_licence_words(make)


def test_rotated_code_keeps_guests_in_the_room(make):
    svc = make()
    seen(svc)
    first = code_of(svc)
    guest = svc.join(first, "203.0.113.9")
    with transaction(svc.engine) as conn:
        svc.rotate(conn, manager(), BAR)
    assert svc.guest_state(guest.token, first)["room_id"] == guest.room_id
    assert svc.place(guest.token, "s1")["status"] in ("sent", "accepted")
    with pytest.raises(Refused) as gone:
        svc.join(first, "198.51.100.77")
    assert gone.value.status == 410
