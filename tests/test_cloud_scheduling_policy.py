"""The scheduling policy as pure functions (docs/saas/18-test-plan.md §18.6, SC-0395).

The database claim and the simulator both call these functions, so what holds here holds for
real workers. Store-level versions of the same rules live in `test_cloud_jobs_claim.py`.
"""

from __future__ import annotations

import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from selecta.scheduling import policy
from selecta.scheduling.policy import (
    Candidate,
    EligibilityContext,
    Ineligible,
    Lane,
    PolicyConfig,
    RunningAttempt,
    WorkerCaps,
)

CONFIG = PolicyConfig()


# --- Fair share ---------------------------------------------------------------------------------


def test_becoming_backlogged_lifts_v_to_the_lane_floor_so_idle_time_banks_no_credit():
    assert policy.backlogged_vtime(2.0, 10.0) == 10.0
    assert policy.backlogged_vtime(15.0, 10.0) == 15.0
    assert policy.backlogged_vtime(4.0, None) == 4.0


def test_the_lane_floor_is_the_smallest_backlogged_v_or_the_lane_own_floor_when_none_wait():
    assert policy.lane_floor([7.0, 3.0, 9.0], fallback=100.0) == 3.0
    assert policy.lane_floor([], fallback=100.0) == 100.0


def test_dispatch_charges_the_estimate_divided_by_the_account_weight():
    assert policy.charge(2.0, est_cost_s=30.0, weight=3.0) == 12.0
    assert policy.charge(2.0, est_cost_s=-5.0, weight=3.0) == 2.0
    assert policy.charge(0.0, est_cost_s=1.0, weight=0.0) == pytest.approx(1e9)


def test_a_low_estimate_is_corrected_upwards_and_a_high_one_downwards():
    assert policy.corrected(10.0, est_cost_s=30.0, actual_cost_s=60.0, weight=3.0,
                            clamp_s=600.0) == 20.0
    assert policy.corrected(10.0, est_cost_s=60.0, actual_cost_s=30.0, weight=3.0,
                            clamp_s=600.0) == 0.0


def test_the_correction_is_clamped_so_one_hung_job_cannot_swing_v_too_far():
    assert policy.correction(10.0, 10_000.0, clamp_s=600.0) == 600.0
    assert policy.correction(10_000.0, 10.0, clamp_s=600.0) == -600.0
    assert policy.corrected(0.0, 10.0, 10_000.0, weight=6.0, clamp_s=600.0) == 100.0


def test_ties_in_v_go_to_the_account_that_has_waited_longest():
    heads = [
        policy.head_key(5.0, 300.0, "b"),
        policy.head_key(5.0, 100.0, "c"),
        policy.head_key(5.0, None, "a"),
        policy.head_key(4.0, 900.0, "z"),
    ]
    assert [key[2] for key in sorted(heads)] == ["z", "c", "b", "a"]
    assert sorted([policy.head_key(1.0, 5.0, "y"), policy.head_key(1.0, 5.0, "x")])[0][2] == "x"


def sfq(weights: list[float], dispatches: int, cost: float = 60.0) -> list[int]:
    """Serve equal-cost jobs to always-backlogged accounts by the policy's own functions."""
    vtimes = [0.0] * len(weights)
    waiting = [0.0] * len(weights)
    served = [0] * len(weights)
    for moment in range(1, dispatches + 1):
        chosen = min(
            range(len(weights)), key=lambda i: policy.head_key(vtimes[i], waiting[i], f"{i:04d}")
        )
        vtimes[chosen] = policy.charge(vtimes[chosen], cost, weights[chosen])
        waiting[chosen] = float(moment)
        served[chosen] += 1
    return served


@given(
    weights=st.lists(st.sampled_from([1.0, 3.0, 6.0, 2.0, 0.5]), min_size=2, max_size=12),
    dispatches=st.integers(min_value=50, max_value=600),
)
def test_every_backlogged_account_is_served_within_one_job_divided_by_its_weight(
    weights, dispatches
):
    cost = 60.0
    served = sfq(weights, dispatches, cost)
    assert sum(served) == dispatches
    normalised = [count * cost / weight for count, weight in zip(served, weights, strict=True)]
    for i, weight_i in enumerate(weights):
        for j, weight_j in enumerate(weights):
            bound = max(cost / weight_i, cost / weight_j) + 1e-6
            assert abs(normalised[i] - normalised[j]) <= bound


def test_shares_follow_weights_with_free_standard_and_premium_backlogged():
    served = sfq([1.0, 3.0, 6.0], 1_000)
    assert served == pytest.approx([100, 300, 600], abs=1)


# --- Lanes and headroom -------------------------------------------------------------------------


