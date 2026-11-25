"""The Lucy turns meter shows what the AI gateway enforces (`usage.meters.lucy_turns`).

The meter used to read `lucy_turn.*` allowance counters that no turn ever wrote, so it showed
nothing used however much Lucy was used. It now reads `ai_usage`, the counters
`ai.allowance.try_start_turn` admits turns against. Every test here moves the meter the way a
real turn does, through `gateway.plan_turn` or `try_start_turn`, and never by writing the meter's
numbers directly.
"""

from __future__ import annotations

import datetime as dt
import threading
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa

from selecta.ai import allowance, gateway, registry
from selecta.ai.gateway import TurnRefused, finish_turn, plan_turn
from selecta.ai.registry import RequestClass, Tier
from selecta.ai.runs import Outcome
from selecta.ai.schema import ai_usage
from selecta.ai.spend import PlatformPolicy
from selecta.billing.plans import CATALOGUE, plan_for
from selecta.persistence import transaction
from selecta.usage import allowances, meters

Q, E, P, D = (RequestClass(name) for name in ("quick", "everyday", "planning", "deep_plan"))
POLICY = PlatformPolicy(daily_cap_usd=25.0, monthly_cap_usd=500.0, alert_percents=())
ODD_ZONES = [None, "", "Not/AZone", "Europe", "x" * 300, "../../etc/passwd", "UTC\x00"]


@pytest.fixture
def engine(cloud_engine):
    with transaction(cloud_engine) as conn:
        registry.seed_defaults(conn)
    return cloud_engine


def admit(engine, workspace="w", tier=Tier.FREE, request_class=E, **options):
    options.setdefault("policy", POLICY)
    with transaction(engine, workspace) as conn:
        return plan_turn(conn, workspace_id=workspace, tier=tier, request_class=request_class,
                         prompt_version="prompt-1", tool_schema_version="tools-1", **options)


def settle(engine, turn, outcome=Outcome.COMPLETED, **tokens):
    with transaction(engine, turn.workspace_id) as conn:
        return finish_turn(conn, turn, outcome=outcome, policy=POLICY, **tokens)


def turn(engine, **options):
    """One whole turn: admitted, answered and settled."""
    started = admit(engine, **options)
    settle(engine, started)
    return started


def count(engine, workspace, tier, bucket, times, month=None):
    """Count turns the way admission does, without running them (for filling an allowance)."""
    admitted = 0
    with transaction(engine, workspace) as conn:
        key = month or allowance.month_key(gateway.db_now(conn))
        for _ in range(times):
            admitted += allowance.try_start_turn(conn, workspace, tier, bucket, key).admitted
    return admitted


def meter(engine, workspace="w", plan="free", version=None, timezone="UTC"):
    with transaction(engine, workspace) as conn:
        return meters.lucy_turns(conn, workspace, plan_for(plan, version), timezone)


def lines(found) -> dict[str, tuple[int, int | None]]:
    return {entry["purpose"]: (entry["used"], entry["limit"]) for entry in found["classes"]}


def enforced(engine, workspace="w") -> dict[str, int]:
    with transaction(engine, workspace) as conn:
        rows = conn.execute(
            sa.select(ai_usage.c.request_class, sa.func.sum(ai_usage.c.turns))
            .where(ai_usage.c.workspace_id == workspace).group_by(ai_usage.c.request_class)
        ).all()
    return {str(name): int(turns) for name, turns in rows if turns}


# What the meter reads ---------------------------------------------------------------------------


def test_a_new_account_has_used_nothing(engine):
    found = meter(engine)
    assert (found["used"], found["limit"], found["fair_use"]) == (0, 40, False)
    assert found["period"] == "month" and found["resets_at"] > 0
    assert found["classes"] == [{
        "model_class": "haiku", "purpose": "everyday", "used": 0, "limit": 40,
        "resets_at": found["resets_at"], "period": "month",
    }]


def test_every_turn_the_gateway_admits_moves_the_meter(engine):
    for expected in (1, 2, 3):
        turn(engine)
        assert meter(engine)["used"] == expected
    assert enforced(engine) == {"everyday": 3}


