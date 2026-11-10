"""What a durable job is: its states, the moves between them, its error classes and its rows.

A job moves through the lifecycle in §4A.3. Only the moves in `TRANSITIONS` are allowed, and
`selecta.work.state` is the one place that changes a job's state, so an impossible move fails
loudly instead of leaving a job somewhere nothing will ever pick it up. Terminal states never
change again: a failed job is retried as a new job, so its history stays true.

An attempt is one try at a job. It holds a lease with a fencing token; only the attempt whose
token equals the job's `lease_generation` may publish, so a worker that lost its lease can never
overwrite newer work.
"""

from __future__ import annotations

import random
from collections.abc import Mapping
from dataclasses import dataclass, fields
from enum import StrEnum
from types import MappingProxyType
from typing import Any

from selecta.work.catalogue import (  # noqa: F401 - the catalogue is part of the model
    CATALOGUE,
    POOLS,
    JobType,
    UnknownJobType,
    flag_for,
    lookup,
)


class JobState(StrEnum):
    CREATED = "created"
    WAITING_DEPS = "waiting_deps"
    QUEUED = "queued"
    LEASED = "leased"
    RUNNING = "running"
    VALIDATING = "validating"
    SUCCEEDED = "succeeded"
    RETRY_SCHEDULED = "retry_scheduled"
    BLOCKED = "blocked"
    CANCEL_REQUESTED = "cancel_requested"
    CANCELLED = "cancelled"
    FAILED = "failed"
    QUARANTINED = "quarantined"


S = JobState
TERMINAL = frozenset({S.SUCCEEDED, S.CANCELLED, S.FAILED, S.QUARANTINED})
ACTIVE = frozenset({S.LEASED, S.RUNNING, S.VALIDATING, S.CANCEL_REQUESTED})
"""States that hold a worker slot: an attempt is live."""
UNSTARTED = frozenset({S.CREATED, S.WAITING_DEPS, S.QUEUED, S.RETRY_SCHEDULED, S.BLOCKED})
"""States a cancel ends at once, because no worker holds the job."""
UNSUCCESSFUL = frozenset({S.CANCELLED, S.FAILED, S.QUARANTINED})
"""Terminal states that block whatever depends on the job."""

_FAILING = {S.QUEUED, S.RETRY_SCHEDULED, S.FAILED, S.QUARANTINED, S.BLOCKED}
TRANSITIONS: Mapping[JobState, frozenset[JobState]] = MappingProxyType(
    {
        S.CREATED: frozenset({S.WAITING_DEPS, S.QUEUED, S.BLOCKED, S.CANCELLED, S.SUCCEEDED}),
        S.WAITING_DEPS: frozenset({S.QUEUED, S.BLOCKED, S.CANCELLED, S.SUCCEEDED}),
        S.QUEUED: frozenset({S.LEASED, S.WAITING_DEPS, S.BLOCKED, S.CANCELLED, S.FAILED}),
        S.LEASED: frozenset({S.RUNNING, S.VALIDATING, S.CANCEL_REQUESTED, *_FAILING}),
        S.RUNNING: frozenset({S.VALIDATING, S.CANCEL_REQUESTED, *_FAILING}),
        S.VALIDATING: frozenset({S.SUCCEEDED, S.CANCEL_REQUESTED, *_FAILING}),
        S.RETRY_SCHEDULED: frozenset({S.QUEUED, S.BLOCKED, S.CANCELLED}),
        S.BLOCKED: frozenset({S.WAITING_DEPS, S.QUEUED, S.CANCELLED}),
        S.CANCEL_REQUESTED: frozenset({S.CANCELLED}),
        S.SUCCEEDED: frozenset(),
        S.CANCELLED: frozenset(),
        S.FAILED: frozenset(),
        S.QUARANTINED: frozenset(),
    }
)
"""Allowed moves. A cancel that arrives while a worker holds the job goes through
`cancel_requested`, and from there only to `cancelled`: a cancelled job never publishes."""


class IllegalTransition(ValueError):
    """A move the lifecycle doesn't allow, which always means a bug in the caller."""


def check_transition(current: JobState | str, new: JobState | str) -> None:
    current, new = JobState(current), JobState(new)
    if new not in TRANSITIONS[current]:
        raise IllegalTransition(f"A job can't go from {current} to {new}.")


def is_terminal(state: JobState | str) -> bool:
    return JobState(state) in TERMINAL


# --- Errors and retries (§4A.7) ----------------------------------------------------------------


class ErrorClass(StrEnum):
    TRANSIENT = "transient"
    RESOURCE = "resource"
    INPUT_INVALID = "input_invalid"
    DEPENDENCY = "dependency"
    POISON = "poison"
    ENGINE_BUG = "engine_bug"
    WORKER_LOST = "worker_lost"
    """The lease ran out: the worker crashed, hung or lost its network. Counts towards poison."""


