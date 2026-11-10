"""Daily and monthly allowances: songs analysed today, Lucy turns this month, and the like
(ADR-0402; docs/saas/02-plans-and-economics.md §3.1).

Allowances reset at midnight in the account's own timezone, daily ones every day and monthly ones
on the 1st, so "150 songs a day" means the person's day, daylight saving included. Each period
has its own row, so the counter starts at zero by itself when a new period begins and last
period's count stays readable.

`try_consume` takes an amount from an allowance only if it all fits, with the counter's row
locked so two requests can't both take the last one. It answers rather than raises: a refusal is
ordinary, and the caller says it plainly ("You've used today's 150 songs; more tomorrow"). The
limit comes from the plan (`limit_for`); `None` means fair use, which is counted but never
refused here.

The timezone is the workspace's IANA name, passed in by the caller. An unknown name counts in
UTC rather than failing. Changing a workspace's timezone moves it to another period key, which can
start a fresh day early, so how often it can change is for the account settings to limit.
"""

from __future__ import annotations

import datetime as dt
import enum
import math
from dataclasses import dataclass
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import persistence
from selecta.billing.plans import Plan, StemAccess
from selecta.usage.schema import allowance_counters, insert_ignore

# Tiny slack so fractional amounts (CPU seconds) that add up exactly to the limit still fit.
EPSILON = 1e-9


class Period(enum.StrEnum):
    DAY = "day"
    MONTH = "month"


# The allowances plans set, and how often each resets.
PERIODS = {
    "analysis_song": Period.DAY,
    "speculative_cpu_seconds": Period.DAY,
    "stem_preview_window": Period.DAY,
    "export": Period.MONTH,
    "lucy_turn.haiku": Period.MONTH,
    "lucy_turn.sonnet": Period.MONTH,
    "lucy_turn.opus": Period.MONTH,
}


def limit_for(plan: Plan, kind: str) -> float | None:
    """A plan's limit for one allowance. `None` is fair use (counted, never refused); 0 means
    the plan doesn't include it."""
    if kind == "analysis_song":
        return plan.analysis_songs_per_day
    if kind == "speculative_cpu_seconds":
        return plan.speculative_cpu_minutes_per_day * 60
    if kind == "stem_preview_window":
        return plan.stem_preview_windows_per_day if plan.stems is StemAccess.PREVIEW else None
    if kind == "export":
        return plan.exports_per_month
    if kind.startswith("lucy_turn."):
        return plan.lucy_turns(kind.removeprefix("lucy_turn."))
    raise KeyError(f"No plan sets an allowance called {kind!r}.")


@dataclass(frozen=True)
class Allowance:
    workspace_id: str
    kind: str
    period: Period
    period_key: str
    used: float
    limit: float | None
    resets_at: float

    @property
    def remaining(self) -> float | None:
        """What's left this period, or None under fair use."""
        if self.limit is None:
            return None
        return max(0.0, self.limit - self.used)


@dataclass(frozen=True)
class Consumed:
    ok: bool
    allowance: Allowance
    # What was taken: the amount asked for when `ok`, else 0.
    taken: float = 0.0


def zone(name: str | None) -> dt.tzinfo:
    """The timezone called `name`, or UTC when it's missing or unknown. A name that's a folder
    of zones ("Europe") or too long for the filesystem fails with an `OSError`, not a lookup
    error, so that counts as unknown too."""
    if not name:
        return dt.UTC
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return dt.UTC


def period_window(period: Period, timezone: str | None, now: float) -> tuple[str, float, float]:
    """The period `now` falls in, in that timezone: its key ("2026-11-09" or "2026-11") and its
    start and end as epoch seconds. Ends are the next local midnight, so a day can be 23 or 25
    hours long around daylight saving."""
    tz = zone(timezone)
    today = dt.datetime.fromtimestamp(now, tz).date()
    if period is Period.DAY:
        first, after = today, today + dt.timedelta(days=1)
        key = first.isoformat()
    else:
        first = today.replace(day=1)
        after = (first + dt.timedelta(days=32)).replace(day=1)
        key = f"{first.year:04d}-{first.month:02d}"
    start = dt.datetime.combine(first, dt.time(0), tzinfo=tz).timestamp()
    end = dt.datetime.combine(after, dt.time(0), tzinfo=tz).timestamp()
    return key, start, end


