"""Pool sizing, spend ceilings and the GPU fallback (ADR-0396 SC-0396-03, -04, -05).

`selecta.work.autoscale.decide` sizes each pool from outstanding work, within min/max and the
daily spend ceiling, and raises an alert when either holds it back. The pool settings are code in
`infra/workers/pools.json`, parsed here. The staging checks (a real pool with a low ceiling, a
Modal GPU outage) are separate and still to run.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st
from test_cloud_jobs_support import make_store

from selecta.persistence import transaction
from selecta.work import autoscale, catalogue
from selecta.work.autoscale import Launch, PoolConfig, PoolState
from selecta.work.enqueue import JobSpec

POOLS_FILE = Path(__file__).resolve().parents[1] / "infra" / "workers" / "pools.json"

CPU = Launch("modal", cpu=4, memory_mb=8192, cost_per_hour_usd=1.0)
T4 = Launch("modal", cpu=4, memory_mb=16384, cost_per_hour_usd=2.0, gpu="T4")
CPU_FALLBACK = Launch("modal", cpu=8, memory_mb=16384, cost_per_hour_usd=1.0, speed_factor=0.25)


def pool(**changes) -> PoolConfig:
    base = PoolConfig(
        name="cpu-heavy", min_workers=0, max_workers=32, slots_per_worker=1,
        target_drain_s=100.0, p95_wait_target_s=60.0, daily_spend_ceiling_usd=1_000.0,
        primary=CPU,
    )
    return replace(base, **changes)


def state(**changes) -> PoolState:
    base = PoolState(outstanding_work_s=0.0, p95_wait_s=0.0, running_workers=0,
                     spend_today_usd=0.0)
    return replace(base, **changes)


def test_the_pools_file_parses_and_names_every_pool_the_catalogue_uses():
    pools = autoscale.load_pools(POOLS_FILE)
    used = {job.pool for job in catalogue.CATALOGUE.values()} - {catalogue.INTERNAL}
    assert used <= set(pools)
    for config in pools.values():
        assert 0 <= config.min_workers <= config.max_workers
        assert config.daily_spend_ceiling_usd > 0 and config.primary.cost_per_hour_usd > 0
    gpu = pools[catalogue.GPU]
    assert gpu.primary.gpu and gpu.fallback is not None and gpu.fallback.gpu is None
    assert gpu.warm_while_listening and pools[catalogue.CPU_HEAVY].warm_while_listening


def test_bad_pool_settings_are_refused():
    data = json.loads(POOLS_FILE.read_text("utf-8"))
    data["pools"]["gpu"]["max_workers"] = -1
    with pytest.raises(ValueError, match="max_workers is below min_workers"):
        autoscale.parse_pools(data)


def test_workers_follow_outstanding_work_over_the_drain_time():
    assert autoscale.decide(pool(), state()).workers == 0
    assert autoscale.decide(pool(), state(outstanding_work_s=1)).workers == 1
    assert autoscale.decide(pool(), state(outstanding_work_s=1_000)).workers == 10
    two_slots = pool(slots_per_worker=2)
    assert autoscale.decide(two_slots, state(outstanding_work_s=1_000)).workers == 5


def test_a_slow_queue_adds_a_worker_even_when_the_estimate_says_enough():
    slow = state(outstanding_work_s=100, p95_wait_s=120, running_workers=3)
    assert autoscale.decide(pool(), slow).workers == 4


def test_a_warm_worker_stays_only_while_someone_is_listening():
    warm = pool(warm_while_listening=True)
    assert autoscale.decide(warm, state(listening=True)).workers == 1
    assert autoscale.decide(warm, state(listening=False)).workers == 0
    assert autoscale.decide(pool(), state(listening=True)).workers == 0


def test_max_workers_holds_and_alerts():
    decision = autoscale.decide(pool(max_workers=4), state(outstanding_work_s=10_000))
    assert (decision.workers, decision.wanted) == (4, 100)
    assert [alert.kind for alert in decision.alerts] == [autoscale.ALERT_MAX]


def test_a_pool_stops_scaling_at_its_spend_ceiling_and_alerts():
    low = pool(daily_spend_ceiling_usd=5.0)
    decision = autoscale.decide(low, state(outstanding_work_s=1_000, spend_today_usd=2.0))
    assert decision.workers == 3, "three more worker-hours at $1 fit in the $3 left"
    assert [alert.kind for alert in decision.alerts] == [autoscale.ALERT_SPEND]
    spent = autoscale.decide(low, state(outstanding_work_s=1_000, spend_today_usd=5.0))
    assert spent.workers == 0 and "daily ceiling" in spent.alerts[-1].message


def test_the_ceiling_beats_the_warm_worker_and_min_workers():
    config = pool(daily_spend_ceiling_usd=1.0, min_workers=2, warm_while_listening=True)
    decision = autoscale.decide(config, state(listening=True, spend_today_usd=1.0))
    assert decision.workers == 0
    assert autoscale.ALERT_SPEND in {alert.kind for alert in decision.alerts}


def test_no_gpu_capacity_falls_back_to_cpu_workers_and_says_so():
    gpu = pool(name="gpu", primary=T4, fallback=CPU_FALLBACK)
    normal = autoscale.decide(gpu, state(outstanding_work_s=400))
    assert (normal.launch, normal.workers, normal.alerts) == (T4, 4, ())
    fallback = autoscale.decide(gpu, state(outstanding_work_s=400, primary_capacity=False))
    assert fallback.launch == CPU_FALLBACK and fallback.launch.gpu is None
    assert fallback.workers == 16, "four times slower, so four times the workers"
    assert [alert.kind for alert in fallback.alerts] == [autoscale.ALERT_FALLBACK]


def test_a_pool_without_a_fallback_keeps_its_primary_launch():
    decision = autoscale.decide(pool(), state(outstanding_work_s=100, primary_capacity=False))
    assert decision.launch == CPU and decision.alerts == ()


@given(
    work=st.floats(0, 1e7), extra=st.floats(0, 1e7), spend=st.floats(0, 2_000),
    ceiling=st.floats(0.5, 2_000), maximum=st.integers(0, 64), listening=st.booleans(),
)
def test_workers_never_pass_max_or_the_ceiling_and_rise_with_work(
    work, extra, spend, ceiling, maximum, listening
):
    config = pool(max_workers=maximum, daily_spend_ceiling_usd=ceiling, warm_while_listening=True)
    less = autoscale.decide(config, state(outstanding_work_s=work, spend_today_usd=spend,
                                          listening=listening))
    more = autoscale.decide(config, state(outstanding_work_s=work + extra,
                                          spend_today_usd=spend, listening=listening))
    for decision in (less, more):
        assert 0 <= decision.workers <= maximum
        assert decision.workers <= autoscale.affordable(config, CPU, spend)
        if decision.workers < decision.wanted:
            assert decision.alerts, "holding a pool back always alerts"
    assert more.workers >= less.workers


def test_outstanding_work_is_summed_per_pool_from_the_jobs_table(cloud_engine):
    store = make_store(cloud_engine)
    store.enqueue(JobSpec("w1", "analyse.song", idempotency_key="a", est_cost_s=40.0))
    store.enqueue(JobSpec("w2", "analyse.song", idempotency_key="b", est_cost_s=20.0))
    store.enqueue(JobSpec("w1", "play.proxy", idempotency_key="c", est_cost_s=6.0))
    with transaction(cloud_engine) as connection:
        found = autoscale.outstanding_work_seconds(connection)
    assert found == {catalogue.CPU_HEAVY: 60.0, catalogue.CPU_LIGHT: 6.0}
