"""How shared workers are divided: pool, then lane, then account, then job (ADR-0395).

Everything here is a pure function of its arguments. The database claim (`selecta.work.claims`)
and the simulator (`selecta.scheduling.simulator`) call the same functions, so a policy change
that passes the simulator behaves the same way on real workers.

The rules, in the order a claim applies them:

- Lanes inside a pool: interactive (someone is waiting on it this second), standard (asked for,
  not waited on), speculative (spare time). Interactive and standard share the pool by virtual
  time with weights 4 and 1, so when both are backlogged standard still gets about a fifth of the
  compute: the weight is the floor that keeps imports and exports moving. Speculative runs only
  when neither has eligible work. In a pool of two or more slots it never takes the last free
  ones; in a one-slot pool it runs when the pool is idle and gives way when other work arrives.
- Accounts inside a lane: start-time fair queuing. Each (pool, lane, workspace) has a virtual time
  V. Dispatch picks the smallest V and charges `est_cost_s / weight`; the finish corrects by the
  difference between actual and estimated cost, clamped. A workspace that comes back after idling
  starts at the lane's current floor, so it can't bank credit while away.
- Jobs inside an account: urgency, then deadline, then the user's render-line order, then age.

Weights, caps and the rest live in a versioned `PolicyConfig`, read at dispatch time, so a plan
change speeds up or slows down work that is already queued without touching running attempts.
"""

from __future__ import annotations

import math
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field, replace
from enum import StrEnum
from types import MappingProxyType


class Lane(StrEnum):
    INTERACTIVE = "interactive"
    STANDARD = "standard"
    SPECULATIVE = "speculative"


LANES = (Lane.INTERACTIVE, Lane.STANDARD, Lane.SPECULATIVE)
"""Most urgent first."""
COMPETING_LANES = (Lane.INTERACTIVE, Lane.STANDARD)
"""The lanes that share a pool by virtual time. Speculative is strictly last."""


def lane_rank(lane: Lane | str) -> int:
    """0 for interactive, 1 for standard, 2 for speculative: lower is more urgent."""
    return LANES.index(Lane(lane))


class Tier(StrEnum):
    FREE = "free"
    STANDARD = "standard"
    PREMIUM = "premium"


def _frozen(mapping: Mapping) -> Mapping:
    return MappingProxyType(
        {
            key: _frozen(value) if isinstance(value, Mapping) else value
            for key, value in mapping.items()
        }
    )


def _thaw(value):
    if isinstance(value, Mapping):
        return {key: _thaw(item) for key, item in value.items()}
    if isinstance(value, frozenset):
        return sorted(value)
    return value


