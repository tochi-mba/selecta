"""How many workers each pool should run, within its limits and its daily spend ceiling.

ADR-0396 and docs/saas/04-queue-and-scheduling.md 4A.6 "Autoscaling": the maintenance leader
sizes each pool from its outstanding estimated work-seconds over a target drain time, nudged up
when the p95 queue wait is over target, between the pool's min and max, never past what its
daily spend ceiling can still pay for, and with one warm worker in the seam and stems pools
while someone is listening. Hitting max or the spend ceiling raises an alert (SC-0396-05).

A pool may name a fallback launch: the GPU pool falls back to CPU workers that run the same
`stems.window` jobs more slowly when the provider has no GPU capacity (SC-0396-03). The fallback
workers register in the same pool with no GPU memory, so the claim and fairness rules are
unchanged; only the launch spec and the speed used for sizing change.

The pool settings live as code in `infra/workers/pools.json`. This module only decides; a
launcher (Modal, Hetzner) carries the decision out. It runs under the `cloud.operations` flag
with the rest of the maintenance loop.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.work.model import JobState
from selecta.work.schema import jobs

OUTSTANDING = (
    JobState.QUEUED, JobState.LEASED, JobState.RUNNING, JobState.VALIDATING,
    JobState.RETRY_SCHEDULED,
)
ALERT_MAX = "max_workers"
ALERT_SPEND = "spend_ceiling"
ALERT_FALLBACK = "primary_capacity_absent"


@dataclass(frozen=True)
class Launch:
    """What one worker of a pool is: where it runs and what it costs."""

    provider: str
    cpu: float
    memory_mb: int
    cost_per_hour_usd: float
    gpu: str | None = None
    speed_factor: float = 1.0
    """Reference seconds of work per wall second, as in `WorkerCaps.speed_factor`."""


@dataclass(frozen=True)
class PoolConfig:
    name: str
    min_workers: int
    max_workers: int
    slots_per_worker: int
    target_drain_s: float
    p95_wait_target_s: float
    daily_spend_ceiling_usd: float
    primary: Launch
    fallback: Launch | None = None
    warm_while_listening: bool = False
    spend_horizon_s: float = 3_600.0
    """How far ahead a new worker's cost is counted against what is left of the ceiling."""


@dataclass(frozen=True)
class PoolState:
    outstanding_work_s: float
    p95_wait_s: float
    running_workers: int
    spend_today_usd: float
    listening: bool = False
    primary_capacity: bool = True


@dataclass(frozen=True)
class Alert:
    pool: str
    kind: str
    message: str


@dataclass(frozen=True)
class Decision:
    pool: str
    workers: int
    launch: Launch
    wanted: int
    """What demand alone asked for, before max and the spend ceiling."""
    alerts: tuple[Alert, ...] = field(default=())


def _launch(raw: Mapping[str, Any]) -> Launch:
    return Launch(
        provider=str(raw["provider"]), cpu=float(raw["cpu"]), memory_mb=int(raw["memory_mb"]),
        cost_per_hour_usd=float(raw["cost_per_hour_usd"]), gpu=raw.get("gpu"),
        speed_factor=float(raw.get("speed_factor", 1.0)),
    )


