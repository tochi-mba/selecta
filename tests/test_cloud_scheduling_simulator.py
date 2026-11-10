"""The scheduling simulator (docs/saas/18-test-plan.md §18.6 "Simulator", §4A.12, SC-0395)."""

from __future__ import annotations

import os
import time
from dataclasses import replace

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from test_cloud_jobs_support import UNLIMITED

from selecta.scheduling import simulator
from selecta.scheduling.policy import PolicyConfig
from selecta.scheduling.simulator import (
    AccountSpec,
    Demand,
    InvariantViolation,
    PlanChange,
    Scenario,
    Simulation,
    WaitStats,
    compare,
    fair_shares,
    simulate,
)

NO_CAPS = PolicyConfig(lane_caps={tier: UNLIMITED for tier in ("free", "standard", "premium")})
HOUR = 3_600.0
NIGHTLY = os.environ.get("HYPOTHESIS_PROFILE") == "nightly"


def saturated(workspace_id: str, tier: str, lane: str = "standard", depth: int = 3,
              cost: float = 60.0) -> AccountSpec:
    return AccountSpec(workspace_id, tier, (Demand(lane=lane, backlog=depth, est_cost_s=cost),))


def mixed(seed: int = 0, accounts: int = 12, **values) -> Scenario:
    """Every kind of event: all three lanes, deadlines, noise, crashes, cancels, plan changes."""
    tiers = ("free", "standard", "premium")
    specs = tuple(
        AccountSpec(
            f"w{i:02d}",
            tiers[i % 3],
            (
                Demand(lane="standard", backlog=2, est_cost_s=30.0, stop_s=2 * HOUR),
                Demand(lane="standard", rate_per_s=0.004, est_cost_s=45.0),
                Demand(lane="interactive", rate_per_s=0.004, est_cost_s=20.0, needed_in_s=40.0),
                Demand(lane="speculative", backlog=1, est_cost_s=90.0),
            ),
            suspended=i == accounts - 1,
        )
        for i in range(accounts)
    )
    values.setdefault("slots", 8)
    values.setdefault("duration_s", 3 * HOUR)
    return Scenario(
        specs,
        seed=seed,
        cost_noise=0.4,
        crash_rate=0.03,
        cancel_rate=0.05,
        plan_changes=(PlanChange(HOUR, "w00", "premium"), PlanChange(2 * HOUR, "w02", "free")),
        **values,
    )


def share(report, prefix: str) -> float:
    total = sum(report.service_s.values())
    return sum(s for key, s in report.service_s.items() if key.startswith(prefix)) / total


# --- Worked examples (§4A.4) --------------------------------------------------------------------


def test_one_premium_and_one_free_on_twenty_slots_split_about_seventeen_to_three():
    scenario = Scenario(
        (saturated("premium", "premium", depth=25), saturated("free", "free", depth=25)),
        slots=20, duration_s=4 * HOUR, config=NO_CAPS,
    )
    report = simulate(scenario)
    assert share(report, "premium") * 20 == pytest.approx(6 / 7 * 20, abs=0.3)
    assert share(report, "free") * 20 == pytest.approx(1 / 7 * 20, abs=0.3)
    assert report.share_error <= 0.15


def test_ten_premium_and_a_thousand_free_give_premium_six_percent_and_six_times_each():
    accounts = tuple(saturated(f"p{i}", "premium", depth=2) for i in range(10)) + tuple(
        saturated(f"f{i:04d}", "free", depth=2) for i in range(1_000)
    )
    report = simulate(Scenario(accounts, slots=20, duration_s=20 * HOUR, config=NO_CAPS))
    premium = [s for key, s in report.service_s.items() if key.startswith("p")]
    free = [s for key, s in report.service_s.items() if key.startswith("f")]
    assert len(free) == 1_000, "every Free account still moves"
    assert share(report, "p") == pytest.approx(60 / 1_060, abs=0.003)
    assert (sum(premium) / 10) / (sum(free) / 1_000) == pytest.approx(6.0, rel=0.05)
    assert max(free) - min(free) <= 60.0 + 1e-6, "Free accounts stay within one job of each other"


# --- Determinism and thresholds -----------------------------------------------------------------


def test_the_same_seed_gives_the_same_report():
    first = simulate(mixed(seed=11))
    again = simulate(mixed(seed=11))
    other = simulate(mixed(seed=12))
    assert first == again
    assert first.decisions > 1_000
    assert first.crashes > 0 and first.preemptions > 0 and first.boosts > 0
    assert first.finished.get("cancelled", 0) > 0
    assert other != first


