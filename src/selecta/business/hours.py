"""Venue opening hours, exceptions, overrides and the zone day for SelectaDJ (ADR-0444).

Pure functions with no database. Hours are stored as wall-clock times plus an IANA zone name and
turned into UTC instants here with `zoneinfo`:

- A period belongs to the day it opens. A closing time at or before the opening time is the next
  day, so Friday 18:00 to 02:00 owns Saturday 01:30.
- Spring forward: a time inside the missing hour moves to the first valid instant after it.
- Fall back: a time inside the repeated hour uses its first occurrence (fold=0), so a venue never
  closes twice.
- Open 24 hours periods have no warming and no closing; consecutive ones merge into one run.
- Date exceptions are keyed to the opening date: closed, replacement periods, yearly repeats and
  ranges (pauses). Holiday suggestions are only ever applied when passed in as exceptions.
- Stay open late and close now are overrides on one opening date (tonight only).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

WARMING_S = 45 * 60
OPENING_FADE_S = 10
CLOSING_MAX_S = 4 * 60
CLOSING_FADE_S = 20
CLOSE_NOW_FADE_S = 60
CLOSE_NOW_UNDO_S = 300
STAY_LATE_REVERSE_FADE_S = 10

ALLOWANCE_MIN = {"owner": 180, "admin": 180, "venue_manager": 180, "staff": 60}

WINDOW_DAYS = 14

_DAY_MIN = 24 * 60
_WEEK_MIN = 7 * _DAY_MIN
_TIME = re.compile(r"^(\d{1,2}):(\d{2})$")


class HoursError(ValueError):
    """Hours that cannot be used, with the problem named in plain English."""


@dataclass(frozen=True)
class Period:
    """One weekly opening period. It belongs to `weekday` (0 = Monday), the day it opens."""

    weekday: int
    opens: str
    closes: str
    all_day: bool = False


@dataclass(frozen=True)
class DateException:
    """Closed, or replacement periods, for the period(s) that open on `date`."""

    date: date
    closed: bool
    periods: tuple[tuple[str, str], ...] = ()
    repeat_yearly: bool = False
    until: date | None = None
    note: str = ""


@dataclass(frozen=True)
class Override:
    """Stay open late or close now, applied to the period that opened on `opening_date`."""

    kind: Literal["stay_open_late", "close_now"]
    opening_date: date
    created_at: datetime
    ends_at: datetime | None
    created_by: str = ""
    undone_at: datetime | None = None


@dataclass(frozen=True)
class Hours:
    """A venue's (or a zone's) weekly periods and date exceptions in one time zone."""

    tz: str
    weekly: tuple[Period, ...]
    exceptions: tuple[DateException, ...] = ()


@dataclass(frozen=True)
class Interval:
    """One opening as UTC instants. `end` is when closing starts (None: open 24 hours on)."""

    opening_date: date
    start: datetime
    end: datetime | None
    scheduled_end: datetime | None
    all_day: bool
    late_until: datetime | None
    closed_early_at: datetime | None


@dataclass(frozen=True)
class ZoneState:
    """Where a zone is in its day, since when, and what comes next."""

    state: Literal["closed", "warming", "opening", "open", "closing"]
    since: datetime | None
    next_change: datetime | None
    next_state: str | None
    interval: Interval | None


# ---------------------------------------------------------------------------------------------
# Parsing and validation


def _minutes(text: object, *, allow_24: bool = False) -> int:
    match = _TIME.match(str(text).strip()) if text is not None else None
    if match is None:
        raise HoursError(f"'{text}' is not a time; write it as HH:MM, for example 18:30.")
    hour, minute = int(match[1]), int(match[2])
    if minute > 59 or hour > 24 or (hour == 24 and (minute or not allow_24)):
        raise HoursError(f"'{text}' is not a time; write it as HH:MM, for example 18:30.")
    return hour * 60 + minute


def _label(period: Period) -> str:
    return "open 24 hours" if period.all_day else f"{period.opens} to {period.closes}"


def _span(period: Period) -> tuple[int, int]:
    """Minutes from Monday 00:00 of the week to the period's opening and closing."""
    if not isinstance(period.weekday, int) or not 0 <= period.weekday <= 6:
        raise HoursError(f"'{period.weekday}' is not a weekday; use 0 for Monday to 6 for Sunday.")
    base = period.weekday * _DAY_MIN
    if period.all_day:
        return base, base + _DAY_MIN
    opens = _minutes(period.opens)
    closes = _minutes(period.closes, allow_24=True)
    length = closes - opens if closes > opens else closes + _DAY_MIN - opens
    return base + opens, base + opens + length