def test_lanes_compete_by_lane_virtual_time_with_ties_to_interactive():
    both = {Lane.INTERACTIVE, Lane.STANDARD}
    assert policy.choose_lanes({"interactive": 5.0, "standard": 1.0}, both, False) == [
        Lane.STANDARD, Lane.INTERACTIVE
    ]
    assert policy.choose_lanes({"interactive": 1.0, "standard": 1.0}, both, False) == [
        Lane.INTERACTIVE, Lane.STANDARD
    ]
    assert policy.choose_lanes({}, {"standard"}, False) == [Lane.STANDARD]


def test_interactive_gets_about_four_fifths_and_standard_is_never_starved():
    vtimes = {"interactive": 0.0, "standard": 0.0}
    served = {"interactive": 0, "standard": 0}
    for _ in range(1_000):
        lane = policy.choose_lanes(vtimes, {"interactive", "standard"}, False)[0]
        vtimes[lane] = policy.charge(vtimes[lane], 30.0, CONFIG.lane_weight(lane))
        served[lane] += 1
    assert served["interactive"] / 1_000 == pytest.approx(0.8, abs=0.01)
    assert served["standard"] >= 199


def test_speculative_comes_last_and_only_when_headroom_allows():
    everything = {"interactive", "standard", "speculative"}
    assert policy.choose_lanes({}, everything, True)[-1] == Lane.SPECULATIVE
    assert Lane.SPECULATIVE not in policy.choose_lanes({}, everything, False)
    assert policy.choose_lanes({}, {"speculative"}, True) == [Lane.SPECULATIVE]
    assert policy.choose_lanes({}, {"speculative"}, False) == []


def test_a_one_slot_pool_runs_speculative_work_whenever_it_is_idle():
    assert CONFIG.speculative_headroom(1) == 0
    assert policy.speculative_allowed(slots=1, busy=0, config=CONFIG) is True
    assert policy.speculative_allowed(slots=1, busy=1, config=CONFIG) is False


@pytest.mark.parametrize(
    ("slots", "headroom"), [(2, 1), (5, 1), (10, 1), (11, 2), (20, 2), (25, 3), (100, 10)]
)
def test_pools_of_two_or_more_keep_one_slot_or_a_tenth_free_of_speculative_work(slots, headroom):
    assert CONFIG.speculative_headroom(slots) == headroom
    assert policy.speculative_allowed(slots, busy=slots - headroom - 1, config=CONFIG) is True
    assert policy.speculative_allowed(slots, busy=slots - headroom, config=CONFIG) is False


def attempt(attempt_id: str, lane: str, started_at: float, asked: bool = False):
    return RunningAttempt(attempt_id, lane, started_at, asked)


def preempt(running, slots: int, free_slots: int = 0, interactive: bool = True):
    return policy.choose_preemption(
        running, slots=slots, free_slots=free_slots, interactive_waiting=interactive
    )


def test_preemption_picks_the_youngest_speculative_attempt_for_waiting_interactive_work():
    running = [
        attempt("a1", "speculative", 10.0),
        attempt("a2", "speculative", 30.0),
        attempt("a3", "interactive", 50.0),
        attempt("a4", "standard", 60.0),
        attempt("a5", "speculative", 40.0, asked=True),
    ]
    chosen = policy.choose_preemption(running, slots=5, free_slots=0, interactive_waiting=True)
    assert chosen == "a2"


def test_interactive_and_standard_work_are_never_preempted():
    running = [attempt("a3", "interactive", 50.0), attempt("a4", "standard", 60.0)]
    assert preempt(running, slots=2) is None


def test_nothing_is_preempted_with_a_free_slot_or_nothing_waiting():
    running = [attempt("a1", "speculative", 10.0)]
    assert preempt(running, slots=4, free_slots=1) is None
    assert preempt(running, slots=4, interactive=False) is None


def test_waiting_standard_work_preempts_only_in_a_one_slot_pool():
    running = [attempt("a1", "speculative", 10.0)]
    assert policy.choose_preemption(
        running, slots=1, free_slots=0, interactive_waiting=False, standard_waiting=True
    ) == "a1"
    assert policy.choose_preemption(
        running, slots=3, free_slots=0, interactive_waiting=False, standard_waiting=True
    ) is None


def test_an_attempt_already_asked_to_stop_is_not_asked_again():
    running = [attempt("a1", "speculative", 10.0, asked=True)]
    assert preempt(running, slots=1) is None


# --- Ordering and eligibility ------------------------------------------------------------------


