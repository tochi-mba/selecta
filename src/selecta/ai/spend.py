"""Layered spend protection for Lucy (§9.3, ADR-0404 SC-0404-03).

| Layer | Guard here |
|---|---|
| Per call | `TurnGuard.check_call`: input token ceiling, worst-case cost estimated first |
| Per turn | `TurnGuard`: tool cycles, seconds and dollars for the whole turn |
| Per account | `acquire_lease`: 1-2 runs at once, as lease rows that expire if a server dies |
| Per tier | `TIER_LIMITS`: run count, turn ceilings and a monthly dollar ceiling per account |
| Per provider | `ProviderGuard`: concurrency and a circuit breaker, held in this process's memory |
| Platform | `reserve` / `reconcile`: daily and monthly dollars, a hard admission cap, alerts |

Spending follows reserve-then-reconcile: a turn reserves its worst case (its cost cap) before it
is admitted, and swaps the reservation for what it really cost when it ends. The admission check
and the reservation are one conditional row update, so two servers can't both take the last
dollar. The emergency switch is `emergency_disable`, which routing honours at once.

The provider guard is per process, so with several API servers each one enforces its own share.
The account and platform guards live in the database and hold across every server.
"""

from __future__ import annotations

import datetime as dt
import os
import threading
import time
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.ai.registry import Deployment, DeploymentStatus, Prices, Tier, set_status
from selecta.ai.schema import ai_concurrency, ai_spend_daily, insert_ignore
from selecta.persistence import db_now, new_id


class SpendRefused(Exception):
    """A guard said no. `code` names the guard; `message` is safe to show."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class TierLimits:
    max_concurrent_runs: int
    max_turn_seconds: int
    max_turn_cost_usd: float
    monthly_cost_ceiling_usd: float
    """At most about 40% of the plan's price in AI for a maxed-out account (§3.1)."""


TIER_LIMITS: dict[Tier, TierLimits] = {
    Tier.FREE: TierLimits(1, 60, 0.02, 0.25),
    Tier.STANDARD: TierLimits(2, 120, 0.15, 3.56),
    Tier.PREMIUM: TierLimits(2, 180, 0.60, 6.60),
}


@dataclass(frozen=True)
class TurnLimits:
    max_cycles: int
    max_seconds: int
    max_cost_usd: float
    max_input_tokens: int
    max_output_tokens: int


def turn_limits(deployment: Deployment, tier: Tier | str) -> TurnLimits:
    """The tighter of the deployment's and the tier's ceilings."""
    limits = TIER_LIMITS[Tier(tier)]
    return TurnLimits(
        max_cycles=deployment.max_tool_cycles,
        max_seconds=limits.max_turn_seconds,
        max_cost_usd=min(deployment.per_turn_cost_cap_usd, limits.max_turn_cost_usd),
        max_input_tokens=deployment.max_input_tokens,
        max_output_tokens=deployment.max_output_tokens,
    )


@dataclass
class TurnGuard:
    """Per-call and per-turn ceilings for one running turn, kept in memory by the agent loop."""

    limits: TurnLimits
    prices: Prices
    clock: Callable[[], float] = time.monotonic
    cycles: int = 0
    cost_usd: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    started: float = field(init=False)

    def __post_init__(self) -> None:
        self.started = self.clock()

    def estimate_call(self, input_tokens: int) -> float:
        """Worst case for one call: nothing cached and the full output allowance used."""
        return self.prices.cost(input_tokens, self.limits.max_output_tokens)

    def check_call(self, input_tokens: int) -> float:
        """Raise `SpendRefused` if the next call would pass a ceiling; else its estimate."""
        if self.cycles >= self.limits.max_cycles:
            raise SpendRefused("cycles", "Lucy reached the step limit for one message.")
        if self.clock() - self.started >= self.limits.max_seconds:
            raise SpendRefused("seconds", "Lucy ran out of time for this message.")
        if 0 < self.limits.max_input_tokens < input_tokens:
            raise SpendRefused("input_tokens", "This conversation is too long for one message.")
        estimate = self.estimate_call(input_tokens)
        if estimate > 0 and self.cost_usd + estimate > self.limits.max_cost_usd:
            raise SpendRefused("cost", "Lucy reached the cost limit for one message.")
        return estimate

    def record_call(
        self, tokens_in: int, tokens_out: int, cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
    ) -> float:
        cost = self.prices.cost(tokens_in, tokens_out, cache_read_tokens, cache_write_tokens)
        self.cycles += 1
        self.cost_usd = round(self.cost_usd + cost, 8)
        self.tokens_in += max(0, tokens_in)
        self.tokens_out += max(0, tokens_out)
        return cost


# Per account: lease rows -------------------------------------------------------------------


