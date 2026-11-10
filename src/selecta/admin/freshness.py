"""How fresh an admin number is: every value on the console carries its as-of time (ADR-0408).

A number is `fresh` while its age is within `stale_after`, `stale` until `unknown_after`, and then
`unknown`: the console shows the age and stops showing the value, because a number that old can
mislead more than it helps. A number never measured is `unknown` with no age. A time in the
future (a clock out of step) counts as age zero rather than as fresher than now.

The defaults suit aggregates refreshed every 15 to 60 seconds (§7.5): stale after two minutes,
unknown after ten.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

STALE_AFTER_S = 120.0
UNKNOWN_AFTER_S = 600.0


class Freshness(StrEnum):
    FRESH = "fresh"
    STALE = "stale"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class Thresholds:
    stale_after_s: float = STALE_AFTER_S
    unknown_after_s: float = UNKNOWN_AFTER_S

    def __post_init__(self) -> None:
        if not 0 < self.stale_after_s <= self.unknown_after_s:
            raise ValueError("stale_after must be positive and no later than unknown_after")


DEFAULT = Thresholds()


@dataclass(frozen=True)
class Reading:
    """One number as the console shows it."""

    value: Any
    as_of: float | None
    age_s: float | None
    state: Freshness

    def to_dict(self) -> dict[str, Any]:
        return {"value": self.value, "as_of": self.as_of, "age_s": self.age_s,
                "state": self.state.value}


def classify(as_of: float | None, now: float, thresholds: Thresholds = DEFAULT) -> Freshness:
    if as_of is None:
        return Freshness.UNKNOWN
    age = max(0.0, now - as_of)
    if age <= thresholds.stale_after_s:
        return Freshness.FRESH
    if age <= thresholds.unknown_after_s:
        return Freshness.STALE
    return Freshness.UNKNOWN


def reading(
    value: Any, as_of: float | None, now: float, thresholds: Thresholds = DEFAULT
) -> Reading:
    """`value` as of `as_of`, judged at `now`. An unknown reading carries no value."""
    state = classify(as_of, now, thresholds)
    age = None if as_of is None else max(0.0, now - as_of)
    return Reading(None if state is Freshness.UNKNOWN else value, as_of, age, state)