def saturation(seed: int, hours: float = 3.0) -> Scenario:
    accounts = tuple(
        saturated(f"{tier}-{i}", tier, depth=4)
        for tier in ("free", "standard", "premium")
        for i in range(2)
    )
    return Scenario(accounts, slots=30, duration_s=hours * HOUR, seed=seed, config=NO_CAPS,
                    cost_noise=0.25)


@pytest.mark.parametrize("seed", [1, 2, 3, 4])
def test_different_seeds_still_keep_share_error_within_fifteen_percent(seed):
    report = simulate(saturation(seed))
    assert 0 < report.share_error <= 0.15
    assert report.max_wait_ratio <= 1.0


def test_saturation_with_default_caps_shares_the_pool_by_capped_fair_share():
    accounts = tuple(saturated(f"{t}-{i}", t, depth=6) for t in ("free", "premium")
                     for i in range(4))
    report = simulate(Scenario(accounts, slots=12, duration_s=2 * HOUR, cost_noise=0.2))
    assert report.share_error <= 0.15
    assert report.max_wait_ratio <= 1.0


def test_no_backlogged_account_waits_beyond_its_bound_through_72_hours_of_premium_demand():
    hog = AccountSpec("premium-hog", "premium", (Demand(backlog=40, est_cost_s=300.0),))
    visitors = tuple(
        AccountSpec(f"free-{i}", "free", (Demand(rate_per_s=1 / 1_800, est_cost_s=120.0),))
        for i in range(30)
    )
    report = simulate(
        Scenario((hog, *visitors), slots=20, duration_s=72 * HOUR, config=NO_CAPS, seed=5)
    )
    assert report.simulated_s == 72 * HOUR
    assert report.max_wait_ratio <= 1.0
    assert report.waits_by_tier["free"].max <= 300.0
    assert report.waits_by_tier["free"].count > 3_000
    assert share(report, "premium") > 0.85


def test_interactive_gets_about_four_fifths_of_compute_when_both_lanes_are_backlogged():
    accounts = tuple(
        AccountSpec(f"w{i}", "premium", (Demand(lane="interactive", backlog=3, est_cost_s=20.0),
                                         Demand(lane="standard", backlog=3, est_cost_s=60.0)))
        for i in range(4)
    )
    report = simulate(Scenario(accounts, slots=10, duration_s=3 * HOUR, config=NO_CAPS))
    assert len(report.lane_shares) >= 15
    assert all(0.75 <= value <= 0.85 for value in report.lane_shares)
    assert report.lane_service_s["standard"] > 0


def test_speculative_work_uses_only_spare_slots_and_never_the_headroom():
    accounts = (
        AccountSpec("w1", "premium", (Demand(lane="speculative", backlog=30, est_cost_s=60.0),)),
        AccountSpec("w2", "premium", (Demand(lane="interactive", rate_per_s=0.02,
                                             est_cost_s=30.0),)),
    )
    report = simulate(Scenario(accounts, slots=10, duration_s=2 * HOUR, config=NO_CAPS,
                               check_every=1))
    assert report.lane_service_s["speculative"] > 0
    assert report.waits_by_account["w2"].count > 100
    assert report.waits_by_account["w2"].p50 == 0.0, "the headroom slot is usually free for it"
    assert report.waits_by_account["w2"].max <= 1.0 + 1e-9, "or speculative work gives way"


def test_a_one_slot_pool_runs_speculative_work_when_idle_and_gives_way_to_other_work():
    accounts = (
        AccountSpec("w1", "free", (Demand(lane="speculative", backlog=1, est_cost_s=600.0),)),
        AccountSpec("w2", "free", (Demand(lane="standard", rate_per_s=1 / 900, est_cost_s=30.0),)),
    )
    report = simulate(Scenario(accounts, slots=1, duration_s=6 * HOUR, check_every=1))
    assert report.lane_service_s["speculative"] > report.lane_service_s["standard"] > 0
    assert report.preemptions > 0
    assert report.waits_by_account["w2"].max <= 1.0 + 1e-9, "standard waits only for a check-in"