@dataclass(frozen=True)
class PolicyConfig:
    """Every number the scheduler uses, in one versioned value.

    Admins tune these; a new version is forecast with the simulator before it is applied, and
    `JobStore.config` is swapped whole, so a claim never sees half of one version and half of
    another. Costs are in seconds of the pool's reference worker.
    """

    version: int = 1
    tier_weights: Mapping[str, float] = field(
        default_factory=lambda: _frozen({"free": 1.0, "standard": 3.0, "premium": 6.0})
    )
    lane_weights: Mapping[str, float] = field(
        default_factory=lambda: _frozen({"interactive": 4.0, "standard": 1.0})
    )
    lane_caps: Mapping[str, Mapping[str, int]] = field(
        default_factory=lambda: _frozen(
            {
                "free": {"standard": 1, "interactive": 1, "speculative": 1},
                "standard": {"standard": 2, "interactive": 2, "speculative": 1},
                "premium": {"standard": 4, "interactive": 3, "speculative": 1},
            }
        )
    )
    """Concurrent attempts per workspace, per pool, per lane (plan catalogue §3.1)."""
    pool_cap_overrides: Mapping[str, Mapping[str, Mapping[str, int]]] = field(
        default_factory=lambda: _frozen({})
    )
    """pool -> tier -> lane -> cap, for a pool that needs different caps (the GPU pool, say)."""
    default_tier: str = "free"
    boost_allowance: int = 3
    boost_window_s: float = 600.0
    slack_factor: float = 1.5
    speculative_headroom_slots: int = 1
    speculative_headroom_share: float = 0.10
    rebase_threshold: float = 1_000_000.0
    correction_clamp_s: float = 600.0
    head_batch: int = 8
    """K: how many workspace heads one claim round reads."""
    job_batch: int = 16
    """How many of one workspace's best jobs a claim locks and checks."""
    claim_rounds: int = 4
    """Rounds of K heads one claim tries per lane before giving up on that lane."""
    lease_s: float = 45.0
    heartbeat_s: float = 10.0
    worker_ttl_s: float = 60.0
    """A worker not seen for this long no longer counts towards a pool's slots."""
    poison_workers: int = 3
    largest_worker_class: Mapping[str, int] = field(default_factory=lambda: _frozen({}))
    """pool -> the biggest worker class it has. A resource failure retries one class up."""
    paused_pools: frozenset[str] = frozenset()
    speculative_budget_cpu_min: Mapping[str, float] = field(
        default_factory=lambda: _frozen({"free": 10.0, "standard": 60.0, "premium": 240.0})
    )
    queued_caps: Mapping[str, int] = field(
        default_factory=lambda: _frozen({"analyse.song": 50_000, "seam.render": 2_000})
    )
    default_queued_cap: int = 10_000
    materialise_page: int = 500
    overload_drain_s: float = 1_800.0
    max_defer_s: float = 3_600.0
    max_result_bytes: int = 1_000_000

    def weight(self, tier: str | None) -> float:
        """An account's share of a lane, by plan. Unknown plans get the default plan's weight."""
        if tier in self.tier_weights:
            return float(self.tier_weights[tier])
        return float(self.tier_weights[self.default_tier])

    def lane_weight(self, lane: Lane | str) -> float:
        return float(self.lane_weights.get(str(lane), 1.0))

    def cap(self, tier: str | None, lane: Lane | str, pool: str | None = None) -> int:
        """How many attempts one workspace may run at once in this pool and lane."""
        tier = tier if tier in self.lane_caps else self.default_tier
        if pool is not None and pool in self.pool_cap_overrides:
            override = self.pool_cap_overrides[pool].get(tier, {})
            if str(lane) in override:
                return int(override[str(lane)])
        return int(self.lane_caps[tier].get(str(lane), 1))

    def speculative_headroom(self, slots: int) -> int:
        """Slots speculative work must leave free in a pool with this many slots.

        A pool of two or more slots keeps at least N, or a share, whichever is more, free for
        interactive work. A one-slot pool (the local app's single runner thread) keeps none:
        there, spare-time work runs whenever the pool is otherwise idle, and gives way at its
        next `check_in()` as soon as interactive or standard work arrives.
        """
        if slots < 2:
            return 0
        share = math.ceil(self.speculative_headroom_share * slots)
        return max(self.speculative_headroom_slots, share)

    def speculative_budget_s(self, tier: str | None) -> float:
        tier = tier if tier in self.speculative_budget_cpu_min else self.default_tier
        return 60.0 * float(self.speculative_budget_cpu_min[tier])

    def queued_cap(self, job_type: str) -> int:
        return int(self.queued_caps.get(job_type, self.default_queued_cap))

    def to_dict(self) -> dict:
        """Plain JSON, for storing a version and showing it in the admin policy editor."""
        return {key: _thaw(value) for key, value in asdict(self).items()}

    @classmethod
    def from_dict(cls, data: Mapping) -> PolicyConfig:
        values = dict(data)
        if "paused_pools" in values:
            values["paused_pools"] = frozenset(values["paused_pools"])
        for key, value in list(values.items()):
            if isinstance(value, Mapping):
                values[key] = _frozen(value)
        return cls(**values)

    def evolve(self, **changes) -> PolicyConfig:
        """A new version with some values changed."""
        for key, value in list(changes.items()):
            if isinstance(value, Mapping):
                changes[key] = _frozen(value)
        changes.setdefault("version", self.version + 1)
        return replace(self, **changes)


# --- Start-time fair queuing -------------------------------------------------------------------


def backlogged_vtime(vtime: float, floor: float | None) -> float:
    """A workspace (or lane) that starts waiting again: `V = max(V, G)`. No credit for idling."""
    if floor is None:
        return vtime
    return max(vtime, floor)


def lane_floor(backlogged: Iterable[float], fallback: float) -> float:
    """G: the smallest V among backlogged workspaces, or the lane's own floor when none wait."""
    smallest = min(backlogged, default=None)
    return fallback if smallest is None else smallest


def charge(vtime: float, est_cost_s: float, weight: float) -> float:
    """On dispatch: `V += est / weight`."""
    return vtime + max(est_cost_s, 0.0) / max(weight, 1e-9)


def correction(est_cost_s: float, actual_cost_s: float, clamp_s: float) -> float:
    """`actual − est`, clamped, so one hung or wildly misjudged job can't swing V too far."""
    return max(-clamp_s, min(clamp_s, actual_cost_s - est_cost_s))


def corrected(
    vtime: float, est_cost_s: float, actual_cost_s: float, weight: float, clamp_s: float
) -> float:
    """On finish: `V += clamp(actual − est) / weight`, so wrong estimates self-correct."""
    return vtime + correction(est_cost_s, actual_cost_s, clamp_s) / max(weight, 1e-9)


