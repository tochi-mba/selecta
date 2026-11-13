"""Zone volume caps and quiet hours (ADR-0450, BZ-0450-09).

Volume is the kiosk player's software gain, 0..1, after loudness levelling. Staff may set any
level from silent up to the zone's cap. Quiet hours are local-time windows (in the venue's time
zone, overnight allowed, DST nights included) with a lower cap; entering one lowers the cap
over `RAMP_SECONDS`, and leaving one never raises the volume by itself (`step` only lowers).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

RAMP_SECONDS = 30.0


def minutes_of(text: str) -> int:
    if not isinstance(text, str) or len(text) != 5 or text[2] != ":":
        raise ValueError(f"times are HH:MM, not {text!r}")
    hours, minutes = int(text[:2]), int(text[3:])
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        raise ValueError(f"{text!r} isn't a time of day")
    return hours * 60 + minutes


def level(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


@dataclass(frozen=True)
class QuietWindow:
    start: str
    end: str
    cap: float
    weekdays: tuple[int, ...] | None = None  # weekday of the start (0 is Monday); None is daily

    def __post_init__(self) -> None:
        if minutes_of(self.start) == minutes_of(self.end):
            raise ValueError("quiet hours must start and end at different times")
        if not 0.0 <= self.cap <= 1.0:
            raise ValueError("a quiet hours cap is from 0 to 1")


@dataclass(frozen=True)
class VolumeRules:
    cap: float = 1.0
    quiet: tuple[QuietWindow, ...] = ()
    time_zone: str = "Europe/London"


def _start_instant(day: date, minute: int, tz: ZoneInfo) -> datetime:
    """When local `day` at `minute` happens. A time skipped by DST counts from the jump; a
    repeated one from its first occurrence."""
    wall = datetime.combine(day, time(minute // 60, minute % 60))
    first = wall.replace(tzinfo=tz, fold=0).astimezone(UTC)
    second = wall.replace(tzinfo=tz, fold=1).astimezone(UTC)
    return min(first, second)


def quiet_window_at(rules: VolumeRules, at: datetime) -> tuple[QuietWindow, datetime] | None:
    tz = ZoneInfo(rules.time_zone)
    local = (at if at.tzinfo else at.replace(tzinfo=UTC)).astimezone(tz)
    minute = local.hour * 60 + local.minute
    today = local.date()
    for window in rules.quiet:
        start, end = minutes_of(window.start), minutes_of(window.end)
        began: date | None = None
        if start < end and start <= minute < end:
            began = today
        elif start > end and minute >= start:
            began = today
        elif start > end and minute < end:
            began = today - timedelta(days=1)
        if began is None:
            continue
        if window.weekdays is not None and began.weekday() not in window.weekdays:
            continue
        return window, _start_instant(began, start, tz)
    return None


def cap_at(rules: VolumeRules, at: datetime) -> float:
    """The cap in force at `at`, ramping down over 30 s from the start of quiet hours."""
    normal = level(rules.cap)
    found = quiet_window_at(rules, at)
    if found is None:
        return normal
    window, began = found
    quiet = min(level(window.cap), normal)
    moment = at if at.tzinfo else at.replace(tzinfo=UTC)
    elapsed = (moment - began).total_seconds()
    share = 1.0 if elapsed < 0 else min(elapsed / RAMP_SECONDS, 1.0)
    return normal - (normal - quiet) * share


def clamp(requested: float, rules: VolumeRules, at: datetime) -> float:
    """A staff choice of level, held to the cap: the cap wins."""
    return min(level(requested), cap_at(rules, at))


def step(current: float, rules: VolumeRules, at: datetime) -> float:
    """The player's level a moment later: lowered to the cap, never raised by itself."""
    return min(level(current), cap_at(rules, at))


def rules_from_json(raw: dict | None, time_zone: str) -> VolumeRules:
    raw = raw or {}
    quiet = tuple(
        QuietWindow(
            start=q["start"], end=q["end"], cap=float(q["cap"]),
            weekdays=tuple(q["weekdays"]) if q.get("weekdays") is not None else None,
        )
        for q in raw.get("quiet_hours") or ()
    )
    cap = raw.get("cap")
    return VolumeRules(cap=level(1.0 if cap is None else cap), quiet=quiet, time_zone=time_zone)


__all__ = [
    "RAMP_SECONDS", "QuietWindow", "VolumeRules", "cap_at", "clamp", "quiet_window_at",
    "rules_from_json", "step",
]
