"""The maintenance leader's autoscaling tick, and the launchers that carry it out (SC-0396-03).

`selecta.work.autoscale` only decides. Every `TICK_S` the leader reads each pool's state from the
database (outstanding work, the p95 wait of queued jobs, live workers, whether anyone is
listening), asks the launcher whether the primary launch has capacity, decides, records any alerts
and tells the launcher the new size. The day's spend is estimated from the sizes the leader set
(`SpendMeter`); it restarts at zero when leadership moves, so the provider's own spend limit stays
the hard stop.

`Launcher` is the interface. `ModalLauncher` scales one deployed Modal function per pool
(`worker-{pool}`, and `worker-{pool}-fallback` for a pool's fallback launch) with
`Function.update_autoscaler`. It does nothing unless configured: without `SELECTA_MODAL_APP`,
`SELECTA_MODAL_TOKEN_ID` and `SELECTA_MODAL_TOKEN_SECRET` the task isn't registered and
`selecta maintain` logs why. The `cloud.autoscale` flag turns the tick off at run time.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta import persistence
from selecta.observability import metrics
from selecta.work.autoscale import (
    ALERT_SPEND,
    Decision,
    Launch,
    PoolConfig,
    PoolState,
    decide,
    load_pools,
    outstanding_work_seconds,
)
from selecta.work.model import JobState
from selecta.work.schema import jobs, workers

FLAG = "cloud.autoscale"
TICK_S = 30.0
LIVE_WORKER_S = 60.0
"""A worker seen within this long counts as running."""
LISTENING_S = 120.0
POOLS_FILE = Path(__file__).resolve().parents[3] / "infra" / "workers" / "pools.json"
MODAL_ENV = ("SELECTA_MODAL_APP", "SELECTA_MODAL_TOKEN_ID", "SELECTA_MODAL_TOKEN_SECRET")

log = logging.getLogger(__name__)


class Launcher(Protocol):
    def has_capacity(self, pool: str, launch: Launch) -> bool:
        """False when the provider says it can't start this launch now (no GPUs)."""
        ...

    def scale(self, pool: str, workers: int, launch: Launch, *, fallback: bool) -> None:
        """Run `workers` workers of this launch for the pool (0 stops them)."""
        ...


class ModalLauncher:
    """Scales deployed Modal functions; inert unless an app and a token are configured."""

    def __init__(
        self,
        app: str | None = None,
        token_id: str | None = None,
        token_secret: str | None = None,
        *,
        lookup: Callable[..., Any] | None = None,
    ):
        self.app = (app or "").strip()
        self._token = ((token_id or "").strip(), (token_secret or "").strip())
        self._lookup = lookup
        self.no_capacity: set[str] = set()
        """Pools whose last primary scale-up the provider refused; cleared on success."""

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> ModalLauncher:
        app, token_id, secret = (env.get(name, "") for name in MODAL_ENV)
        return cls(app, token_id, secret)

    @property
    def configured(self) -> bool:
        return bool(self.app and all(self._token))

    def _function(self, name: str) -> Any:
        if self._lookup is not None:
            return self._lookup(self.app, name)
        import modal  # imported only when configured: local mode never needs it

        client = modal.Client.from_credentials(*self._token)
        return modal.Function.from_name(self.app, name, client=client)

    def has_capacity(self, pool: str, launch: Launch) -> bool:
        return not (launch.gpu and pool in self.no_capacity)

    def scale(self, pool: str, workers: int, launch: Launch, *, fallback: bool) -> None:
        if not self.configured:
            return
        name = f"worker-{pool}-fallback" if fallback else f"worker-{pool}"
        try:
            self._function(name).update_autoscaler(
                min_containers=workers, max_containers=max(workers, 1)
            )
        except Exception as error:
            if launch.gpu and not fallback:
                self.no_capacity.add(pool)
            raise RuntimeError(f"Modal refused to scale {name} to {workers}: {error}") from error
        if not fallback:
            self.no_capacity.discard(pool)
        other = f"worker-{pool}" if fallback else f"worker-{pool}-fallback"
        if fallback or launch.gpu:
            try:  # Only one launch of a pool runs at a time.
                self._function(other).update_autoscaler(min_containers=0, max_containers=0)
            except Exception:  # noqa: BLE001 - a pool with no fallback app has nothing to stop
                log.debug("No %s to stop", other)