def head_key(vtime: float, waiting_since: float | None, workspace_id: str = "") -> tuple:
    """Which workspace goes next in a lane: smallest V, then whoever has waited longest.

    `waiting_since` is when the head last started waiting (became backlogged, or was last served
    while more work remained), which stands in for its oldest waiting job.
    """
    return (vtime, math.inf if waiting_since is None else waiting_since, workspace_id)


def job_key(
    urgency: int, needed_by: float | None, line_position: int | None, created_at: float
) -> tuple:
    """Which of one account's jobs goes next: urgency, deadline (none last), line order, age."""
    return (
        urgency,
        needed_by is None,
        0.0 if needed_by is None else needed_by,
        line_position is None,
        0 if line_position is None else line_position,
        created_at,
    )


# --- Lanes -------------------------------------------------------------------------------------


def speculative_allowed(slots: int, busy: int, config: PolicyConfig) -> bool:
    """May speculative work take a slot in a pool of `slots` slots with `busy` in use?

    Only if a slot is free and taking it still leaves the pool's headroom (see
    `PolicyConfig.speculative_headroom`): none for a one-slot pool, at least one otherwise.
    """
    free = slots - busy
    return free > 0 and free > config.speculative_headroom(slots)


def choose_lanes(
    lane_vtimes: Mapping[str, float], backlogged: Collection[str], speculative_ok: bool
) -> list[Lane]:
    """The lanes a claim should try, in order.

    Interactive and standard compete by lane virtual time (ties go to interactive). Speculative
    comes last and only when headroom allows; the claim moves on to the next lane when one has no
    eligible work, so speculative runs only when the others have nothing it could take instead.
    """
    competing = [lane for lane in COMPETING_LANES if lane in backlogged]
    competing.sort(key=lambda lane: (lane_vtimes.get(lane, 0.0), lane_rank(lane)))
    if speculative_ok and Lane.SPECULATIVE in backlogged:
        competing.append(Lane.SPECULATIVE)
    return competing


# --- Deadlines, preemption, inheritance --------------------------------------------------------


def slack(needed_by: float, est_cost_s: float, now: float) -> float:
    """Time left before the deadline once the job's own run time is taken out."""
    return (needed_by - now) - est_cost_s


def needs_boost(
    needed_by: float | None, est_cost_s: float, now: float, config: PolicyConfig
) -> bool:
    """A playback seam whose slack has dropped under 1.5× its estimate jumps the lane."""
    if needed_by is None:
        return False
    return slack(needed_by, est_cost_s, now) < config.slack_factor * max(est_cost_s, 0.0)


def boost_allowed(boosts_in_window: int, config: PolicyConfig) -> bool:
    """Each account gets a few boosts per window, so deadlines can't be used to skip the line."""
    return boosts_in_window < config.boost_allowance


@dataclass(frozen=True)
class RunningAttempt:
    attempt_id: str
    lane: str
    started_at: float
    cancel_requested: bool = False


def choose_preemption(
    running: Sequence[RunningAttempt],
    *,
    slots: int,
    free_slots: int,
    interactive_waiting: bool,
    standard_waiting: bool = False,
) -> str | None:
    """Which speculative attempt gives way, if any, so waiting work can start.

    Speculative work is optional by definition, so it is the one kind preempted across
    accounts. In a pool of two or more slots only waiting interactive work preempts it (the
    headroom rule keeps a slot free for that, so this is rare). In a one-slot pool, where
    speculative work runs whenever the pool is idle, any interactive or standard work preempts
    it. Nothing is preempted while a slot is free. The youngest attempt has lost the least work;
    one already asked to stop isn't asked again.
    """
    if free_slots > 0:
        return None
    if not (interactive_waiting or (slots < 2 and standard_waiting)):
        return None
    candidates = [
        attempt
        for attempt in running
        if attempt.lane == Lane.SPECULATIVE and not attempt.cancel_requested
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda attempt: (attempt.started_at, attempt.attempt_id)).attempt_id


def inherited(
    own_lane: str, own_urgency: int, dependents: Iterable[tuple[str, int]]
) -> tuple[Lane, int]:
    """A prerequisite runs in the most urgent lane, at the most urgent urgency, of what waits on it.

    It inherits lane and urgency inside its own account, never the account's weight, and its
    own values are the floor it returns to when the dependents finish or are cancelled.
    """
    lane, urgency = Lane(own_lane), own_urgency
    for dependent_lane, dependent_urgency in dependents:
        if lane_rank(dependent_lane) < lane_rank(lane):
            lane = Lane(dependent_lane)
        urgency = min(urgency, dependent_urgency)
    return lane, urgency


# --- Today's ranks (seams.py) ------------------------------------------------------------------

URGENT, REQUEST, MIX, LINE, LATER, PREPARING = range(6)
"""The seam worker's ranks, in `selecta.seams`, copied so this module doesn't import it."""

