"""Lucy's allowance table in the plan catalogue (ADR-0485): one base, a multiplier per plan.

The table is the one place a Lucy allowance is written. Until the gateway reads it, the guard
tests at the end hold it equal to the values the gateway still uses today.
"""

from __future__ import annotations

from dataclasses import replace
from types import MappingProxyType

import pytest
from hypothesis import given
from hypothesis import strategies as st

from selecta.ai.registry import Tier
from selecta.ai.spend import TIER_LIMITS
from selecta.billing import plans
from selecta.billing.plans import LucyUsagePlan, LucyUsageVersion
from selecta.lucy.cloud_agent import HISTORY_CHARS

V1 = plans.lucy_usage(1)
PLAN_IDS = ("free", "standard", "premium")


def with_plan(plan_id: str, **changes) -> LucyUsageVersion:
    """Version 1 with one plan's entry changed."""
    entries = dict(V1.plans)
    entries[plan_id] = replace(entries[plan_id], **changes)
    return replace(V1, plans=MappingProxyType(entries))


def use(monkeypatch: pytest.MonkeyPatch, *versions: LucyUsageVersion) -> None:
    monkeypatch.setattr(plans, "LUCY_USAGE", tuple(versions))


# ---- the shipped table


def test_the_newest_version_is_the_default_and_a_version_can_be_named():
    assert plans.lucy_usage() is plans.LUCY_USAGE[-1]
    assert plans.lucy_usage(1) is plans.LUCY_USAGE[0]
    assert plans.lucy_usage(1).version == 1


def test_an_unknown_version_is_refused():
    with pytest.raises(plans.UnknownPlan):
        plans.lucy_usage(99)
    with pytest.raises(plans.UnknownPlan):
        plans.lucy_usage(0)


def test_the_table_cannot_be_edited_in_place():
    with pytest.raises(TypeError):
        V1.plans["free"] = V1.plans["premium"]  # type: ignore[index]
    with pytest.raises(AttributeError):
        V1.plans["free"].multiplier_milli = 26_000  # type: ignore[misc]


@pytest.mark.parametrize(
    ("plan_id", "weekly", "session"),
    [
        ("free", 57_692, 14_423),
        ("standard", 807_688, 201_922),
        ("premium", 1_499_992, 374_998),
    ],
)
def test_a_weekly_limit_is_the_base_times_the_multiplier_and_a_session_is_a_quarter_of_it(
    plan_id, weekly, session
):
    assert plans.lucy_weekly_limit(V1, plan_id) == weekly
    assert plans.lucy_session_limit(V1, plan_id) == session
    assert session == weekly // 4


def test_standard_is_14_times_free_and_premium_26_times():
    free = plans.lucy_weekly_limit(V1, "free")
    assert plans.lucy_weekly_limit(V1, "standard") == 14 * free
    assert plans.lucy_weekly_limit(V1, "premium") == 26 * free
    assert V1.base_weekly_units == free


def test_an_unknown_plan_gets_the_free_allowance_and_never_more():
    assert plans.lucy_weekly_limit(V1, "platinum") == plans.lucy_weekly_limit(V1, "free")
    assert plans.lucy_session_limit(V1, "platinum") == plans.lucy_session_limit(V1, "free")
    assert plans.lucy_weekly_limit(V1, "") == plans.lucy_weekly_limit(V1, "free")


def test_a_venue_pool_has_a_weekly_allowance_and_no_plan_entry_of_its_own():
    assert V1.venue_weekly_units == 773_000
    assert set(V1.plans) == set(PLAN_IDS)


# ---- a multiplier of 0, and overrides


def test_a_multiplier_of_0_gives_no_weekly_allowance_and_no_session_allowance():
    usage = with_plan("free", multiplier_milli=0)
    assert plans.lucy_weekly_limit(usage, "free") == 0
    assert plans.lucy_session_limit(usage, "free") == 0
    assert plans.lucy_weekly_limit(usage, "standard") == 807_688