@dataclass
class SpendMeter:
    """The day's estimated spend per pool, from the sizes this leader set."""

    day: int = -1
    spent: dict[str, float] = field(default_factory=dict)
    last: dict[str, tuple[float, float]] = field(default_factory=dict)
    """Pool -> (when it was last sized, its cost per hour then)."""

    def charge(self, pool: str, now: float) -> float:
        today = int(now // 86_400)
        if today != self.day:
            self.day, self.spent = today, {}
        since, per_hour = self.last.get(pool, (now, 0.0))
        self.spent[pool] = self.spent.get(pool, 0.0) + per_hour * max(now - since, 0.0) / 3_600
        self.last[pool] = (max(now, since), per_hour)  # charged up to now; a failed scale skips set
        return self.spent[pool]

    def set(self, pool: str, now: float, workers: int, launch: Launch) -> None:
        self.last[pool] = (now, workers * launch.cost_per_hour_usd)


def p95_wait_seconds(conn: Connection, now: float) -> dict[str, float]:
    """The 95th percentile age of each pool's queued jobs."""
    rows = conn.execute(
        sa.select(jobs.c.pool, sa.func.coalesce(jobs.c.queued_at, jobs.c.created_at)).where(
            jobs.c.state == JobState.QUEUED.value
        )
    ).all()
    ages: dict[str, list[float]] = {}
    for pool, since in rows:
        ages.setdefault(pool, []).append(max(now - float(since), 0.0))
    found = {}
    for pool, values in ages.items():
        values.sort()
        found[pool] = values[min(len(values) - 1, int(0.95 * len(values)))]
    return found


def live_workers(conn: Connection, now: float) -> dict[str, int]:
    rows = conn.execute(
        sa.select(workers.c.pool, sa.func.count())
        .where(workers.c.last_seen_at >= now - LIVE_WORKER_S, workers.c.draining.is_(False))
        .group_by(workers.c.pool)
    ).all()
    return {pool: int(count) for pool, count in rows}


def someone_listening(conn: Connection, now: float) -> bool:
    from selecta.playback.schema import playback_sessions

    return (
        conn.execute(
            sa.select(sa.literal(1))
            .select_from(playback_sessions)
            .where(
                playback_sessions.c.state.in_(("playing", "paused")),
                playback_sessions.c.updated_at >= now - LISTENING_S,
            )
            .limit(1)
        ).first()
        is not None
    )


def tick(
    engine: Engine,
    pools: Mapping[str, PoolConfig],
    launcher: Launcher,
    meter: SpendMeter,
    now: float | None = None,
) -> list[Decision]:
    """One autoscaling pass over every pool: decide, record alerts, then scale."""
    from selecta.admin import alerts

    with persistence.transaction(engine) as conn:
        moment = persistence.db_now(conn) if now is None else now
        work = outstanding_work_seconds(conn)
        waits = p95_wait_seconds(conn, moment)
        running = live_workers(conn, moment)
        listening = someone_listening(conn, moment)
        decisions = []
        for name, config in sorted(pools.items()):
            state = PoolState(
                outstanding_work_s=work.get(name, 0.0),
                p95_wait_s=waits.get(name, 0.0),
                running_workers=running.get(name, 0),
                spend_today_usd=meter.charge(name, moment),
                listening=listening,
                primary_capacity=launcher.has_capacity(name, config.primary),
            )
            decision = decide(config, state)
            for alert in decision.alerts:
                if alert.kind == ALERT_SPEND:
                    metrics.add("selecta_spend_ceiling_hits_total", ceiling="compute")
                alerts.raise_alert(
                    conn,
                    f"autoscale.{alert.kind}",
                    alert.message,
                    metadata={
                        "pool": alert.pool,
                        "workers": decision.workers,
                        "wanted": decision.wanted,
                    },
                )
            decisions.append(decision)
    for decision in decisions:
        fallback = decision.launch is not pools[decision.pool].primary
        try:
            launcher.scale(decision.pool, decision.workers, decision.launch, fallback=fallback)
        except Exception:  # noqa: BLE001 - one pool's provider error mustn't stop the others
            log.exception("Couldn't scale the %s pool", decision.pool)
            continue
        meter.set(decision.pool, moment, decision.workers, decision.launch)
    return decisions


def _flag_on() -> bool:
    from selecta import flags

    try:
        return flags.on(FLAG)
    except KeyError:
        return False


def maintenance_task(
    engine: Engine, env: Mapping[str, str] | None = None, launcher: Launcher | None = None
):
    """The `autoscale` maintenance task, or why it's off (a string)."""
    from selecta.work.maintenance import Task

    env = os.environ if env is None else env
    if launcher is None:
        modal = ModalLauncher.from_env(env)
        if not modal.configured:
            return "set " + ", ".join(MODAL_ENV)
        launcher = modal
    path = Path(env.get("SELECTA_WORKER_POOLS", "").strip() or POOLS_FILE)
    if not path.is_file():
        return f"set SELECTA_WORKER_POOLS to the pools file ({path} is missing)"
    pools = load_pools(path)
    meter = SpendMeter()

    def run(_fence) -> object:
        if not _flag_on():
            return 0
        return [(d.pool, d.workers) for d in tick(engine, pools, launcher, meter)]

    return Task("autoscale", TICK_S, run)


__all__ = [
    "FLAG",
    "Launcher",
    "ModalLauncher",
    "SpendMeter",
    "live_workers",
    "maintenance_task",
    "p95_wait_seconds",
    "someone_listening",
    "tick",
]