def _overlap_message(first: Period, second: Period) -> str:
    if first.weekday == second.weekday:
        a, b = sorted((first, second), key=lambda p: (not p.all_day, _minutes(p.opens or "0:00")))
        return f"{WEEKDAYS[a.weekday]} has two periods that overlap: {_label(a)} and {_label(b)}"
    return (
        f"{WEEKDAYS[first.weekday]}'s period {_label(first)} runs into "
        f"{WEEKDAYS[second.weekday]}'s period {_label(second)}"
    )


def validate_weekly(periods: Iterable[Period]) -> None:
    """Refuse unreadable times and overlapping periods (an overnight period counts too)."""
    items = [(period, _span(period)) for period in periods]
    for i, (first, (a0, a1)) in enumerate(items):
        for second, (b0, b1) in items[i + 1 :]:
            for shift in (-_WEEK_MIN, 0, _WEEK_MIN):
                if a0 < b1 + shift and b0 + shift < a1:
                    if a0 <= b0 + shift:
                        raise HoursError(_overlap_message(first, second))
                    raise HoursError(_overlap_message(second, first))


# ---------------------------------------------------------------------------------------------
# Time arithmetic


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(str(name))
    except (ZoneInfoNotFoundError, ValueError, TypeError) as exc:
        raise HoursError(f"'{name}' is not a time zone SelectaDJ recognises.") from exc


def _utc(value: datetime, what: str = "That time") -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise HoursError(f"{what} needs a time zone.")
    return value.astimezone(UTC)