def test_an_override_replaces_the_plans_multiplier():
    assert plans.lucy_weekly_limit(V1, "free", 3_000) == 3 * 57_692
    assert plans.lucy_session_limit(V1, "free", 3_000) == 3 * 57_692 // 4
    assert plans.lucy_weekly_limit(V1, "premium", 1_000) == 57_692
    assert plans.lucy_weekly_limit(V1, "standard", 1_500) == 86_538
    assert plans.lucy_weekly_limit(V1, "premium", None) == 1_499_992


def test_an_override_of_0_switches_the_allowance_off_on_any_plan():
    for plan_id in PLAN_IDS:
        assert plans.lucy_weekly_limit(V1, plan_id, 0) == 0
        assert plans.lucy_session_limit(V1, plan_id, 0) == 0


def test_a_negative_override_gives_nothing_rather_than_a_negative_limit():
    assert plans.lucy_weekly_limit(V1, "premium", -5_000) == 0
    assert plans.lucy_session_limit(V1, "premium", -5_000) == 0


def test_a_plan_with_no_session_share_has_no_session_limit():
    usage = with_plan("premium", session_share_milli=None)
    assert plans.lucy_session_limit(usage, "premium") is None
    assert plans.lucy_session_limit(usage, "premium", 0) is None
    assert plans.lucy_weekly_limit(usage, "premium") == 1_499_992


def test_a_session_limit_is_at_least_1_while_the_week_has_anything():
    tiny = replace(with_plan("free", session_share_milli=1), base_weekly_units=3)
    assert plans.lucy_weekly_limit(tiny, "free") == 3
    assert plans.lucy_session_limit(tiny, "free") == 1


@given(
    base=st.integers(1, 10_000_000),
    multiplier=st.integers(0, 100_000),
    share=st.none() | st.integers(1, 1000),
    override=st.none() | st.integers(0, 100_000),
)
def test_a_session_never_exceeds_its_week_and_neither_limit_is_negative(
    base, multiplier, share, override
):
    usage = replace(
        with_plan("free", multiplier_milli=multiplier, session_share_milli=share),
        base_weekly_units=base,
    )
    weekly = plans.lucy_weekly_limit(usage, "free", override)
    session = plans.lucy_session_limit(usage, "free", override)
    used = multiplier if override is None else override
    assert weekly == base * used // 1000
    if share is None:
        assert session is None
    else:
        assert 0 <= session <= weekly
        assert (session == 0) == (weekly == 0)


# ---- validation


def test_the_shipped_table_has_no_problems():
    assert plans.problems() == []
    plans.validate_catalogue()


def broken_plan(**changes) -> LucyUsageVersion:
    return with_plan("standard", **changes)


@pytest.mark.parametrize(
    ("versions", "says"),
    [
        ((), "Lucy usage: has no versions"),
        ((replace(V1, version=2),), "Lucy usage: versions start at 1, not 2"),
        ((V1, replace(V1, version=1)), "Lucy usage v1: versions must go up; 1 follows 1"),
        (
            (V1, replace(V1, version=3), replace(V1, version=2)),
            "Lucy usage v2: versions must go up; 2 follows 3",
        ),
        ((replace(V1, base_weekly_units=0),), "Lucy usage v1: base_weekly_units must be more"),
        ((replace(V1, base_weekly_units=-1),), "Lucy usage v1: base_weekly_units must be more"),
        ((replace(V1, venue_weekly_units=0),), "Lucy usage v1: venue_weekly_units must be more"),
        (
            (replace(V1, plans={"free": V1.plans["free"], "standard": V1.plans["standard"]}),),
            "Lucy usage v1: has no entry for the premium plan",
        ),
        (
            (broken_plan(multiplier_milli=-1),),
            "Lucy usage v1 standard: multiplier_milli can't be negative",
        ),
        (
            (broken_plan(session_share_milli=0),),
            "Lucy usage v1 standard: session_share_milli must be from 1 to 1000",
        ),
        (
            (broken_plan(session_share_milli=1001),),
            "Lucy usage v1 standard: session_share_milli must be from 1 to 1000",
        ),
        (
            (broken_plan(max_turn_units=0),),
            "Lucy usage v1 standard: max_turn_units must be more than 0",
        ),
        (
            (broken_plan(max_concurrent_turns=0),),
            "Lucy usage v1 standard: max_concurrent_turns must be more than 0",
        ),
        (
            (broken_plan(max_turn_seconds=-3),),
            "Lucy usage v1 standard: max_turn_seconds must be more than 0",
        ),
        (
            (broken_plan(history_chars=0),),
            "Lucy usage v1 standard: history_chars must be more than 0",
        ),
    ],
)
def test_each_kind_of_fault_in_the_table_is_named(monkeypatch, versions, says):
    use(monkeypatch, *versions)
    found = plans.problems()
    assert any(says in problem for problem in found), found
    with pytest.raises(ValueError, match="Invalid Cloud plan catalogue"):
        plans.validate_catalogue()