def test_a_turn_is_on_the_meter_while_it_is_still_being_answered(engine):
    running = admit(engine)
    assert meter(engine)["used"] == 1
    settle(engine, running)
    assert meter(engine)["used"] == 1


@pytest.mark.parametrize("outcome", [Outcome.FAILED, Outcome.INCOMPLETE, Outcome.ABANDONED])
def test_a_turn_that_never_reached_the_person_comes_off_the_meter(engine, outcome):
    turn(engine)
    lost = admit(engine)
    assert meter(engine)["used"] == 2
    settle(engine, lost, outcome)
    assert meter(engine)["used"] == 1


def test_a_turn_the_person_stopped_stays_on_the_meter(engine):
    stopped = admit(engine)
    settle(engine, stopped, Outcome.CANCELLED)
    assert meter(engine)["used"] == 1


def test_a_refused_send_does_not_move_the_meter(engine):
    running = admit(engine)
    with pytest.raises(TurnRefused):
        admit(engine)  # Free answers one message at a time
    assert meter(engine)["used"] == 1
    settle(engine, running)


def test_what_a_turn_cost_is_not_counted_as_a_turn(engine):
    with transaction(engine, "w") as conn:
        month = allowance.month_key(gateway.db_now(conn))
        allowance.record_usage(conn, "w", month, E, tokens_in=9_000, tokens_out=900, cost_usd=0.2)
    assert meter(engine)["used"] == 0


def test_the_old_counters_no_longer_feed_the_meter(engine):
    """The rows the meter used to read: writing them changes nothing now."""
    with transaction(engine, "w") as conn:
        taken = allowances.try_consume(conn, "w", "lucy_turn.everyday", 7, 40, timezone="UTC")
    assert taken.ok and meter(engine)["used"] == 0
    turn(engine)
    assert meter(engine)["used"] == 1


# The meter and the limit agree ------------------------------------------------------------------


def test_the_meter_is_full_exactly_when_the_gateway_stops_admitting(engine):
    for _ in range(39):
        turn(engine)
    assert meter(engine)["used"] == 39
    last = turn(engine)
    assert not last.is_builtin and meter(engine)["used"] == 40

    refused = turn(engine)

    assert refused.is_builtin and refused.limited == "allowance"
    found = meter(engine)
    assert (found["used"], found["limit"]) == (40, 40)  # the planner's answer counts nothing


def test_the_meter_never_goes_below_nothing_used(engine):
    with transaction(engine, "w") as conn:
        month = allowance.month_key(gateway.db_now(conn))
        assert allowance.refund_turn(conn, "w", month, E) is False
    assert meter(engine)["used"] == 0
    lost = admit(engine)
    settle(engine, lost, Outcome.FAILED)
    with transaction(engine, "w") as conn:
        assert allowance.refund_turn(conn, "w", lost.month, E) is False  # given back only once
    assert meter(engine)["used"] == 0