def acquire_lease(
    conn: Connection, workspace_id: str, run_id: str, max_runs: int, ttl_seconds: float
) -> str | None:
    """Take one of the workspace's `max_runs` run slots, or None when all are busy.

    A slot is a unique (workspace, slot) row; an expired one is cleared first, so a server that
    died mid-turn frees its slot after `ttl_seconds`. No row locks needed on either engine.
    """
    now = db_now(conn)
    for slot in range(max(1, max_runs)):
        conn.execute(
            sa.delete(ai_concurrency).where(
                ai_concurrency.c.workspace_id == workspace_id,
                ai_concurrency.c.slot == slot,
                ai_concurrency.c.expires_at <= now,
            )
        )
        lease_id = new_id()
        values = {
            "id": lease_id, "workspace_id": workspace_id, "slot": slot, "run_id": run_id,
            "acquired_at": now, "expires_at": now + ttl_seconds,
        }
        if insert_ignore(conn, ai_concurrency, values, ["workspace_id", "slot"]):
            return lease_id
    return None


def renew_lease(conn: Connection, lease_id: str, ttl_seconds: float) -> bool:
    """Extend a live lease; False if it already expired and may belong to someone else."""
    now = db_now(conn)
    result = conn.execute(
        sa.update(ai_concurrency)
        .where(ai_concurrency.c.id == lease_id, ai_concurrency.c.expires_at > now)
        .values(expires_at=now + ttl_seconds)
    )
    return result.rowcount == 1


def release_lease(conn: Connection, lease_id: str) -> None:
    conn.execute(sa.delete(ai_concurrency).where(ai_concurrency.c.id == lease_id))


def active_leases(conn: Connection, workspace_id: str) -> int:
    count = conn.execute(
        sa.select(sa.func.count()).select_from(ai_concurrency).where(
            ai_concurrency.c.workspace_id == workspace_id,
            ai_concurrency.c.expires_at > db_now(conn),
        )
    ).scalar()
    return int(count or 0)


# Per provider: in-memory concurrency and circuit breakers ---------------------------------