@pytest.mark.parametrize(
    "usage",
    [
        with_plan("free", multiplier_milli=0),
        with_plan("premium", session_share_milli=None),
        with_plan("free", session_share_milli=1000),
        with_plan("free", session_share_milli=1),
    ],
)
def test_no_lucy_model_no_session_window_and_the_share_bounds_are_allowed(monkeypatch, usage):
    use(monkeypatch, usage)
    assert plans.problems() == []


def test_a_second_version_is_allowed_and_becomes_the_newest(monkeypatch):
    second = replace(V1, version=2, base_weekly_units=60_000)
    use(monkeypatch, V1, second)
    assert plans.problems() == []
    assert plans.lucy_usage() is second
    assert plans.lucy_usage(1) is V1
    assert plans.lucy_weekly_limit(plans.lucy_usage(), "standard") == 840_000


def test_every_fault_is_reported_at_once(monkeypatch):
    use(monkeypatch, replace(broken_plan(multiplier_milli=-1, history_chars=0), version=4))
    found = [problem for problem in plans.problems() if problem.startswith("Lucy usage")]
    assert len(found) == 3, found


# ---- guards: the table equals what the gateway enforces today (ADR-0485 rule 5)


@pytest.mark.parametrize("tier", list(Tier))
def test_the_caps_slots_and_seconds_equal_todays_tier_limits(tier):
    entry: LucyUsagePlan = plans.lucy_usage().plans[tier.value]
    today = TIER_LIMITS[tier]
    assert entry.max_turn_units == round(today.max_turn_cost_usd * 1_000_000)
    assert entry.max_concurrent_turns == today.max_concurrent_runs
    assert entry.max_turn_seconds == today.max_turn_seconds


def test_the_table_and_todays_tiers_name_the_same_plans():
    usage = plans.lucy_usage()
    assert set(usage.plans) == {tier.value for tier in Tier} == set(plans.CATALOGUE)
    assert set(usage.plans) == set(HISTORY_CHARS)


@pytest.mark.parametrize("plan_id", PLAN_IDS)
def test_the_earlier_conversation_size_equals_todays(plan_id):
    assert plans.lucy_usage().plans[plan_id].history_chars == HISTORY_CHARS[plan_id]


@pytest.mark.parametrize(
    ("tier", "within"),
    [(Tier.FREE, 0.01), (Tier.STANDARD, 0.02), (Tier.PREMIUM, 0.02)],
)
def test_a_year_of_full_weeks_costs_what_todays_monthly_ceiling_does(tier, within):
    # ADR-0482 rule 4: the weekly limit is the monthly ceiling times 12 over 52. Standard and
    # Premium are looser because their multipliers are rounded to whole numbers.
    today_weekly_usd = TIER_LIMITS[tier].monthly_cost_ceiling_usd * 12 / 52
    weekly_usd = plans.lucy_weekly_limit(plans.lucy_usage(), tier.value) / 1_000_000
    assert weekly_usd == pytest.approx(today_weekly_usd, rel=within)