def _period(kind: str, period: Period | str | None) -> Period:
    if period is not None:
        return Period(period)
    if kind in PERIODS:
        return PERIODS[kind]
    raise KeyError(f"{kind!r} isn't a known allowance; say whether it's daily or monthly.")


def _check_limit(limit: float | None) -> None:
    if limit is not None and (not math.isfinite(limit) or limit < 0):
        raise ValueError("An allowance limit is a number, 0 or more, or None for fair use.")


def _key(workspace_id: str, kind: str, period_key: str):
    return (
        (allowance_counters.c.workspace_id == workspace_id)
        & (allowance_counters.c.kind == kind)
        & (allowance_counters.c.period_key == period_key)
    )


def try_consume(
    connection: Connection,
    workspace_id: str,
    kind: str,
    amount: float,
    limit: float | None,
    *,
    timezone: str | None = "UTC",
    period: Period | str | None = None,
) -> Consumed:
    """Take `amount` from this period's allowance if it all fits, atomically. Nothing is taken
    when it doesn't fit, and `ok` is false."""
    if not math.isfinite(amount) or amount <= 0:
        raise ValueError("Consume an amount above 0.")
    _check_limit(limit)
    which = _period(kind, period)
    now = persistence.db_now(connection)
    key, start, end = period_window(which, timezone, now)
    match = _key(workspace_id, kind, key)
    query = sa.select(allowance_counters.c.used).where(match).with_for_update()
    used = connection.execute(query).scalar()
    if used is None:
        insert_ignore(
            connection,
            allowance_counters,
            {
                "workspace_id": workspace_id,
                "kind": kind,
                "period_key": key,
                "used": 0.0,
                "period_start": start,
                "resets_at": end,
                "updated_at": now,
            },
            keys=("workspace_id", "kind", "period_key"),
        )
        used = connection.execute(query).scalar_one()
    used = float(used)
    if limit is not None and used + amount > limit + EPSILON:
        return Consumed(False, Allowance(workspace_id, kind, which, key, used, limit, end))
    used += amount
    connection.execute(sa.update(allowance_counters).where(match).values(used=used, updated_at=now))
    return Consumed(True, Allowance(workspace_id, kind, which, key, used, limit, end), amount)


def give_back(connection: Connection, consumed: Consumed, amount: float | None = None) -> None:
    """Return what a `try_consume` took, or part of it, when the work didn't happen (a Lucy turn
    that failed before answering, say). It goes back to the period it was taken from, even after
    midnight. Giving back a negative or non-finite amount is refused: it would take more, or
    wipe the count."""
    if amount is not None and (not math.isfinite(amount) or amount < 0):
        raise ValueError("You can only give back an amount of 0 or more.")
    if not consumed.ok:
        return
    allowance = consumed.allowance
    match = _key(allowance.workspace_id, allowance.kind, allowance.period_key)
    held = connection.execute(
        sa.select(allowance_counters.c.used).where(match).with_for_update()
    ).scalar()
    if held is None:
        return
    back = consumed.taken if amount is None else min(amount, consumed.taken)
    connection.execute(
        sa.update(allowance_counters)
        .where(match)
        .values(used=max(0.0, float(held) - back), updated_at=persistence.db_now(connection))
    )


def remaining(
    connection: Connection,
    workspace_id: str,
    kind: str,
    limit: float | None,
    *,
    timezone: str | None = "UTC",
    period: Period | str | None = None,
) -> Allowance:
    """This period's allowance as it stands, for the meters. Reads without locking."""
    _check_limit(limit)
    which = _period(kind, period)
    key, _start, end = period_window(which, timezone, persistence.db_now(connection))
    used = connection.execute(
        sa.select(allowance_counters.c.used).where(_key(workspace_id, kind, key))
    ).scalar()
    return Allowance(workspace_id, kind, which, key, float(used or 0.0), limit, end)
