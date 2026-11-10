"""Lucy's allowances and layered spend guards (ADR-0404 §9.3, test plan §18.13).

Turn allowances per class and month, per-turn ceilings, account run leases, provider circuit
breakers, and the platform's daily and monthly dollar caps. Races run on PostgreSQL only (CI).
"""

from __future__ import annotations

import datetime as dt
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from types import SimpleNamespace

import pytest
import sqlalchemy as sa

from selecta.ai import allowance, registry
from selecta.ai.allowance import ALLOWANCES, month_key, month_resets_at, try_start_turn
from selecta.ai.registry import DEFAULT_DEPLOYMENTS, Prices, RegistryError, RequestClass, Tier
from selecta.ai.routing import resolve
from selecta.ai.schema import ai_concurrency, ai_spend_daily, ai_usage, insert_ignore
from selecta.ai.spend import (
    BreakerState,
    CircuitBreaker,
    PlatformPolicy,
    ProviderGuard,
    SpendRefused,
    TurnGuard,
    TurnLimits,
    acquire_lease,
    active_leases,
    emergency_disable,
    platform_totals,
    reconcile,
    release_lease,
    renew_lease,
    reserve,
    turn_limits,
)
from selecta.persistence import transaction

DEFAULTS = {deployment.id: deployment for deployment in DEFAULT_DEPLOYMENTS}
Q, E, P, D = (RequestClass(name) for name in ("quick", "everyday", "planning", "deep_plan"))
DAY_ONE = dt.datetime(2026, 11, 9, 12, tzinfo=dt.UTC).timestamp()
DAY_TWO = DAY_ONE + 86_400


