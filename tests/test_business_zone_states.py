"""The zone day with fake instants: closed, warming, opening, open, closing (BZ-0444-05)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from selecta.business import hours as h
from selecta.business.hours import Hours, Period

LONDON = ZoneInfo("Europe/London")
DAY = date(2027, 1, 6)  # January: London is on UTC, so the arithmetic below reads plainly


def at(hh: int, mi: int = 0, s: int = 0, day: date = DAY) -> datetime:
    return datetime(day.year, day.month, day.day, hh, mi, s, tzinfo=LONDON).astimezone(UTC)


def nxt(hh: int, mi: int = 0, s: int = 0) -> datetime:
    return at(hh, mi, s, DAY + timedelta(days=1))


def venue(opens: str = "10:00", closes: str = "23:00") -> Hours:
    return Hours("Europe/London", tuple(Period(wd, opens, closes) for wd in range(7)))


def split(second: tuple[str, str]) -> Hours:
    shifts = (("10:00", "15:00"), second)
    return Hours("Europe/London", tuple(Period(wd, o, c) for wd in range(7) for o, c in shifts))


def intervals(hours: Hours | None = None, overrides=()):
    hours = hours or venue()
    start = at(0) - timedelta(days=1)
    return h.periods_between(hours, start, start + timedelta(days=4), overrides)


def test_every_state_in_the_table_natural_closing():
    ivs = intervals()
    s = h.state_at(ivs, at(8))
    assert (s.state, s.next_change, s.next_state) == ("closed", at(9, 15), "warming")
    assert s.interval is None
    assert s.since == at(23, 4, 20, DAY - timedelta(days=1))

    s = h.state_at(ivs, at(9, 30))
    assert (s.state, s.since, s.next_change) == ("warming", at(9, 15), at(10))
    assert s.next_state == "opening"
    assert s.interval is not None and s.interval.start == at(10)

    s = h.state_at(ivs, at(10, 0, 5))
    assert (s.state, s.since, s.next_change) == ("opening", at(10), at(10, 0, 10))
    assert s.next_state == "open"

    s = h.state_at(ivs, at(12))
    assert (s.state, s.since, s.next_change) == ("open", at(10, 0, 10), at(23))
    assert s.next_state == "closing"

    s = h.state_at(ivs, at(23, 2))
    assert (s.state, s.since, s.next_change, s.next_state) == (
        "closing",
        at(23),
        at(23, 4, 20),
        "closed",
    )

    s = h.state_at(ivs, at(23, 5))
    assert (s.state, s.since, s.next_change, s.next_state) == (
        "closed",
        at(23, 4, 20),
        nxt(9, 15),
        "warming",
    )


def test_closing_at_the_time_exactly_fades_over_the_last_20_seconds():
    ivs = intervals()
    s = h.state_at(ivs, at(22, 59, 30), closing_mode="exact")
    assert (s.state, s.next_change, s.next_state) == ("open", at(22, 59, 40), "closing")
    s = h.state_at(ivs, at(22, 59, 50), closing_mode="exact")
    assert (s.state, s.since, s.next_change, s.next_state) == (
        "closing",
        at(22, 59, 40),
        at(23),
        "closed",
    )
    assert h.state_at(ivs, at(23, 0, 1), closing_mode="exact").state == "closed"
    assert h.state_at(ivs, at(23, 0, 1), closing_mode="natural").state == "closing"


def test_late_start_joins_the_horizon_where_the_schedule_says():
    ivs = intervals()
    s = h.state_at(ivs, at(11, 20))
    assert s.state == "open"
    assert h.playback_offset(s.interval, at(11, 20)) == 80 * 60
    assert h.playback_offset(s.interval, at(9, 50)) == 0.0


@pytest.mark.parametrize("mode", ["natural", "exact"])
def test_stay_open_late_during_the_closing_fade_reverses_it(mode: str):
    ivs = intervals()
    pressed = at(23, 1) if mode == "natural" else at(22, 59, 50)
    assert h.state_at(ivs, pressed, closing_mode=mode).state == "closing"
    late = h.stay_open_late(ivs, pressed, until=nxt(0), role="staff", by="Jo")
    after = intervals(overrides=[late])
    s = h.state_at(after, pressed + timedelta(seconds=1), closing_mode=mode)
    assert s.state == "open"
    assert s.interval.late_until == nxt(0)
    expected_close = nxt(0) if mode == "natural" else nxt(0) - timedelta(seconds=20)
    assert s.next_change == expected_close
    assert h.STAY_LATE_REVERSE_FADE_S == 10


def test_stay_open_late_at_2358_for_a_midnight_close_cancels_the_fade_before_it_starts():
    hours = venue("10:00", "00:00")
    ivs = intervals(hours)
    late = h.stay_open_late(ivs, at(23, 58), until=nxt(0, 30), role="staff", by="Jo")
    after = intervals(hours, [late])
    for mode in ("natural", "exact"):
        assert h.state_at(after, at(23, 59, 50), closing_mode=mode).state == "open"
        assert h.state_at(after, nxt(0, 10), closing_mode=mode).state == "open"


def test_stay_open_late_after_the_closing_has_finished_is_refused():
    ivs = intervals()
    with pytest.raises(h.HoursError, match="closed"):
        h.stay_open_late(ivs, at(23, 5), until=nxt(0), role="owner", by="O")


def test_close_now_fades_over_60_seconds_and_undo_brings_the_music_back():
    ivs = intervals()
    pressed = at(15)
    stop = h.close_now(ivs, pressed, by="Sam")
    after = intervals(overrides=[stop])
    s = h.state_at(after, pressed + timedelta(seconds=30))
    assert (s.state, s.since, s.next_change, s.next_state) == (
        "closing",
        pressed,
        pressed + timedelta(seconds=60),
        "closed",
    )
    s = h.state_at(after, pressed + timedelta(seconds=90))
    assert (s.state, s.next_change, s.next_state) == ("closed", nxt(9, 15), "warming")
    undone = h.undo_close_now(stop, pressed + timedelta(minutes=2))
    assert h.state_at(intervals(overrides=[undone]), pressed + timedelta(minutes=2)).state == "open"


def test_split_shift_warms_after_the_first_period_has_closed():
    hours = split(("15:30", "23:00"))
    ivs = intervals(hours)
    s = h.state_at(ivs, at(15, 10))
    assert (s.state, s.since, s.next_change) == ("warming", at(15, 4, 20), at(15, 30))
    assert h.state_at(ivs, at(15, 2)).state == "closing"


def test_back_to_back_periods_hand_over_without_closing():
    hours = split(("15:00", "23:00"))
    ivs = intervals(hours)
    s = h.state_at(ivs, at(14, 59, 59))
    assert (s.state, s.next_change, s.next_state) == ("open", at(15), "opening")


def test_open_24_hours_has_no_warming_and_no_closing():
    hours = Hours("Europe/London", tuple(Period(wd, "00:00", "00:00", True) for wd in range(5)))
    monday = date(2027, 1, 4)
    start = at(0, day=monday) - timedelta(days=2)
    ivs = h.periods_between(hours, start, start + timedelta(days=9))
    s = h.state_at(ivs, at(23, 50, day=monday - timedelta(days=1)))
    assert (s.state, s.next_change, s.next_state) == ("closed", at(0, day=monday), "opening")
    s = h.state_at(ivs, at(12, day=date(2027, 1, 8)))
    assert (s.state, s.next_change, s.next_state) == ("open", at(0, day=date(2027, 1, 9)), "closed")


def test_next_change_uses_the_zone_and_the_venue_overrides():
    v = venue()
    terrace = venue("12:00", "20:00")
    s = h.next_change(v, terrace, at(11))
    assert (s.state, s.next_change, s.next_state) == ("closed", at(11, 15), "warming")
    s = h.next_change(v, terrace, at(11, 30))
    assert (s.state, s.since, s.next_change, s.next_state) == (
        "warming",
        at(11, 15),
        at(12),
        "opening",
    )
    s = h.next_change(v, None, at(11))
    assert (s.state, s.next_change, s.next_state) == ("open", at(23), "closing")
    s = h.next_change(v, None, at(22, 59, 45), closing_mode="exact")
    assert (s.state, s.next_change) == ("closing", at(23))
    late = h.Override("stay_open_late", DAY, at(22), nxt(1), "Sam")
    s = h.next_change(v, None, at(23, 30), [late])
    assert (s.state, s.next_change, s.next_state) == ("open", nxt(1), "closing")
    s = h.next_change(v, None, at(23, 30))
    assert (s.state, s.next_change, s.next_state) == ("closed", nxt(9, 15), "warming")
