"""Daily and monthly allowances that reset at the account's own midnight, daylight saving
included (ADR-0402; docs/saas/02-plans-and-economics.md §3.1; docs/saas/18-test-plan.md §18.9)."""

from __future__ import annotations

import datetime as dt
import math
import threading

import pytest

from selecta.billing.plans import plan_for
from selecta.persistence import transaction
from selecta.usage import allowances as a
from selecta.usage.allowances import Period

WS = "ws-allow"
LONDON = "Europe/London"


def utc(*parts: int) -> float:
    return dt.datetime(*parts, tzinfo=dt.UTC).timestamp()


def consume(engine, kind="analysis_song", amount=1, limit=3, workspace=WS, **kwargs):
    with transaction(engine, workspace) as conn:
        return a.try_consume(conn, workspace, kind, amount, limit, **kwargs)


def left(engine, kind="analysis_song", limit=3, workspace=WS, **kwargs) -> a.Allowance:
    with transaction(engine, workspace) as conn:
        return a.remaining(conn, workspace, kind, limit, **kwargs)


def give_back(engine, consumed, amount=None) -> None:
    with transaction(engine, consumed.allowance.workspace_id) as conn:
        a.give_back(conn, consumed, amount)


# What each plan allows


@pytest.mark.parametrize(
    ("kind", "free", "standard", "premium"),
    [
        ("analysis_song", 150, 1_500, 5_000),
        ("speculative_cpu_seconds", 600, 3_600, 14_400),
        ("stem_preview_window", 10, None, None),
        ("export", 3, 30, None),
        ("lucy_turn.haiku", 40, 400, None),
        ("lucy_turn.sonnet", 0, 40, 150),
        ("lucy_turn.opus", 0, 0, 25),
    ],
)
def test_each_plan_sets_the_allowances_in_the_plan_table(kind, free, standard, premium):
    found = tuple(a.limit_for(plan_for(p), kind) for p in ("free", "standard", "premium"))
    assert found == (free, standard, premium)


def test_an_allowance_no_plan_sets_is_a_key_error():
    with pytest.raises(KeyError, match="No plan sets an allowance called 'uploads'"):
        a.limit_for(plan_for("free"), "uploads")


def test_every_plan_allowance_says_whether_it_is_daily_or_monthly():
    assert a.PERIODS["analysis_song"] is Period.DAY
    assert a.PERIODS["export"] is Period.MONTH
    for kind in a.PERIODS:
        a.limit_for(plan_for("premium"), kind)


# Periods


def test_a_utc_day_runs_from_midnight_to_midnight():
    key, start, end = a.period_window(Period.DAY, "UTC", utc(2026, 11, 9, 15, 30))
    assert (key, start, end) == ("2026-11-09", utc(2026, 11, 9), utc(2026, 11, 10))


def test_a_london_summer_day_starts_at_local_midnight():
    late = utc(2026, 7, 1, 22, 30)  # 23:30 BST on 1 July
    key, start, end = a.period_window(Period.DAY, LONDON, late)
    assert key == "2026-07-01"
    assert (start, end) == (utc(2026, 6, 30, 23), utc(2026, 7, 1, 23))
    assert a.period_window(Period.DAY, LONDON, utc(2026, 7, 1, 23))[0] == "2026-07-02"


def test_the_london_spring_forward_day_is_23_hours_long():
    key, start, end = a.period_window(Period.DAY, LONDON, utc(2027, 3, 28, 12))
    assert key == "2027-03-28"
    assert start == utc(2027, 3, 28, 0)
    assert end == utc(2027, 3, 28, 23)
    assert end - start == 23 * 3600
    # The skipped hour belongs to nobody; the moments either side are the same day.
    assert a.period_window(Period.DAY, LONDON, utc(2027, 3, 28, 0, 59))[0] == "2027-03-28"
    assert a.period_window(Period.DAY, LONDON, utc(2027, 3, 28, 1, 0))[0] == "2027-03-28"
    assert a.period_window(Period.DAY, LONDON, utc(2027, 3, 28, 23))[0] == "2027-03-29"


