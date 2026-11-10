"""A deterministic, event-driven simulator for the scheduling policy (§4A.12).

It runs the exact functions in `selecta.scheduling.policy` (lane choice, start-time fair queuing,
the in-account order, eligibility, headroom, deadline boosts and preemption) against an in-memory
pool with a virtual clock and seeded randomness, so the same scenario and seed always give the
same report. It models arrivals per account and lane, estimated against actual costs, worker
crashes and the lease expiry that follows, plan changes and cancellations.

After every event it checks the cheap invariants (no double lease, caps and headroom kept at
dispatch, slots never over-filled); `Scenario.check_every` adds the full recount (no lost job,
heads match the jobs) as often as a test wants. The report gives per-plan and per-account waits
(p50, p95, p99), the share error against weights in each window, the interactive share of compute,
and starvation: the longest any backlogged account waited, and that wait against its bound.

The admin policy editor forecasts a change with `compare(scenario, new_config)`.

The bound for one account i in a lane, with N backlogged accounts of total weight W there, is
`((W - w_i) / w_i + N) * c / s + 2c`, where c is the largest job cost seen and s the slots the lane
gets by lane weight: between two services of i every other account j can be served at most
`w_j / w_i + 1` times, those jobs drain s at a time, and i may wait for one slot and one of its
own running jobs.
"""

from __future__ import annotations

import heapq
import math
import random
from collections import Counter, defaultdict, deque
from collections.abc import Mapping
from dataclasses import dataclass, field, replace

from selecta.scheduling import policy
from selecta.scheduling.policy import COMPETING_LANES, LANES, Lane, PolicyConfig

QUEUED = "queued"
RUNNING = "running"
CANCEL_REQUESTED = "cancel_requested"
SUCCEEDED = "succeeded"
FAILED = "failed"
CANCELLED = "cancelled"
QUARANTINED = "quarantined"
TERMINAL = frozenset({SUCCEEDED, FAILED, CANCELLED, QUARANTINED})
LIVE = frozenset({RUNNING, CANCEL_REQUESTED})
MAX_ATTEMPTS = 6
"""Attempts before a job whose workers keep vanishing fails (the catalogue's default)."""

_FILL, _ARRIVE, _FINISH, _EXPIRE, _STOP, _CANCEL, _PLAN, _WINDOW = range(8)
_INTERACTIVE, _STANDARD, _SPECULATIVE = (str(lane) for lane in LANES)
_COMPETING = tuple(str(lane) for lane in COMPETING_LANES)


class InvariantViolation(AssertionError):
    """The simulated scheduler broke one of its promises; the message says which."""


@dataclass(frozen=True)
class Demand:
    """One stream of work from one account, in one lane."""

    lane: str = Lane.STANDARD
    backlog: int = 0
    """Keep this many jobs queued at all times (a saturated account); 0 for arrivals only."""
    rate_per_s: float = 0.0
    """Poisson arrivals per second, on top of any backlog."""
    est_cost_s: float = 60.0
    urgency: int | None = None
    needed_in_s: float | None = None
    """A playback seam: due this long after it arrives, which makes it a candidate for a boost."""
    start_s: float = 0.0
    stop_s: float = math.inf


@dataclass(frozen=True)
class AccountSpec:
    workspace_id: str
    tier: str = "free"
    demand: tuple[Demand, ...] = (Demand(backlog=1),)
    suspended: bool = False


@dataclass(frozen=True)
class PlanChange:
    at_s: float
    workspace_id: str
    tier: str


@dataclass(frozen=True)
class Scenario:
    accounts: tuple[AccountSpec, ...]
    slots: int = 20
    duration_s: float = 3_600.0
    seed: int = 0
    config: PolicyConfig = field(default_factory=PolicyConfig)
    cost_noise: float = 0.0
    """Spread of actual cost around the estimate (log-normal sigma, mean 1). 0: exact."""
    crash_rate: float = 0.0
    """Chance an attempt's worker dies part-way; the slot is held until its lease runs out."""
    cancel_rate: float = 0.0
    """Chance a job is cancelled at some point in the two estimates after it arrives."""
    plan_changes: tuple[PlanChange, ...] = ()
    window_s: float = 600.0
    warmup_s: float = 600.0
    """Windows that start before this are left out of the share error: a pool filling up from
    empty (the first arrivals take every idle slot) isn't the steady state being measured."""
    share_min_jobs: float = 10.0
    """Share error counts an account in a window only when its fair share is this many jobs."""
    max_decisions: int | None = None
    check_every: int = 0
    """Also run the full recount every this many events; 0 runs only the cheap checks."""
    check_in_s: float = 1.0
    """How soon a running attempt notices it was asked to stop."""


