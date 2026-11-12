"""Staged rollout of a new model deployment: 5%, 25%, then 100%, each step compared against the
deployment it replaces (ADR-0404 SC-0404-06; docs/saas/09-lucy-ai-gateway.md §9.6).

A deployment passes the evaluation set first (`evaluation.gate`). Then the active routing lists
it beside the previous deployment, and `advance` moves its `rollout_percent` one stage at a
time. Before each step after the first, `compare` reads both deployments' real Lucy runs since a
given moment (`ai_runs`) and judges the candidate against the previous one:

- enough finished turns on the candidate (`min_turns`) to judge at all, or the step waits;
- failure rate (failed, incomplete or abandoned turns) no more than `max_failure_increase`
  above the previous deployment's;
- p95 turn time no more than `max_p95_ratio` times the previous deployment's;
- mean cost per turn no more than `max_cost_ratio` times the previous deployment's.

A regression rolls the candidate back to 0%, so routing sends everyone to the previous
deployment again (rollout buckets are stable, so a later retry reaches the same accounts first).
Run from staging or production with `python -m selecta.ops.lucy_eval rollout ...`.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field, replace
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.ai import registry
from selecta.ai.runs import Outcome
from selecta.ai.schema import ai_runs

STAGES = (5, 25, 100)
FAILED = frozenset({Outcome.FAILED.value, Outcome.INCOMPLETE.value, Outcome.ABANDONED.value})
JUDGED = FAILED | {Outcome.COMPLETED.value}


@dataclass(frozen=True)
class Limits:
    min_turns: int = 50
    max_failure_increase: float = 0.02
    max_p95_ratio: float = 1.25
    max_cost_ratio: float = 1.25


@dataclass(frozen=True)
class Metrics:
    deployment_id: str
    turns: int
    failure_rate: float
    p95_seconds: float
    mean_cost_usd: float


@dataclass(frozen=True)
class Comparison:
    candidate: Metrics
    previous: Metrics
    regressions: tuple[str, ...] = ()
    waiting: str | None = None
    """Why there is not enough evidence yet to judge, or None."""

    @property
    def ok(self) -> bool:
        return not self.regressions and self.waiting is None


@dataclass(frozen=True)
class Step:
    deployment_id: str
    verdict: str
    """"started", "advanced", "held", "rolled_back" or "done"."""
    from_percent: int
    to_percent: int
    comparison: Comparison | None = None
    notes: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(0.95 * len(ordered)) - 1)]


def metrics(conn: Connection, deployment_id: str, since: float) -> Metrics:
    """One deployment's finished turns since `since`; cancelled turns are not judged."""
    rows = conn.execute(
        sa.select(
            ai_runs.c.outcome, ai_runs.c.started_at, ai_runs.c.finished_at, ai_runs.c.cost_usd
        ).where(
            ai_runs.c.deployment_id == deployment_id,
            ai_runs.c.started_at >= since,
            ai_runs.c.outcome.in_(sorted(JUDGED)),
        )
    ).all()
    if not rows:
        return Metrics(deployment_id, 0, 0.0, 0.0, 0.0)
    failed = sum(row.outcome in FAILED for row in rows)
    times = [row.finished_at - row.started_at for row in rows if row.finished_at is not None]
    return Metrics(
        deployment_id,
        len(rows),
        failed / len(rows),
        _p95(times),
        sum(float(row.cost_usd) for row in rows) / len(rows),
    )


def compare(
    conn: Connection,
    candidate_id: str,
    previous_id: str,
    since: float,
    limits: Limits = Limits(),
) -> Comparison:
    new, old = metrics(conn, candidate_id, since), metrics(conn, previous_id, since)
    if new.turns < limits.min_turns:
        return Comparison(
            new, old, waiting=f"{new.turns} turns on {candidate_id}, need {limits.min_turns}"
        )
    problems = []
    if new.failure_rate > old.failure_rate + limits.max_failure_increase:
        problems.append(f"failure rate {new.failure_rate:.1%} vs {old.failure_rate:.1%}")
    if old.turns and new.p95_seconds > old.p95_seconds * limits.max_p95_ratio:
        problems.append(f"p95 {new.p95_seconds:.1f} s vs {old.p95_seconds:.1f} s")
    if old.turns and new.mean_cost_usd > old.mean_cost_usd * limits.max_cost_ratio:
        problems.append(f"cost per turn ${new.mean_cost_usd:.4f} vs ${old.mean_cost_usd:.4f}")
    return Comparison(new, old, tuple(problems))


def next_stage(percent: int) -> int | None:
    return next((stage for stage in STAGES if stage > percent), None)


def advance(
    conn: Connection,
    candidate_id: str,
    previous_id: str,
    since: float,
    limits: Limits = Limits(),
    *,
    dry_run: bool = False,
) -> Step:
    """Take the candidate one rollout stage further, hold it, or roll it back."""
    deployments = registry.load_deployments(conn)
    candidate = deployments.get(candidate_id)
    if candidate is None or previous_id not in deployments:
        raise registry.RegistryError("Both the candidate and the previous deployment must exist.")
    if candidate.eval_passed_at is None:
        raise registry.RegistryError(f"{candidate_id} hasn't passed the evaluation set.")
    current = candidate.rollout_percent
    if current >= 100:
        return Step(candidate_id, "done", current, current)
    to = next_stage(current)
    assert to is not None
    comparison = None
    if current > 0:
        comparison = compare(conn, candidate_id, previous_id, since, limits)
        if comparison.regressions:
            to, verdict = 0, "rolled_back"
        elif comparison.waiting:
            return Step(candidate_id, "held", current, current, comparison)
        else:
            verdict = "advanced"
    else:
        verdict = "started"
    if not dry_run:
        registry.save_deployment(conn, replace(candidate, rollout_percent=to))
    return Step(
        candidate_id,
        verdict,
        current,
        to,
        comparison,
        ["dry run: nothing saved"] if dry_run else [],
    )


__all__ = [
    "STAGES",
    "Comparison",
    "Limits",
    "Metrics",
    "Step",
    "advance",
    "compare",
    "metrics",
    "next_stage",
]