def test_in_account_order_is_urgency_then_deadline_then_line_position_then_age():
    jobs = {
        "late-urgent": policy.job_key(0, None, None, 50.0),
        "deadline-soon": policy.job_key(1, 100.0, 9, 40.0),
        "deadline-later": policy.job_key(1, 200.0, 1, 30.0),
        "no-deadline-line-1": policy.job_key(1, None, 1, 20.0),
        "no-deadline-line-2": policy.job_key(1, None, 2, 10.0),
        "no-line-old": policy.job_key(1, None, None, 0.0),
        "no-line-young": policy.job_key(1, None, None, 5.0),
        "less-urgent": policy.job_key(2, 1.0, 0, 0.0),
    }
    assert sorted(jobs, key=jobs.get) == [
        "late-urgent",
        "deadline-soon",
        "deadline-later",
        "no-deadline-line-1",
        "no-deadline-line-2",
        "no-line-old",
        "no-line-young",
        "less-urgent",
    ]


WORKER = WorkerCaps(pool="gpu", engine_version=4, gpu_memory_mb=8_000, scratch_mb=10_000,
                    worker_class=1, job_types=frozenset({"stems.window"}))
OPEN = EligibilityContext(now=100.0, running=0, cap=2)


def test_a_job_that_passes_every_filter_is_eligible():
    candidate = Candidate("stems.window", not_before=100.0, engine_version_required=4,
                          gpu_memory_mb=8_000, scratch_mb=10_000, min_worker_class=1)
    assert policy.why_ineligible(candidate, WORKER, OPEN) is None
    assert policy.is_eligible(candidate, WORKER, OPEN) is True


@pytest.mark.parametrize(
    ("candidate", "caps", "context", "reason"),
    [
        (Candidate("stems.window", deps_satisfied=False), WORKER, OPEN, Ineligible.DEPENDENCIES),
        (Candidate("stems.window", not_before=100.5), WORKER, OPEN, Ineligible.NOT_YET),
        (Candidate("stems.window"), WORKER, EligibilityContext(100.0, 2, 2), Ineligible.AT_CAP),
        (Candidate("stems.window", engine_version_required=5), WORKER, OPEN, Ineligible.ENGINE),
        (
            Candidate("stems.window", engine_version_required=1),
            WorkerCaps(pool="gpu", gpu_memory_mb=8_000),
            OPEN,
            Ineligible.ENGINE,
        ),
        (Candidate("stems.window", gpu_memory_mb=8_001), WORKER, OPEN, Ineligible.GPU),
        (Candidate("stems.window", scratch_mb=10_001), WORKER, OPEN, Ineligible.SCRATCH),
        (Candidate("stems.window", min_worker_class=2), WORKER, OPEN, Ineligible.WORKER_CLASS),
        (Candidate("analyse.song"), WORKER, OPEN, Ineligible.JOB_TYPE),
        (
            Candidate("stems.window"),
            WORKER,
            EligibilityContext(100.0, 0, 2, entitled=False),
            Ineligible.NOT_ENTITLED,
        ),
        (
            Candidate("stems.window"),
            WORKER,
            EligibilityContext(100.0, 0, 2, flag_on=False),
            Ineligible.FLAG_OFF,
        ),
        (
            Candidate("stems.window"),
            WORKER,
            EligibilityContext(100.0, 0, 2, suspended=True),
            Ineligible.SUSPENDED,
        ),
        (
            Candidate("stems.window"),
            WORKER,
            EligibilityContext(100.0, 0, 2, pool_paused=True),
            Ineligible.POOL_PAUSED,
        ),
    ],
    ids=[
        "unmet-dependency", "not-before-in-future", "concurrency-cap", "engine-version",
        "worker-without-engine-version", "gpu-memory", "scratch-disk", "worker-class",
        "job-type", "entitlement", "flag-off", "suspended-account", "paused-pool",
    ],
)
def test_each_eligibility_filter_alone_blocks_a_job(candidate, caps, context, reason):
    assert policy.why_ineligible(candidate, caps, context) == reason
    assert policy.is_eligible(candidate, caps, context) is False


def test_a_worker_with_no_job_type_list_runs_every_type_in_its_pool():
    caps = WorkerCaps(pool="cpu-heavy")
    assert policy.why_ineligible(Candidate("analyse.song"), caps, OPEN) is None


def test_a_deadline_boost_triggers_only_once_slack_drops_under_one_and_a_half_estimates():
    # est 10 s: slack = needed_by - now - 10 must fall under 15 s.
    assert policy.slack(needed_by=40.0, est_cost_s=10.0, now=0.0) == 30.0
    assert policy.needs_boost(25.0, 10.0, now=0.0, config=CONFIG) is False
    assert policy.needs_boost(24.9, 10.0, now=0.0, config=CONFIG) is True
    assert policy.needs_boost(None, 10.0, now=0.0, config=CONFIG) is False


def test_the_boost_allowance_is_three_per_window():
    assert [policy.boost_allowed(used, CONFIG) for used in range(5)] == [
        True, True, True, False, False
    ]
    assert CONFIG.boost_window_s == 600.0