@dataclass(frozen=True)
class WaitStats:
    count: int
    p50: float
    p95: float
    p99: float
    max: float

    @classmethod
    def of(cls, values: list[float]) -> WaitStats:
        if not values:
            return cls(0, 0.0, 0.0, 0.0, 0.0)
        ordered = sorted(values)
        last = len(ordered) - 1

        def rank(share: float) -> float:
            return ordered[min(last, max(0, math.ceil(share * len(ordered)) - 1))]

        return cls(len(ordered), rank(0.50), rank(0.95), rank(0.99), ordered[-1])


@dataclass(frozen=True)
class Report:
    seed: int
    decisions: int
    events: int
    simulated_s: float
    created: int
    finished: Mapping[str, int]
    """Jobs that ended, by terminal state."""
    unfinished: int
    crashes: int
    preemptions: int
    boosts: int
    waits_by_tier: Mapping[str, WaitStats]
    """From queued to dispatched, by the account's plan at dispatch."""
    waits_by_account: Mapping[str, WaitStats]
    service_s: Mapping[str, float]
    """Slot-seconds each account received."""
    lane_service_s: Mapping[str, float]
    share_error: float
    """Largest |received / fair - 1| of any account backlogged through a whole window."""
    lane_shares: tuple[float, ...]
    """Interactive share of compute in each window both competing lanes were backlogged."""
    max_wait_s: float
    """Starvation: the longest a backlogged account waited between services."""
    max_wait_ratio: float
    """That wait against the account's bound (see the module notes); 1 or less is kept."""
    invariant_checks: int


class _Job:
    __slots__ = ("id", "workspace_id", "lane", "key", "needed_by", "est", "actual", "state",
                 "queued_at", "attempts", "crashes", "attempt", "stream", "enqueued")

    def __init__(self, job_id, workspace_id, lane, key, needed_by, est, actual, stream):
        self.id = job_id
        self.workspace_id = workspace_id
        self.lane = lane
        self.key = key
        self.needed_by = needed_by
        self.est = est
        self.actual = actual
        self.stream = stream
        self.state = QUEUED
        self.queued_at = 0.0
        self.attempts = 0
        self.crashes = 0
        self.attempt: _Attempt | None = None
        self.enqueued = 0


class _Attempt:
    __slots__ = ("id", "job", "lane", "started_at", "ended", "stop_requested", "crashed")

    def __init__(self, attempt_id, job, started_at):
        self.id = attempt_id
        self.job = job
        self.lane = job.lane
        self.started_at = started_at
        self.ended = False
        self.stop_requested = False
        self.crashed = False


class _Head:
    __slots__ = ("workspace_id", "lane", "vtime", "queue", "queued", "running", "waiting_since",
                 "version", "backlogged_since", "weight")

    def __init__(self, workspace_id, lane):
        self.workspace_id = workspace_id
        self.lane = lane
        self.vtime = 0.0
        self.queue: list = []
        self.queued = 0
        self.running = 0
        self.waiting_since: float | None = None
        self.version = 0
        self.backlogged_since: float | None = None
        self.weight = 0.0


class _Stream:
    __slots__ = ("account", "demand", "queued")

    def __init__(self, account, demand):
        self.account = account
        self.demand = demand
        self.queued = 0


def fair_shares(capacity: float, members: list[tuple[object, float, float]]) -> dict:
    """Weighted max-min shares of `capacity` among (key, weight, limit) members.

    Members whose proportional share would pass their limit (a concurrency cap) get the limit,
    and the rest is shared again among the others.
    """
    shares: dict = {}
    active = list(members)
    remaining = capacity
    while active:
        total = sum(weight for _, weight, _ in active)
        capped = [m for m in active if remaining * m[1] / total >= m[2]]
        if not capped:
            for key, weight, _ in active:
                shares[key] = remaining * weight / total
            break
        for key, _, limit in capped:
            shares[key] = limit
            remaining -= limit
        active = [m for m in active if m not in capped]
    return shares


