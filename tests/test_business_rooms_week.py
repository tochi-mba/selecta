"""BZ-0451-01: standing zone rooms over a simulated week, an overnight close and a DST night."""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa
from test_business_rooms_support import (  # noqa: F401
    BAR,
    TERRACE,
    WeekHours,
    code_of,
    seen,
)
from test_business_rooms_support import Clock as WeekClock

from selecta.business.rooms import ports
from selecta.business.rooms.schema import business_zone_rooms
from selecta.persistence import transaction
from selecta.rooms.schema import rooms as personal_rooms

# Share the canonical fixtures without shadowing them in test parameters.
pytest_plugins = ("test_business_rooms_support",)

LONDON = ZoneInfo("Europe/London")


@pytest.fixture
def clock():
    """Use the callable room-service clock instead of the database clock fixture."""
    return WeekClock()


def state_of(svc, token):
    return svc.guest_state(token)


def test_one_standing_room_per_zone_and_no_expiry_over_a_week(make, clock):
    hours = WeekHours()
    svc = make(hours=hours)
    first = code_of(svc)
    joined = svc.join(first, "10.0.0.1")
    room_id = joined.room_id
    opened = closed = 0
    for _hour in range(24 * 8):
        clock.advance(3600)
        seen(svc)  # staff on shift keep requests from pausing
        shown = state_of(svc, joined.token)
        at = datetime.fromtimestamp(clock(), UTC)
        assert shown["room_id"] == room_id
        if hours.is_open(None, BAR, at):
            opened += 1
            assert shown["state"] == "open", at.astimezone(LONDON)
        else:
            closed += 1
            assert shown["state"] == "closed"
            assert shown["text"] == "Requests open at 17:00"
            assert shown["now_playing"] is None and shown["coming_up"] == []
    assert opened and closed
    assert code_of(svc) == first  # the printed code never changed on its own
    with transaction(svc.engine) as conn:
        rows = conn.execute(sa.select(business_zone_rooms.c.zone_id)).scalars().all()
    assert rows == [BAR]


def test_overnight_close_is_open_after_midnight_and_closed_at_two(make, clock):
    # Wednesday at 01:30 belongs to Tuesday's overnight opening. Make Tuesday
    # an opening day in this test; the default fixture intentionally closes Tuesdays.
    hours = WeekHours(closed_weekday=0)
    svc = make(hours=hours)
    token = svc.join(code_of(svc), "10.0.0.2").token
    for day, hour, minute in (
        (20, 23, 59),  # Tuesday night
        (21, 0, 0),    # Wednesday midnight
        (21, 1, 30),   # the reported regression
        (21, 1, 59),   # just before the scheduled close
    ):
        clock.now = datetime(2026, 10, day, hour, minute, tzinfo=LONDON).timestamp()
        seen(svc)  # staff must still be present for staff-approved requests
        assert state_of(svc, token)["state"] == "open", (day, hour, minute)
    for hour, minute in ((2, 0), (2, 30)):
        clock.now = datetime(2026, 10, 21, hour, minute, tzinfo=LONDON).timestamp()
        shown = state_of(svc, token)
        assert shown["state"] == "closed"
        assert shown["text"] == "Requests open at 17:00"


def test_closed_tuesday_keeps_monday_overnight_but_not_tuesday_night(make, clock):
    hours = WeekHours()  # Tuesday has no opening period
    svc = make(hours=hours)
    token = svc.join(code_of(svc), "10.0.0.8").token
    for day, hour, minute, expected in (
        (20, 1, 30, "open"),   # Monday opening continues into Tuesday
        (20, 2, 0, "closed"),  # closes exactly at the boundary
        (20, 19, 0, "closed"), # Tuesday has no 17:00 opening
        (21, 1, 30, "closed"), # Wednesday morning belongs to closed Tuesday
    ):
        clock.now = datetime(2026, 10, day, hour, minute, tzinfo=LONDON).timestamp()
        seen(svc)
        assert state_of(svc, token)["state"] == expected, (day, hour, minute)



def test_closed_day_points_to_the_next_opening(make, clock):
    svc = make(hours=WeekHours())  # closed Tuesdays
    token = svc.join(code_of(svc), "10.0.0.3").token
    clock.now = datetime(2026, 10, 20, 19, 0, tzinfo=LONDON).timestamp()  # Tuesday evening
    assert state_of(svc, token)["text"] == "Requests open at 17:00"


def test_dst_night_keeps_local_hours(make, clock):
    # British Summer Time ends at 02:00 on Sunday 25 October 2026 (clocks go back to 01:00).
    hours = WeekHours()
    svc = make(hours=hours)
    token = svc.join(code_of(svc), "10.0.0.4").token
    before = datetime(2026, 10, 25, 0, 30, tzinfo=UTC).timestamp()  # 01:30 BST
    for minutes in range(0, 240, 15):
        clock.now = before + minutes * 60
        seen(svc)
        at = datetime.fromtimestamp(clock(), UTC)
        expected = "open" if hours.is_open(None, BAR, at) else "closed"
        assert state_of(svc, token)["state"] == expected
    # 01:30 BST and 01:30 GMT are both open; 02:00 GMT (03:00 UTC) is closed.
    clock.now = datetime(2026, 10, 25, 1, 30, tzinfo=UTC).timestamp()
    assert state_of(svc, token)["state"] == "open"
    clock.now = datetime(2026, 10, 25, 2, 5, tzinfo=UTC).timestamp()
    shown = state_of(svc, token)
    assert shown["state"] == "closed" and shown["text"] == "Requests open at 17:00"
    # Sunday's 17:00 is GMT now: 17:00 UTC.
    nxt = hours.next_open(None, BAR, datetime.fromtimestamp(clock(), UTC))
    assert nxt.astimezone(UTC).hour == 17


def test_stay_open_late_keeps_the_room_open(make, clock):
    hours = WeekHours()
    svc = make(hours=hours)
    token = svc.join(code_of(svc), "10.0.0.5").token
    clock.now = datetime(2026, 10, 22, 2, 30, tzinfo=LONDON).timestamp()
    seen(svc)
    assert state_of(svc, token)["state"] == "closed"
    hours.late_until = datetime(2026, 10, 22, 3, 0, tzinfo=LONDON).astimezone(UTC)
    assert state_of(svc, token)["state"] == "open"


def test_each_zone_has_its_own_code(make):
    svc = make()
    assert code_of(svc, BAR) != code_of(svc, TERRACE)
    assert svc.join(code_of(svc, TERRACE), "10.0.0.6").room_id != svc.join(
        code_of(svc, BAR), "10.0.0.7").room_id


def test_personal_party_rooms_are_untouched(make):
    svc = make()
    code_of(svc)
    # The personal table keeps its one-live-room-per-workspace index and isn't written to.
    names = {index.name for index in personal_rooms.indexes}
    assert "uq_rooms_one_live_per_workspace" in names
    assert not sa.inspect(svc.engine).has_table("rooms")


def test_default_hours_without_any_hours_set_is_open(engine):
    from test_business_rooms_support import directory

    adapter = ports.DefaultZoneHours(directory())
    now = datetime(2026, 10, 20, 4, 0, tzinfo=UTC)
    with transaction(engine) as conn:
        assert adapter.is_open(conn, BAR, now) is True
        assert adapter.next_open(conn, BAR, now) is None