def test_priority_inheritance_lifts_lane_and_urgency_to_the_most_urgent_dependent():
    assert policy.inherited("standard", 4, [("interactive", 1), ("standard", 2)]) == (
        Lane.INTERACTIVE, 1
    )
    assert policy.inherited("interactive", 0, [("standard", 3)]) == (Lane.INTERACTIVE, 0)
    assert policy.inherited("speculative", 5, []) == (Lane.SPECULATIVE, 5)


@pytest.mark.parametrize(
    ("rank", "lane", "urgency"),
    [
        (policy.URGENT, Lane.INTERACTIVE, 0),
        (policy.REQUEST, Lane.INTERACTIVE, 1),
        (policy.MIX, Lane.STANDARD, 2),
        (policy.LINE, Lane.STANDARD, 3),
        (policy.LATER, Lane.STANDARD, 4),
        (policy.PREPARING, Lane.SPECULATIVE, 5),
    ],
)
def test_todays_seam_ranks_map_exactly_onto_lanes_and_urgency(rank, lane, urgency):
    assert policy.from_rank(rank) == (lane, urgency)


def test_an_unknown_rank_is_refused():
    with pytest.raises(ValueError, match="rank 6"):
        policy.from_rank(6)


def test_lane_rank_orders_interactive_standard_speculative():
    assert [policy.lane_rank(lane) for lane in ("interactive", "standard", "speculative")] == [
        0, 1, 2
    ]
    with pytest.raises(ValueError):
        policy.lane_rank("urgent")


# --- Config ------------------------------------------------------------------------------------


@pytest.mark.parametrize("bad", [0, 0.0, -1.0, math.inf, math.nan, "6"])
def test_zero_negative_or_non_numeric_weights_are_refused(bad):
    with pytest.raises(ValueError, match="tier_weights"):
        PolicyConfig(tier_weights={"free": 1.0, "standard": 3.0, "premium": bad})
    with pytest.raises(ValueError, match="lane_weights"):
        PolicyConfig(lane_weights={"interactive": bad, "standard": 1.0})


def test_every_other_unusable_value_is_named():
    with pytest.raises(ValueError, match="default plan"):
        PolicyConfig(default_tier="gold")
    with pytest.raises(ValueError, match="versions start at 1"):
        PolicyConfig(version=0)
    for name in ("head_batch", "job_batch", "claim_rounds", "materialise_page"):
        with pytest.raises(ValueError, match=name):
            PolicyConfig(**{name: 0})
    with pytest.raises(ValueError, match="heartbeat"):
        PolicyConfig(heartbeat_s=45.0, lease_s=45.0)
    with pytest.raises(ValueError, match="heartbeat"):
        PolicyConfig(heartbeat_s=0.0)
    assert PolicyConfig().problems() == []


def test_a_new_version_is_recorded_and_round_trips_through_plain_json():
    tuned = CONFIG.evolve(tier_weights={"free": 1.0, "standard": 3.0, "premium": 8.0},
                          paused_pools=frozenset({"gpu"}))
    assert tuned.version == CONFIG.version + 1
    assert tuned.weight("premium") == 8.0
    plain = tuned.to_dict()
    assert plain["version"] == 2
    assert plain["paused_pools"] == ["gpu"]
    assert plain["lane_caps"]["premium"]["standard"] == 4
    assert PolicyConfig.from_dict(plain) == tuned
    assert CONFIG.evolve(version=7).version == 7
    assert PolicyConfig.from_dict({"version": 3, "lease_s": 60.0}) == PolicyConfig(
        version=3, lease_s=60.0
    )
    with pytest.raises(TypeError):
        tuned.tier_weights["premium"] = 99.0


def test_unknown_plans_and_lanes_fall_back_to_safe_defaults():
    assert CONFIG.weight("enterprise") == CONFIG.weight("free") == 1.0
    assert CONFIG.weight(None) == 1.0
    assert CONFIG.lane_weight("speculative") == 1.0
    assert CONFIG.cap("enterprise", "standard") == 1
    assert CONFIG.cap("premium", "interactive") == 3
    assert CONFIG.cap("premium", "nonsense-lane") == 1
    assert CONFIG.speculative_budget_s("premium") == 240 * 60.0
    assert CONFIG.speculative_budget_s(None) == 10 * 60.0
    assert CONFIG.queued_cap("analyse.song") == 50_000
    assert CONFIG.queued_cap("lyrics.fetch") == 10_000


def test_a_pool_can_override_caps_for_some_plans_and_lanes():
    config = CONFIG.evolve(pool_cap_overrides={"gpu": {"premium": {"standard": 1}}})
    assert config.cap("premium", "standard", pool="gpu") == 1
    assert config.cap("premium", "interactive", pool="gpu") == 3
    assert config.cap("free", "standard", pool="gpu") == 1
    assert config.cap("premium", "standard", pool="cpu-heavy") == 4