class Simulation:
    """One run of one scenario. Use `simulate(scenario)` unless you want to look inside."""

    def __init__(self, scenario: Scenario):
        if scenario.slots < 1:
            raise ValueError("A pool needs at least one slot.")
        self.scenario = scenario
        self.config = scenario.config
        self.rng = random.Random(scenario.seed)
        self.caps = policy.WorkerCaps(pool="simulated", slots=scenario.slots)
        self.candidate = policy.Candidate(job_type="simulated")
        self.now = 0.0
        self._events: list = []
        self._seq = 0
        self._ids = 0
        self.tiers = {account.workspace_id: account.tier for account in scenario.accounts}
        self.suspended = {account.workspace_id: account.suspended for account in scenario.accounts}
        if len(self.tiers) != len(scenario.accounts):
            raise ValueError("Each account needs its own workspace id.")
        # The config is fixed for a run, so its answers are read once (plan changes move tiers).
        plans = set(self.tiers.values()) | {change.tier for change in scenario.plan_changes}
        self.weight = {tier: self.config.weight(tier) for tier in plans}
        self.cap = {
            (tier, str(lane)): self.config.cap(tier, lane) for tier in plans for lane in LANES
        }
        self.lane_weight = {str(lane): self.config.lane_weight(lane) for lane in LANES}
        self.jobs: dict[int, _Job] = {}
        self.heads: dict[tuple[str, str], _Head] = {}
        self.lane_heaps: dict[str, list] = {lane: [] for lane in map(str, LANES)}
        self.lane_backlogged = dict.fromkeys(self.lane_heaps, 0)
        self.lane_weights = dict.fromkeys(self.lane_heaps, 0.0)
        self.lane_since: dict[str, float | None] = dict.fromkeys(self.lane_heaps)
        self.lane_vtime = dict.fromkeys(_COMPETING, 0.0)
        self.lane_floor = dict.fromkeys(self.lane_heaps, 0.0)
        self.busy = 0
        self.live: dict[int, _Attempt] = {}
        self.speculative: dict[int, _Attempt] = {}
        self.boost_heap: list = []
        self.boost_times: dict[str, deque] = defaultdict(deque)
        self.states: Counter = Counter()
        self.created = 0
        self.decisions = 0
        self.event_count = 0
        self.checks = 0
        self.crashes = 0
        self.preemptions = 0
        self.boosts = 0
        self.largest_cost = 0.0
        self.lane_cost = defaultdict(lambda: [0.0, 0])
        self.waits_tier: dict[str, list[float]] = defaultdict(list)
        self.waits_account: dict[str, list[float]] = defaultdict(list)
        self.max_wait = 0.0
        self.max_ratio = 0.0
        self.service: dict[int, dict[tuple[str, str], float]] = defaultdict(
            lambda: defaultdict(float)
        )
        self.throughout: dict[int, set[tuple[str, str]]] = {}
        self.lanes_throughout: dict[int, set[str]] = {}

    # --- the event queue ---

    def _at(self, moment: float, kind: int, payload) -> None:
        self._seq += 1
        heapq.heappush(self._events, (moment, self._seq, kind, payload))

    def run(self) -> Report:
        scenario = self.scenario
        for account in scenario.accounts:
            for demand in account.demand:
                stream = _Stream(account, demand)
                if demand.backlog > 0:
                    self._at(demand.start_s, _FILL, stream)
                if demand.rate_per_s > 0:
                    first = demand.start_s + self.rng.expovariate(demand.rate_per_s)
                    self._at(first, _ARRIVE, stream)
        for change in scenario.plan_changes:
            self._at(change.at_s, _PLAN, change)
        self._at(scenario.window_s, _WINDOW, 0)
        handlers = (self._fill, self._arrive, self._finish, self._expire, self._stop,
                    self._cancel, self._plan, self._window)
        end = scenario.duration_s
        while self._events:
            moment, _, kind, payload = self._events[0]
            if moment > scenario.duration_s:
                break
            heapq.heappop(self._events)
            self.now = moment
            self.event_count += 1
            handlers[kind](payload)
            self._dispatch()
            self._check()
            if scenario.max_decisions is not None and self.decisions >= scenario.max_decisions:
                end = self.now
                break
        self.now = end
        for attempt in list(self.live.values()):
            self._credit(attempt, end)
        return self._report(end)

    # --- arrivals ---

    def _fill(self, stream: _Stream) -> None:
        self._refill(stream)

    def _refill(self, stream: _Stream) -> None:
        demand = stream.demand
        while stream.queued < demand.backlog and demand.start_s <= self.now < demand.stop_s:
            self._new_job(stream)

    def _arrive(self, stream: _Stream) -> None:
        demand = stream.demand
        if self.now < demand.stop_s:
            self._new_job(stream)
            following = self.now + self.rng.expovariate(demand.rate_per_s)
            if following < demand.stop_s:
                self._at(following, _ARRIVE, stream)

    def _new_job(self, stream: _Stream) -> None:
        demand, scenario = stream.demand, self.scenario
        lane = Lane(demand.lane)
        urgency = policy.DEFAULT_URGENCY[lane] if demand.urgency is None else demand.urgency
        needed_by = None if demand.needed_in_s is None else self.now + demand.needed_in_s
        est = float(demand.est_cost_s)
        actual = est
        if scenario.cost_noise > 0:
            sigma = scenario.cost_noise
            actual = est * self.rng.lognormvariate(-sigma * sigma / 2, sigma)
        self._ids += 1
        key = policy.job_key(urgency, needed_by, None, self.now)
        job = _Job(self._ids, stream.account.workspace_id, str(lane), key, needed_by, est,
                   actual, stream)
        self.jobs[job.id] = job
        self.created += 1
        if scenario.cancel_rate > 0 and self.rng.random() < scenario.cancel_rate:
            self._at(self.now + self.rng.uniform(0.0, 2.0 * est), _CANCEL, job)
        self._enqueue(job)

    def _head(self, lane: str, workspace_id: str) -> _Head:
        head = self.heads.get((lane, workspace_id))
        if head is None:
            head = self.heads[(lane, workspace_id)] = _Head(workspace_id, lane)
        return head

    def _enqueue(self, job: _Job) -> None:
        if job.state != QUEUED:
            self.states[job.state] -= 1
        job.state = QUEUED
        self.states[QUEUED] += 1
        job.queued_at = self.now
        job.enqueued += 1
        job.stream.queued += 1
        head = self._head(job.lane, job.workspace_id)
        heapq.heappush(head.queue, (job.key, job.id, job.enqueued))
        if job.needed_by is not None and job.lane == _INTERACTIVE:
            heapq.heappush(self.boost_heap, (job.needed_by, job.id, job.enqueued))
        head.queued += 1
        if head.queued == 1:
            self._starts_waiting(head)
        if (
            self.speculative
            and self.busy >= self.scenario.slots
            and (job.lane == _INTERACTIVE or (job.lane == _STANDARD and self.scenario.slots < 2))
        ):
            self._preempt()

    def _lane_top(self, lane: str):
        """The backlogged head with the smallest key in a lane, dropping stale entries."""
        heap = self.lane_heaps[lane]
        while heap:
            entry = heap[0]
            head = self.heads[(lane, entry[2])]
            if head.version == entry[3] and head.queued > 0:
                return entry
            heapq.heappop(heap)
        return None

    def _push_head(self, head: _Head) -> None:
        head.version += 1
        key = policy.head_key(head.vtime, head.waiting_since, head.workspace_id)
        heapq.heappush(self.lane_heaps[head.lane], (*key, head.version))

    def _starts_waiting(self, head: _Head) -> None:
        """`V = max(V, G)`, as `selecta.work.heads.job_queued` does it."""
        lane = head.lane
        lane_was_idle = self.lane_backlogged[lane] == 0
        top = None if lane_was_idle else self._lane_top(lane)
        floor = self.lane_floor[lane] if top is None else top[0]
        head.vtime = policy.backlogged_vtime(head.vtime, floor)
        head.waiting_since = head.backlogged_since = self.now
        head.weight = self.weight[self.tiers[head.workspace_id]]
        self._push_head(head)
        self.lane_backlogged[lane] += 1
        self.lane_weights[lane] += head.weight
        if lane_was_idle:
            self.lane_since[lane] = self.now
            if lane in _COMPETING:
                others = [o for o in _COMPETING if o != lane and self.lane_backlogged[o] > 0]
                if others:
                    lane_floor = policy.lane_floor(
                        (self.lane_vtime[o] for o in others), self.lane_vtime[lane]
                    )
                    self.lane_vtime[lane] = policy.backlogged_vtime(
                        self.lane_vtime[lane], lane_floor
                    )

    def _stops_waiting(self, head: _Head) -> None:
        head.version += 1
        head.waiting_since = head.backlogged_since = None
        self.lane_backlogged[head.lane] -= 1
        self.lane_weights[head.lane] -= head.weight
        if self.lane_backlogged[head.lane] == 0:
            self.lane_since[head.lane] = None
            self.lane_weights[head.lane] = 0.0

    # --- dispatch ---

    def _context(self, head: _Head) -> policy.EligibilityContext:
        tier = self.tiers[head.workspace_id]
        return policy.EligibilityContext(
            now=self.now,
            running=head.running,
            cap=self.cap[(tier, head.lane)],
            suspended=self.suspended[head.workspace_id],
        )

    def _dispatch(self) -> None:
        while self.busy < self.scenario.slots and self._dispatch_one():
            pass

    def _dispatch_one(self) -> bool:
        backlogged = [lane for lane, count in self.lane_backlogged.items() if count > 0]
        if not backlogged:
            return False
        if _INTERACTIVE in backlogged and self.boost_heap and self._try_boost():
            return True
        speculative_ok = _SPECULATIVE in backlogged and policy.speculative_allowed(
            self.scenario.slots, self.busy, self.config
        )
        for lane in policy.choose_lanes(self.lane_vtime, backlogged, speculative_ok):
            head = self._pick(str(lane))
            if head is not None:
                self._start(head)
                return True
        return False

    def _pick(self, lane: str) -> _Head | None:
        heap = self.lane_heaps[lane]
        skipped = []
        found = None
        while self._lane_top(lane) is not None:
            entry = heapq.heappop(heap)
            head = self.heads[(lane, entry[2])]
            context = self._context(head)
            if policy.why_ineligible(self.candidate, self.caps, context) is None:
                found = head
                skipped.append(entry)
                break
            skipped.append(entry)
        for entry in skipped:
            heapq.heappush(heap, entry)
        return found

    def _boosts_in_window(self, workspace_id: str) -> int:
        times = self.boost_times[workspace_id]
        while times and times[0] < self.now - self.config.boost_window_s:
            times.popleft()
        return len(times)

    def _try_boost(self) -> bool:
        heap, config = self.boost_heap, self.config
        skipped, chosen, looked = [], None, 0
        while heap and looked < config.head_batch:
            entry = heapq.heappop(heap)
            job = self.jobs[entry[1]]
            if job.state != QUEUED or job.enqueued != entry[2]:
                continue
            looked += 1
            skipped.append(entry)
            if not policy.needs_boost(job.needed_by, job.est, self.now, config):
                continue
            head = self.heads[(job.lane, job.workspace_id)]
            if policy.why_ineligible(self.candidate, self.caps, self._context(head)) is not None:
                continue
            if not policy.boost_allowed(self._boosts_in_window(job.workspace_id), config):
                continue
            chosen = (head, job)
            break
        for entry in skipped:
            heapq.heappush(heap, entry)
        if chosen is None:
            return False
        self.boost_times[chosen[1].workspace_id].append(self.now)
        self.boosts += 1
        self._start(*chosen)
        return True

    def _start(self, head: _Head, job: _Job | None = None) -> None:
        scenario, config = self.scenario, self.config
        if job is None:
            while True:
                _, job_id, enqueued = heapq.heappop(head.queue)
                job = self.jobs[job_id]
                if job.state == QUEUED and job.enqueued == enqueued:
                    break
        tier = self.tiers[head.workspace_id]
        if head.running >= self.cap[(tier, head.lane)]:
            raise InvariantViolation(f"{head.workspace_id} went past its {head.lane} cap.")
        if head.lane == _SPECULATIVE and not policy.speculative_allowed(
            scenario.slots, self.busy, config
        ):
            raise InvariantViolation("Speculative work took a slot kept for interactive work.")
        if job.attempt is not None:
            raise InvariantViolation(f"Job {job.id} was leased twice.")
        if self.busy >= scenario.slots:
            raise InvariantViolation("More attempts than slots.")
        self._measure(head, job, tier)
        self.decisions += 1
        self.states[QUEUED] -= 1
        self.states[RUNNING] += 1
        job.state = RUNNING
        job.attempts += 1
        job.stream.queued -= 1
        self._ids += 1
        attempt = job.attempt = _Attempt(self._ids, job, self.now)
        self.live[attempt.id] = attempt
        if job.lane == _SPECULATIVE:
            self.speculative[attempt.id] = attempt
        self.busy += 1
        before = head.vtime
        head.queued -= 1
        head.running += 1
        head.vtime = policy.charge(head.vtime, job.est, self.weight[tier])
        if head.queued:
            head.waiting_since = self.now
            self._push_head(head)
        else:
            self._stops_waiting(head)
        self.lane_floor[head.lane] = max(self.lane_floor[head.lane], before)
        if head.lane in _COMPETING:
            weight = self.lane_weight[head.lane]
            self.lane_vtime[head.lane] = policy.charge(self.lane_vtime[head.lane], job.est, weight)
        self.largest_cost = max(self.largest_cost, job.est, job.actual)
        totals = self.lane_cost[head.lane]
        totals[0] += job.est
        totals[1] += 1
        if scenario.crash_rate > 0 and self.rng.random() < scenario.crash_rate:
            attempt.crashed = True
            dies = self.now + self.rng.uniform(0.0, job.actual)
            self._at(dies + config.lease_s, _EXPIRE, attempt)
        else:
            self._at(self.now + job.actual, _FINISH, attempt)
        self._refill(job.stream)

    def _measure(self, head: _Head, job: _Job, tier: str) -> None:
        wait = self.now - job.queued_at
        self.waits_tier[tier].append(wait)
        self.waits_account[head.workspace_id].append(wait)
        between = self.now - head.waiting_since
        self.max_wait = max(self.max_wait, between)
        if head.lane not in _COMPETING:
            return
        weight = head.weight
        others = (self.lane_weights[head.lane] - weight) / weight + self.lane_backlogged[head.lane]
        backlogged, lane_weight = self.lane_backlogged, self.lane_weight
        share = lane_weight[head.lane] / sum(
            lane_weight[lane] for lane in _COMPETING if backlogged[lane] > 0
        )
        cost = max(self.largest_cost, job.est, job.actual)
        bound = others * cost / (self.scenario.slots * share) + 2 * cost
        self.max_ratio = max(self.max_ratio, between / bound)

    # --- endings ---

    def _end(self, attempt: _Attempt) -> _Job:
        config = self.config
        attempt.ended = True
        del self.live[attempt.id]
        self.speculative.pop(attempt.id, None)
        self.busy -= 1
        job = attempt.job
        job.attempt = None
        head = self.heads[(attempt.lane, job.workspace_id)]
        head.running -= 1
        cost = self.now - attempt.started_at
        weight = self.weight[self.tiers[job.workspace_id]]
        clamp = config.correction_clamp_s
        head.vtime = policy.corrected(head.vtime, job.est, cost, weight, clamp)
        if head.queued:
            self._push_head(head)
        if attempt.lane in _COMPETING:
            lane_weight = self.lane_weight[attempt.lane]
            self.lane_vtime[attempt.lane] = policy.corrected(
                self.lane_vtime[attempt.lane], job.est, cost, lane_weight, clamp
            )
        self._credit(attempt, self.now)
        return job

    def _terminal(self, job: _Job, state: str) -> None:
        self.states[job.state] -= 1
        self.states[state] += 1
        job.state = state

    def _finish(self, attempt: _Attempt) -> None:
        if attempt.ended:
            return
        job = self._end(attempt)
        self._terminal(job, CANCELLED if job.state == CANCEL_REQUESTED else SUCCEEDED)

    def _expire(self, attempt: _Attempt) -> None:
        """The reaper: the crashed attempt's lease ran out."""
        if attempt.ended:
            return
        self.crashes += 1
        job = self._end(attempt)
        job.crashes += 1
        if job.state == CANCEL_REQUESTED:
            self._terminal(job, CANCELLED)
        elif job.crashes >= self.config.poison_workers:
            self._terminal(job, QUARANTINED)
        elif job.attempts >= MAX_ATTEMPTS:
            self._terminal(job, FAILED)
        else:
            self._enqueue(job)

    def _stop(self, attempt: _Attempt) -> None:
        """A live attempt reached its next check-in after being asked to stop."""
        if attempt.ended or attempt.crashed:
            return
        job = self._end(attempt)
        if job.state == CANCEL_REQUESTED:
            self._terminal(job, CANCELLED)
        else:
            job.attempts -= 1
            self._enqueue(job)

    def _cancel(self, job: _Job) -> None:
        if job.state == QUEUED:
            head = self.heads[(job.lane, job.workspace_id)]
            head.queued -= 1
            job.stream.queued -= 1
            if head.queued == 0:
                self._stops_waiting(head)
            self._terminal(job, CANCELLED)
            self._refill(job.stream)
        elif job.state == RUNNING:
            self._terminal(job, CANCEL_REQUESTED)
            attempt = job.attempt
            attempt.stop_requested = True
            if not attempt.crashed:
                self._at(self.now + self.scenario.check_in_s, _STOP, attempt)

    def _preempt(self) -> None:
        running = [
            policy.RunningAttempt(f"{a.id:012d}", a.lane, a.started_at, a.stop_requested)
            for a in self.speculative.values()
        ]
        target = policy.choose_preemption(
            running,
            slots=self.scenario.slots,
            free_slots=self.scenario.slots - self.busy,
            interactive_waiting=self.lane_backlogged[_INTERACTIVE] > 0,
            standard_waiting=self.lane_backlogged[_STANDARD] > 0,
        )
        if target is None:
            return
        attempt = self.speculative[int(target)]
        attempt.stop_requested = True
        self.preemptions += 1
        if not attempt.crashed:
            self._at(self.now + self.scenario.check_in_s, _STOP, attempt)

    def _plan(self, change: PlanChange) -> None:
        weight = self.weight[change.tier]
        for lane in self.lane_heaps:
            head = self.heads.get((lane, change.workspace_id))
            if head is not None and head.queued > 0:
                self.lane_weights[lane] += weight - head.weight
                head.weight = weight
        self.tiers[change.workspace_id] = change.tier

    # --- measuring ---

    def _credit(self, attempt: _Attempt, until: float) -> None:
        width = self.scenario.window_s
        key = (attempt.lane, attempt.job.workspace_id)
        start = attempt.started_at
        while start < until:
            index = int(start // width)
            edge = min((index + 1) * width, until)
            self.service[index][key] += edge - start
            start = edge

    def _window(self, index: int) -> None:
        """Window `index` just ended: note who was backlogged all through it."""
        self._at((index + 2) * self.scenario.window_s, _WINDOW, index + 1)
        began = index * self.scenario.window_s
        self.throughout[index] = {
            key
            for key, head in self.heads.items()
            if head.backlogged_since is not None and head.backlogged_since <= began
        }
        self.lanes_throughout[index] = {
            lane for lane, since in self.lane_since.items() if since is not None and since <= began
        }

    def _share_error(self) -> float:
        worst = 0.0
        width = self.scenario.window_s
        for index, members in self.throughout.items():
            if index * width < self.scenario.warmup_s:
                continue
            served = self.service.get(index, {})
            by_lane: dict[str, list] = defaultdict(list)
            for key in sorted(members):
                by_lane[key[0]].append(key)
            for lane, keys in by_lane.items():
                total, count = self.lane_cost[lane]
                if not count:
                    continue
                least = self.scenario.share_min_jobs * (total / count)
                capacity = sum(served.get(key, 0.0) for key in keys)
                fair = fair_shares(
                    capacity,
                    [
                        (
                            key,
                            self.weight[self.tiers[key[1]]],
                            self.cap[(self.tiers[key[1]], lane)] * width,
                        )
                        for key in keys
                    ],
                )
                for key in keys:
                    if fair[key] >= least:
                        worst = max(worst, abs(served.get(key, 0.0) / fair[key] - 1.0))
        return worst

    def _lane_shares(self) -> tuple[float, ...]:
        shares = []
        for index, lanes in sorted(self.lanes_throughout.items()):
            if not set(_COMPETING) <= lanes:
                continue
            served = self.service.get(index, {})
            by_lane = Counter()
            for (lane, _), seconds in served.items():
                by_lane[lane] += seconds
            total = by_lane[_INTERACTIVE] + by_lane[_STANDARD]
            if total > 0:
                shares.append(by_lane[_INTERACTIVE] / total)
        return tuple(shares)

    def _report(self, end: float) -> Report:
        service: dict[str, float] = defaultdict(float)
        lane_service: dict[str, float] = defaultdict(float)
        for served in self.service.values():
            for (lane, workspace_id), seconds in served.items():
                service[workspace_id] += seconds
                lane_service[lane] += seconds
        finished = {state: self.states[state] for state in sorted(TERMINAL) if self.states[state]}
        return Report(
            seed=self.scenario.seed,
            decisions=self.decisions,
            events=self.event_count,
            simulated_s=end,
            created=self.created,
            finished=finished,
            unfinished=self.created - sum(finished.values()),
            crashes=self.crashes,
            preemptions=self.preemptions,
            boosts=self.boosts,
            waits_by_tier={tier: WaitStats.of(v) for tier, v in sorted(self.waits_tier.items())},
            waits_by_account={
                account: WaitStats.of(v) for account, v in sorted(self.waits_account.items())
            },
            service_s=dict(sorted(service.items())),
            lane_service_s=dict(sorted(lane_service.items())),
            share_error=self._share_error(),
            lane_shares=self._lane_shares(),
            max_wait_s=self.max_wait,
            max_wait_ratio=self.max_ratio,
            invariant_checks=self.checks,
        )

    # --- invariants ---

    def _check(self) -> None:
        self.checks += 1
        if self.busy != len(self.live) or self.busy > self.scenario.slots:
            raise InvariantViolation(f"{self.busy} slots busy for {len(self.live)} attempts.")
        every = self.scenario.check_every
        if every and self.event_count % every == 0:
            self.full_check()

    def full_check(self) -> None:
        """Recount everything from the jobs: slow, so tests choose how often to run it."""
        if sum(self.states.values()) != self.created or len(self.jobs) != self.created:
            raise InvariantViolation("A job was lost.")
        counted = Counter(job.state for job in self.jobs.values())
        if +counted != +self.states:
            raise InvariantViolation(f"State counts drifted: {dict(counted)}")
        queued: Counter = Counter()
        running: Counter = Counter()
        for job in self.jobs.values():
            key = (job.lane, job.workspace_id)
            if job.state == QUEUED:
                queued[key] += 1
            if job.state in LIVE:
                if job.attempt is None or job.attempt.ended or job.attempt.job is not job:
                    raise InvariantViolation(f"Job {job.id} is {job.state} with no live attempt.")
                running[key] += 1
            elif job.attempt is not None:
                raise InvariantViolation(f"Job {job.id} is {job.state} but holds an attempt.")
        backlogged = Counter()
        for key, head in self.heads.items():
            if head.queued != queued[key] or head.running != running[key]:
                raise InvariantViolation(f"The head for {key} doesn't match its jobs.")
            if head.queued:
                backlogged[key[0]] += 1
        for lane, count in self.lane_backlogged.items():
            if count != backlogged[lane]:
                raise InvariantViolation(f"The {lane} lane's backlog count drifted.")


def simulate(scenario: Scenario) -> Report:
    """Run one scenario to its end and report on it."""
    return Simulation(scenario).run()


def compare(scenario: Scenario, config: PolicyConfig) -> tuple[Report, Report]:
    """Forecast a policy change: the scenario under its own config, then under `config`."""
    return simulate(scenario), simulate(replace(scenario, config=config))


__all__ = [
    "AccountSpec",
    "Demand",
    "InvariantViolation",
    "PlanChange",
    "Report",
    "Scenario",
    "Simulation",
    "WaitStats",
    "compare",
    "fair_shares",
    "simulate",
]