class BreakerState(StrEnum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    """Opens after `failure_threshold` errors or 429s within `window_seconds`; after
    `cooldown_seconds` lets one probe through, and closes again if that probe succeeds."""

    def __init__(
        self, failure_threshold: int = 5, window_seconds: float = 60.0,
        cooldown_seconds: float = 30.0, clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.failure_threshold = failure_threshold
        self.window_seconds = window_seconds
        self.cooldown_seconds = cooldown_seconds
        self.clock = clock
        self._failures: deque[float] = deque()
        self._open = False
        self._opened_at = 0.0
        self._probing = False

    @property
    def state(self) -> BreakerState:
        if not self._open:
            return BreakerState.CLOSED
        if self.clock() - self._opened_at >= self.cooldown_seconds:
            return BreakerState.HALF_OPEN
        return BreakerState.OPEN

    def available(self) -> bool:
        """Whether a call could go through now, without using up the half-open probe."""
        state = self.state
        return state is BreakerState.CLOSED or (
            state is BreakerState.HALF_OPEN and not self._probing
        )

    def allow(self) -> bool:
        """Like `available`, but takes the single half-open probe when that's what's left."""
        state = self.state
        if state is BreakerState.CLOSED:
            return True
        if state is BreakerState.HALF_OPEN and not self._probing:
            self._probing = True
            return True
        return False

    def record_success(self) -> None:
        self._open = False
        self._probing = False
        self._failures.clear()

    def record_failure(self) -> None:
        now = self.clock()
        if self._open:  # the probe failed, or a call that started before opening
            self._opened_at = now
            self._probing = False
            return
        self._failures.append(now)
        while self._failures and now - self._failures[0] > self.window_seconds:
            self._failures.popleft()
        if len(self._failures) >= self.failure_threshold:
            self._open = True
            self._opened_at = now
            self._failures.clear()


class ProviderGuard:
    """Concurrency per deployment (and optionally per provider) plus a breaker per deployment.

    It is also the routing `HealthPort`: an open breaker makes routing fall back.
    """

    def __init__(
        self, provider_limits: Mapping[str, int] | None = None, *, failure_threshold: int = 5,
        window_seconds: float = 60.0, cooldown_seconds: float = 30.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.provider_limits = dict(provider_limits or {})
        self._settings = (failure_threshold, window_seconds, cooldown_seconds, clock)
        self._lock = threading.Lock()
        self._breakers: dict[str, CircuitBreaker] = {}
        self._in_flight: dict[str, int] = {}
        self._provider_in_flight: dict[str, int] = {}
        self._provider_of: dict[str, str] = {}

    def breaker(self, deployment_id: str) -> CircuitBreaker:
        with self._lock:
            return self._breaker(deployment_id)

    def _breaker(self, deployment_id: str) -> CircuitBreaker:
        found = self._breakers.get(deployment_id)
        if found is None:
            threshold, window, cooldown, clock = self._settings
            found = self._breakers[deployment_id] = CircuitBreaker(
                threshold, window, cooldown, clock
            )
        return found

    def is_healthy(self, deployment_id: str) -> bool:
        with self._lock:
            return self._breaker(deployment_id).available()

    def try_acquire(self, deployment: Deployment) -> bool:
        """Claim a call slot for one provider call. Pair every True with `release`."""
        provider = deployment.provider.value
        with self._lock:
            if self._in_flight.get(deployment.id, 0) >= deployment.concurrency:
                return False
            limit = self.provider_limits.get(provider)
            if limit is not None and self._provider_in_flight.get(provider, 0) >= limit:
                return False
            if not self._breaker(deployment.id).allow():
                return False
            self._in_flight[deployment.id] = self._in_flight.get(deployment.id, 0) + 1
            self._provider_in_flight[provider] = self._provider_in_flight.get(provider, 0) + 1
            self._provider_of[deployment.id] = provider
            return True

    def release(self, deployment_id: str, *, ok: bool) -> None:
        """End a call. `ok=False` for provider faults (5xx, 429, timeouts, offline) only."""
        with self._lock:
            self._in_flight[deployment_id] = max(0, self._in_flight.get(deployment_id, 0) - 1)
            provider = self._provider_of.get(deployment_id)
            if provider is not None:
                count = self._provider_in_flight.get(provider, 0)
                self._provider_in_flight[provider] = max(0, count - 1)
            breaker = self._breaker(deployment_id)
            if ok:
                breaker.record_success()
            else:
                breaker.record_failure()

    def states(self) -> dict[str, dict[str, object]]:
        """For the admin page: each deployment's breaker state and calls in flight."""
        with self._lock:
            return {
                deployment_id: {
                    "state": breaker.state.value,
                    "in_flight": self._in_flight.get(deployment_id, 0),
                }
                for deployment_id, breaker in self._breakers.items()
            }


# Platform: daily and monthly dollars ------------------------------------------------------


@dataclass(frozen=True)
class PlatformPolicy:
    daily_cap_usd: float = 25.0
    monthly_cap_usd: float = 500.0
    alert_percents: tuple[int, ...] = (50, 80, 100)

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> PlatformPolicy:
        """`SELECTA_AI_DAILY_CAP_USD`, `SELECTA_AI_MONTHLY_CAP_USD`, `SELECTA_AI_ALERT_PERCENTS`
        ("50,80,100"); anything unset keeps the default above."""
        env = os.environ if environ is None else environ
        default = cls()
        percents = env.get("SELECTA_AI_ALERT_PERCENTS")
        return cls(
            daily_cap_usd=float(env.get("SELECTA_AI_DAILY_CAP_USD", default.daily_cap_usd)),
            monthly_cap_usd=float(
                env.get("SELECTA_AI_MONTHLY_CAP_USD", default.monthly_cap_usd)
            ),
            alert_percents=tuple(sorted(int(p) for p in percents.split(",") if p.strip()))
            if percents else default.alert_percents,
        )


@dataclass(frozen=True)
class SpendAlert:
    scope: str  # "daily" or "monthly"
    percent: int
    total_usd: float
    cap_usd: float
    day: str


@dataclass(frozen=True)
class Reservation:
    admitted: bool
    day: str
    amount_usd: float
    reason: str | None = None
    alerts: tuple[SpendAlert, ...] = ()


@dataclass(frozen=True)
class PlatformTotals:
    day: str
    day_spent_usd: float
    day_reserved_usd: float
    month_spent_usd: float
    month_reserved_usd: float


def day_key(epoch: float) -> str:
    """The UTC day, "2026-11-09". Platform spend follows the provider's invoices, not accounts."""
    return dt.datetime.fromtimestamp(epoch, dt.UTC).strftime("%Y-%m-%d")


def _ensure_day(conn: Connection, day: str) -> None:
    insert_ignore(
        conn, ai_spend_daily,
        {
            "id": new_id(), "day": day, "spent_usd": 0.0, "reserved_usd": 0.0,
            "alert_level": 0, "monthly_alert_level": 0, "updated_at": db_now(conn),
        },
        ["day"],
    )


def _same_month(day: str):
    return ai_spend_daily.c.day.like(f"{day[:7]}-%")


def _other_days(conn: Connection, day: str) -> tuple[float, int]:
    """This month's spend and reservations on days other than `day`, and their alert level."""
    total, level = conn.execute(
        sa.select(
            sa.func.coalesce(
                sa.func.sum(ai_spend_daily.c.spent_usd + ai_spend_daily.c.reserved_usd), 0.0
            ),
            sa.func.coalesce(sa.func.max(ai_spend_daily.c.monthly_alert_level), 0),
        ).where(_same_month(day), ai_spend_daily.c.day != day)
    ).one()
    return float(total or 0.0), int(level or 0)


def _crossed(percent: float, thresholds: tuple[int, ...]) -> int:
    return max((p for p in thresholds if percent >= p), default=0)


def _alerts(conn: Connection, day: str, policy: PlatformPolicy) -> tuple[SpendAlert, ...]:
    """Raise each alert threshold once: daily ones once a day, monthly ones once a month."""
    other, other_level = _other_days(conn, day)
    row = conn.execute(
        sa.select(ai_spend_daily).where(ai_spend_daily.c.day == day)
    ).mappings().one()
    today = float(row["spent_usd"]) + float(row["reserved_usd"])
    alerts: list[SpendAlert] = []
    checks = (
        ("daily", "alert_level", today, policy.daily_cap_usd, row["alert_level"]),
        ("monthly", "monthly_alert_level", other + today, policy.monthly_cap_usd,
         max(row["monthly_alert_level"], other_level)),
    )
    for scope, column, total, cap, already in checks:
        if cap <= 0:
            continue
        level = _crossed(total / cap * 100.0, policy.alert_percents)
        if level <= already:
            continue
        result = conn.execute(
            sa.update(ai_spend_daily)
            .where(ai_spend_daily.c.day == day, ai_spend_daily.c[column] < level)
            .values({column: level})
        )
        if result.rowcount == 1:
            alerts.append(SpendAlert(scope, level, round(total, 6), cap, day))
    return tuple(alerts)


def reserve(
    conn: Connection, amount_usd: float, policy: PlatformPolicy, now: float | None = None
) -> Reservation:
    """Admit a turn's worst case against the daily and monthly caps, or refuse it."""
    now = db_now(conn) if now is None else now
    day = day_key(now)
    amount = max(0.0, float(amount_usd))
    _ensure_day(conn, day)
    other, _ = _other_days(conn, day)
    cap = min(policy.daily_cap_usd, policy.monthly_cap_usd - other)
    result = conn.execute(
        sa.update(ai_spend_daily)
        .where(
            ai_spend_daily.c.day == day,
            ai_spend_daily.c.spent_usd + ai_spend_daily.c.reserved_usd + amount <= cap,
        )
        .values(reserved_usd=ai_spend_daily.c.reserved_usd + amount, updated_at=now)
    )
    admitted = result.rowcount == 1
    reason = None
    if not admitted:
        reason = "monthly_cap" if policy.monthly_cap_usd - other < policy.daily_cap_usd else (
            "daily_cap"
        )
    return Reservation(admitted, day, amount if admitted else 0.0, reason,
                       _alerts(conn, day, policy))


def reconcile(
    conn: Connection, day: str, reserved_usd: float, actual_usd: float, policy: PlatformPolicy
) -> tuple[SpendAlert, ...]:
    """Swap a turn's reservation for what it really cost, on the day it was reserved."""
    _ensure_day(conn, day)
    release = max(0.0, float(reserved_usd))
    left = ai_spend_daily.c.reserved_usd - release
    conn.execute(
        sa.update(ai_spend_daily)
        .where(ai_spend_daily.c.day == day)
        .values(
            reserved_usd=sa.case((left < 0, 0.0), else_=left),
            spent_usd=ai_spend_daily.c.spent_usd + max(0.0, float(actual_usd)),
            updated_at=db_now(conn),
        )
    )
    return _alerts(conn, day, policy)


def platform_totals(conn: Connection, now: float | None = None) -> PlatformTotals:
    now = db_now(conn) if now is None else now
    day = day_key(now)
    rows = conn.execute(
        sa.select(ai_spend_daily.c.day, ai_spend_daily.c.spent_usd, ai_spend_daily.c.reserved_usd)
        .where(_same_month(day))
    ).all()
    today = next(((s, r) for d, s, r in rows if d == day), (0.0, 0.0))
    return PlatformTotals(
        day=day, day_spent_usd=float(today[0]), day_reserved_usd=float(today[1]),
        month_spent_usd=float(sum(s for _, s, _ in rows)),
        month_reserved_usd=float(sum(r for _, _, r in rows)),
    )


def emergency_disable(conn: Connection, deployment_id: str) -> bool:
    """Stop new runs on one deployment now; routing falls back past it on the next turn."""
    return set_status(conn, deployment_id, DeploymentStatus.DISABLED)