def test_the_london_fall_back_day_is_25_hours_long():
    key, start, end = a.period_window(Period.DAY, LONDON, utc(2026, 10, 25, 12))
    assert key == "2026-10-25"
    assert start == utc(2026, 10, 24, 23)
    assert end == utc(2026, 10, 26, 0)
    assert end - start == 25 * 3600
    # 01:30 happens twice that night, and both are the same day.
    first, second = utc(2026, 10, 25, 0, 30), utc(2026, 10, 25, 1, 30)
    assert a.period_window(Period.DAY, LONDON, first)[0] == "2026-10-25"
    assert a.period_window(Period.DAY, LONDON, second)[0] == "2026-10-25"
    assert a.period_window(Period.DAY, LONDON, utc(2026, 10, 24, 22, 59))[0] == "2026-10-24"


def test_a_month_runs_from_the_first_to_the_first():
    key, start, end = a.period_window(Period.MONTH, "UTC", utc(2026, 11, 9, 15))
    assert (key, start, end) == ("2026-11", utc(2026, 11, 1), utc(2026, 12, 1))


def test_december_rolls_over_into_january():
    key, start, end = a.period_window(Period.MONTH, "UTC", utc(2026, 12, 31, 23, 59))
    assert (key, start, end) == ("2026-12", utc(2026, 12, 1), utc(2027, 1, 1))


def test_a_leap_february_has_29_days():
    key, start, end = a.period_window(Period.MONTH, "UTC", utc(2028, 2, 29, 12))
    assert key == "2028-02"
    assert end - start == 29 * 86_400


def test_a_london_month_follows_its_clock_changes():
    _key, start, end = a.period_window(Period.MONTH, LONDON, utc(2027, 3, 15))
    assert end - start == 31 * 86_400 - 3600
    _key, start, end = a.period_window(Period.MONTH, LONDON, utc(2026, 10, 15))
    assert end - start == 31 * 86_400 + 3600
    assert a.period_window(Period.MONTH, LONDON, utc(2026, 10, 31, 23, 30))[0] == "2026-10"
    assert a.period_window(Period.MONTH, LONDON, utc(2026, 9, 30, 23, 30))[0] == "2026-10"


@pytest.mark.parametrize(
    "name",
    [None, "", "Mars/Olympus_Mons", "europe/london", "../etc/passwd", "Europe/London/", "UTC\0"],
)
def test_an_unknown_timezone_counts_in_utc(name):
    assert a.zone(name) is dt.UTC
    moment = utc(2026, 7, 1, 23, 30)
    assert a.period_window(Period.DAY, name, moment) == a.period_window(Period.DAY, "UTC", moment)


@pytest.mark.parametrize("name", ["Europe", "America", "Etc", "x" * 300])
def test_a_timezone_name_that_is_a_folder_or_too_long_counts_in_utc(name):
    # The account form accepts any of these; on disk they're a folder or an impossible path.
    assert a.zone(name) is dt.UTC


# Taking from an allowance


def test_an_allowance_can_be_used_up_to_its_limit_and_no_further(cloud_engine):
    first = consume(cloud_engine, amount=2)
    assert (first.ok, first.taken, first.allowance.used) == (True, 2, 2)
    assert first.allowance.remaining == 1
    exactly = consume(cloud_engine, amount=1)
    assert (exactly.ok, exactly.allowance.used, exactly.allowance.remaining) == (True, 3, 0)
    over = consume(cloud_engine, amount=1)
    assert (over.ok, over.taken, over.allowance.used) == (False, 0, 3)


def test_a_refused_amount_takes_nothing_even_when_part_of_it_would_fit(cloud_engine):
    consume(cloud_engine, amount=2)
    refused = consume(cloud_engine, amount=2)
    assert not refused.ok
    assert left(cloud_engine).used == 2
    assert consume(cloud_engine, amount=1).ok


@pytest.mark.parametrize("amount", [0, -1, math.nan, math.inf])
def test_only_an_amount_above_zero_can_be_taken(cloud_engine, amount):
    with pytest.raises(ValueError, match="above 0"):
        consume(cloud_engine, amount=amount)


@pytest.mark.parametrize("limit", [-1, math.nan, math.inf])
def test_a_limit_is_a_number_zero_or_more(cloud_engine, limit):
    with pytest.raises(ValueError, match="0 or more"):
        consume(cloud_engine, limit=limit)
    with pytest.raises(ValueError, match="0 or more"):
        left(cloud_engine, limit=limit)