def parse_pools(data: Mapping[str, Any]) -> dict[str, PoolConfig]:
    """Read pool settings, refusing ones that could never be honoured."""
    pools: dict[str, PoolConfig] = {}
    for name, raw in data["pools"].items():
        config = PoolConfig(
            name=name,
            min_workers=int(raw["min_workers"]),
            max_workers=int(raw["max_workers"]),
            slots_per_worker=int(raw.get("slots_per_worker", 1)),
            target_drain_s=float(raw["target_drain_s"]),
            p95_wait_target_s=float(raw["p95_wait_target_s"]),
            daily_spend_ceiling_usd=float(raw["daily_spend_ceiling_usd"]),
            primary=_launch(raw["primary"]),
            fallback=_launch(raw["fallback"]) if raw.get("fallback") else None,
            warm_while_listening=bool(raw.get("warm_while_listening", False)),
            spend_horizon_s=float(raw.get("spend_horizon_s", 3_600.0)),
        )
        problems = [
            why for bad, why in (
                (config.min_workers < 0, "min_workers is negative"),
                (config.max_workers < config.min_workers, "max_workers is below min_workers"),
                (config.slots_per_worker < 1, "slots_per_worker is below 1"),
                (config.target_drain_s <= 0, "target_drain_s must be positive"),
                (config.daily_spend_ceiling_usd <= 0, "daily_spend_ceiling_usd must be positive"),
                (config.primary.speed_factor <= 0, "primary speed_factor must be positive"),
                (config.fallback is not None and config.fallback.speed_factor <= 0,
                 "fallback speed_factor must be positive"),
            ) if bad
        ]
        if problems:
            raise ValueError(f"Pool {name}: {'; '.join(problems)}")
        pools[name] = config
    return pools


def load_pools(path: Path) -> dict[str, PoolConfig]:
    return parse_pools(json.loads(path.read_text("utf-8")))


def affordable(config: PoolConfig, launch: Launch, spend_today_usd: float) -> int:
    """How many workers what is left of today's ceiling can pay for over the horizon."""
    left = config.daily_spend_ceiling_usd - spend_today_usd
    per_worker = launch.cost_per_hour_usd * config.spend_horizon_s / 3_600.0
    if left <= 0:
        return 0
    if per_worker <= 0:
        return config.max_workers
    return int(left // per_worker)


def decide(config: PoolConfig, state: PoolState) -> Decision:
    """The worker count for one pool now, with any alerts the decision raises."""
    alerts: list[Alert] = []
    launch = config.primary
    if not state.primary_capacity and config.fallback is not None:
        launch = config.fallback
        alerts.append(Alert(config.name, ALERT_FALLBACK, (
            f"{config.name}: no {config.primary.gpu or config.primary.provider} capacity, "
            f"running on {config.fallback.provider} fallback workers"
        )))
    per_worker = config.target_drain_s * config.slots_per_worker * launch.speed_factor
    wanted = math.ceil(max(state.outstanding_work_s, 0.0) / per_worker)
    if state.p95_wait_s > config.p95_wait_target_s and state.outstanding_work_s > 0:
        wanted = max(wanted, state.running_workers + 1)
    floor = config.min_workers
    if config.warm_while_listening and state.listening:
        floor = max(floor, 1)
    wanted = max(wanted, floor)
    workers = wanted
    if workers > config.max_workers:
        workers = config.max_workers
        alerts.append(Alert(config.name, ALERT_MAX, (
            f"{config.name}: wants {wanted} workers, held at its max of {config.max_workers}"
        )))
    budget = affordable(config, launch, state.spend_today_usd)
    if workers > budget:
        workers = budget
        alerts.append(Alert(config.name, ALERT_SPEND, (
            f"{config.name}: spent ${state.spend_today_usd:.2f} of its "
            f"${config.daily_spend_ceiling_usd:.2f} daily ceiling; held at {budget} workers"
        )))
    return Decision(config.name, workers, launch, wanted, tuple(alerts))


def outstanding_work_seconds(connection: Connection) -> dict[str, float]:
    """Estimated reference seconds of work queued or running, per pool (the scaling signal)."""
    rows = connection.execute(
        sa.select(jobs.c.pool, sa.func.coalesce(sa.func.sum(jobs.c.est_cost_s), 0.0))
        .where(jobs.c.state.in_([state.value for state in OUTSTANDING]))
        .group_by(jobs.c.pool)
    ).all()
    return {pool: float(total) for pool, total in rows}


__all__ = [
    "ALERT_FALLBACK", "ALERT_MAX", "ALERT_SPEND", "Alert", "Decision", "Launch", "PoolConfig",
    "PoolState", "affordable", "decide", "load_pools", "outstanding_work_seconds", "parse_pools",
]
