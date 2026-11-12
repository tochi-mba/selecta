"""The maintenance leader sizes the pools and tells the launcher (ADR-0396, SC-0396-03).

A fake launcher stands in for Modal: the tick reads the queue, live workers and listeners from the
database, decides with `autoscale.decide`, records alerts and scales. `ModalLauncher` is checked
with a fake Modal lookup: it does nothing unless an app and token are configured, scales
the function `MODAL_FUNCTIONS` names, and moves a GPU pool to its CPU fallback when the provider refuses GPUs.
Runs on SQLite and PostgreSQL.
"""

from __future__ import annotations

import pytest
from test_cloud_jobs_support import make_store

from selecta import maintain
from selecta.admin import alerts
from selecta.persistence import transaction
from selecta.playback.schema import playback_sessions
from selecta.work import autoscale, autoscale_leader
from selecta.work.autoscale import Launch, PoolConfig
from selecta.work.enqueue import JobSpec
from selecta.work.schema import workers

NOW = 1_800_000_000.0
CPU = Launch("modal", cpu=4, memory_mb=8192, cost_per_hour_usd=1.0)
T4 = Launch("modal", cpu=4, memory_mb=16384, cost_per_hour_usd=2.0, gpu="T4")
SLOW_CPU = Launch("modal", cpu=8, memory_mb=16384, cost_per_hour_usd=1.0, speed_factor=0.5)


def _pool(name: str, **values) -> PoolConfig:
    base = dict(
        min_workers=0,
        max_workers=4,
        slots_per_worker=1,
        target_drain_s=10.0,
        p95_wait_target_s=600.0,
        daily_spend_ceiling_usd=1_000.0,
        primary=CPU,
    )
    return PoolConfig(name=name, **{**base, **values})


POOLS = {
    "cpu-heavy": _pool("cpu-heavy", warm_while_listening=True),
    "gpu": _pool("gpu", primary=T4, fallback=SLOW_CPU),
}


class FakeLauncher:
    def __init__(self, gpus: bool = True):
        self.gpus = gpus
        self.scaled: list[tuple[str, int, bool]] = []

    def has_capacity(self, pool, launch):
        return self.gpus or not launch.gpu

    def scale(self, pool, workers, launch, *, fallback):
        self.scaled.append((pool, workers, fallback))


def _work(engine, job_type: str, seconds: float, n: int) -> None:
    store = make_store(engine)
    for i in range(n):
        store.enqueue(
            JobSpec("ws-a", job_type, idempotency_key=f"{job_type}-{i}", est_cost_s=seconds)
        )


def test_the_tick_sizes_each_pool_from_its_queue(cloud_engine):
    _work(cloud_engine, "analyse.song", 10.0, 3)
    _work(cloud_engine, "stems.window", 5.0, 2)
    launcher = FakeLauncher()
    decided = autoscale_leader.tick(cloud_engine, POOLS, launcher, autoscale_leader.SpendMeter())
    assert {(d.pool, d.workers) for d in decided} == {("cpu-heavy", 3), ("gpu", 1)}
    assert sorted(launcher.scaled) == [("cpu-heavy", 3, False), ("gpu", 1, False)]


def test_no_gpu_capacity_moves_the_gpu_pool_to_its_fallback_and_alerts(cloud_engine):
    _work(cloud_engine, "stems.window", 5.0, 2)
    launcher = FakeLauncher(gpus=False)
    decided = autoscale_leader.tick(cloud_engine, POOLS, launcher, autoscale_leader.SpendMeter())
    gpu = next(d for d in decided if d.pool == "gpu")
    assert gpu.launch == SLOW_CPU and gpu.workers == 2  # half speed needs twice the workers
    assert ("gpu", 2, True) in launcher.scaled
    with transaction(cloud_engine) as conn:
        [alert] = alerts.recent(conn, kind=f"autoscale.{autoscale.ALERT_FALLBACK}")
    assert "fallback" in alert.summary


def test_a_listener_keeps_one_warm_worker_and_live_workers_are_counted(cloud_engine):
    with transaction(cloud_engine, "ws-a") as conn:
        conn.execute(
            playback_sessions.insert().values(
                workspace_id="ws-a",
                state="playing",
                song_index=0,
                offset_ms=0,
                seq=0,
                updated_at=NOW,
            )
        )
    with transaction(cloud_engine) as conn:
        for n, seen in enumerate((NOW, NOW - 5, NOW - 3_600)):
            conn.execute(
                workers.insert().values(
                    id=f"w{n}",
                    pool="cpu-heavy",
                    capabilities={},
                    registered_at=NOW,
                    last_seen_at=seen,
                )
            )
        assert autoscale_leader.live_workers(conn, NOW) == {"cpu-heavy": 2}
        assert autoscale_leader.someone_listening(conn, NOW)
    launcher = FakeLauncher()
    autoscale_leader.tick(cloud_engine, POOLS, launcher, autoscale_leader.SpendMeter(), now=NOW)
    assert ("cpu-heavy", 1, False) in launcher.scaled


