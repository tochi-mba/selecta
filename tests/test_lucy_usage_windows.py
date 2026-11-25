"""The arithmetic of Lucy's session window and weekly limit (ADR-0482, ADR-0484 rules 5 and 11).

Pure functions only: no database, no clock, no sleeping. Every instant is given.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

import pytest
from hypothesis import given
from hypothesis import strategies as st

from selecta.ai import usage_windows as uw
from selecta.ai.usage_windows import Anchor

HOUR = 3600
DAY = 24 * HOUR
WEEK = 7 * DAY

MON, TUE, WED, THU, FRI, SAT, SUN = range(7)

ZONES = (
    "UTC",
    "Europe/London",
    "America/Los_Angeles",
    "Pacific/Auckland",
    "Pacific/Kiritimati",
    "Etc/GMT+12",
    "Australia/Lord_Howe",
    "Asia/Kolkata",
)
ODD_NAMES = (None, "", "Not/AZone", "Europe", "x" * 300, "../../etc/passwd", "Europe/London\x00")


def utc(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> float:
    return dt.datetime(year, month, day, hour, minute, tzinfo=dt.UTC).timestamp()


def local(instant: float, zone: str) -> dt.datetime:
    return dt.datetime.fromtimestamp(instant, ZoneInfo(zone))


# ---- constants


def test_a_session_is_five_hours_and_a_unit_is_a_millionth_of_a_dollar():
    assert uw.SESSION_SECONDS == 18_000
    assert uw.UNITS_PER_USD == 1_000_000
    assert uw.NEAR_AT == 0.8


# ---- zone


@pytest.mark.parametrize("name", ZONES)
def test_a_known_zone_name_gives_that_zone(name):
    assert uw.zone(name) == ZoneInfo(name)


@pytest.mark.parametrize("name", ODD_NAMES)
def test_a_missing_or_unusable_zone_name_gives_utc(name):
    assert uw.zone(name) is dt.UTC


# ---- anchor_for


@pytest.mark.parametrize(
    ("created_at", "zone", "expected"),
    [
        # Wednesday 25 November 2026, 14:30 UTC.
        (utc(2026, 11, 25, 14, 30), "UTC", Anchor("UTC", WED, 14)),
        (utc(2026, 11, 25, 14, 30), "Europe/London", Anchor("Europe/London", WED, 14)),
        (utc(2026, 11, 25, 14, 30), "America/Los_Angeles", Anchor("America/Los_Angeles", WED, 6)),
        (utc(2026, 11, 25, 14, 30), "Pacific/Auckland", Anchor("Pacific/Auckland", THU, 3)),
        (utc(2026, 11, 25, 14, 30), "Pacific/Kiritimati", Anchor("Pacific/Kiritimati", THU, 4)),
        (utc(2026, 11, 25, 14, 30), "Etc/GMT+12", Anchor("Etc/GMT+12", WED, 2)),
        (utc(2026, 11, 25, 14, 30), "Australia/Lord_Howe", Anchor("Australia/Lord_Howe", THU, 1)),
        # Kolkata is half an hour off the hour: 14:30 UTC is 20:00 there, 14:29 is 19:59.
        (utc(2026, 11, 25, 14, 30), "Asia/Kolkata", Anchor("Asia/Kolkata", WED, 20)),
        (utc(2026, 11, 25, 14, 29), "Asia/Kolkata", Anchor("Asia/Kolkata", WED, 19)),
        # British Summer Time: 23:30 UTC on Saturday is 00:30 on Sunday in London.
        (utc(2026, 7, 4, 23, 30), "Europe/London", Anchor("Europe/London", SUN, 0)),
    ],
)
def test_the_anchor_is_the_weekday_and_local_hour_of_creation(created_at, zone, expected):
    assert uw.anchor_for(created_at, zone) == expected


@pytest.mark.parametrize("name", ODD_NAMES)
def test_an_unusable_zone_is_anchored_in_utc_and_stored_as_utc(name):
    assert uw.anchor_for(utc(2026, 11, 25, 14, 30), name) == Anchor("UTC", WED, 14)


# ---- week_bounds


@pytest.mark.parametrize(
    ("anchor", "now", "start", "end"),
    [
        # Plain weeks.
        (
            Anchor("UTC", THU, 9),
            utc(2026, 11, 25, 12),
            utc(2026, 11, 19, 9),
            utc(2026, 11, 26, 9),
        ),
        (
            Anchor("Asia/Kolkata", MON, 0),
            utc(2026, 11, 25, 12),
            utc(2026, 11, 22, 18, 30),
            utc(2026, 11, 29, 18, 30),
        ),
        (
            Anchor("Pacific/Kiritimati", MON, 0),
            utc(2026, 11, 25, 12),
            utc(2026, 11, 22, 10),
            utc(2026, 11, 29, 10),
        ),
        (
            Anchor("Etc/GMT+12", SUN, 23),
            utc(2026, 11, 25, 12),
            utc(2026, 11, 23, 11),
            utc(2026, 11, 30, 11),
        ),
        # The reset instant itself belongs to the new week; the second before it to the old one.
        (
            Anchor("UTC", THU, 9),
            utc(2026, 11, 26, 9),
            utc(2026, 11, 26, 9),
            utc(2026, 12, 3, 9),
        ),
        (
            Anchor("UTC", THU, 9),
            utc(2026, 11, 26, 9) - 1,
            utc(2026, 11, 19, 9),
            utc(2026, 11, 26, 9),
        ),
    ],
)
def test_a_week_runs_from_one_anchor_time_to_the_next(anchor, now, start, end):
    assert uw.week_bounds(anchor, now) == (start, end)


@pytest.mark.parametrize(
    ("change", "before", "after"),
    [
        # (the Sunday the clocks go forward, the Sunday before, the Sunday after), all in UTC.
        (utc(2026, 3, 29, 1), utc(2026, 3, 22, 1), utc(2026, 4, 5, 0)),
        (utc(2027, 3, 28, 1), utc(2027, 3, 21, 1), utc(2027, 4, 4, 0)),
    ],
)
def test_a_reset_inside_the_uk_spring_gap_happens_at_the_first_instant_after_it(
    change, before, after
):
    # Sunday 01:00 does not exist in London on the day the clocks go forward.
    anchor = Anchor("Europe/London", SUN, 1)
    assert uw.week_bounds(anchor, change - 1) == (before, change)
    assert uw.week_bounds(anchor, change) == (change, after)
    assert (local(change, "Europe/London").hour, local(change, "Europe/London").minute) == (2, 0)
    assert change - before == WEEK
    assert after - change == WEEK - HOUR


@pytest.mark.parametrize(
    ("first", "before", "after"),
    [
        # (the first 01:00 on the Sunday the clocks go back, the Sunday before, the Sunday after).
        (utc(2026, 10, 25, 0), utc(2026, 10, 18, 0), utc(2026, 11, 1, 1)),
        (utc(2027, 10, 31, 0), utc(2027, 10, 24, 0), utc(2027, 11, 7, 1)),
    ],
)
def test_a_reset_inside_the_uk_autumn_repeated_hour_happens_at_its_first_occurrence(
    first, before, after
):
    anchor = Anchor("Europe/London", SUN, 1)
    assert uw.week_bounds(anchor, first - 1) == (before, first)
    assert uw.week_bounds(anchor, first) == (first, after)
    # The second 01:00, an hour later, is inside the same week: it does not reset again.
    assert uw.week_bounds(anchor, first + HOUR) == (first, after)
    assert local(first, "Europe/London").hour == local(first + HOUR, "Europe/London").hour == 1
    assert first - before == WEEK
    assert after - first == WEEK + HOUR


@pytest.mark.parametrize(
    ("anchor", "reset", "reads"),
    [
        # Los Angeles: 02:00 on 8 March 2026 does not exist; 01:00 on 1 November happens twice.
        (Anchor("America/Los_Angeles", SUN, 2), utc(2026, 3, 8, 10), (3, 0)),
        (Anchor("America/Los_Angeles", SUN, 1), utc(2026, 11, 1, 8), (1, 0)),
        # Auckland: 02:00 on 27 September 2026 does not exist; 02:00 on 5 April happens twice.
        (Anchor("Pacific/Auckland", SUN, 2), utc(2026, 9, 26, 14), (3, 0)),
        (Anchor("Pacific/Auckland", SUN, 2), utc(2026, 4, 4, 13), (2, 0)),
        # Lord Howe moves by half an hour: 02:00 on 4 October 2026 does not exist, and the first
        # instant after the gap reads 02:30.
        (Anchor("Australia/Lord_Howe", SUN, 2), utc(2026, 10, 3, 15, 30), (2, 30)),
    ],
)
def test_clock_changes_in_other_zones_follow_the_same_two_rules(anchor, reset, reads):
    start, end = uw.week_bounds(anchor, reset)
    assert start == reset
    assert uw.week_bounds(anchor, reset - 1)[1] == reset
    at = local(reset, anchor.time_zone)
    assert (at.hour, at.minute) == reads
    assert WEEK - HOUR <= end - start <= WEEK + HOUR


def test_a_week_anchored_in_an_unusable_zone_is_reckoned_in_utc():
    now = utc(2026, 11, 25, 12)
    assert uw.week_bounds(Anchor("Not/AZone", THU, 9), now) == uw.week_bounds(
        Anchor("UTC", THU, 9), now
    )


anchors = st.builds(
    Anchor,
    time_zone=st.sampled_from(ZONES),
    weekday=st.integers(0, 6),
    hour=st.integers(0, 23),
)
instants = st.floats(
    min_value=utc(2025, 1, 1), max_value=utc(2030, 12, 31), allow_nan=False, allow_infinity=False
)


@given(anchor=anchors, now=instants)
def test_weeks_tile_time_with_one_reset_each_and_no_gap_or_overlap(anchor, now):
    start, end = uw.week_bounds(anchor, now)
    assert start <= now < end
    assert WEEK - HOUR <= end - start <= WEEK + HOUR
    assert uw.week_bounds(anchor, end)[0] == end
    assert uw.week_bounds(anchor, start)[0] == start
    assert uw.week_bounds(anchor, start - 1)[1] == start
    assert uw.week_bounds(anchor, end - 1) == (start, end)


@given(anchor=anchors, now=instants)
def test_a_reset_reads_the_anchor_time_on_the_local_clock_except_on_a_gap_day(anchor, now):
    _, end = uw.week_bounds(anchor, now)
    at = local(end, anchor.time_zone)
    if (at.weekday(), at.hour, at.minute, at.second) == (anchor.weekday, anchor.hour, 0, 0):
        # When that local time happens twice, the reset is its first occurrence.
        assert at.fold == 0
        return
    # Otherwise the anchor time did not exist that day: the reset is the instant the clocks went
    # forward, on the anchor's weekday, past the anchor's hour.
    just_before = local(end - 1, anchor.time_zone)
    assert at.utcoffset() > just_before.utcoffset()
    assert at.weekday() == anchor.weekday
    assert (just_before.hour, just_before.minute) < (anchor.hour, 0) < (at.hour, at.minute)


@given(created_at=instants, zone=st.sampled_from(ZONES + ODD_NAMES), later=st.floats(0, 3 * WEEK))
def test_a_workspace_week_always_resets_at_its_own_anchor(created_at, zone, later):
    anchor = uw.anchor_for(created_at, zone)
    assert 0 <= anchor.weekday <= 6
    assert 0 <= anchor.hour <= 23
    start, end = uw.week_bounds(anchor, created_at + later)
    assert start <= created_at + later < end


# ---- session_end


@pytest.mark.parametrize("opened_at", [0.0, utc(2026, 3, 29, 0, 30), utc(2026, 10, 25, 0, 30)])
def test_a_session_closes_exactly_five_hours_after_it_opens_whatever_the_clocks_do(opened_at):
    assert uw.session_end(opened_at) == opened_at + 5 * HOUR


# ---- to_units


@pytest.mark.parametrize(
    ("cost_usd", "units"),
    [
        (0, 0),
        (0.0, 0),
        (-0.0, 0),
        (-1.5, 0),
        (float("nan"), 0),
        (0.000001, 1),
        (0.0000001, 1),
        (0.0000011, 2),
        (0.01, 10_000),
        (0.02, 20_000),
        (0.07, 70_000),
        (0.15, 150_000),
        (0.29, 290_000),
        (0.60, 600_000),
        (0.1 + 0.2, 300_000),
        (1.1 * 3, 3_300_000),
        (0.0100004, 10_001),
        (1, 1_000_000),
        (6.60, 6_600_000),
    ],
)
def test_a_cost_becomes_units_rounded_up_and_float_noise_never_adds_one(cost_usd, units):
    assert uw.to_units(cost_usd) == units


costs = st.floats(min_value=-1.0, max_value=1_000.0, allow_nan=False, allow_infinity=False)


@given(cost=costs)
def test_units_are_whole_never_negative_and_never_below_the_true_cost(cost):
    units = uw.to_units(cost)
    assert isinstance(units, int)
    assert units >= 0
    assert units >= cost * uw.UNITS_PER_USD - 1e-9
    assert units <= max(cost, 0.0) * uw.UNITS_PER_USD + 1
    assert (units == 0) == (cost <= 0)


@given(a=costs, b=costs)
def test_a_dearer_turn_never_costs_fewer_units(a, b):
    low, high = sorted((a, b))
    assert uw.to_units(low) <= uw.to_units(high)


# ---- percent_left, state, segments_lit


@pytest.mark.parametrize(
    ("used", "limit", "percent", "state", "segments"),
    [
        (0, 1_000, 100, "ok", 5),
        (-5, 1_000, 100, "ok", 5),
        (1, 1_000, 99, "ok", 4),
        (1, 1_000_000, 99, "ok", 4),
        (100, 1_000, 90, "ok", 4),
        (199, 1_000, 80, "ok", 4),
        (200, 1_000, 80, "ok", 4),
        (201, 1_000, 79, "ok", 3),
        (500, 1_000, 50, "ok", 2),
        (799, 1_000, 20, "ok", 1),
        (800, 1_000, 20, "near", 1),
        (801, 1_000, 19, "near", 1),
        (995, 1_000, 1, "near", 1),
        (999, 1_000, 1, "near", 1),
        (999_999, 1_000_000, 1, "near", 1),
        (1_000, 1_000, 0, "spent", 0),
        (1_500, 1_000, 0, "spent", 0),
        # Small and awkward limits: 12 of 15 is exactly 80 percent.
        (11, 15, 26, "ok", 1),
        (12, 15, 20, "near", 1),
        (1, 3, 66, "ok", 3),
        (0, 1, 100, "ok", 5),
        (1, 1, 0, "spent", 0),
        # No allowance at all (a multiplier of 0) is spent, even with nothing used.
        (0, 0, 0, "spent", 0),
        (5, 0, 0, "spent", 0),
        (0, -1, 0, "spent", 0),
    ],
)
def test_the_meter_never_flatters(used, limit, percent, state, segments):
    assert uw.percent_left(used, limit) == percent
    assert uw.state(used, limit) == state
    assert uw.segments_lit(used, limit) == segments


@pytest.mark.parametrize(
    ("used", "segments", "lit"),
    [(0, 10, 10), (1, 10, 9), (50, 10, 5), (99, 10, 1), (100, 10, 0), (0, 1, 1), (50, 1, 1)],
)
def test_a_ladder_of_another_size_follows_the_same_rule(used, segments, lit):
    assert uw.segments_lit(used, 100, segments) == lit


usage = st.tuples(st.integers(-10, 3_000_000), st.integers(-10, 2_000_000))


@given(pair=usage, segments=st.integers(2, 12))
def test_percent_state_and_segments_always_agree(pair, segments):
    used, limit = pair
    percent = uw.percent_left(used, limit)
    state = uw.state(used, limit)
    lit = uw.segments_lit(used, limit, segments)
    assert state in ("ok", "near", "spent")
    assert (state == "spent") == (percent == 0) == (lit == 0)
    assert 0 <= percent <= 100
    assert 0 <= lit <= segments
    if used > 0:
        assert percent < 100, "never 100 percent left after any use"
        assert lit < segments, "never a full ladder after any use"
    elif limit > 0:
        assert (percent, lit, state) == (100, segments, "ok")
    if state != "spent":
        # Rounded down: the figure shown is never more than what is truly left.
        assert percent == 100 or percent * limit <= (limit - used) * 100 or percent == 1
        assert (state == "near") == (used * 10 >= limit * 8)


@given(limit=st.integers(1, 2_000_000), a=st.integers(0, 3_000_000), b=st.integers(0, 3_000_000))
def test_using_more_never_shows_more_left(limit, a, b):
    less, more = sorted((a, b))
    assert uw.percent_left(more, limit) <= uw.percent_left(less, limit)
    assert uw.segments_lit(more, limit) <= uw.segments_lit(less, limit)


# ---- back_words


NOW = utc(2026, 11, 25, 12)  # Wednesday 25 November 2026, midday UTC


@pytest.mark.parametrize(
    ("resets_at", "zone", "now", "words"),
    [
        (utc(2026, 11, 25, 16, 40), "UTC", NOW, "16:40"),
        (utc(2026, 11, 25, 12, 5), "UTC", NOW, "12:05"),
        (utc(2026, 11, 26, 9), "UTC", NOW, "Thursday 09:00"),
        (utc(2026, 11, 26, 0), "UTC", NOW, "Thursday 00:00"),
        (utc(2026, 12, 1, 9), "UTC", NOW, "Tuesday 09:00"),
        (utc(2026, 12, 2, 9), "UTC", NOW, "Wednesday 2 December 09:00"),
        (utc(2026, 12, 3, 9), "UTC", NOW, "Thursday 3 December 09:00"),
        # The day is the local one: 16:40 UTC is already Thursday in Auckland and Kiritimati,
        # where "now" is already Thursday too.
        (utc(2026, 11, 25, 16, 40), "Pacific/Auckland", NOW, "05:40"),
        (utc(2026, 11, 25, 16, 40), "Pacific/Kiritimati", NOW, "06:40"),
        (utc(2026, 11, 25, 16, 40), "America/Los_Angeles", NOW, "08:40"),
        (utc(2026, 11, 25, 16, 40), "Asia/Kolkata", NOW, "22:10"),
        (utc(2026, 11, 25, 16, 40), "Australia/Lord_Howe", NOW, "Thursday 03:40"),
        (utc(2026, 11, 25, 16, 40), "Etc/GMT+12", NOW, "04:40"),
        # 20:00 UTC is tomorrow in Kolkata (01:30 on Thursday) and still today in London.
        (utc(2026, 11, 25, 20), "Asia/Kolkata", NOW, "Thursday 01:30"),
        (utc(2026, 11, 25, 20), "Europe/London", NOW, "20:00"),
        # British Summer Time.
        (utc(2026, 7, 2, 8), "Europe/London", utc(2026, 7, 1, 12), "Thursday 09:00"),
        (utc(2027, 1, 7, 9), "Europe/London", utc(2026, 12, 31, 12), "Thursday 7 January 09:00"),
        # A reset that has already passed is still only a time.
        (utc(2026, 11, 24, 9), "UTC", NOW, "09:00"),
    ],
)
def test_a_reset_time_is_said_in_plain_words_in_the_local_zone(resets_at, zone, now, words):
    assert uw.back_words(resets_at, zone, now) == words


@pytest.mark.parametrize("name", ODD_NAMES)
def test_an_unusable_zone_says_the_reset_time_in_utc(name):
    assert uw.back_words(utc(2026, 11, 26, 9), name, NOW) == "Thursday 09:00"


def test_every_weekday_and_month_is_written_out_in_english():
    days = [uw.back_words(NOW + n * DAY, "UTC", NOW).split()[0] for n in range(1, 7)]
    assert days == ["Thursday", "Friday", "Saturday", "Sunday", "Monday", "Tuesday"]
    months = {
        uw.back_words(utc(2027, month, 15, 9), "UTC", NOW).split()[2] for month in range(1, 13)
    }
    assert months == {
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    }


@given(resets_at=instants, now=instants, zone=st.sampled_from(ZONES))
def test_the_words_always_end_with_a_two_digit_24_hour_time(resets_at, now, zone):
    words = uw.back_words(resets_at, zone, now).split()
    clock = words[-1]
    assert len(clock) == 5 and clock[2] == ":"
    assert 0 <= int(clock[:2]) <= 23 and 0 <= int(clock[3:]) <= 59
    assert len(words) in (1, 2, 4)