class FakeClock:
    def __init__(self, now: float = 1_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


# Allowances ---------------------------------------------------------------------------------


def test_the_monthly_allowances_match_the_plan_table():
    assert ALLOWANCES[Tier.FREE] == {E: 40}
    assert ALLOWANCES[Tier.STANDARD] == {E: 400, P: 40}
    assert ALLOWANCES[Tier.PREMIUM] == {E: 150, D: 25, Q: allowance.FAIR_USE_QUICK}


@pytest.mark.parametrize(
    ("tier", "request_class", "bucket"),
    [
        (Tier.FREE, Q, E), (Tier.FREE, E, E), (Tier.FREE, P, E), (Tier.FREE, D, E),
        (Tier.STANDARD, Q, E), (Tier.STANDARD, E, E), (Tier.STANDARD, P, P),
        (Tier.STANDARD, D, P), (Tier.PREMIUM, Q, Q), (Tier.PREMIUM, E, E),
        (Tier.PREMIUM, P, E), (Tier.PREMIUM, D, D),
    ],
)
def test_each_request_class_counts_against_its_tiers_bucket(tier, request_class, bucket):
    assert allowance.bucket_for(tier, request_class) is bucket
    assert bucket in ALLOWANCES[Tier(tier)]


def test_a_turn_steps_down_one_class_at_a_time():
    assert allowance.classes_from(D) == [D, P, E, Q]
    assert allowance.classes_from("quick") == [Q]


def test_turns_are_consumed_per_class_up_to_the_limit(cloud_engine, monkeypatch):
    monkeypatch.setitem(ALLOWANCES, Tier.STANDARD, {E: 3, P: 2})
    with transaction(cloud_engine) as conn:
        planning = [try_start_turn(conn, "w", Tier.STANDARD, P, "2026-11") for _ in range(3)]
        everyday = [try_start_turn(conn, "w", Tier.STANDARD, Q, "2026-11") for _ in range(4)]

    assert [start.admitted for start in planning] == [True, True, False]
    assert [start.used for start in planning] == [1, 2, 2]
    assert planning[-1].limit == 2 and planning[-1].bucket is P
    assert [start.admitted for start in everyday] == [True, True, True, False]
    assert everyday[0].bucket is E  # quick questions count as everyday on Standard


def test_a_bucket_a_tier_lacks_never_admits(cloud_engine, monkeypatch):
    monkeypatch.setitem(ALLOWANCES, Tier.FREE, {})
    with transaction(cloud_engine) as conn:
        start = try_start_turn(conn, "w", Tier.FREE, Q, "2026-11")
        rows = conn.execute(sa.select(sa.func.count()).select_from(ai_usage)).scalar_one()

    assert (start.admitted, start.used, start.limit) == (False, 0, 0)
    assert rows == 0


def test_a_new_month_starts_with_a_fresh_allowance(cloud_engine, monkeypatch):
    monkeypatch.setitem(ALLOWANCES, Tier.FREE, {E: 1})
    with transaction(cloud_engine) as conn:
        assert try_start_turn(conn, "w", Tier.FREE, E, "2026-11").admitted
        assert not try_start_turn(conn, "w", Tier.FREE, E, "2026-11").admitted
        assert try_start_turn(conn, "w", Tier.FREE, E, "2026-12").admitted
        assert try_start_turn(conn, "other", Tier.FREE, E, "2026-11").admitted


def test_months_follow_the_accounts_time_zone():
    late_on_the_30th = dt.datetime(2026, 11, 30, 23, 30, tzinfo=dt.UTC).timestamp()

    assert month_key(late_on_the_30th) == "2026-11"
    assert month_key(late_on_the_30th, "Europe/London") == "2026-11"
    assert month_key(late_on_the_30th, "Asia/Tokyo") == "2026-12"
    assert month_key(late_on_the_30th, "Not/A_Zone") == "2026-11"
    assert month_key(late_on_the_30th, None) == "2026-11"


def test_the_meter_says_when_the_month_resets():
    assert month_resets_at("2026-11") == dt.datetime(2026, 12, 1, tzinfo=dt.UTC).timestamp()
    assert month_resets_at("2026-12") == dt.datetime(2027, 1, 1, tzinfo=dt.UTC).timestamp()
    tokyo = dt.datetime(2026, 12, 1, tzinfo=dt.timezone(dt.timedelta(hours=9))).timestamp()
    assert month_resets_at("2026-11", "Asia/Tokyo") == tokyo
    assert month_resets_at("2026-11", "../../etc/passwd") == month_resets_at("2026-11")


def test_a_refund_gives_a_turn_back_but_never_below_zero(cloud_engine):
    with transaction(cloud_engine) as conn:
        assert not allowance.refund_turn(conn, "w", "2026-11", E)
        try_start_turn(conn, "w", Tier.FREE, E, "2026-11")
        assert allowance.refund_turn(conn, "w", "2026-11", "everyday")
        assert not allowance.refund_turn(conn, "w", "2026-11", E)
        used = allowance.remaining(conn, "w", Tier.FREE, "2026-11")[0].used

    assert used == 0


def test_usage_adds_tokens_and_dollars_and_the_meter_shows_turns_left(cloud_engine):
    with transaction(cloud_engine) as conn:
        try_start_turn(conn, "w", Tier.PREMIUM, D, "2026-11")
        try_start_turn(conn, "w", Tier.PREMIUM, Q, "2026-11")
        allowance.record_usage(conn, "w", "2026-11", D, tokens_in=100, tokens_out=50,
                               cost_usd=0.25, cache_read_tokens=40)
        allowance.record_usage(conn, "w", "2026-11", "quick", tokens_in=-5, tokens_out=10,
                               cost_usd=-1.0)
        allowance.record_usage(conn, "w", "2026-11", E, tokens_in=1, tokens_out=1, cost_usd=0.5)
        allowance.record_usage(conn, "w", "2026-10", E, tokens_in=1, tokens_out=1, cost_usd=9.0)
        cost = allowance.month_cost(conn, "w", "2026-11")
        nothing = allowance.month_cost(conn, "nobody", "2026-11")
        meter = {state.bucket: state for state in allowance.remaining(conn, "w", "premium",
                                                                       "2026-11")}
        deep = conn.execute(
            sa.select(ai_usage.c.tokens_in, ai_usage.c.tokens_out, ai_usage.c.cache_read_tokens)
            .where(ai_usage.c.request_class == "deep_plan")
        ).one()

    assert cost == pytest.approx(0.75)
    assert nothing == 0.0
    assert tuple(deep) == (100, 50, 40)
    assert (meter[D].used, meter[D].remaining, meter[D].limit) == (1, 24, 25)
    assert meter[Q].fair_use and not meter[D].fair_use
    assert meter[E].used == 0 and meter[E].remaining == 150
    assert meter[E].resets_at == month_resets_at("2026-11")


def test_concurrent_turn_starts_never_overspend_an_allowance(postgres_engine):
    """PostgreSQL only: real row locks. 60 starts race for Free's 40 turns."""

    def start(_: int) -> bool:
        with transaction(postgres_engine, "w") as conn:
            return try_start_turn(conn, "w", Tier.FREE, E, "2026-11").admitted

    with ThreadPoolExecutor(max_workers=12) as pool:
        admitted = list(pool.map(start, range(60)))
    with transaction(postgres_engine) as conn:
        used = conn.execute(sa.select(ai_usage.c.turns)).scalar_one()

    assert sum(admitted) == 40
    assert used == 40


# Per call and per turn ------------------------------------------------------------------------


def limits(**changes) -> TurnLimits:
    values = dict(max_cycles=3, max_seconds=60, max_cost_usd=0.01, max_input_tokens=10_000,
                  max_output_tokens=1_000)
    values.update(changes)
    return TurnLimits(**values)


def test_turn_limits_take_the_tighter_of_deployment_and_tier():
    opus = turn_limits(DEFAULTS["opus-high"], Tier.PREMIUM)
    sonnet_on_standard = turn_limits(DEFAULTS["sonnet-medium"], "standard")
    haiku_on_free = turn_limits(DEFAULTS["haiku-low"], Tier.FREE)

    assert (opus.max_cycles, opus.max_seconds, opus.max_cost_usd) == (10, 180, 0.60)
    assert sonnet_on_standard.max_cost_usd == 0.15 and sonnet_on_standard.max_seconds == 120
    assert haiku_on_free.max_cost_usd == 0.01 and haiku_on_free.max_input_tokens == 60_000


def test_the_cycle_cap_stops_a_turn_after_its_last_allowed_call():
    guard = TurnGuard(limits(max_cycles=2), Prices(1.0, 1.0), FakeClock())
    for _ in range(2):
        guard.check_call(100)
        guard.record_call(100, 10)

    with pytest.raises(SpendRefused) as refused:
        guard.check_call(100)
    assert refused.value.code == "cycles"
    assert guard.cycles == 2 and guard.tokens_in == 200 and guard.tokens_out == 20


def test_the_time_cap_stops_a_turn_once_its_seconds_are_used():
    clock = FakeClock()
    guard = TurnGuard(limits(max_seconds=60), Prices(1.0, 1.0), clock)
    clock.now += 59.9
    guard.check_call(10)
    clock.now += 0.1

    with pytest.raises(SpendRefused, match="ran out of time") as refused:
        guard.check_call(10)
    assert refused.value.code == "seconds"


def test_a_call_longer_than_the_input_ceiling_is_refused():
    guard = TurnGuard(limits(max_input_tokens=1_000), Prices(1.0, 1.0), FakeClock())
    guard.check_call(1_000)

    with pytest.raises(SpendRefused) as refused:
        guard.check_call(1_001)
    assert refused.value.code == "input_tokens"


def test_the_cost_cap_admits_a_call_ending_exactly_at_it_and_refuses_one_past_it():
    # 1,000 output tokens at $5/M is $0.005 worst case; input is free here.
    guard = TurnGuard(limits(max_cost_usd=0.01), Prices(1e-9, 5.0), FakeClock())
    assert guard.check_call(0) == pytest.approx(0.005)
    guard.record_call(0, 1_000)
    assert guard.check_call(0) == pytest.approx(0.005)  # 0.005 + 0.005 is exactly the cap
    guard.record_call(0, 1)

    with pytest.raises(SpendRefused, match="cost limit") as refused:
        guard.check_call(0)
    assert refused.value.code == "cost"
    assert guard.cost_usd == pytest.approx(0.005005)


def test_the_built_in_planner_has_no_cost_to_cap():
    guard = TurnGuard(turn_limits(registry.BUILTIN, Tier.FREE), registry.BUILTIN.prices,
                      FakeClock())

    assert guard.check_call(0) == 0.0
    assert guard.record_call(500, 500) == 0.0


def test_a_turn_guard_defaults_to_the_monotonic_clock():
    guard = TurnGuard(limits(), Prices(1.0, 1.0))

    assert guard.started > 0
    assert guard.estimate_call(1_000_000) == pytest.approx(1.001)


# Per account: run leases ---------------------------------------------------------------------


def test_an_account_holds_at_most_its_run_slots(cloud_engine):
    with transaction(cloud_engine) as conn:
        first = acquire_lease(conn, "w", "run-1", 2, 60)
        second = acquire_lease(conn, "w", "run-2", 2, 60)
        third = acquire_lease(conn, "w", "run-3", 2, 60)
        elsewhere = acquire_lease(conn, "other", "run-4", 2, 60)
        busy = active_leases(conn, "w")
        release_lease(conn, first)
        fourth = acquire_lease(conn, "w", "run-5", 2, 60)

    assert first and second and elsewhere and fourth
    assert third is None
    assert busy == 2
    assert len({first, second, fourth}) == 3


def test_a_zero_slot_account_still_gets_one_run(cloud_engine):
    with transaction(cloud_engine) as conn:
        assert acquire_lease(conn, "w", "run-1", 0, 60)
        assert acquire_lease(conn, "w", "run-2", 0, 60) is None


def test_a_lease_from_a_server_that_died_expires(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        dead = acquire_lease(conn, "w", "run-1", 1, 120)
        assert acquire_lease(conn, "w", "run-2", 1, 120) is None
    clock.advance(119)
    with transaction(sqlite_engine) as conn:
        assert renew_lease(conn, dead, 120)  # still alive, so it may be extended
    clock.advance(120)
    with transaction(sqlite_engine) as conn:
        assert active_leases(conn, "w") == 0
        assert not renew_lease(conn, dead, 120)  # expired: it may belong to someone else now
        taken = acquire_lease(conn, "w", "run-2", 1, 120)
        release_lease(conn, dead)  # the dead server's late release can't free the new lease
        holders = conn.execute(sa.select(ai_concurrency.c.run_id)).scalars().all()

    assert taken is not None
    assert holders == ["run-2"]


def test_concurrent_turns_never_hold_more_leases_than_slots(postgres_engine):
    """PostgreSQL only: 10 servers race for an account's 2 run slots."""

    def take(number: int) -> str | None:
        with transaction(postgres_engine, "w") as conn:
            return acquire_lease(conn, "w", f"run-{number}", 2, 60)

    with ThreadPoolExecutor(max_workers=10) as pool:
        leases = [lease for lease in pool.map(take, range(10)) if lease]

    assert len(leases) == 2


# Per provider: circuit breaker and concurrency ---------------------------------------------


def test_the_circuit_breaker_goes_closed_open_half_open_and_closed_again():
    clock = FakeClock()
    breaker = CircuitBreaker(failure_threshold=3, window_seconds=60, cooldown_seconds=30,
                             clock=clock)
    assert breaker.state is BreakerState.CLOSED
    breaker.record_failure()
    breaker.record_failure()
    assert breaker.state is BreakerState.CLOSED and breaker.allow()

    breaker.record_failure()
    assert breaker.state is BreakerState.OPEN
    assert not breaker.available() and not breaker.allow()

    clock.now += 30
    assert breaker.state is BreakerState.HALF_OPEN
    assert breaker.available()
    assert breaker.allow()  # the single probe
    assert not breaker.available() and not breaker.allow()

    breaker.record_success()
    assert breaker.state is BreakerState.CLOSED
    assert breaker.available()


def test_a_failed_probe_opens_the_breaker_for_another_cooldown():
    clock = FakeClock()
    breaker = CircuitBreaker(failure_threshold=1, cooldown_seconds=30, clock=clock)
    breaker.record_failure()
    clock.now += 30
    assert breaker.allow()

    breaker.record_failure()
    assert breaker.state is BreakerState.OPEN
    clock.now += 29
    assert breaker.state is BreakerState.OPEN
    clock.now += 1
    assert breaker.state is BreakerState.HALF_OPEN and breaker.allow()


def test_a_probe_that_never_reports_frees_the_breaker_after_another_cooldown():
    clock = FakeClock()
    breaker = CircuitBreaker(failure_threshold=1, cooldown_seconds=30, clock=clock)
    breaker.record_failure()
    clock.now += 30
    assert breaker.allow()  # this probe's caller crashes and never reports back

    clock.now += 29
    assert not breaker.available()
    clock.now += 1
    assert breaker.available()
    assert breaker.allow()
    assert not breaker.allow()


def test_failures_spread_wider_than_the_window_never_open_the_breaker():
    clock = FakeClock()
    breaker = CircuitBreaker(failure_threshold=3, window_seconds=60, clock=clock)
    for _ in range(10):
        breaker.record_failure()
        clock.now += 31

    assert breaker.state is BreakerState.CLOSED


def test_the_breaker_defaults_to_the_monotonic_clock():
    assert CircuitBreaker().state is BreakerState.CLOSED


def test_the_provider_guard_caps_calls_per_deployment_and_per_provider():
    guard = ProviderGuard({"anthropic": 3})
    haiku = replace(DEFAULTS["haiku-low"], concurrency=2)
    sonnet = DEFAULTS["sonnet-medium"]

    assert guard.try_acquire(haiku) and guard.try_acquire(haiku)
    assert not guard.try_acquire(haiku)  # the deployment's own limit
    assert guard.try_acquire(sonnet)
    assert not guard.try_acquire(sonnet)  # the provider's limit
    guard.release("haiku-low", ok=True)
    assert guard.try_acquire(sonnet)
    assert guard.states() == {
        "haiku-low": {"state": "closed", "in_flight": 1},
        "sonnet-medium": {"state": "closed", "in_flight": 2},
    }
    guard.release("never-acquired", ok=True)
    assert guard.states()["never-acquired"]["in_flight"] == 0


def test_an_open_breaker_makes_routing_fall_back_and_a_probe_restores_it(cloud_engine):
    clock = FakeClock()
    guard = ProviderGuard(failure_threshold=2, cooldown_seconds=30, clock=clock)
    opus = DEFAULTS["opus-high"]
    with transaction(cloud_engine) as conn:
        registry.seed_defaults(conn)
        for _ in range(2):
            assert guard.try_acquire(opus)
            guard.release("opus-high", ok=False)
        assert not guard.is_healthy("opus-high")
        assert not guard.try_acquire(opus)
        fallen = resolve(conn, Tier.PREMIUM, D, "w", guard)
        clock.now += 30
        assert guard.breaker("opus-high").state is BreakerState.HALF_OPEN
        assert guard.try_acquire(opus)  # the probe
        while_probing = resolve(conn, Tier.PREMIUM, D, "w", guard)
        guard.release("opus-high", ok=True)
        restored = resolve(conn, Tier.PREMIUM, D, "w", guard)

    assert fallen.deployment.id == "sonnet-medium"
    assert while_probing.deployment.id == "sonnet-medium"
    assert restored.deployment.id == "opus-high"


# Platform: daily and monthly caps -------------------------------------------------------------


def test_the_platform_policy_reads_its_caps_from_the_environment():
    assert PlatformPolicy.from_env({}) == PlatformPolicy()
    policy = PlatformPolicy.from_env({
        "SELECTA_AI_DAILY_CAP_USD": "12.5",
        "SELECTA_AI_MONTHLY_CAP_USD": "300",
        "SELECTA_AI_ALERT_PERCENTS": "90, 25,,",
    })

    assert policy == PlatformPolicy(12.5, 300.0, (25, 90))


def test_platform_policy_defaults_come_from_the_process_environment(monkeypatch):
    monkeypatch.setenv("SELECTA_AI_DAILY_CAP_USD", "7")
    monkeypatch.delenv("SELECTA_AI_MONTHLY_CAP_USD", raising=False)
    monkeypatch.delenv("SELECTA_AI_ALERT_PERCENTS", raising=False)

    assert PlatformPolicy.from_env().daily_cap_usd == 7.0


def test_the_daily_cap_admits_up_to_exactly_the_cap_and_refuses_past_it(cloud_engine):
    policy = PlatformPolicy(daily_cap_usd=0.3, monthly_cap_usd=100.0, alert_percents=())
    with transaction(cloud_engine) as conn:
        admitted = [reserve(conn, 0.1, policy, DAY_ONE) for _ in range(3)]
        refused = reserve(conn, 0.000001, policy, DAY_ONE)
        totals = platform_totals(conn, DAY_ONE)

    assert all(r.admitted and r.amount_usd == 0.1 for r in admitted)
    assert (refused.admitted, refused.amount_usd, refused.reason) == (False, 0.0, "daily_cap")
    assert totals.day_reserved_usd == pytest.approx(0.3)
    assert totals.day == "2026-11-09"


def test_the_monthly_cap_counts_every_day_of_the_month(cloud_engine):
    policy = PlatformPolicy(daily_cap_usd=0.4, monthly_cap_usd=0.5, alert_percents=())
    with transaction(cloud_engine) as conn:
        assert reserve(conn, 0.4, policy, DAY_ONE).admitted
        over = reserve(conn, 0.2, policy, DAY_TWO)
        exact = reserve(conn, 0.1, policy, DAY_TWO)
        after = reserve(conn, 0.01, policy, DAY_TWO)
        totals = platform_totals(conn, DAY_TWO)

    assert (over.admitted, over.reason) == (False, "monthly_cap")
    assert exact.admitted
    assert (after.admitted, after.reason) == (False, "monthly_cap")
    assert totals.month_reserved_usd == pytest.approx(0.5)
    assert totals.day_reserved_usd == pytest.approx(0.1)


def test_a_new_month_starts_under_the_monthly_cap_again(cloud_engine):
    policy = PlatformPolicy(daily_cap_usd=1.0, monthly_cap_usd=1.0, alert_percents=())
    next_month = dt.datetime(2026, 12, 1, 1, tzinfo=dt.UTC).timestamp()
    with transaction(cloud_engine) as conn:
        assert reserve(conn, 1.0, policy, DAY_ONE).admitted
        assert not reserve(conn, 0.5, policy, DAY_TWO).admitted
        assert reserve(conn, 0.5, policy, next_month).admitted


def test_reconcile_swaps_a_reservation_for_what_the_turn_really_cost(cloud_engine):
    policy = PlatformPolicy(daily_cap_usd=1.0, monthly_cap_usd=10.0, alert_percents=())
    with transaction(cloud_engine) as conn:
        held = reserve(conn, 0.6, policy, DAY_ONE)
        assert not reserve(conn, 0.5, policy, DAY_ONE).admitted
        reconcile(conn, held.day, held.amount_usd, 0.05, policy)
        freed = reserve(conn, 0.5, policy, DAY_ONE)
        reconcile(conn, held.day, 5.0, -1.0, policy)  # an over-release never goes negative
        totals = platform_totals(conn, DAY_ONE)
        reconcile(conn, "2026-11-20", 0.1, 0.02, policy)  # a day with no row yet

    assert freed.admitted
    assert totals.day_spent_usd == pytest.approx(0.05)
    assert totals.day_reserved_usd == 0.0


def test_spend_alerts_fire_once_per_threshold_per_day_and_per_month(cloud_engine):
    policy = PlatformPolicy(daily_cap_usd=1.0, monthly_cap_usd=2.0, alert_percents=(50, 80))
    with transaction(cloud_engine) as conn:
        first = reserve(conn, 0.5, policy, DAY_ONE).alerts
        repeat = reserve(conn, 0.125, policy, DAY_ONE).alerts
        eighty = reserve(conn, 0.25, policy, DAY_ONE).alerts
        next_day = reserve(conn, 0.5, policy, DAY_TWO).alerts
        settled = reconcile(conn, "2026-11-10", 0.5, 0.5, policy)

    assert [(a.scope, a.percent) for a in first] == [("daily", 50)]
    assert first[0].total_usd == 0.5 and first[0].cap_usd == 1.0 and first[0].day == "2026-11-09"
    assert repeat == ()
    assert [(a.scope, a.percent) for a in eighty] == [("daily", 80)]
    # Day two: its own daily 50%, and the month passes 50% once (0.875 + 0.5 of 2.0).
    assert [(a.scope, a.percent) for a in next_day] == [("daily", 50), ("monthly", 50)]
    assert settled == ()


def test_a_zero_cap_refuses_everything_and_raises_no_alert(cloud_engine):
    policy = PlatformPolicy(daily_cap_usd=0.0, monthly_cap_usd=0.0)
    with transaction(cloud_engine) as conn:
        refused = reserve(conn, 0.01, policy, DAY_ONE)

    assert not refused.admitted and refused.alerts == ()


def test_reservations_use_database_time_when_none_is_given(sqlite_engine, clock):
    clock.now = DAY_ONE
    with transaction(sqlite_engine) as conn:
        held = reserve(conn, 0.2, PlatformPolicy())
        totals = platform_totals(conn)
        day = conn.execute(sa.select(ai_spend_daily.c.day)).scalar_one()

    assert held.day == day == totals.day == "2026-11-09"
    assert totals.month_reserved_usd == pytest.approx(0.2)


def test_concurrent_reservations_never_pass_the_platform_cap(postgres_engine):
    """PostgreSQL only: 80 turns from many servers race for a $0.50 daily cap in cents."""
    policy = PlatformPolicy(daily_cap_usd=0.5, monthly_cap_usd=100.0, alert_percents=())
    lock = threading.Lock()
    admitted: list[bool] = []

    def take(_: int) -> None:
        with transaction(postgres_engine) as conn:
            result = reserve(conn, 0.01, policy, DAY_ONE).admitted
        with lock:
            admitted.append(result)

    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(take, range(80)))
    with transaction(postgres_engine) as conn:
        reserved = conn.execute(sa.select(ai_spend_daily.c.reserved_usd)).scalar_one()

    assert sum(admitted) == 50
    assert reserved == pytest.approx(0.5)


# Emergency disable --------------------------------------------------------------------------


def test_emergency_disable_stops_new_runs_on_a_deployment_at_once(cloud_engine):
    with transaction(cloud_engine) as conn:
        registry.seed_defaults(conn)
        before = resolve(conn, Tier.PREMIUM, D, "w")
        assert emergency_disable(conn, "opus-high")
        after = resolve(conn, Tier.PREMIUM, D, "w")
        assert not emergency_disable(conn, "no-such-deployment")
        with pytest.raises(RegistryError):
            emergency_disable(conn, registry.BUILTIN_ID)

    assert before.deployment.id == "opus-high"
    assert after.deployment.id == "sonnet-medium"
    assert after.skipped == (("opus-high", "disabled"),)


def test_insert_ignore_refuses_a_database_it_was_not_written_for():
    other = SimpleNamespace(dialect=SimpleNamespace(name="mysql"))

    with pytest.raises(RuntimeError, match="Unsupported database: mysql"):
        insert_ignore(other, ai_usage, {}, ["id"])


def test_insert_ignore_says_whether_it_inserted_on_both_databases(cloud_engine):
    row = {"id": "u1", "workspace_id": "w", "month": "2026-11", "request_class": "everyday",
           "turns": 0, "tokens_in": 0, "tokens_out": 0, "cache_read_tokens": 0,
           "cost_usd": 0.0, "updated_at": 1.0}
    with transaction(cloud_engine) as conn:
        first = insert_ignore(conn, ai_usage, row, ["workspace_id", "month", "request_class"])
        again = insert_ignore(conn, ai_usage, {**row, "id": "u2"},
                              ["workspace_id", "month", "request_class"])

    assert (first, again) == (True, False)