class AttemptOutcome(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    LEASE_EXPIRED = "lease_expired"
    TIMED_OUT = "timed_out"
    RELEASED = "released"
    """Gave way (preempted, or its worker shut down) and went back in line without counting."""
    CANCELLED = "cancelled"
    SUPERSEDED = "superseded"


@dataclass(frozen=True)
class RetryRule:
    retries: bool
    max_failures: int | None = None
    """Failures of this class a job may have before it fails for good (None: the job's limit)."""
    base_s: float = 5.0
    max_s: float = 600.0


RETRY_RULES: Mapping[ErrorClass, RetryRule] = MappingProxyType(
    {
        ErrorClass.TRANSIENT: RetryRule(True),
        ErrorClass.RESOURCE: RetryRule(True, base_s=1.0, max_s=60.0),
        ErrorClass.INPUT_INVALID: RetryRule(False),
        ErrorClass.DEPENDENCY: RetryRule(False),
        ErrorClass.POISON: RetryRule(False),
        ErrorClass.ENGINE_BUG: RetryRule(True, max_failures=2, base_s=30.0),
        ErrorClass.WORKER_LOST: RetryRule(True),
    }
)
"""Transient: back off 5 s → 10 min with jitter, up to the job's attempts (6 by default).
Resource: retry one worker class up when the pool has one, else fail as too large. Engine bug:
retry once. Input invalid fails, dependency blocks, poison quarantines, all at once."""


def backoff_s(failures: int, rule: RetryRule, rng: random.Random) -> float:
    """Exponential backoff with equal jitter: half the step fixed, half random."""
    step = min(rule.max_s, rule.base_s * (2 ** max(failures - 1, 0)))
    return step / 2 + rng.uniform(0, step / 2)


@dataclass(frozen=True)
class FailureDecision:
    state: JobState
    delay_s: float = 0.0
    min_worker_class: int | None = None
    reason: str = ""


def after_failure(
    error_class: ErrorClass | str,
    *,
    failures_of_class: int,
    attempt_count: int,
    max_attempts: int,
    crashed_workers: int,
    poison_workers: int,
    worker_class: int,
    largest_worker_class: int,
    rng: random.Random,
) -> FailureDecision:
    """What happens to a job after one of its attempts fails (counts include this failure).

    A lost worker goes straight back in line (§4A.6); other retries wait in `retry_scheduled`.
    """
    error_class = ErrorClass(error_class)
    rule = RETRY_RULES[error_class]
    if error_class == ErrorClass.POISON or crashed_workers >= poison_workers:
        return FailureDecision(S.QUARANTINED, reason="It stopped several workers in a row.")
    if error_class == ErrorClass.DEPENDENCY:
        return FailureDecision(S.BLOCKED, reason="Something it needs didn't finish.")
    if not rule.retries:
        return FailureDecision(S.FAILED, reason="Its input can't be used.")
    if attempt_count >= max_attempts:
        return FailureDecision(S.FAILED, reason="It failed on every attempt.")
    if rule.max_failures is not None and failures_of_class >= rule.max_failures:
        return FailureDecision(S.FAILED, reason="It hit the same problem twice.")
    if error_class == ErrorClass.RESOURCE:
        if worker_class >= largest_worker_class:
            return FailureDecision(S.FAILED, reason="It's too large for any worker.")
        return FailureDecision(
            S.RETRY_SCHEDULED, backoff_s(1, rule, rng), worker_class + 1, "Trying a bigger worker."
        )
    if error_class == ErrorClass.WORKER_LOST:
        return FailureDecision(S.QUEUED, reason="Its worker stopped answering.")
    return FailureDecision(S.RETRY_SCHEDULED, backoff_s(failures_of_class, rule, rng))


# --- Rows --------------------------------------------------------------------------------------


def _from_row(cls, row: Any):
    mapping = row._mapping if hasattr(row, "_mapping") else row
    return cls(**{f.name: mapping[f.name] for f in fields(cls) if f.name in mapping})


@dataclass(frozen=True)
class Job:
    id: str
    workspace_id: str
    type: str
    pool: str
    lane: str
    base_lane: str
    urgency: int
    base_urgency: int
    state: str
    input_ref: Any
    est_cost_s: float
    max_attempts: int
    max_run_s: float
    created_at: float
    updated_at: float
    idempotency_key: str | None = None
    needed_by: float | None = None
    line_position: int | None = None
    actual_cost_s: float | None = None
    attempt_count: int = 0
    not_before: float | None = None
    engine_version_required: int | None = None
    min_worker_class: int = 0
    gpu_memory_mb: int | None = None
    scratch_mb: int | None = None
    entitlement_version: int | None = None
    created_by: str | None = None
    flag_id: str | None = None
    parent_id: str | None = None
    lease_generation: int = 0
    error_class: str | None = None
    error_detail: str | None = None
    progress_done: float = 0.0
    progress_total: float | None = None
    progress_at: float | None = None
    result: Any = None
    boosted_at: float | None = None
    queued_at: float | None = None
    started_at: float | None = None
    finished_at: float | None = None

    @classmethod
    def from_row(cls, row: Any) -> Job:
        return _from_row(cls, row)

    @property
    def terminal(self) -> bool:
        return is_terminal(self.state)


@dataclass(frozen=True)
class Attempt:
    id: str
    workspace_id: str
    job_id: str
    pool: str
    lane: str
    fencing_token: int
    est_cost_s: float
    started_at: float
    lease_expires_at: float
    deadline_at: float
    worker_id: str | None = None
    heartbeat_at: float | None = None
    ended_at: float | None = None
    outcome: str | None = None
    cancel_requested: bool = False
    cancel_reason: str | None = None
    progress_done: float = 0.0
    progress_at: float | None = None
    cost_s: float | None = None
    error_class: str | None = None
    error_detail: str | None = None

    @classmethod
    def from_row(cls, row: Any) -> Attempt:
        return _from_row(cls, row)

    @property
    def live(self) -> bool:
        return self.outcome is None
