"""Admission control: staying healthy under overload without ever dropping accepted work (§4A.4).

- Per-workspace caps on queued jobs per type. Beyond a cap, new work is accepted as *planned* and
  materialised in batches as earlier work drains (a 20,000-song import creates analysis jobs in
  pages of 500).
- Speculative work draws on a daily CPU-minute budget per plan (10 / 60 / 240). When it's spent,
  nothing speculative is created.
- When a pool's estimated backlog would take longer than a threshold to drain, Free standard work
  is deferred: accepted, shown as waiting for capacity. Interactive work is never deferred.

These are pure decisions over numbers the store reads (`JobStore.admit`), so the simulator and
the admin forecast use exactly the same rules.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from enum import StrEnum

from selecta.scheduling.policy import Lane, PolicyConfig, Tier


class Verdict(StrEnum):
    ACCEPT = "accept"
    PLAN = "plan"
    """Over the type's queued cap: keep it as planned work and materialise it later."""
    DEFER = "defer"
    """Accepted, but held back (`not_before`) until the pool has capacity."""
    REFUSE = "refuse"
    """Speculative work with no budget left: don't create it at all."""


@dataclass(frozen=True)
class Admission:
    verdict: Verdict
    reason: str = ""
    defer_s: float = 0.0

    @property
    def creates_job(self) -> bool:
        return self.verdict in (Verdict.ACCEPT, Verdict.DEFER)


def drain_seconds(queued_est_s: float, slots: int) -> float:
    """How long a pool's queued work would take with every slot busy on it."""
    if queued_est_s <= 0:
        return 0.0
    if slots <= 0:
        return float("inf")
    return queued_est_s / slots


def speculative_left_s(config: PolicyConfig, tier: str | None, used_s: float) -> float:
    """Reference seconds of spare-time work this account may still use today."""
    if not config.enforce_speculative_budget:
        return float("inf")
    return max(config.speculative_budget_s(tier) - max(used_s, 0.0), 0.0)


def admit(
    config: PolicyConfig,
    *,
    job_type: str,
    lane: Lane | str,
    tier: str | None,
    queued_of_type: int,
    backlog_drain_s: float,
    speculative_used_s: float = 0.0,
) -> Admission:
    """Should one new job be created now, held as planned, deferred, or not made at all?"""
    lane = Lane(lane)
    if lane == Lane.SPECULATIVE and speculative_left_s(config, tier, speculative_used_s) <= 0:
        return Admission(Verdict.REFUSE, "Today's spare-time budget is used up.")
    if queued_of_type >= config.queued_cap(job_type):
        return Admission(Verdict.PLAN, f"{queued_of_type} {job_type} jobs are already queued.")
    overloaded = backlog_drain_s > config.overload_drain_s
    if (
        overloaded
        and config.enforce_plan_backpressure
        and lane == Lane.STANDARD
        and (tier or config.default_tier) == Tier.FREE
    ):
        wait = min(backlog_drain_s - config.overload_drain_s, config.max_defer_s)
        return Admission(Verdict.DEFER, "Waiting for capacity.", max(wait, 0.0))
    return Admission(Verdict.ACCEPT)


def next_page(
    config: PolicyConfig,
    *,
    job_type: str,
    outstanding: int,
    remaining: int,
    queued_of_type: int,
) -> int:
    """How many planned children a workflow should materialise now.

    `outstanding` is the workflow's children that are queued or running, `remaining` those still
    only planned. A new page is made once the last one has half drained, never past the type's
    queued cap.
    """
    page = config.materialise_page
    if remaining <= 0 or outstanding > page // 2:
        return 0
    room = config.queued_cap(job_type) - queued_of_type
    return max(min(page, remaining, room), 0)


@dataclass
class SpeculativeLedger:
    """In-memory daily spend per account, for the simulator and admin forecasts.

    The database store sums `job_attempts` instead, so the two agree on what counts: every
    speculative attempt's cost, including attempts preempted part-way.
    """

    config: PolicyConfig
    day_s: float = 86_400.0
    _spent: dict[tuple[str, int], float] = field(default_factory=lambda: defaultdict(float))

    def _day(self, now: float) -> int:
        return int(now // self.day_s)

    def spend(self, workspace_id: str, seconds: float, now: float) -> None:
        self._spent[(workspace_id, self._day(now))] += max(seconds, 0.0)

    def used(self, workspace_id: str, now: float) -> float:
        return self._spent.get((workspace_id, self._day(now)), 0.0)

    def left(self, workspace_id: str, tier: str | None, now: float) -> float:
        return speculative_left_s(self.config, tier, self.used(workspace_id, now))