def _local_instant(tz: ZoneInfo, day: date, minutes: int) -> datetime:
    """The UTC instant of a wall-clock time on `day`, with the gap and fold rules applied."""
    day = day + timedelta(days=minutes // _DAY_MIN)
    minutes %= _DAY_MIN
    naive = datetime.combine(day, time(minutes // 60, minutes % 60))
    first = naive.replace(tzinfo=tz, fold=0).astimezone(UTC)
    if first.astimezone(tz).replace(tzinfo=None) == naive:
        return first
    # Inside a spring-forward gap: find the first valid instant after it (the transition).
    other = naive.replace(tzinfo=tz, fold=1).astimezone(UTC)
    lo_s = int(min(first, other).timestamp())
    hi_s = int(max(first, other).timestamp())
    while hi_s - lo_s > 1:
        mid = (lo_s + hi_s) // 2
        if datetime.fromtimestamp(mid, tz).replace(tzinfo=None) >= naive:
            hi_s = mid
        else:
            lo_s = mid
    return datetime.fromtimestamp(hi_s, UTC)


# ---------------------------------------------------------------------------------------------
# Exceptions


def _as_date(value: object) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise HoursError(f"'{value}' is not a date; write it as YYYY-MM-DD.") from exc


def _matches(exc: DateException, day: date) -> int:
    """0 when the exception does not cover `day`, else its priority (single dates win)."""
    start = _as_date(exc.date)
    if exc.until is not None:
        until = _as_date(exc.until)
        if exc.repeat_yearly:
            key, lo, hi = (day.month, day.day), (start.month, start.day), (until.month, until.day)
            inside = lo <= key <= hi if lo <= hi else (key >= lo or key <= hi)
        else:
            inside = start <= day <= until
        return 1 if inside else 0
    if exc.repeat_yearly:
        return 2 if (start.month, start.day) == (day.month, day.day) else 0
    return 3 if start == day else 0


def _exception_for(hours: Hours, day: date) -> DateException | None:
    best: DateException | None = None
    best_rank = 0
    for exc in hours.exceptions:
        rank = _matches(exc, day)
        if rank and rank >= best_rank:
            best, best_rank = exc, rank
    return best


def _day_periods(hours: Hours, day: date) -> list[Period]:
    exc = _exception_for(hours, day)
    if exc is None:
        return [period for period in hours.weekly if period.weekday == day.weekday()]
    if exc.closed:
        return []
    periods = [
        Period(weekday=day.weekday(), opens=str(pair[0]), closes=str(pair[1]))
        for pair in exc.periods
    ]
    validate_weekly(periods)
    return periods


# ---------------------------------------------------------------------------------------------
# Periods to instants


def _live(overrides: Sequence[Override]) -> list[Override]:
    return [o for o in overrides if o.undone_at is None]


def _apply_overrides(interval: Interval, overrides: Sequence[Override]) -> Interval:
    start, scheduled = interval.start, interval.scheduled_end
    if scheduled is None:
        return interval
    events = []
    for o in overrides:
        created = _utc(o.created_at, "An override")
        if interval.all_day:
            if o.kind == "close_now" and start <= created < scheduled:
                events.append((created, o))
        elif _as_date(o.opening_date) == interval.opening_date:
            if o.kind == "close_now" and created >= start:
                events.append((created, o))
            elif o.kind == "stay_open_late" and o.ends_at is not None:
                events.append((created, o))
    if not events:
        return interval
    late: datetime | None = None
    closed_early: datetime | None = None
    for created, o in sorted(events, key=lambda pair: pair[0]):
        if o.kind == "close_now":
            if closed_early is None:
                closed_early = created
        else:
            closed_early = None
            late = max(_utc(o.ends_at, "Stay open late"), scheduled)  # type: ignore[arg-type]
    if closed_early is not None:
        return replace(interval, end=closed_early, late_until=None, closed_early_at=closed_early)
    return replace(interval, end=late, late_until=late)


def _raw_intervals(hours: Hours, first: date, last: date) -> list[Interval]:
    tz = _zone(hours.tz)
    result: list[Interval] = []
    day = first
    while day <= last:
        for period in _day_periods(hours, day):
            begin, finish = _span(period)
            base = period.weekday * _DAY_MIN
            start = _local_instant(tz, day, begin - base)
            end = _local_instant(tz, day, finish - base)
            if end <= start:
                continue
            result.append(Interval(day, start, end, end, period.all_day, None, None))
        day += timedelta(days=1)
    return sorted(result, key=lambda iv: iv.start)


def periods_between(
    hours: Hours, start: datetime, end: datetime, overrides: Sequence[Override] = ()
) -> list[Interval]:
    """Every opening that intersects [start, end), sorted, as UTC instants."""
    validate_weekly(hours.weekly)
    start, end = _utc(start, "The window start"), _utc(end, "The window end")
    tz = _zone(hours.tz)
    first = start.astimezone(tz).date() - timedelta(days=1)
    last = end.astimezone(tz).date() + timedelta(days=2)
    live = _live(overrides)
    raw = [_apply_overrides(iv, live) for iv in _raw_intervals(hours, first, last)]
    merged: list[Interval] = []
    for iv in raw:
        prev = merged[-1] if merged else None
        if (
            prev is not None
            and iv.all_day
            and prev.all_day
            and prev.closed_early_at is None
            and prev.end == iv.start
        ):
            merged[-1] = replace(
                prev, end=iv.end, scheduled_end=iv.scheduled_end, closed_early_at=iv.closed_early_at
            )
        else:
            merged.append(iv)
    horizon = _local_instant(tz, last + timedelta(days=1), 0)
    result = []
    for iv in merged:
        if iv.all_day and iv.closed_early_at is None and iv.end is not None and iv.end >= horizon:
            iv = replace(iv, end=None, scheduled_end=None)
        if iv.start < end and (iv.end is None or iv.end > start):
            result.append(iv)
    return result


def _min(a: datetime | None, b: datetime | None) -> datetime | None:
    if a is None:
        return b
    if b is None:
        return a
    return min(a, b)


def zone_periods_between(
    venue: Hours,
    zone: Hours | None,
    start: datetime,
    end: datetime,
    overrides: Sequence[Override] = (),
) -> list[Interval]:
    """A zone's openings: its own hours inside the venue's. Venue overrides reach the zone."""
    venue_ivs = periods_between(venue, start, end, overrides)
    if zone is None:
        return venue_ivs
    zone_ivs = periods_between(zone, start, end)
    result: list[Interval] = []
    for v in venue_ivs:
        for z in zone_ivs:
            s = max(v.start, z.start)
            scheduled = _min(z.end, v.scheduled_end)
            reaches_close = v.scheduled_end is not None and (
                z.end is None or z.end >= v.scheduled_end
            )
            late = None
            e = scheduled
            if v.late_until is not None and reaches_close:
                e, late = v.late_until, v.late_until
            closed_early = None
            if v.closed_early_at is not None and (e is None or v.closed_early_at < e):
                e, closed_early, late = v.closed_early_at, v.closed_early_at, None
            if e is not None and s >= e:
                continue
            result.append(
                Interval(
                    opening_date=v.opening_date,
                    start=s,
                    end=e,
                    scheduled_end=scheduled,
                    all_day=v.all_day and z.all_day,
                    late_until=late,
                    closed_early_at=closed_early,
                )
            )
    return sorted(result, key=lambda iv: iv.start)


# ---------------------------------------------------------------------------------------------
# The zone day


def _close_times(
    iv: Interval, closing_mode: str
) -> tuple[datetime | None, datetime | None]:
    """When closing starts and when the zone is closed, before any clamping."""
    if iv.end is None:
        return None, None
    if iv.closed_early_at is not None and iv.end == iv.closed_early_at:
        return iv.end, iv.end + timedelta(seconds=CLOSE_NOW_FADE_S)
    if iv.all_day:
        return iv.end, iv.end
    if closing_mode == "exact":
        return max(iv.end - timedelta(seconds=CLOSING_FADE_S), iv.start), iv.end
    return iv.end, iv.end + timedelta(seconds=CLOSING_MAX_S + CLOSING_FADE_S)


_Segment = tuple[str, datetime, "datetime | None", Interval]


def _segments(intervals: Sequence[Interval], closing_mode: str) -> list[_Segment]:
    ivs = sorted(intervals, key=lambda iv: iv.start)
    segs: list[_Segment] = []
    prev_done: datetime | None = None
    for k, iv in enumerate(ivs):
        nxt = ivs[k + 1].start if k + 1 < len(ivs) else None
        if not iv.all_day:
            warm = iv.start - timedelta(seconds=WARMING_S)
            if prev_done is not None and warm < prev_done:
                warm = prev_done
            if warm < iv.start:
                segs.append(("warming", warm, iv.start, iv))
        close_begin, done = _close_times(iv, closing_mode)
        if nxt is not None:
            done = nxt if done is None or done > nxt else done
            close_begin = done if close_begin is None or close_begin > done else close_begin
        open_at = iv.start + timedelta(seconds=OPENING_FADE_S)
        if close_begin is not None and open_at > close_begin:
            open_at = close_begin
        if open_at > iv.start:
            segs.append(("opening", iv.start, open_at, iv))
        if close_begin is None or close_begin > open_at:
            segs.append(("open", open_at, close_begin, iv))
        if close_begin is not None and done is not None and done > close_begin:
            segs.append(("closing", close_begin, done, iv))
        prev_done = done
    return segs


def state_at(
    intervals: Sequence[Interval],
    instant: datetime,
    *,
    closing_mode: Literal["natural", "exact"] = "natural",
) -> ZoneState:
    """The zone's state at `instant` and its next change, from computed intervals."""
    instant = _utc(instant)
    segs = _segments(intervals, closing_mode)
    for idx, (state, t0, t1, iv) in enumerate(segs):
        if t0 <= instant and (t1 is None or instant < t1):
            if t1 is None:
                return ZoneState(state, t0, None, None, iv)  # type: ignore[arg-type]
            following = segs[idx + 1] if idx + 1 < len(segs) else None
            nxt = following[0] if following is not None and following[1] == t1 else "closed"
            return ZoneState(state, t0, t1, nxt, iv)  # type: ignore[arg-type]
    since = None
    for _state, _t0, t1, _iv in segs:
        if t1 is not None and t1 <= instant and (since is None or t1 > since):
            since = t1
    upcoming = [seg for seg in segs if seg[1] > instant]
    if upcoming:
        first = min(upcoming, key=lambda seg: seg[1])
        return ZoneState("closed", since, first[1], first[0], None)
    return ZoneState("closed", since, None, None, None)


def next_change(
    venue: Hours,
    zone: Hours | None,
    instant: datetime,
    overrides: Sequence[Override] = (),
    *,
    closing_mode: Literal["natural", "exact"] = "natural",
) -> ZoneState:
    """The zone's state now and its next change, over a 14-day window."""
    instant = _utc(instant)
    intervals = zone_periods_between(
        venue,
        zone,
        instant - timedelta(days=2),
        instant + timedelta(days=WINDOW_DAYS),
        overrides,
    )
    return state_at(intervals, instant, closing_mode=closing_mode)


def playback_offset(interval: Interval, instant: datetime) -> float:
    """Seconds since opening, so a late start joins the horizon where the schedule says."""
    return max(0.0, (_utc(instant) - interval.start).total_seconds())


# ---------------------------------------------------------------------------------------------
# Stay open late and close now


def _duration(minutes: float) -> str:
    total = int(round(minutes))
    hours, mins = divmod(total, 60)
    parts = []
    if hours:
        parts.append(f"{hours} hour" + ("s" if hours != 1 else ""))
    if mins or not hours:
        parts.append(f"{mins} minute" + ("s" if mins != 1 else ""))
    return " ".join(parts)


def _current(intervals: Sequence[Interval], instant: datetime) -> Interval | None:
    """The opening that is playing or closing (natural closing at the latest) at `instant`."""
    for state, t0, t1, iv in _segments(intervals, "natural"):
        if state in ("opening", "open", "closing") and t0 <= instant and (
            t1 is None or instant < t1
        ):
            return iv
    return None


def stay_open_late(
    intervals: Sequence[Interval],
    instant: datetime,
    *,
    until: datetime,
    role: str,
    by: str,
    allowance_min: int | None = None,
) -> Override:
    """Keep tonight's current (or closing) period open until `until`, within the allowance."""
    instant = _utc(instant)
    until = _utc(until, "The new closing time")
    iv = _current(intervals, instant)
    if iv is None:
        raise HoursError("The venue is closed, so there is nothing to keep open late.")
    if iv.scheduled_end is None or iv.all_day:
        raise HoursError("This period is open 24 hours, so it has no close to extend.")
    if until <= iv.scheduled_end or until <= instant:
        raise HoursError("Stay open late must run past the scheduled close.")
    allowance = allowance_min if allowance_min is not None else ALLOWANCE_MIN.get(role)
    if allowance is None:
        raise HoursError(f"The {role.replace('_', ' ')} role cannot keep the venue open late.")
    past = (until - iv.scheduled_end).total_seconds() / 60.0
    if past > allowance:
        raise HoursError(
            f"That is {_duration(past)} past the scheduled close, beyond the "
            f"{role.replace('_', ' ')} allowance of {_duration(allowance)}."
        )
    return Override(
        kind="stay_open_late",
        opening_date=iv.opening_date,
        created_at=instant,
        ends_at=until,
        created_by=by,
    )


def close_now(intervals: Sequence[Interval], instant: datetime, *, by: str) -> Override:
    """End the current period now with a 60 second fade; music returns at the next period."""
    instant = _utc(instant)
    iv = _current(intervals, instant)
    if iv is None:
        raise HoursError("The venue is already closed.")
    return Override(
        kind="close_now",
        opening_date=iv.opening_date,
        created_at=instant,
        ends_at=None,
        created_by=by,
    )


def undo_close_now(override: Override, instant: datetime) -> Override:
    """Undo a close now within 5 minutes; the music comes back with a fade-in."""
    if override.kind != "close_now":
        raise HoursError("Only close now can be undone.")
    if override.undone_at is not None:
        raise HoursError("That close now has already been undone.")
    elapsed = (_utc(instant) - _utc(override.created_at, "The close now")).total_seconds()
    if elapsed < 0 or elapsed > CLOSE_NOW_UNDO_S:
        raise HoursError(
            "Close now can only be undone within 5 minutes; it was pressed "
            f"{_duration(elapsed / 60.0)} ago."
        )
    return replace(override, undone_at=_utc(instant))


# ---------------------------------------------------------------------------------------------
# Holiday suggestions (never applied unless accepted into Hours.exceptions)

_HOLIDAYS: dict[str, tuple[tuple[int, int, str], ...]] = {
    "GB": (
        (1, 1, "New Year's Day"),
        (12, 25, "Christmas Day"),
        (12, 26, "Boxing Day"),
    ),
    "PT": (
        (1, 1, "Ano Novo"),
        (4, 25, "Dia da Liberdade"),
        (5, 1, "Dia do Trabalhador"),
        (6, 10, "Dia de Portugal"),
        (8, 15, "Assuncao de Nossa Senhora"),
        (10, 5, "Implantacao da Republica"),
        (11, 1, "Dia de Todos os Santos"),
        (12, 1, "Restauracao da Independencia"),
        (12, 8, "Imaculada Conceicao"),
        (12, 25, "Natal"),
    ),
    "US": (
        (1, 1, "New Year's Day"),
        (6, 19, "Juneteenth"),
        (7, 4, "Independence Day"),
        (11, 11, "Veterans Day"),
        (12, 25, "Christmas Day"),
    ),
    "AU": (
        (1, 1, "New Year's Day"),
        (1, 26, "Australia Day"),
        (4, 25, "Anzac Day"),
        (12, 25, "Christmas Day"),
        (12, 26, "Boxing Day"),
    ),
}
_COUNTRY_ALIASES = {"UK": "GB"}


def suggest_holidays(country: str, year: int) -> list[DateException]:
    """Fixed-date public holidays as closed-day suggestions for a manager to accept."""
    code = str(country).strip().upper()
    code = _COUNTRY_ALIASES.get(code, code)
    return [
        DateException(date=date(year, month, day), closed=True, note=name)
        for month, day, name in _HOLIDAYS.get(code, ())
    ]