def test_racing_sends_fill_the_meter_and_never_pass_it(postgres_engine):
    engine = postgres_engine
    admitted, lock = [], threading.Lock()

    def one() -> None:
        got = count(engine, "w", Tier.FREE, E, 1)
        with lock:
            admitted.append(got)

    threads = [threading.Thread(target=one) for _ in range(60)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sum(admitted) == 40
    assert meter(engine)["used"] == 40


# Each plan's lines ------------------------------------------------------------------------------


def test_standard_counts_quick_as_everyday_and_deep_plans_as_planning(engine):
    for asked in (Q, E, P, D):
        turn(engine, tier=Tier.STANDARD, request_class=asked)

    found = meter(engine, plan="standard")

    assert lines(found) == {"everyday": (2, 400), "planning": (2, 40)}
    assert (found["used"], found["limit"], found["fair_use"]) == (4, 440, False)
    assert enforced(engine) == {"everyday": 2, "planning": 2}


def test_premium_counts_planning_as_everyday_and_keeps_deep_plans_and_quick_apart(engine):
    for asked in (Q, Q, Q, E, P, D):
        turn(engine, tier=Tier.PREMIUM, request_class=asked)

    found = meter(engine, plan="premium")

    assert lines(found) == {"everyday": (2, 150), "deep_plan": (1, 25), "quick": (3, None)}
    # fair-use quick turns are in their own line and never in the total
    assert (found["used"], found["limit"], found["fair_use"]) == (3, 175, True)


def test_a_month_of_quick_questions_never_reads_as_used_up(engine):
    assert count(engine, "w", Tier.PREMIUM, Q, 300) == 300

    found = meter(engine, plan="premium")

    assert lines(found)["quick"] == (300, None)
    assert found["used"] == 0 and found["used"] < found["limit"]


def test_a_turn_that_steps_down_is_shown_where_it_was_counted(engine):
    assert count(engine, "w", Tier.PREMIUM, E, 150) == 150

    stepped = turn(engine, tier=Tier.PREMIUM, request_class=E)

    assert stepped.allowance_class is Q and stepped.limited == "allowance"
    assert lines(meter(engine, plan="premium")) == {
        "everyday": (150, 150), "deep_plan": (0, 25), "quick": (1, None),
    }


def test_used_up_deep_plans_show_full_and_the_next_one_counts_as_everyday(engine):
    assert count(engine, "w", Tier.PREMIUM, D, 25) == 25

    turn(engine, tier=Tier.PREMIUM, request_class=D)

    found = meter(engine, plan="premium")
    assert lines(found)["deep_plan"] == (25, 25) and lines(found)["everyday"] == (1, 150)
    assert found["used"] == 26


@pytest.mark.parametrize(("plan_id", "versions"), [(key, CATALOGUE[key]) for key in CATALOGUE])
def test_every_plan_version_sells_exactly_what_the_gateway_enforces(plan_id, versions):
    """The plan table (what the meter and the plan cards show) and `ai.allowance.ALLOWANCES`
    (what admission enforces) are written separately; this fails when they drift."""
    tier = Tier(plan_id)
    enforced_limits = allowance.ALLOWANCES[tier]
    fair = allowance.FAIR_USE.get(tier, frozenset())
    for plan in versions:
        sold = {RequestClass(entry.purpose): entry.turns for entry in plan.lucy}
        assert set(sold) == set(enforced_limits), (plan.id, plan.version)
        for purpose, turns in sold.items():
            if turns is None:
                assert purpose in fair, (plan.id, plan.version, purpose)
            else:
                assert purpose not in fair and turns == enforced_limits[purpose]
            # a turn asked for as this purpose is counted in the line that shows it
            assert allowance.bucket_for(tier, purpose) is purpose


# Whose turns, and which month -------------------------------------------------------------------


def test_another_accounts_turns_are_not_on_this_meter(engine):
    turn(engine, workspace="w")
    turn(engine, workspace="w")
    turn(engine, workspace="other")
    assert meter(engine, workspace="w")["used"] == 2
    assert meter(engine, workspace="other")["used"] == 1


def test_another_months_turns_are_not_on_this_meter(engine):
    assert count(engine, "w", Tier.FREE, E, 12, month="2020-01") == 12
    assert count(engine, "w", Tier.FREE, E, 5, month="2999-12") == 5
    assert meter(engine)["used"] == 0
    turn(engine)
    assert meter(engine)["used"] == 1


def test_a_downgrade_mid_month_shows_the_turns_already_used(engine):
    assert count(engine, "w", Tier.PREMIUM, E, 45) == 45

    found = meter(engine, plan="free")
    refused = turn(engine, tier=Tier.FREE)

    assert (found["used"], found["limit"]) == (45, 40)  # true, and over: no turn is left
    assert refused.is_builtin and refused.limited == "allowance"
    assert meter(engine, plan="free")["used"] == 45


def test_an_upgrade_mid_month_keeps_the_turns_already_used(engine):
    for _ in range(3):
        turn(engine, tier=Tier.FREE)

    found = meter(engine, plan="standard")

    assert lines(found) == {"everyday": (3, 400), "planning": (0, 40)}


# Months and time zones --------------------------------------------------------------------------


def at(clock, moment: str) -> None:
    clock.now = dt.datetime.fromisoformat(moment).replace(tzinfo=dt.UTC).timestamp()


@pytest.fixture
def frozen(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        registry.seed_defaults(conn)
    return sqlite_engine


@pytest.mark.parametrize(("zone", "month", "resets"), [
    ("UTC", "2026-11", "2026-12-01T00:00"),
    ("Pacific/Auckland", "2026-12", "2027-01-01T00:00"),  # already December there
    ("Pacific/Kiritimati", "2026-12", "2027-01-01T00:00"),  # UTC+14
    ("America/Los_Angeles", "2026-11", "2026-12-01T00:00"),
    ("Etc/GMT+12", "2026-11", "2026-12-01T00:00"),  # UTC-12
    ("Europe/London", "2026-11", "2026-12-01T00:00"),
])
def test_at_a_month_end_the_meter_uses_the_accounts_own_month(frozen, clock, zone, month, resets):
    at(clock, "2026-11-30T23:30:00")

    started = turn(frozen, timezone=zone)
    found = meter(frozen, timezone=zone)

    assert started.month == month  # the gateway and the meter name the same month
    assert found["used"] == 1
    local = dt.datetime.fromtimestamp(found["resets_at"], ZoneInfo(zone))
    assert local.replace(tzinfo=None) == dt.datetime.fromisoformat(resets)


def test_the_meter_empties_when_the_accounts_month_turns(frozen, clock):
    at(clock, "2026-11-30T23:59:59")
    turn(frozen, timezone="UTC")
    assert meter(frozen, timezone="UTC")["used"] == 1

    clock.advance(1)

    found = meter(frozen, timezone="UTC")
    assert found["used"] == 0
    assert dt.datetime.fromtimestamp(found["resets_at"], dt.UTC) == dt.datetime(
        2027, 1, 1, tzinfo=dt.UTC
    )
    turn(frozen, timezone="UTC")
    assert meter(frozen, timezone="UTC")["used"] == 1


def test_december_resets_in_january_of_the_next_year(frozen, clock):
    at(clock, "2026-12-15T12:00:00")
    turn(frozen, timezone="Europe/London")
    found = meter(frozen, timezone="Europe/London")
    assert found["used"] == 1
    assert dt.datetime.fromtimestamp(found["resets_at"], dt.UTC) == dt.datetime(
        2027, 1, 1, tzinfo=dt.UTC
    )


def test_a_month_that_starts_on_summer_time_resets_at_local_midnight(frozen, clock):
    at(clock, "2026-03-31T12:00:00")  # British Summer Time began on 29 March
    turn(frozen, timezone="Europe/London")
    found = meter(frozen, timezone="Europe/London")
    local = dt.datetime.fromtimestamp(found["resets_at"], ZoneInfo("Europe/London"))
    assert (local.month, local.day, local.hour, local.minute) == (4, 1, 0, 0)
    assert found["used"] == 1


@pytest.mark.parametrize("zone", ODD_ZONES)
def test_a_missing_or_unknown_time_zone_reads_as_utc(frozen, clock, zone):
    at(clock, "2026-11-30T23:30:00")

    started = turn(frozen, timezone=zone)  # the gateway must not fail on it either
    found = meter(frozen, timezone=zone)

    assert started.month == "2026-11" and found["used"] == 1
    assert found == meter(frozen, timezone="UTC")


@pytest.mark.parametrize("zone", ODD_ZONES)
def test_month_helpers_accept_any_time_zone_name(zone):
    moment = dt.datetime(2026, 11, 30, 23, 30, tzinfo=dt.UTC).timestamp()
    assert allowance.month_key(moment, zone) == "2026-11"
    assert allowance.month_resets_at("2026-11", zone) == dt.datetime(
        2026, 12, 1, tzinfo=dt.UTC
    ).timestamp()