def test_deadline_boosts_are_limited_to_three_per_account_per_ten_minutes():
    accounts = tuple(
        AccountSpec(f"w{i}", "premium", (
            Demand(lane="interactive", rate_per_s=0.05, est_cost_s=20.0, needed_in_s=25.0),
            Demand(lane="interactive", backlog=3, est_cost_s=20.0),
        ))
        for i in range(3)
    )
    report = simulate(Scenario(accounts, slots=4, duration_s=HOUR, config=NO_CAPS))
    assert report.boosts > 0
    assert report.boosts <= 3 * 3 * 6


def test_a_suspended_account_is_never_served():
    accounts = (saturated("ok", "free"), replace(saturated("held", "premium"), suspended=True))
    report = simulate(Scenario(accounts, slots=4, duration_s=HOUR))
    assert "held" not in report.service_s
    assert report.service_s["ok"] > 0


def test_a_plan_upgrade_speeds_up_work_that_is_already_queued():
    accounts = (saturated("a", "free", depth=10), saturated("b", "free", depth=10))
    upgrade = (PlanChange(HOUR, "a", "premium"),)
    scenario = Scenario(accounts, slots=4, duration_s=2 * HOUR, config=NO_CAPS,
                        plan_changes=upgrade, check_every=7)
    report = simulate(scenario)
    before = simulate(replace(scenario, plan_changes=()))
    # Half the run at 1:1 and half at 6:1 gives about (1/2 + 6/7) / (1/2 + 1/2) = 1.36 times.
    assert report.service_s["a"] / before.service_s["a"] == pytest.approx(1.36, abs=0.05)


def test_workers_that_keep_dying_quarantine_the_job():
    report = simulate(Scenario((saturated("w", "free", depth=1, cost=10.0),), slots=2,
                               duration_s=HOUR, crash_rate=1.0, check_every=1))
    assert report.crashes >= 3
    assert set(report.finished) == {"quarantined"}


def test_a_policy_change_is_forecast_against_the_same_workload_before_it_is_applied():
    scenario = Scenario((saturated("p", "premium"), saturated("f", "free")), slots=4,
                        duration_s=HOUR, config=NO_CAPS)
    heavier = NO_CAPS.evolve(tier_weights={"free": 1.0, "standard": 3.0, "premium": 12.0})
    now, then = compare(scenario, heavier)
    assert share(then, "p") > share(now, "p")
    assert now == simulate(scenario)


# --- Invariants after every event ---------------------------------------------------------------


@settings(max_examples=12, deadline=None)
@given(
    seed=st.integers(min_value=0, max_value=10_000),
    slots=st.integers(min_value=1, max_value=6),
    accounts=st.integers(min_value=2, max_value=6),
)
def test_invariants_hold_after_every_event_in_long_random_scenarios(seed, slots, accounts):
    report = simulate(mixed(seed=seed, accounts=accounts, slots=slots, duration_s=2 * HOUR,
                            check_every=1))
    assert report.invariant_checks == report.events
    assert report.created == sum(report.finished.values()) + report.unfinished


def finished_simulation() -> Simulation:
    simulation = Simulation(Scenario((saturated("a", "free"), saturated("b", "premium")),
                                     slots=2, duration_s=600.0))
    simulation.run()
    simulation.full_check()
    return simulation


def test_the_full_check_catches_a_lost_job():
    simulation = finished_simulation()
    simulation.created += 1
    with pytest.raises(InvariantViolation, match="lost"):
        simulation.full_check()


def test_the_full_check_catches_drifted_state_counts_heads_and_lanes():
    simulation = finished_simulation()
    simulation.states["queued"] -= 1
    simulation.states["succeeded"] += 1
    with pytest.raises(InvariantViolation, match="State counts"):
        simulation.full_check()

    simulation = finished_simulation()
    next(iter(simulation.heads.values())).queued += 1
    with pytest.raises(InvariantViolation, match="head"):
        simulation.full_check()

    simulation = finished_simulation()
    simulation.lane_backlogged["standard"] += 1
    with pytest.raises(InvariantViolation, match="backlog count"):
        simulation.full_check()


def test_the_full_check_catches_a_running_job_without_an_attempt_and_the_reverse():
    simulation = finished_simulation()
    running = next(job for job in simulation.jobs.values() if job.state == "running")
    running.attempt = None
    with pytest.raises(InvariantViolation, match="no live attempt"):
        simulation.full_check()

    simulation = finished_simulation()
    queued = next(job for job in simulation.jobs.values() if job.state == "queued")
    queued.attempt = next(iter(simulation.live.values()))
    with pytest.raises(InvariantViolation, match="holds an attempt"):
        simulation.full_check()


