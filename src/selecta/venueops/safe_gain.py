"""Safe venue loudness: cap automatic gain changes (ADR-0435, AV-0435-05).

Autopilot may nudge the master gain (level matching between songs, a quiet room, a request to
lift the energy), but it must never make a room suddenly louder. `SafeGain.propose` takes the gain
Autopilot wants and returns the gain it may actually set, with the reasons it was held back:

- each change rises by at most `max_step_db`;
- over any rolling minute the gain rises by at most `max_rise_per_min_db`;
- the gain never goes above `ceiling_db` relative to the calibrated venue level (0 dB is the level
  the venue was calibrated at during setup);
- while an emergency stop is active the gain never rises at all;
- if the limiter reports it is already reducing gain by more than `limiter_max_reduction_db`,
  automatic rises are refused (the signal is already too hot).

Decreases are always allowed immediately: getting quieter is never unsafe. A person turning the
physical volume or the staff manual level is not routed through here. Flag: `venue.safe_gain`.
Whether the result sounds right in a real room is a listening check for a person.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

FLAG = "venue.safe_gain"


@dataclass(frozen=True)
class GainLimits:
    max_step_db: float = 1.0
    max_rise_per_min_db: float = 3.0
    ceiling_db: float = 0.0
    """Highest automatic gain relative to the calibrated level."""
    limiter_max_reduction_db: float = 3.0


@dataclass(frozen=True)
class GainDecision:
    wanted_db: float
    applied_db: float
    reasons: tuple[str, ...]

    @property
    def held(self) -> bool:
        return self.applied_db != self.wanted_db


@dataclass
class SafeGain:
    limits: GainLimits = field(default_factory=GainLimits)
    current_db: float = 0.0
    emergency_stop: bool = False
    _rises: deque[tuple[float, float]] = field(default_factory=deque)

    def _risen_last_minute(self, now: float) -> float:
        while self._rises and now - self._rises[0][0] >= 60.0:
            self._rises.popleft()
        return sum(amount for _, amount in self._rises)

    def propose(self, wanted_db: float, now: float, limiter_reduction_db: float = 0.0) -> GainDecision:
        """Apply the caps to one automatic change and return what was set."""
        reasons: list[str] = []
        target = wanted_db
        if target <= self.current_db:
            self.current_db = target
            return GainDecision(wanted_db, target, ())
        if self.emergency_stop:
            return GainDecision(wanted_db, self.current_db, ("emergency stop: never raise",))
        if limiter_reduction_db > self.limits.limiter_max_reduction_db:
            return GainDecision(
                wanted_db, self.current_db,
                (f"limiter already reducing {limiter_reduction_db:.1f} dB",),
            )
        if target > self.limits.ceiling_db:
            target = self.limits.ceiling_db
            reasons.append(f"ceiling {self.limits.ceiling_db:+.1f} dB over calibrated level")
        if target - self.current_db > self.limits.max_step_db:
            target = self.current_db + self.limits.max_step_db
            reasons.append(f"step capped at {self.limits.max_step_db:.1f} dB")
        room = self.limits.max_rise_per_min_db - self._risen_last_minute(now)
        if target - self.current_db > room:
            target = self.current_db + max(0.0, room)
            reasons.append(f"rise capped at {self.limits.max_rise_per_min_db:.1f} dB per minute")
        rise = target - self.current_db
        if rise > 0:
            self._rises.append((now, rise))
            self.current_db = target
        return GainDecision(wanted_db, round(self.current_db, 6), tuple(reasons))


__all__ = ["FLAG", "GainDecision", "GainLimits", "SafeGain"]