def test_the_spend_meter_charges_what_was_running_and_resets_each_day():
    meter = autoscale_leader.SpendMeter()
    assert meter.charge("gpu", NOW) == 0.0
    meter.set("gpu", NOW, 3, T4)
    assert meter.charge("gpu", NOW + 1_800) == pytest.approx(3.0)
    next_day = (NOW // 86_400 + 1) * 86_400 + 60
    meter.set("gpu", next_day - 60, 3, T4)
    assert meter.charge("gpu", next_day) == pytest.approx(0.1)


def test_the_spend_meter_never_charges_the_same_time_twice():
    # A failed scale skips `set`, so the next charge must still start where the last one ended.
    meter = autoscale_leader.SpendMeter()
    meter.set("gpu", NOW, 3, T4)
    assert meter.charge("gpu", NOW + 1_800) == pytest.approx(3.0)
    assert meter.charge("gpu", NOW + 3_600) == pytest.approx(6.0)


def test_one_pool_failing_to_scale_does_not_stop_the_others(cloud_engine, caplog):
    class Flaky(FakeLauncher):
        def scale(self, pool, workers, launch, *, fallback):
            if pool == "cpu-heavy":
                raise RuntimeError("provider down")
            super().scale(pool, workers, launch, fallback=fallback)

    launcher = Flaky()
    autoscale_leader.tick(cloud_engine, POOLS, launcher, autoscale_leader.SpendMeter())
    assert launcher.scaled == [("gpu", 0, False)]
    assert "Couldn't scale the cpu-heavy pool" in caplog.text


class FakeModal:
    def __init__(self, refuse: set[str] = frozenset()):
        self.calls: list[tuple[str, str, int]] = []
        self.refuse = refuse

    def __call__(self, app, name):
        modal = self

        class Function:
            def update_autoscaler(self, *, min_containers, max_containers):
                if name in modal.refuse:
                    raise RuntimeError("no capacity")
                modal.calls.append((app, name, min_containers))

        return Function()


def test_modal_does_nothing_unless_configured():
    fake = FakeModal()
    launcher = autoscale_leader.ModalLauncher(lookup=fake)
    assert not launcher.configured
    launcher.scale("cpu-heavy", 3, CPU, fallback=False)
    assert fake.calls == []
    assert isinstance(autoscale_leader.maintenance_task(None, env={}), str)


def test_modal_scales_the_pool_function_and_stops_the_other_launch():
    fake = FakeModal()
    launcher = autoscale_leader.ModalLauncher("selecta", "id", "secret", lookup=fake)
    launcher.scale("cpu-heavy", 3, CPU, fallback=False)
    launcher.scale("gpu", 2, SLOW_CPU, fallback=True)
    assert fake.calls == [
        ("selecta", "cpu_heavy", 3),
        ("selecta", "gpu_stems_fallback", 2),
        ("selecta", "gpu_stems", 0),
    ]


def test_a_pool_without_a_modal_function_fails_loudly():
    launcher = autoscale_leader.ModalLauncher("selecta", "id", "secret", lookup=FakeModal())
    with pytest.raises(RuntimeError, match="No Modal function"):
        launcher.scale("cpu-heavy", 1, CPU, fallback=True)
    with pytest.raises(RuntimeError, match="No Modal function"):
        launcher.scale("nowhere", 1, CPU, fallback=False)


def test_a_refused_gpu_scale_up_reports_no_capacity_until_one_succeeds():
    fake = FakeModal(refuse={"gpu_stems"})
    launcher = autoscale_leader.ModalLauncher("selecta", "id", "secret", lookup=fake)
    assert launcher.has_capacity("gpu", T4)
    with pytest.raises(RuntimeError, match="refused"):
        launcher.scale("gpu", 1, T4, fallback=False)
    assert not launcher.has_capacity("gpu", T4)
    fake.refuse = set()
    launcher.scale("gpu", 1, T4, fallback=False)
    assert launcher.has_capacity("gpu", T4)


def test_the_maintenance_leader_runs_the_tick_behind_its_flag(cloud_engine, monkeypatch):
    _work(cloud_engine, "analyse.song", 100.0, 1)
    launcher = FakeLauncher()
    task = autoscale_leader.maintenance_task(cloud_engine, env={}, launcher=launcher)
    assert task.name == "autoscale" and task.every_s == autoscale_leader.TICK_S
    monkeypatch.setattr(autoscale_leader, "_flag_on", lambda: False)
    assert task.run(None) == 0 and launcher.scaled == []
    monkeypatch.setattr(autoscale_leader, "_flag_on", lambda: True)
    assert ("cpu-heavy", 1) in task.run(None)


def test_a_configured_modal_launcher_registers_the_task(sqlite_engine):
    env = {
        "SELECTA_MODAL_APP": "selecta",
        "SELECTA_MODAL_TOKEN_ID": "id",
        "SELECTA_MODAL_TOKEN_SECRET": "secret",
    }
    plan = maintain.cloud_plan(sqlite_engine, env=env)
    assert "autoscale" in {task.name for task in plan.tasks}
    assert "autoscale" not in plan.disabled
