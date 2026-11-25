"""The arithmetic of Lucy's allowance windows: pure functions, no database (ADR-0481 to 0484).

Lucy's allowance is counted in usage units. One unit is one millionth of a US dollar. It is held
in a session window of five hours and a weekly limit whose reset is a fixed weekday and local
hour for each workspace (ADR-0482 rules 2 and 3).

Everything here takes the time as an argument, in epoch seconds, so callers pass the database
clock and tests pass any instant they like.

A weekly reset is "the local clock reads the anchor's weekday at the anchor's hour". Clock
changes make that ambiguous twice a year, so:

- when the local time does not exist that week (clocks go forward over it), the reset is the
  first instant after the gap;
- when it happens twice (clocks go back over it), the reset is the first of the two.

Every week therefore has exactly one reset, and the weeks tile time with no gap or overlap.
"""

from __future__ import annotations

import datetime as dt
import math
from collections.abc import Sequence
from dataclasses import dataclass
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

SESSION_SECONDS = 5 * 3600
UNITS_PER_USD = 1_000_000
# The share of a limit from which its state is "near" (ADR-0484 rule 2).
NEAR_AT = 0.8

_NEAR_MILLI = round(NEAR_AT * 1000)
# A cost this close to a whole number of units is that number: float noise never adds a unit.
_WHOLE_UNIT_TOLERANCE = 1e-9
_MAX_ZONE_NAME = 255

_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


def zone(name: str | None) -> dt.tzinfo:
    """The named time zone, or UTC when the name is missing or cannot be used."""
    if not isinstance(name, str) or not name or len(name) > _MAX_ZONE_NAME:
        return dt.UTC
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        # OSError covers a folder of zones such as "Europe" and names the file system refuses.
        return dt.UTC


def _zone_name(tz: dt.tzinfo) -> str:
    return tz.key if isinstance(tz, ZoneInfo) else "UTC"


@dataclass(frozen=True)
class Anchor:
    """When a workspace's week resets: a weekday and a local hour in one time zone."""

    time_zone: str
    weekday: int  # 0 is Monday
    hour: int  # 0 to 23


def anchor_for(created_at: float, time_zone: str | None) -> Anchor:
    """The weekday and local hour of that instant in that zone. `time_zone` on the result is the
    name actually used: "UTC" when the given one is unusable."""
    tz = zone(time_zone)
    local = dt.datetime.fromtimestamp(created_at, tz)
    return Anchor(time_zone=_zone_name(tz), weekday=local.weekday(), hour=local.hour)


def _offset_at(instant: int, tz: dt.tzinfo) -> dt.timedelta | None:
    return dt.datetime.fromtimestamp(instant, tz).utcoffset()


def _reset_on(day: dt.date, hour: int, tz: dt.tzinfo) -> float:
    """The one reset that belongs to this local date."""
    first = dt.datetime(day.year, day.month, day.day, hour, tzinfo=tz, fold=0)
    second = first.replace(fold=1)
    early, late = second.timestamp(), first.timestamp()
    if early >= late:
        # The local time exists once (equal) or twice (`late` is the first occurrence).
        return late
    # The local time is inside a gap. The clocks changed somewhere in (early, late]: find the
    # first second that already has the new offset.
    low, high = int(early), int(late)
    after = _offset_at(high, tz)
    while high - low > 1:
        middle = (low + high) // 2
        if _offset_at(middle, tz) == after:
            high = middle
        else:
            low = middle
    return float(high)


def week_bounds(anchor: Anchor, now: float) -> tuple[float, float]:
    """`(start, end)` of the week holding `now`, in epoch seconds, with `start <= now < end`."""
    tz = zone(anchor.time_zone)
    today = dt.datetime.fromtimestamp(now, tz).date()
    latest = today - dt.timedelta(days=(today.weekday() - anchor.weekday) % 7)
    days = [latest + dt.timedelta(days=7 * weeks) for weeks in (-1, 0, 1, 2)]
    resets = [_reset_on(day, anchor.hour, tz) for day in days]
    for start, end in zip(resets, resets[1:], strict=False):
        if start <= now < end:
            return start, end
    raise ValueError(f"no week holds {now!r} for {anchor!r}")


def session_end(opened_at: float) -> float:
    """When a session that opened then closes, used up or not (ADR-0482 rule 2)."""
    return opened_at + SESSION_SECONDS


def to_units(cost_usd: float) -> int:
    """A dollar cost in usage units, rounded up so a charge is never below the true cost.

    0 for nothing, a negative cost or not-a-number. Any real cost is at least one unit. A cost
    within 1e-9 of a whole number of units is that number.
    """
    units = cost_usd * UNITS_PER_USD
    if not units > 0:
        return 0
    return max(1, math.ceil(units - _WHOLE_UNIT_TOLERANCE))


def _spent(used: int, limit: int) -> bool:
    return limit <= 0 or used >= limit


def percent_left(used: int, limit: int) -> int:
    """The whole percentage left, rounded so it never flatters (ADR-0484 rule 5): 100 only when
    nothing is used, 0 only when spent, and otherwise 1 to 99."""
    if _spent(used, limit):
        return 0
    if used <= 0:
        return 100
    return max(1, min(99, (limit - used) * 100 // limit))


def state(used: int, limit: int) -> str:
    """One of "spent", "near" (from `NEAR_AT` of the limit) or "ok"."""
    if _spent(used, limit):
        return "spent"
    if used * 1000 >= _NEAR_MILLI * limit:
        return "near"
    return "ok"


def segments_lit(used: int, limit: int, segments: int = 5) -> int:
    """How many segments of a level meter are lit (ADR-0484 rule 11): all only when nothing is
    used, none only when spent, and at least one while anything is left."""
    if _spent(used, limit):
        return 0
    if used <= 0:
        return segments
    return max(1, min(segments - 1, (limit - used) * segments // limit))


def estimated_messages(remaining_units: int, recent_charges: Sequence[int]) -> int | None:
    """Estimate from the latest settled turns, with no estimate until five have settled."""
    charges = sorted(recent_charges[:20])
    if len(charges) < 5:
        return None
    middle = len(charges) // 2
    doubled_median = charges[(len(charges) - 1) // 2] + charges[middle]
    if doubled_median <= 0:
        return None
    return max(0, remaining_units) * 2 // doubled_median


def back_words(resets_at: float, time_zone: str | None, now: float) -> str:
    """The reset time in plain words in that zone, on a 24-hour clock: "16:40" on the same local
    day as `now`, "Thursday 09:00" within the next 6 days, "Thursday 3 December 09:00" later."""
    tz = zone(time_zone)
    local = dt.datetime.fromtimestamp(resets_at, tz)
    days = (local.date() - dt.datetime.fromtimestamp(now, tz).date()).days
    clock = f"{local.hour:02d}:{local.minute:02d}"
    if days <= 0:
        return clock
    weekday = _WEEKDAYS[local.weekday()]
    if days <= 6:
        return f"{weekday} {clock}"
    return f"{weekday} {local.day} {_MONTHS[local.month - 1]} {clock}"