def test_dispatch_refuses_to_break_caps_leases_slots_or_headroom():
    simulation = finished_simulation()
    head = next(h for h in simulation.heads.values() if h.queued)
    head.running = 10_000
    with pytest.raises(InvariantViolation, match="cap"):
        simulation._start(head)

    simulation = finished_simulation()
    head = next(h for h in simulation.heads.values() if h.queued)
    job = next(j for j in simulation.jobs.values() if j.state == "queued"
               and j.workspace_id == head.workspace_id)
    job.attempt = next(iter(simulation.live.values()))
    with pytest.raises(InvariantViolation, match="leased twice"):
        simulation._start(head, job)

    simulation = finished_simulation()
    head = next(h for h in simulation.heads.values() if h.queued)
    with pytest.raises(InvariantViolation, match="slots"):
        simulation._start(head)

    simulation = finished_simulation()
    head = next(h for h in simulation.heads.values() if h.queued)
    head.lane = "speculative"
    with pytest.raises(InvariantViolation, match="Speculative"):
        simulation._start(head)

    simulation = finished_simulation()
    simulation.busy += 1
    with pytest.raises(InvariantViolation, match="slots busy"):
        simulation._check()


# --- Pieces -------------------------------------------------------------------------------------


def test_fair_shares_give_a_capped_account_its_cap_and_share_the_rest_by_weight():
    shares = fair_shares(100.0, [("a", 1.0, 1_000.0), ("b", 1.0, 10.0), ("c", 2.0, 1_000.0)])
    assert shares == pytest.approx({"a": 30.0, "b": 10.0, "c": 60.0})
    assert fair_shares(0.0, [("a", 1.0, 5.0)]) == {"a": 0.0}


def test_wait_statistics_use_nearest_rank_percentiles():
    stats = WaitStats.of([float(v) for v in range(1, 101)])
    assert (stats.count, stats.p50, stats.p95, stats.p99, stats.max) == (100, 50, 95, 99, 100)
    assert WaitStats.of([]) == WaitStats(0, 0.0, 0.0, 0.0, 0.0)


def test_a_scenario_needs_slots_and_distinct_accounts():
    with pytest.raises(ValueError, match="slot"):
        Simulation(Scenario((saturated("a", "free"),), slots=0))
    with pytest.raises(ValueError, match="own workspace id"):
        Simulation(Scenario((saturated("a", "free"), saturated("a", "premium"))))


def test_streams_start_and_stop_when_they_say():
    accounts = (AccountSpec("w", "free", (
        Demand(backlog=2, est_cost_s=60.0, start_s=600.0, stop_s=1_200.0),
        Demand(rate_per_s=0.01, est_cost_s=10.0, start_s=0.0, stop_s=300.0),
    )),)
    report = simulate(Scenario(accounts, slots=1, duration_s=HOUR, check_every=1))
    assert report.unfinished == 0
    assert report.created < 20


# --- Speed --------------------------------------------------------------------------------------


def machine_factor() -> float:
    """How much slower this machine is than the CI runner the budgets were set for (at least 1).

    A busy laptop can be several times slower than CI, so the budgets scale with a fixed loop.
    """
    started = time.perf_counter()
    total = 0
    for value in range(2_000_000):
        total += value
    return max(1.0, (time.perf_counter() - started) / 0.12)


def decisions_scenario(decisions: int) -> Scenario:
    accounts = tuple(saturated(f"w{i:02d}", ("free", "standard", "premium")[i % 3], depth=3,
                               cost=30.0) for i in range(60))
    return Scenario(accounts, slots=50, duration_s=10.0**9, max_decisions=decisions,
                    cost_noise=0.2)


def test_one_hundred_thousand_decisions_take_under_ten_seconds():
    budget = 10.0 * machine_factor()
    started = time.perf_counter()
    report = simulate(decisions_scenario(100_000))
    elapsed = time.perf_counter() - started
    assert report.decisions >= 100_000
    assert elapsed < budget, f"{elapsed:.1f} s against a budget of {budget:.1f} s"


@pytest.mark.skipif(not NIGHTLY, reason="the million-decision run is nightly")
def test_one_million_decisions_take_under_sixty_seconds():
    budget = 60.0 * machine_factor()
    started = time.perf_counter()
    report = simulate(decisions_scenario(1_000_000))
    assert report.decisions >= 1_000_000
    assert time.perf_counter() - started < budget


def test_the_module_exports_its_public_names():
    assert set(simulator.__all__) <= set(dir(simulator))
