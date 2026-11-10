"""The job store: the one object producers, workers and maintenance talk to (ADR-0394).

It owns the engine and the scheduling policy, opens one transaction per operation, and hands the
work to the small modules beside it (`enqueue`, `claims`, `lifecycle`, `retrying`, `upkeep`).
The same store runs the local app on SQLite and the cloud gateway on PostgreSQL; what differs is
plugged in through `ports`: entitlements, per-workspace flags, and output verification.

Wakers are in-process callbacks told the pool name after a commit that queued work there, which
is how the local runner hears of new work at once. Across processes the outbox's `pg_notify`
does the same job.
"""

from __future__ import annotations

import contextlib
import json
import random
import threading
from collections.abc import Callable, Iterable, Iterator
from typing import Any, Protocol

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.persistence import db_now, new_id, transaction
from selecta.scheduling import admission
from selecta.scheduling.policy import Lane, PolicyConfig, WorkerCaps
from selecta.work import (
    artifacts,
    claims,
    enqueue,
    fleet,
    heads,
    lifecycle,
    outbox,
    retrying,
    upkeep,
)
from selecta.work.claims import Claim
from selecta.work.enqueue import Enqueued, JobSpec
from selecta.work.errors import ResultTooLarge, StaleLease
from selecta.work.lifecycle import Heartbeat
from selecta.work.model import Attempt, ErrorClass, Job, JobState, lookup
from selecta.work.ports import (
    AllFlagsOn,
    ArtifactOutput,
    Entitlements,
    FlagGate,
    LocalEntitlements,
    NoWorkControls,
    OutputVerifier,
    ResultApplier,
    TrustOutputs,
    WorkControls,
)
from selecta.work.schema import fair_heads, job_attempts, jobs
from selecta.work.sql import WOKEN, take_woken
from selecta.work.state import read_job

Waker = Callable[[str], None]
DAY_S = 86_400.0


class TermFence(Protocol):
    """Checks, inside a transaction, that a maintenance task's leader term is still current,
    raising `LostLeadership` when it isn't (see `selecta.work.maintenance`)."""

    def check(self, connection: Connection) -> None: ...