def test_fair_use_is_counted_but_never_refused(cloud_engine):
    for _ in range(5):
        found = consume(cloud_engine, kind="lucy_turn.haiku", amount=100, limit=None)
        assert found.ok
    assert found.allowance.used == 500
    assert found.allowance.remaining is None
    assert left(cloud_engine, "lucy_turn.haiku", None).remaining is None


def test_a_limit_of_zero_means_the_plan_does_not_include_it(cloud_engine):
    found = consume(cloud_engine, kind="lucy_turn.opus", limit=0)
    assert not found.ok
    assert found.allowance.used == 0


def test_fractions_that_add_up_exactly_to_the_limit_still_fit(cloud_engine):
    for _ in range(10):
        assert consume(cloud_engine, kind="speculative_cpu_seconds", amount=0.1, limit=1.0).ok
    found = consume(cloud_engine, kind="speculative_cpu_seconds", amount=0.001, limit=1.0)
    assert not found.ok


def test_each_workspace_and_kind_has_its_own_count(cloud_engine):
    consume(cloud_engine, amount=3)
    assert consume(cloud_engine, workspace="ws-other", amount=3).ok
    assert consume(cloud_engine, kind="export", amount=3).ok
    assert not consume(cloud_engine, amount=1).ok


def test_an_allowance_no_plan_sets_needs_its_period_said(cloud_engine):
    with pytest.raises(KeyError, match="daily or monthly"):
        consume(cloud_engine, kind="welcome_songs")
    found = consume(cloud_engine, kind="welcome_songs", period="day", limit=500)
    assert found.allowance.period is Period.DAY
    found = consume(cloud_engine, kind="welcome_songs", period=Period.MONTH, limit=500)
    assert found.allowance.period is Period.MONTH


def test_remaining_reads_without_taking_anything(cloud_engine):
    fresh = left(cloud_engine)
    assert (fresh.used, fresh.remaining) == (0, 3)
    assert left(cloud_engine).used == 0
    consume(cloud_engine, amount=2)
    assert left(cloud_engine).remaining == 1


def test_an_allowance_says_when_it_resets(sqlite_engine, clock):
    clock.now = utc(2026, 11, 9, 15)
    found = consume(sqlite_engine, timezone=LONDON)
    assert found.allowance.resets_at == utc(2026, 11, 10)
    assert found.allowance.period_key == "2026-11-09"
    monthly = consume(sqlite_engine, kind="export", timezone=LONDON)
    assert monthly.allowance.resets_at == utc(2026, 12, 1)
    assert monthly.allowance.period_key == "2026-11"


# Resets


def test_a_daily_allowance_resets_at_the_accounts_local_midnight(sqlite_engine, clock):
    clock.now = utc(2026, 7, 1, 22, 59, 59)  # 23:59:59 BST
    assert consume(sqlite_engine, amount=3, timezone=LONDON).ok
    assert not consume(sqlite_engine, timezone=LONDON).ok
    clock.advance(1)  # midnight in London, still 23:00 in UTC
    found = consume(sqlite_engine, timezone=LONDON)
    assert found.ok
    assert (found.allowance.period_key, found.allowance.used) == ("2026-07-02", 1)


def test_the_spring_forward_day_resets_after_23_hours(sqlite_engine, clock):
    clock.now = utc(2027, 3, 28, 0, 30)  # 00:30 GMT, before the clocks go forward
    assert consume(sqlite_engine, amount=3, timezone=LONDON).ok
    clock.now = utc(2027, 3, 28, 22, 59)  # 23:59 BST, the same local day
    assert not consume(sqlite_engine, timezone=LONDON).ok
    clock.now = utc(2027, 3, 28, 23, 0)  # midnight BST: 23 hours after it began
    assert consume(sqlite_engine, timezone=LONDON).allowance.period_key == "2027-03-29"


def test_the_fall_back_day_resets_after_25_hours(sqlite_engine, clock):
    clock.now = utc(2026, 10, 24, 23, 30)  # 00:30 BST on the 25th
    assert consume(sqlite_engine, amount=3, timezone=LONDON).ok
    clock.now = utc(2026, 10, 25, 23, 59)  # 23:59 GMT, 24.5 hours later, the same day
    assert not consume(sqlite_engine, timezone=LONDON).ok
    clock.now = utc(2026, 10, 26, 0, 0)
    found = consume(sqlite_engine, timezone=LONDON)
    assert found.ok
    assert found.allowance.period_key == "2026-10-26"


