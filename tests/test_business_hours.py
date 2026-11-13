"""Venue opening hours, DST, exceptions and overrides (ADR-0444, BZ-0444-01 to 04)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from selecta.business import hours as h
from selecta.business.hours import DateException, Hours, HoursError, Period

LONDON = ZoneInfo("Europe/London")


def at(y: int, mo: int, d: int, hh: int, mi: int = 0, s: int = 0, tz=LONDON) -> datetime:
    """A wall-clock time (fold=0) as a UTC instant."""
    return datetime(y, mo, d, hh, mi, s, tzinfo=tz).astimezone(UTC)


def every_day(opens: str, closes: str, *, all_day: bool = False) -> tuple[Period, ...]:
    return tuple(Period(wd, opens, closes, all_day) for wd in range(7))


def london(weekly, exceptions=()) -> Hours:
    return Hours(tz="Europe/London", weekly=tuple(weekly), exceptions=tuple(exceptions))


def window(hours: Hours, first: date, days: int = 1, overrides=()):
    start = datetime(first.year, first.month, first.day, tzinfo=ZoneInfo(hours.tz))
    return h.periods_between(hours, start, start + timedelta(days=days), overrides)


# --- BZ-0444-01: the weekly model ---------------------------------------------------------------


def test_overlapping_periods_are_refused():
    periods = [Period(4, "14:00", "23:00"), Period(4, "10:00", "15:00")]
    with pytest.raises(HoursError) as err:
        h.validate_weekly(periods)
    assert str(err.value) == (
        "Friday has two periods that overlap: 10:00 to 15:00 and 14:00 to 23:00"
    )


def test_overnight_period_overlapping_the_next_days_period_is_refused():
    with pytest.raises(HoursError, match="Friday's period 18:00 to 02:00 runs into Saturday"):
        h.validate_weekly([Period(5, "01:00", "10:00"), Period(4, "18:00", "02:00")])
    with pytest.raises(HoursError, match="Sunday's period 20:00 to 03:00 runs into Monday"):
        h.validate_weekly([Period(0, "02:00", "12:00"), Period(6, "20:00", "03:00")])


def test_touching_periods_and_split_shifts_are_allowed():
    h.validate_weekly(
        [Period(4, "10:00", "15:00"), Period(4, "15:00", "23:00"), Period(5, "02:00", "09:00")]
    )
    h.validate_weekly([Period(4, "18:00", "02:00"), Period(5, "02:00", "10:00")])


def test_unreadable_times_and_weekdays_are_refused():
    with pytest.raises(HoursError, match="'25:00' is not a time"):
        h.validate_weekly([Period(0, "25:00", "23:00")])
    with pytest.raises(HoursError, match="'ten' is not a time"):
        h.validate_weekly([Period(0, "ten", "23:00")])
    with pytest.raises(HoursError, match="not a weekday"):
        h.validate_weekly([Period(7, "10:00", "23:00")])
    with pytest.raises(HoursError, match="not a time zone"):
        h.periods_between(Hours("Mars/Base", ()), at(2027, 1, 1, 0), at(2027, 1, 2, 0))


def test_overnight_friday_owns_saturday_0130():
    hours = london([Period(4, "18:00", "02:00"), Period(5, "10:00", "23:00")])
    ivs = window(hours, date(2027, 1, 9))  # Saturday
    assert date(2027, 1, 8).weekday() == 4
    owner = [iv for iv in ivs if iv.start <= at(2027, 1, 9, 1, 30) < iv.end]
    assert len(owner) == 1
    assert owner[0].opening_date == date(2027, 1, 8)
    assert owner[0].start == at(2027, 1, 8, 18)
    assert owner[0].end == at(2027, 1, 9, 2)
    saturday = [iv for iv in ivs if iv.opening_date == date(2027, 1, 9)]
    assert [(iv.start, iv.end) for iv in saturday] == [(at(2027, 1, 9, 10), at(2027, 1, 9, 23))]


def test_closing_at_or_before_opening_means_the_next_day():
    hours = london([Period(2, "10:00", "10:00")])
    (iv,) = window(hours, date(2027, 1, 6))
    assert iv.end - iv.start == timedelta(hours=24)
    (iv,) = window(london([Period(2, "18:00", "24:00")]), date(2027, 1, 6))
    assert iv.end == at(2027, 1, 7, 0)


def test_open_24_hours_merges_into_one_run_with_no_close():
    hours = london(every_day("00:00", "00:00", all_day=True))
    ivs = window(hours, date(2027, 1, 6), days=3)
    assert len(ivs) == 1
    assert ivs[0].all_day and ivs[0].end is None and ivs[0].scheduled_end is None
    state = h.state_at(ivs, at(2027, 1, 7, 3))
    assert state.state == "open" and state.next_change is None


def test_open_24_hours_on_weekdays_ends_at_the_weekend_without_warming():
    hours = london([Period(wd, "00:00", "00:00", all_day=True) for wd in range(5)])
    ivs = window(hours, date(2027, 1, 4), days=7)  # Monday 4 January
    assert [(iv.start, iv.end) for iv in ivs] == [(at(2027, 1, 4, 0), at(2027, 1, 9, 0))]
    assert h.state_at(ivs, at(2027, 1, 3, 23, 30)).state == "closed"
    assert h.state_at(ivs, at(2027, 1, 9, 0, 0, 1)).state == "closed"


def test_zone_narrower_hours_are_the_intersection_with_the_venue():
    venue = london(every_day("10:00", "23:00"))
    terrace = london(every_day("12:00", "20:00"))
    wide = london(every_day("08:00", "01:00"))
    start, end = at(2027, 1, 6, 0), at(2027, 1, 7, 0)
    (iv,) = h.zone_periods_between(venue, terrace, start, end)
    assert (iv.start, iv.end) == (at(2027, 1, 6, 12), at(2027, 1, 6, 20))
    ivs = h.zone_periods_between(venue, wide, start, end)
    assert [(iv.start, iv.end) for iv in ivs] == [(at(2027, 1, 6, 10), at(2027, 1, 6, 23))]
    assert h.zone_periods_between(venue, None, start, end) == h.periods_between(venue, start, end)


def test_stay_open_late_on_the_venue_extends_zones_that_close_with_it():
    venue = london(every_day("10:00", "23:00"))
    late = h.Override(
        "stay_open_late", date(2027, 1, 6), at(2027, 1, 6, 22), at(2027, 1, 7, 0), "Sam"
    )
    start, end = at(2027, 1, 6, 0), at(2027, 1, 7, 0)
    bar = london(every_day("17:00", "23:00"))
    terrace = london(every_day("12:00", "20:00"))
    (iv,) = h.zone_periods_between(venue, bar, start, end, [late])
    assert iv.end == at(2027, 1, 7, 0) and iv.late_until == at(2027, 1, 7, 0)
    assert iv.scheduled_end == at(2027, 1, 6, 23)
    (iv,) = h.zone_periods_between(venue, terrace, start, end, [late])
    assert iv.end == at(2027, 1, 6, 20) and iv.late_until is None


def test_london_and_lisbon_both_open_at_local_ten():
    lisbon_tz = ZoneInfo("Europe/Lisbon")
    ldn = london(every_day("10:00", "22:00"))
    lis = Hours("Europe/Lisbon", every_day("10:00", "22:00"))
    nyc = Hours("America/New_York", every_day("10:00", "22:00"))
    for day in (date(2027, 1, 6), date(2027, 7, 7)):
        (a,) = window(ldn, day)
        (b,) = window(lis, day)
        (c,) = window(nyc, day)
        assert a.start.astimezone(LONDON).strftime("%H:%M") == "10:00"
        assert b.start.astimezone(lisbon_tz).strftime("%H:%M") == "10:00"
        assert c.start.astimezone(ZoneInfo("America/New_York")).strftime("%H:%M") == "10:00"
        assert a.start == b.start  # the two cities share an offset all year
        assert c.start - a.start == timedelta(hours=5)


# --- BZ-0444-03: exceptions ---------------------------------------------------------------------


def test_holiday_closure_overrides_the_weekly_hours():
    weekly = every_day("10:00", "22:00")
    christmas = date(2026, 12, 25)
    suggestions = h.suggest_holidays("GB", 2026)
    assert any(s.date == christmas and s.closed for s in suggestions)
    # Suggestions are never applied on their own.
    assert len(window(london(weekly), christmas)) == 1
    accepted = [s for s in suggestions if s.date == christmas]
    assert window(london(weekly, accepted), christmas) == []
    assert len(window(london(weekly, accepted), date(2026, 12, 24))) == 1


def test_holiday_suggestions_cover_four_countries_and_unknown_is_empty():
    for country in ("GB", "PT", "US", "AU", "uk"):
        found = h.suggest_holidays(country, 2027)
        assert found and all(s.closed and s.date.year == 2027 and s.note for s in found)
    assert date(2027, 4, 25) in {s.date for s in h.suggest_holidays("PT", 2027)}
    assert h.suggest_holidays("ZZ", 2027) == []


def test_replacement_periods_repeat_yearly_and_a_pause_range():
    weekly = every_day("10:00", "22:00")
    special = DateException(date(2020, 12, 31), False, (("18:00", "03:00"),), repeat_yearly=True)
    pause = DateException(date(2027, 2, 20), True, until=date(2027, 3, 3), note="Refurbishment")
    hours = london(weekly, [special, pause])
    (iv,) = window(hours, date(2026, 12, 31))
    assert (iv.start, iv.end) == (at(2026, 12, 31, 18), at(2027, 1, 1, 3))
    assert window(hours, date(2027, 2, 19))
    assert all(window(hours, date(2027, 2, 20) + timedelta(days=n)) == [] for n in range(12))
    assert window(hours, date(2027, 3, 4))
    bad = DateException(date(2027, 1, 6), False, (("10:00", "15:00"), ("14:00", "23:00")))
    with pytest.raises(HoursError, match="overlap"):
        window(london(weekly, [bad]), date(2027, 1, 6))


def test_christmas_eve_past_midnight_with_25_december_closed():
    weekly = every_day("18:00", "23:00")
    eve = DateException(date(2026, 12, 24), False, (("18:00", "01:00"),))
    closed = DateException(date(2026, 12, 25), True)
    hours = london(weekly, [eve, closed])
    ivs = window(hours, date(2026, 12, 24), days=3)
    assert [(iv.opening_date, iv.start, iv.end) for iv in ivs] == [
        (date(2026, 12, 24), at(2026, 12, 24, 18), at(2026, 12, 25, 1)),
        (date(2026, 12, 26), at(2026, 12, 26, 18), at(2026, 12, 26, 23)),
    ]
    assert h.state_at(ivs, at(2026, 12, 25, 0, 30)).state == "open"


# --- BZ-0444-02: DST ----------------------------------------------------------------------------


def test_spring_forward_inside_opening_hours_keeps_the_right_close():
    # UK clocks go 01:00 GMT -> 02:00 BST on Sunday 29 March 2026.
    night = date(2026, 3, 28)
    (iv,) = window(london([Period(5, "20:00", "02:00")]), night)
    assert iv.start == datetime(2026, 3, 28, 20, tzinfo=UTC)
    assert iv.end == datetime(2026, 3, 29, 1, tzinfo=UTC)  # 02:00 BST
    assert iv.end - iv.start == timedelta(hours=5)
    (iv,) = window(london([Period(5, "20:00", "01:30")]), night)
    assert iv.end == datetime(2026, 3, 29, 1, tzinfo=UTC)  # 01:30 is missing: 02:00 BST
    assert iv.end.astimezone(LONDON).strftime("%H:%M") == "02:00"
    (iv,) = window(london([Period(6, "01:30", "05:00")]), date(2026, 3, 29))
    assert iv.start.astimezone(LONDON).strftime("%H:%M %Z") == "02:00 BST"


def test_fall_back_repeated_hour_does_not_close_twice():
    # UK clocks go 02:00 BST -> 01:00 GMT on Sunday 25 October 2026; 01:30 happens twice.
    hours = london([Period(5, "20:00", "01:30"), Period(6, "18:00", "23:00")])
    ivs = window(hours, date(2026, 10, 24), days=2)
    first = ivs[0]
    assert first.end == datetime(2026, 10, 25, 0, 30, tzinfo=UTC)  # 01:30 BST
    second_0130 = datetime(2026, 10, 25, 1, 30, tzinfo=UTC)  # 01:30 GMT
    assert not any(iv.start <= second_0130 < (iv.end or second_0130) for iv in ivs)
    assert h.state_at(ivs, second_0130).state == "closed"
    instants = [first.start + timedelta(minutes=m) for m in range(0, 20 * 60)]
    states = [h.state_at(ivs, t).state for t in instants]
    pairs = list(zip(instants[1:], states[:-1], states[1:], strict=True))
    starts = [t for t, a, b in pairs if a != "closing" and b == "closing"]
    assert starts == [first.end]  # the Saturday night closes once, at the first 01:30


def _transitions(tz: ZoneInfo, year: int):
    found = []
    t = datetime(year, 1, 1, tzinfo=UTC)
    prev = t.astimezone(tz).utcoffset()
    while t.year == year:
        t2 = t + timedelta(hours=1)
        off = t2.astimezone(tz).utcoffset()
        if off != prev:
            found.append((t2, prev, off))
        prev, t = off, t2
    return found


def _hhmm(value: datetime) -> str:
    return value.strftime("%H:%M")


@pytest.mark.parametrize("year", [2026, 2027])
@pytest.mark.parametrize(
    "tz_name", ["Europe/London", "Europe/Lisbon", "America/New_York", "Australia/Sydney"]
)
def test_dst_transitions_match_zoneinfo(tz_name: str, year: int):
    tz = ZoneInfo(tz_name)
    transitions = _transitions(tz, year)
    assert len(transitions) == 2
    for instant, old, new in transitions:
        old_local = (instant + old).replace(tzinfo=None)
        new_local = (instant + new).replace(tzinfo=None)
        if new > old:  # spring forward: [old_local, new_local) is missing
            mid = old_local + (new - old) / 2
            expected = instant
        else:  # fall back: [new_local, old_local) is repeated; the first occurrence wins
            mid = new_local + (old - new) / 2
            expected = mid.replace(tzinfo=tz, fold=0).astimezone(UTC)
            assert expected == (mid - old).replace(tzinfo=UTC)
        day = mid.date()
        before = day - timedelta(days=1)
        start = datetime(before.year, before.month, before.day, tzinfo=tz)
        end = start + timedelta(days=3)

        opening = Hours(tz_name, (), (DateException(day, False, ((_hhmm(mid), "23:30"),)),))
        (iv,) = h.periods_between(opening, start, end)
        assert iv.start == expected

        closing = Hours(tz_name, (), (DateException(before, False, (("20:00", _hhmm(mid)),)),))
        (iv,) = h.periods_between(closing, start, end)
        assert iv.start == datetime(before.year, before.month, before.day, 20, tzinfo=tz)
        assert iv.end == expected
        if new < old:
            second = mid.replace(tzinfo=tz, fold=1).astimezone(UTC)
            assert second > iv.end
            assert h.state_at([iv], second).state == "closed"

        night = Hours(tz_name, (), (DateException(before, False, (("20:00", "06:00"),)),))
        (iv,) = h.periods_between(night, start, end)
        assert iv.end - iv.start == timedelta(hours=10) - (new - old)


# --- BZ-0444-04: stay open late and close now ---------------------------------------------------


def _week_hours() -> Hours:
    return london(every_day("10:00", "23:00"))


def test_stay_open_late_extends_only_tonight():
    hours = _week_hours()
    ivs = window(hours, date(2027, 1, 6), days=3)
    pressed = at(2027, 1, 6, 22, 30)
    late = h.stay_open_late(ivs, pressed, until=at(2027, 1, 7, 1), role="venue_manager", by="Sam")
    assert late.kind == "stay_open_late" and late.opening_date == date(2027, 1, 6)
    assert late.created_by == "Sam" and late.ends_at == at(2027, 1, 7, 1)
    after = window(hours, date(2027, 1, 6), days=3, overrides=[late])
    assert after[0].end == at(2027, 1, 7, 1) and after[0].late_until == at(2027, 1, 7, 1)
    assert after[0].scheduled_end == at(2027, 1, 6, 23)
    assert after[1:] == ivs[1:]
    assert h.state_at(after, at(2027, 1, 7, 0, 30)).state == "open"
    assert h.state_at(after, at(2027, 1, 7, 0, 30)).next_change == at(2027, 1, 7, 1)


def test_stay_open_late_beyond_the_staff_allowance_is_refused():
    ivs = window(_week_hours(), date(2027, 1, 6))
    pressed = at(2027, 1, 6, 22, 30)
    with pytest.raises(HoursError) as err:
        h.stay_open_late(ivs, pressed, until=at(2027, 1, 7, 0, 30), role="staff", by="Jo")
    assert "staff allowance of 1 hour" in str(err.value)
    assert "1 hour 30 minutes past the scheduled close" in str(err.value)
    ok = h.stay_open_late(ivs, pressed, until=at(2027, 1, 7, 0), role="staff", by="Jo")
    assert ok.ends_at == at(2027, 1, 7, 0)
    ok = h.stay_open_late(ivs, pressed, until=at(2027, 1, 7, 2), role="venue_manager", by="Sam")
    assert ok.ends_at == at(2027, 1, 7, 2)
    with pytest.raises(HoursError, match="venue manager allowance of 3 hours"):
        h.stay_open_late(ivs, pressed, until=at(2027, 1, 7, 2, 1), role="venue_manager", by="S")
    with pytest.raises(HoursError, match="allowance of 30 minutes"):
        h.stay_open_late(
            ivs, pressed, until=at(2027, 1, 7, 0), role="staff", by="Jo", allowance_min=30
        )
    with pytest.raises(HoursError, match="viewer role cannot"):
        h.stay_open_late(ivs, pressed, until=at(2027, 1, 7, 0), role="viewer", by="V")


def test_stay_open_late_is_refused_when_closed_or_before_the_close():
    ivs = window(_week_hours(), date(2027, 1, 6))
    with pytest.raises(HoursError, match="closed"):
        h.stay_open_late(ivs, at(2027, 1, 6, 8), until=at(2027, 1, 6, 9), role="owner", by="O")
    with pytest.raises(HoursError, match="past the scheduled close"):
        h.stay_open_late(ivs, at(2027, 1, 6, 20), until=at(2027, 1, 6, 22), role="owner", by="O")
    all_day = window(london(every_day("00:00", "00:00", all_day=True)), date(2027, 1, 6))
    with pytest.raises(HoursError, match="open 24 hours"):
        h.stay_open_late(
            all_day, at(2027, 1, 6, 20), until=at(2027, 1, 7, 2), role="owner", by="O"
        )


def test_close_now_and_undo_within_five_minutes():
    hours = _week_hours()
    ivs = window(hours, date(2027, 1, 6), days=2)
    pressed = at(2027, 1, 6, 15)
    stop = h.close_now(ivs, pressed, by="Sam")
    assert stop.kind == "close_now" and stop.opening_date == date(2027, 1, 6)
    after = window(hours, date(2027, 1, 6), days=2, overrides=[stop])
    assert after[0].end == pressed and after[0].closed_early_at == pressed
    assert after[1] == ivs[1]  # music starts again at the next period
    undone = h.undo_close_now(stop, pressed + timedelta(minutes=4))
    assert undone.undone_at == pressed + timedelta(minutes=4)
    assert window(hours, date(2027, 1, 6), days=2, overrides=[undone]) == ivs
    with pytest.raises(HoursError, match="within 5 minutes; it was pressed 6 minutes ago"):
        h.undo_close_now(stop, pressed + timedelta(minutes=6))
    with pytest.raises(HoursError, match="already been undone"):
        h.undo_close_now(undone, pressed + timedelta(minutes=5))
    with pytest.raises(HoursError, match="already closed"):
        h.close_now(ivs, at(2027, 1, 6, 8), by="Sam")


def test_close_now_on_an_open_24_hours_run_resumes_the_next_day():
    hours = london(every_day("00:00", "00:00", all_day=True))
    ivs = window(hours, date(2027, 1, 6), days=3)
    stop = h.close_now(ivs, at(2027, 1, 6, 15), by="Sam")
    after = window(hours, date(2027, 1, 6), days=3, overrides=[stop])
    assert after[0].end == at(2027, 1, 6, 15)
    assert after[1].start == at(2027, 1, 7, 0) and after[1].end is None


def test_naive_instants_are_refused():
    with pytest.raises(HoursError, match="time zone"):
        h.periods_between(_week_hours(), datetime(2027, 1, 6), datetime(2027, 1, 7))