class JobStore:
    def __init__(
        self,
        engine: Engine,
        config: PolicyConfig | None = None,
        *,
        entitlements: Entitlements | None = None,
        flags: FlagGate | None = None,
        verifier: OutputVerifier | None = None,
        appliers: dict[str, ResultApplier] | None = None,
        controls: WorkControls | None = None,
        rng: random.Random | None = None,
        batch: int = 200,
    ):
        self.engine = engine
        self.config = config or PolicyConfig()
        """Swapped whole by the admin policy editor; every claim reads it once."""
        self.entitlements: Entitlements = entitlements or LocalEntitlements()
        self.flags: FlagGate = flags or AllFlagsOn()
        self.verifier: OutputVerifier = verifier or TrustOutputs()
        self.appliers: dict[str, ResultApplier] = dict(appliers or {})
        self.controls: WorkControls = controls or NoWorkControls()
        """Emergency controls and staff holds; the cloud passes `admin.state.DbWorkControls`."""
        self.rng = rng or random.Random()
        self.batch = batch
        self.flag_resume_s = 5.0
        """How often each pool's claims look for `flag_off` jobs whose flag is back on."""
        self._flag_resume_at: dict[str, float] = {}
        self._wakers: list[Waker] = []
        self._workspaces: dict[str, str] = {}
        self._lock = threading.Lock()
        self._lanes_ready = False

    # --- plumbing ---

    def add_waker(self, waker: Waker) -> None:
        with self._lock:
            self._wakers.append(waker)

    def remove_waker(self, waker: Waker) -> None:
        with self._lock:
            if waker in self._wakers:
                self._wakers.remove(waker)

    def register_applier(self, job_type: str, applier: ResultApplier) -> None:
        lookup(job_type)
        self.appliers[job_type] = applier

    @contextlib.contextmanager
    def _tx(
        self,
        workspace_id: str | None = None,
        fence: TermFence | None = None,
        heads_first: bool = False,
    ) -> Iterator[tuple[Connection, float]]:
        """One transaction. `heads_first` for anything that may change `fair_heads`: it takes
        every lane clock before any other row, the lock order that keeps PostgreSQL free of
        deadlocks (see `selecta.work.heads`)."""
        with transaction(self.engine, workspace_id) as connection:
            connection.info.pop(WOKEN, None)
            if heads_first:
                self._lock_lanes(connection)
            if fence is not None:
                fence.check(connection)
            yield connection, db_now(connection)
            woken = take_woken(connection)
        with self._lock:
            wakers = list(self._wakers)
        for pool in sorted(woken):
            for waker in wakers:
                try:
                    waker(pool)
                except Exception:  # noqa: BLE001 - a broken listener must not undo a commit
                    pass

    def _lock_lanes(self, connection: Connection) -> None:
        if not self._lanes_ready:
            heads.create_lanes(connection, db_now(connection))
            self._lanes_ready = True
        heads.lock_all_lanes(connection)

    def _remember(self, attempt_id: str, workspace_id: str) -> None:
        with self._lock:
            if len(self._workspaces) > 10_000:
                self._workspaces.clear()
            self._workspaces[attempt_id] = workspace_id

    def _workspace_of(self, attempt_id: str) -> str:
        """Which workspace an attempt belongs to, so its transaction runs as that workspace."""
        with self._lock:
            known = self._workspaces.get(attempt_id)
        if known is not None:
            return known
        with transaction(self.engine) as connection:
            workspace_id = connection.execute(
                sa.select(job_attempts.c.workspace_id).where(job_attempts.c.id == attempt_id)
            ).scalar()
        if workspace_id is None:
            raise StaleLease(f"There's no attempt {attempt_id}.")
        self._remember(attempt_id, workspace_id)
        return workspace_id

    def _forget(self, attempt_id: str) -> None:
        with self._lock:
            self._workspaces.pop(attempt_id, None)

    # --- producers ---

    def enqueue(self, spec: JobSpec) -> Enqueued:
        with self._tx(spec.workspace_id, heads_first=True) as (connection, now):
            return enqueue.enqueue(connection, spec, now)

    def add_dependency(self, workspace_id: str, job_id: str, depends_on: str) -> Job:
        with self._tx(workspace_id, heads_first=True) as (connection, now):
            return enqueue.add_dependency(connection, workspace_id, job_id, depends_on, now)

    def cancel(self, workspace_id: str, job_id: str) -> Job:
        with self._tx(workspace_id, heads_first=True) as (connection, now):
            return lifecycle.cancel(connection, workspace_id, job_id, now)

    def retry(self, workspace_id: str, job_id: str) -> Job:
        with self._tx(workspace_id, heads_first=True) as (connection, now):
            return retrying.retry(connection, workspace_id, job_id, now)

    def admit(self, spec: JobSpec, *, day_start: float | None = None) -> admission.Admission:
        """Admission control for one new job (see `selecta.scheduling.admission`).

        A pool with no registered workers counts as one slot, so scaling to zero doesn't look
        like overload. `day_start` is midnight in the account's time zone (UTC by default).
        """
        kind = lookup(spec.type)
        lane = Lane(spec.lane) if spec.lane is not None else kind.lane
        standing = self.entitlements.standing(spec.workspace_id)
        unstarted = [str(s) for s in (JobState.QUEUED, JobState.WAITING_DEPS,
                                       JobState.RETRY_SCHEDULED)]
        with self._tx(spec.workspace_id) as (connection, now):
            queued_of_type = connection.execute(
                sa.select(sa.func.count()).where(
                    jobs.c.workspace_id == spec.workspace_id,
                    jobs.c.type == spec.type,
                    jobs.c.state.in_(unstarted),
                )
            ).scalar_one()
            backlog = connection.execute(
                sa.select(sa.func.sum(fair_heads.c.queued_est_s)).where(
                    fair_heads.c.pool == kind.pool
                )
            ).scalar()
            slots = fleet.pool_slots(connection, kind.pool, now - self.config.worker_ttl_s)
            used = 0.0
            if lane == Lane.SPECULATIVE:
                since = now - now % DAY_S if day_start is None else day_start
                used = self._speculative_used(connection, spec.workspace_id, since, now)
            blocked = self.controls.admission_block(connection, kind.pool, str(lane))
        if blocked is not None:
            return admission.Admission(admission.Verdict.REFUSE, blocked)
        return admission.admit(
            self.config,
            job_type=spec.type,
            lane=lane,
            tier=standing.tier,
            queued_of_type=queued_of_type,
            backlog_drain_s=admission.drain_seconds(float(backlog or 0.0), max(slots, 1)),
            speculative_used_s=used,
        )

    @staticmethod
    def _speculative_used(connection: Connection, workspace_id: str, since: float, now: float):
        speculative = sa.and_(
            job_attempts.c.workspace_id == workspace_id,
            job_attempts.c.lane == str(Lane.SPECULATIVE),
        )
        ended = connection.execute(
            sa.select(sa.func.sum(job_attempts.c.cost_s)).where(
                speculative, job_attempts.c.ended_at >= since
            )
        ).scalar()
        running = connection.execute(
            sa.select(sa.func.sum(now - job_attempts.c.started_at)).where(
                speculative, job_attempts.c.outcome.is_(None)
            )
        ).scalar()
        return float(ended or 0.0) + float(running or 0.0)

    # --- workers ---

    def register_worker(self, caps: WorkerCaps, worker_id: str | None = None) -> str:
        worker_id = worker_id or caps.worker_id or new_id()
        with self._tx() as (connection, now):
            fleet.register(connection, worker_id, caps, now)
        return worker_id

    def touch_worker(self, worker_id: str) -> None:
        with self._tx() as (connection, now):
            fleet.touch(connection, worker_id, now)

    def retire_worker(self, worker_id: str) -> None:
        with self._tx() as (connection, _now):
            fleet.retire(connection, worker_id)

    def claim(self, pool: str, caps: WorkerCaps) -> Claim | None:
        """The next job this worker should run in this pool, or None if nothing is eligible."""
        with self._tx() as (connection, now):
            claimed = claims.ClaimSession(connection, self, pool, caps, now).run()
        if claimed is not None:
            self._remember(claimed.attempt_id, claimed.job.workspace_id)
        return claimed

    def start(self, attempt_id: str, token: int) -> Job:
        with self._tx(self._workspace_of(attempt_id)) as (connection, now):
            return lifecycle.start(connection, attempt_id, token, now)

    def heartbeat(self, attempt_id: str, token: int) -> Heartbeat:
        with self._tx(self._workspace_of(attempt_id)) as (connection, now):
            return lifecycle.heartbeat(connection, attempt_id, token, now, self.config.lease_s)

    def progress(
        self, attempt_id: str, token: int, done: float, total: float | None = None
    ) -> None:
        with self._tx(self._workspace_of(attempt_id)) as (connection, now):
            lifecycle.progress(connection, attempt_id, token, done, total, now)

    def complete(
        self,
        attempt_id: str,
        token: int,
        *,
        result: Any = None,
        artifacts: Iterable[ArtifactOutput] = (),
        cost_s: float | None = None,
    ) -> Job:
        """Publish an attempt's results. Raises `StaleLease` (or its `JobCancelled`) when the
        attempt no longer holds the job, and `CompletionRejected` when the results were refused
        (the job has then been rescheduled or failed)."""
        if result is not None:
            size = len(json.dumps(result, default=str).encode("utf-8"))
            if size > self.config.max_result_bytes:
                raise ResultTooLarge(f"The results are {size} bytes; store them as artifacts.")
        outputs = tuple(artifacts)
        with self._tx(self._workspace_of(attempt_id), heads_first=True) as (connection, now):
            job, problem = lifecycle.complete(
                connection, self, attempt_id, token, result, outputs, cost_s, now
            )
        self._forget(attempt_id)
        if problem is not None:
            raise problem
        return job

    def fail(
        self,
        attempt_id: str,
        token: int,
        error_class: ErrorClass | str,
        detail: str = "",
        cost_s: float | None = None,
    ) -> Job:
        with self._tx(self._workspace_of(attempt_id), heads_first=True) as (connection, now):
            job = lifecycle.fail(
                connection, self, attempt_id, token, error_class, detail, cost_s, now
            )
        self._forget(attempt_id)
        return job

    def release(self, attempt_id: str, token: int, cost_s: float | None = None) -> Job:
        """The attempt gave way: back in line, or cancelled if a cancel was asked for."""
        with self._tx(self._workspace_of(attempt_id), heads_first=True) as (connection, now):
            job = lifecycle.release(connection, self, attempt_id, token, cost_s, now)
        self._forget(attempt_id)
        return job

    def request_preemption(
        self, pool: str, *, slots: int | None = None, free_slots: int | None = None
    ) -> str | None:
        """Ask the youngest speculative attempt in a full pool to give way to waiting work.
        Returns its attempt id, or None when nothing needs to give way."""
        with self._tx() as (connection, now):
            if slots is None:
                slots = fleet.pool_slots(connection, pool, now - self.config.worker_ttl_s)
            if free_slots is None:
                free_slots = slots - heads.pool_busy(connection, pool)
            target = claims.preemption_target(
                connection, pool, slots=slots, free_slots=free_slots
            )
            if target is not None and lifecycle.request_preemption(connection, target, now):
                return target
        return None

    # --- maintenance ---

    def reap_expired(self, fence: TermFence | None = None) -> list[str]:
        reaped: list[str] = []
        while True:
            with self._tx(None, fence, heads_first=True) as (connection, now):
                found = upkeep.reap_expired(connection, self, now, self.batch)
            reaped.extend(found)
            if len(found) < self.batch:
                return reaped

    def promote_due_retries(self, fence: TermFence | None = None) -> int:
        total = 0
        while True:
            with self._tx(None, fence, heads_first=True) as (connection, now):
                moved = upkeep.promote_due_retries(connection, now, self.batch)
            total += moved
            if moved < self.batch:
                return total

    def reconcile_heads(self, fence: TermFence | None = None) -> list[upkeep.HeadDiff]:
        """Recompute `fair_heads` from the jobs, fix what differs, and return the differences."""
        with self._tx(None, fence) as (connection, _now):
            suspects = upkeep.head_suspects(connection)
        fixed = []
        for key in suspects:
            with self._tx(None, fence, heads_first=True) as (connection, now):
                difference = upkeep.fix_head(connection, key, now)
            if difference is not None:
                fixed.append(difference)
        return fixed

    def rebase_vtimes(self, fence: TermFence | None = None) -> list[tuple[str, str, float]]:
        with self._tx(None, fence, heads_first=True) as (connection, now):
            return upkeep.rebase(connection, self.config.rebase_threshold, now)

    def prune_outbox(self, keep_s: float = outbox.KEEP_S, fence: TermFence | None = None) -> int:
        with self._tx(None, fence) as (connection, now):
            return outbox.prune(connection, now, keep_s)

    # --- reading ---

    def job(self, job_id: str) -> Job | None:
        with transaction(self.engine) as connection:
            return read_job(connection, job_id)

    def attempt(self, attempt_id: str) -> Attempt | None:
        with transaction(self.engine) as connection:
            return lifecycle.read_attempt(connection, attempt_id)

    def events_after(self, after_id: int, limit: int = 500) -> list[outbox.OutboxEvent]:
        with transaction(self.engine) as connection:
            return outbox.read_after(connection, after_id, limit)

    def find_artifact(
        self, workspace_id: str, kind: str, input_hash: str, *, touch: bool = True
    ) -> artifacts.Artifact | None:
        """An already-published output for these inputs, to reuse instead of making a job."""
        with self._tx(workspace_id) as (connection, now):
            used_at = now if touch else None
            return artifacts.find(connection, workspace_id, kind, input_hash, used_at)