def test_an_unknown_timezone_resets_at_utc_midnight(sqlite_engine, clock):
    clock.now = utc(2026, 7, 1, 23, 59)
    assert consume(sqlite_engine, amount=3, timezone="Europe").ok
    assert not consume(sqlite_engine, timezone="Mars/Olympus_Mons").ok
    clock.now = utc(2026, 7, 2, 0, 0)
    assert consume(sqlite_engine, timezone="Europe").ok


def test_a_monthly_allowance_resets_on_the_first_and_last_months_count_stays(sqlite_engine, clock):
    clock.now = utc(2026, 10, 31, 23, 30)  # 23:30 GMT on 31 October
    assert consume(sqlite_engine, kind="export", amount=3, timezone=LONDON).ok
    assert not consume(sqlite_engine, kind="export", timezone=LONDON).ok
    clock.now = utc(2026, 11, 1, 0, 0)
    found = consume(sqlite_engine, kind="export", timezone=LONDON)
    assert (found.ok, found.allowance.period_key, found.allowance.used) == (True, "2026-11", 1)
    clock.now = utc(2026, 10, 15)
    assert left(sqlite_engine, "export", timezone=LONDON).used == 3


# Giving back


def test_giving_back_returns_what_was_taken(cloud_engine):
    taken = consume(cloud_engine, amount=2)
    give_back(cloud_engine, taken)
    assert left(cloud_engine).used == 0


def test_giving_back_part_returns_only_that_part_and_never_more_than_was_taken(cloud_engine):
    consume(cloud_engine, amount=1)
    taken = consume(cloud_engine, amount=2)
    give_back(cloud_engine, taken, 0.5)
    assert left(cloud_engine).used == 2.5
    give_back(cloud_engine, taken, 50)
    assert left(cloud_engine).used == 0.5


def test_giving_back_a_refused_amount_changes_nothing(cloud_engine):
    consume(cloud_engine, amount=3)
    refused = consume(cloud_engine, amount=1)
    give_back(cloud_engine, refused)
    assert left(cloud_engine).used == 3


@pytest.mark.parametrize("amount", [-1, math.nan, -math.inf, math.inf])
def test_giving_back_a_negative_or_impossible_amount_is_refused(cloud_engine, amount):
    taken = consume(cloud_engine, amount=2)
    with pytest.raises(ValueError, match="give back"):
        give_back(cloud_engine, taken, amount)
    assert left(cloud_engine).used == 2


def test_giving_back_goes_to_the_period_it_was_taken_from(sqlite_engine, clock):
    clock.now = utc(2026, 7, 1, 22, 59)
    taken = consume(sqlite_engine, amount=3, timezone=LONDON)
    clock.now = utc(2026, 7, 1, 23, 1)  # the next London day
    assert consume(sqlite_engine, amount=1, timezone=LONDON).ok
    give_back(sqlite_engine, taken)
    assert left(sqlite_engine, timezone=LONDON).used == 1
    clock.now = utc(2026, 7, 1, 12)
    assert left(sqlite_engine, timezone=LONDON).used == 0


def test_giving_back_to_a_period_with_no_count_does_nothing(cloud_engine):
    nothing = a.Allowance(WS, "analysis_song", Period.DAY, "1999-01-01", 1, 3, 0)
    give_back(cloud_engine, a.Consumed(True, nothing, 1))
    assert left(cloud_engine).used == 0


# Many requests at once


def test_requests_at_once_never_take_more_than_the_allowance(cloud_engine):
    results: list[bool] = []
    errors: list[BaseException] = []
    start = threading.Barrier(40)

    def take() -> None:
        try:
            start.wait()
            results.append(consume(cloud_engine, kind="lucy_turn.haiku", limit=10).ok)
        except BaseException as error:  # noqa: BLE001
            errors.append(error)

    threads = [threading.Thread(target=take) for _ in range(40)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == []
    assert results.count(True) == 10
    found = left(cloud_engine, "lucy_turn.haiku", 10)
    assert (found.used, found.remaining) == (10, 0)