RANKS: Mapping[int, tuple[Lane, int]] = MappingProxyType(
    {
        URGENT: (Lane.INTERACTIVE, 0),
        REQUEST: (Lane.INTERACTIVE, 1),
        MIX: (Lane.STANDARD, 2),
        LINE: (Lane.STANDARD, 3),
        LATER: (Lane.STANDARD, 4),
        PREPARING: (Lane.SPECULATIVE, 5),
    }
)

DEFAULT_URGENCY: Mapping[str, int] = MappingProxyType(
    {Lane.INTERACTIVE: REQUEST, Lane.STANDARD: LATER, Lane.SPECULATIVE: PREPARING}
)
"""Urgency for work whose producer named only a lane."""


def from_rank(rank: int) -> tuple[Lane, int]:
    """(lane, urgency) for one of today's ranks, as in §4A.5."""
    if rank not in RANKS:
        raise ValueError(f"There's no rank {rank}; ranks run from URGENT (0) to PREPARING (5).")
    return RANKS[rank]


# --- Eligibility -------------------------------------------------------------------------------


@dataclass(frozen=True)
class WorkerCaps:
    """What a worker can do. `job_types` of None means any type its pool runs."""

    pool: str
    engine_version: int | None = None
    gpu_memory_mb: int = 0
    scratch_mb: int = 0
    worker_class: int = 0
    speed_factor: float = 1.0
    """Reference seconds per wall second: a worker twice as fast reports 2.0."""
    slots: int = 1
    job_types: frozenset[str] | None = None
    worker_id: str | None = None
    region: str | None = None


@dataclass(frozen=True)
class Candidate:
    """The parts of a job the eligibility check looks at."""

    job_type: str
    deps_satisfied: bool = True
    not_before: float | None = None
    engine_version_required: int | None = None
    gpu_memory_mb: int | None = None
    scratch_mb: int | None = None
    min_worker_class: int = 0


@dataclass(frozen=True)
class EligibilityContext:
    """The account and pool around a candidate, read at dispatch time."""

    now: float
    running: int
    cap: int
    suspended: bool = False
    entitled: bool = True
    flag_on: bool = True
    pool_paused: bool = False


class Ineligible(StrEnum):
    """Why a candidate can't run now. Shown in diagnostics and counted by the simulator."""

    POOL_PAUSED = "pool_paused"
    SUSPENDED = "suspended"
    AT_CAP = "at_cap"
    DEPENDENCIES = "dependencies"
    NOT_YET = "not_yet"
    NOT_ENTITLED = "not_entitled"
    FLAG_OFF = "flag_off"
    JOB_TYPE = "job_type"
    ENGINE = "engine"
    GPU = "gpu"
    SCRATCH = "scratch"
    WORKER_CLASS = "worker_class"


def account_blocker(context: EligibilityContext) -> Ineligible | None:
    """The checks that apply to a whole workspace head, before any of its jobs is looked at."""
    if context.pool_paused:
        return Ineligible.POOL_PAUSED
    if context.suspended:
        return Ineligible.SUSPENDED
    if context.running >= context.cap:
        return Ineligible.AT_CAP
    return None


def job_blocker(
    candidate: Candidate, caps: WorkerCaps, context: EligibilityContext
) -> Ineligible | None:
    """The checks that apply to one job on one worker."""
    if not candidate.deps_satisfied:
        return Ineligible.DEPENDENCIES
    if candidate.not_before is not None and candidate.not_before > context.now:
        return Ineligible.NOT_YET
    if not context.entitled:
        return Ineligible.NOT_ENTITLED
    if not context.flag_on:
        return Ineligible.FLAG_OFF
    if caps.job_types is not None and candidate.job_type not in caps.job_types:
        return Ineligible.JOB_TYPE
    required = candidate.engine_version_required
    if required is not None and (caps.engine_version is None or caps.engine_version < required):
        return Ineligible.ENGINE
    if (candidate.gpu_memory_mb or 0) > caps.gpu_memory_mb:
        return Ineligible.GPU
    if (candidate.scratch_mb or 0) > caps.scratch_mb:
        return Ineligible.SCRATCH
    if candidate.min_worker_class > caps.worker_class:
        return Ineligible.WORKER_CLASS
    return None


def why_ineligible(
    candidate: Candidate, caps: WorkerCaps, context: EligibilityContext
) -> Ineligible | None:
    """None when the candidate may run on this worker now, else the first reason it can't."""
    return account_blocker(context) or job_blocker(candidate, caps, context)


def is_eligible(candidate: Candidate, caps: WorkerCaps, context: EligibilityContext) -> bool:
    return why_ineligible(candidate, caps, context) is None
