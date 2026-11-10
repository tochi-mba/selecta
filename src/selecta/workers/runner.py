"""Run claimed durable jobs with heartbeats, cancellation and fenced result publication.

This is the execution half of the durable queue. The API process and worker process can use the
same ``JobStore`` contract; a worker only needs a pool, capabilities and handlers. Long-running
engine functions remain cooperative: they should call ``ctx.check_in()`` between bounded steps so
the runner can stop them after cancellation, preemption, lease loss or their runtime deadline.
"""

from __future__ import annotations

import logging
import tempfile
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from selecta import jobs as engine_jobs
from selecta.observability import tracing
from selecta.persistence import new_id
from selecta.scheduling.policy import WorkerCaps
from selecta.storage.artifacts import ArtifactStore
from selecta.work.claims import Claim
from selecta.work.errors import CompletionRejected, JobCancelled, StaleLease
from selecta.work.model import AttemptOutcome, ErrorClass, Job, JobState
from selecta.work.ports import ArtifactOutput
from selecta.workers.context import (
    AttemptSignals,
    Handler,
    JobContext,
    JobOutput,
    classify,
    describe,
)
from selecta.workers.giveway import GIVE_WAY

if TYPE_CHECKING:
    from selecta.work.store import JobStore

log = logging.getLogger(__name__)


class DurableStore(Protocol):
    """The worker-facing part of ``JobStore``; kept small for tests and adapters."""

    config: Any

    def claim(self, pool: str, caps: WorkerCaps) -> Claim | None: ...

    def start(self, attempt_id: str, token: int) -> Job: ...

    def heartbeat(self, attempt_id: str, token: int) -> Any: ...

    def progress(
        self, attempt_id: str, token: int, done: float, total: float | None = None
    ) -> None: ...

    def complete(
        self,
        attempt_id: str,
        token: int,
        *,
        result: Any = None,
        artifacts: tuple[ArtifactOutput, ...] = (),
        cost_s: float | None = None,
    ) -> Job: ...

    def fail(
        self,
        attempt_id: str,
        token: int,
        error_class: ErrorClass | str,
        detail: str = "",
        cost_s: float | None = None,
    ) -> Job: ...

    def release(self, attempt_id: str, token: int, cost_s: float | None = None) -> Job: ...

    def touch_worker(self, worker_id: str) -> None: ...

    def job(self, job_id: str) -> Job | None: ...


@dataclass(frozen=True)
class RunResult:
    """One worker attempt's outcome; stale attempts are reported without publishing."""

    attempt_id: str
    job_id: str
    state: str
    outcome: str
    detail: str = ""


class WorkerRunner:
    """Poll one pool and execute jobs through the durable store.

    ``handlers`` is keyed by the server-owned catalogue job type. Unknown types fail closed as an
    engine bug instead of being treated as successful no-ops. ``artifact_store`` is what every
    handler's ``ctx.open_input``, ``ctx.publish`` and ``ctx.verify`` use: the local folder on the
    local app, R2 for a worker with storage credentials, or None behind the gateway. The runner
    does not register a worker automatically, because enrollment credentials and registration
    belong to deployment setup; call ``store.register_worker(caps)`` once before starting the
    loop.
    """

    def __init__(
        self,
        store: DurableStore,
        caps: WorkerCaps,
        handlers: Mapping[str, Handler],
        *,
        scratch_root: Path | None = None,
        heartbeat_s: float | None = None,
        idle_s: float = 0.5,
        clock: Callable[[], float] = time.monotonic,
        no_progress_s: float | None = None,
        artifact_store: ArtifactStore | None = None,
    ) -> None:
        if caps.worker_id is None:
            raise ValueError("WorkerCaps.worker_id is required for a running worker.")
        if heartbeat_s is None:
            heartbeat_s = float(store.config.heartbeat_s)
        if heartbeat_s <= 0 or idle_s <= 0:
            raise ValueError("heartbeat_s and idle_s must be positive.")
        if no_progress_s is not None and no_progress_s <= 0:
            raise ValueError("no_progress_s must be positive when it's set.")
        self.store = store
        self.caps = caps
        self.handlers = dict(handlers)
        self.scratch_root = scratch_root
        if scratch_root is not None:
            scratch_root.mkdir(parents=True, exist_ok=True)
        self.heartbeat_s = heartbeat_s
        self.idle_s = idle_s
        self.clock = clock
        self.artifact_store = artifact_store
        self.no_progress_s = no_progress_s
        """The watchdog stops a job that reports no progress for this long (None: never)."""
        self.live: dict[str, AttemptSignals] = {}
        """The attempt this runner is working on, by id, so a local runner can stop it at once."""

    def run_once(self) -> RunResult | None:
        """Claim and run at most one job; return ``None`` when this pool has no eligible work."""
        self.store.touch_worker(self.caps.worker_id)
        claim = self.store.claim(self.caps.pool, self.caps)
        if claim is None:
            return None
        return self.run_claim(claim)

    def run_claim(self, claim: Claim) -> RunResult:
        """Start and execute one already-claimed attempt, in the job's trace (ADR-0410)."""
        with tracing.job_span(
            "worker.run",
            claim.job.id,
            service="worker",
            **{
                "selecta.job_type": claim.job.type,
                "selecta.attempt_id": claim.attempt_id,
                "selecta.pool": self.caps.pool,
            },
        ) as span:
            result = self._run_claim(claim)
            span.set_attribute("selecta.outcome", str(result.outcome))
            return result

    def _run_claim(self, claim: Claim) -> RunResult:
        job = claim.job
        try:
            job = self.store.start(claim.attempt_id, claim.fencing_token)
        except StaleLease as problem:
            return self._result(claim, job, AttemptOutcome.SUPERSEDED, str(problem))

        handler = self.handlers.get(job.type)
        if handler is None:
            return self._fail(
                claim,
                job,
                ErrorClass.ENGINE_BUG,
                f"No worker handler is registered for {job.type}.",
                0.0,
            )

        signals = AttemptSignals()
        started = self.clock()
        context: JobContext
        with tempfile.TemporaryDirectory(
            prefix=f"selecta-{job.id[:8]}-", dir=self.scratch_root
        ) as scratch:
            context = JobContext(
                job,
                claim.attempt_id,
                claim.fencing_token,
                Path(scratch),
                signals,
                lambda done, total: self.store.progress(
                    claim.attempt_id, claim.fencing_token, done, total
                ),
                input_urls=claim.input_urls,
                output_prefix=claim.output_prefix,
                input_downloader=getattr(self.store, "download_input", None),
                artifact_publisher=getattr(self.store, "publish_artifact", None),
                artifact_store=self.artifact_store,
                clock=self.clock,
            )
            self.live[claim.attempt_id] = signals
            heartbeat_stop = threading.Event()
            heartbeat = threading.Thread(
                target=self._heartbeat,
                args=(claim, signals, heartbeat_stop, started, job.max_run_s, context),
                name=f"job-heartbeat-{claim.attempt_id[:8]}",
                daemon=True,
            )
            heartbeat.start()
            try:
                with GIVE_WAY.watching(context.should_stop):
                    value = handler(job, context)
                context.check_in()
            except engine_jobs.Interrupted:
                cost = max(self.clock() - started, 0.0)
                if signals.lost.is_set():
                    return self._result(claim, job, AttemptOutcome.SUPERSEDED, signals.reason)
                if signals.timed_out.is_set():
                    return self._fail(claim, job, ErrorClass.RESOURCE, signals.reason, cost)
                try:
                    released = self.store.release(claim.attempt_id, claim.fencing_token, cost)
                except StaleLease as problem:
                    return self._result(claim, job, AttemptOutcome.SUPERSEDED, str(problem))
                outcome = (
                    AttemptOutcome.CANCELLED
                    if released.state == JobState.CANCELLED
                    else AttemptOutcome.RELEASED
                )
                return self._result(claim, released, outcome, signals.reason)
            except BaseException as problem:
                # Interrupted is the only expected BaseException; preserve process-level exits.
                if not isinstance(problem, Exception):
                    raise
                cost = max(self.clock() - started, 0.0)
                if signals.lost.is_set():
                    return self._result(claim, job, AttemptOutcome.SUPERSEDED, signals.reason)
                if signals.timed_out.is_set():
                    return self._fail(claim, job, ErrorClass.RESOURCE, signals.reason, cost)
                return self._fail(claim, job, classify(problem), describe(problem), cost)
            else:
                cost = max(self.clock() - started, 0.0)
                output = value if isinstance(value, JobOutput) else JobOutput(result=value)
                artifacts_by_input = {
                    (item.kind, item.input_hash): item
                    for item in (*context.artifacts.outputs, *output.artifacts)
                }
                try:
                    completed = self.store.complete(
                        claim.attempt_id,
                        claim.fencing_token,
                        result=output.result,
                        artifacts=tuple(artifacts_by_input.values()),
                        cost_s=cost,
                    )
                except JobCancelled as problem:
                    current = self.store.job(job.id) or job
                    return self._result(claim, current, AttemptOutcome.CANCELLED, str(problem))
                except CompletionRejected as problem:
                    current = self.store.job(job.id) or job
                    return self._result(claim, current, AttemptOutcome.FAILED, str(problem))
                except StaleLease as problem:
                    return self._result(claim, job, AttemptOutcome.SUPERSEDED, str(problem))
                return self._result(claim, completed, AttemptOutcome.SUCCEEDED)
            finally:
                self.live.pop(claim.attempt_id, None)
                heartbeat_stop.set()
                heartbeat.join(timeout=max(self.heartbeat_s * 2, 1.0))

    def serve(self, stop: threading.Event) -> None:
        """Run until ``stop`` is set, sleeping briefly when there is no eligible work."""
        while not stop.is_set():
            try:
                result = self.run_once()
                if result is None:
                    stop.wait(self.idle_s)
            except Exception:  # noqa: BLE001 - one failed poll must not kill a worker process
                log.exception("Durable worker poll failed for pool %s", self.caps.pool)
                stop.wait(self.idle_s)

    def _heartbeat(
        self,
        claim: Claim,
        signals: AttemptSignals,
        stop: threading.Event,
        started: float,
        max_run_s: float,
        context: JobContext,
    ) -> None:
        """Renew the lease while the handler works, and be its watchdog.

        A job past its maximum run time, or silent for `no_progress_s`, is told to stop and this
        thread stops beating, so a handler that never checks in loses its lease and the reaper
        takes over (§4A.6).
        """
        while not stop.wait(self.heartbeat_s):
            now = self.clock()
            if now - started >= max_run_s:
                signals.stop_for(signals.timed_out, "The worker exceeded the job's runtime limit.")
                return
            last = context.last_progress_at if context.last_progress_at is not None else started
            if self.no_progress_s is not None and now - last >= self.no_progress_s:
                signals.stop_for(
                    signals.timed_out, f"It reported no progress for {self.no_progress_s:.0f} s."
                )
                return
            try:
                state = self.store.heartbeat(claim.attempt_id, claim.fencing_token)
            except StaleLease:
                signals.stop_for(signals.lost, "Its lease ran out.")
                return
            except Exception:  # noqa: BLE001 - transient store errors get another heartbeat
                log.warning("Heartbeat failed for %s", claim.attempt_id, exc_info=True)
                continue
            if state.cancel_requested:
                signals.stop_for(
                    signals.cancel, state.cancel_reason or "The attempt was asked to stop."
                )
                return

    def _fail(
        self,
        claim: Claim,
        job: Job,
        error_class: ErrorClass,
        detail: str,
        cost: float,
    ) -> RunResult:
        try:
            failed = self.store.fail(
                claim.attempt_id, claim.fencing_token, error_class, detail, cost
            )
        except StaleLease as problem:
            return self._result(claim, job, AttemptOutcome.SUPERSEDED, str(problem))
        outcome = (
            AttemptOutcome.CANCELLED
            if failed.state == JobState.CANCELLED
            else AttemptOutcome.FAILED
        )
        return self._result(claim, failed, outcome, detail)

    @staticmethod
    def _result(claim: Claim, job: Job, outcome: AttemptOutcome, detail: str = "") -> RunResult:
        return RunResult(claim.attempt_id, job.id, str(job.state), str(outcome), detail)


class LocalRunner:
    """The local app's in-process runner: a few threads claiming from one pool (§4A.13).

    Each thread is a registered worker of one slot, so the pool has as many slots as threads.
    A store waker hears of new work in the pool as soon as it's committed: it wakes idle threads
    and, when the pool is full, asks the youngest speculative attempt to give way. A one-slot
    pool therefore runs spare-time work whenever it's otherwise idle and gives way the moment
    interactive or standard work arrives (§4A.4). When one of this runner's threads holds that
    attempt, it stops at its next `check_in()` instead of waiting for a heartbeat.

    `stop()` is graceful: handlers already running finish and publish, nothing new is claimed.
    """

    def __init__(
        self,
        store: JobStore,
        pool: str,
        handlers: Mapping[str, Handler],
        *,
        threads: int = 1,
        caps: WorkerCaps | None = None,
        name: str | None = None,
        preempt: bool = True,
        **options: Any,
    ) -> None:
        if threads < 1:
            raise ValueError("A local runner needs at least one thread.")
        base = name or f"local-{new_id()}"
        template = caps or WorkerCaps(pool=pool)
        self.store = store
        self.pool = pool
        self.preempt = preempt
        self.runners = [
            WorkerRunner(
                store,
                replace(template, pool=pool, slots=1, worker_id=f"{base}-{number}"),
                handlers,
                **options,
            )
            for number in range(threads)
        ]
        self._stop = threading.Event()
        self._gate = threading.Lock()
        """Held from the stop check to the end of a claim, so `stop()` can't miss one."""
        self._wakes = [threading.Event() for _ in self.runners]
        self._threads: list[threading.Thread] = []

    @property
    def slots(self) -> int:
        return len(self.runners)

    def start(self) -> None:
        if self._threads:
            raise RuntimeError("This runner has already started.")
        for runner in self.runners:
            self.store.register_worker(runner.caps)
        self.store.add_waker(self.wake)
        self._threads = [
            threading.Thread(
                target=self._loop,
                args=(runner, wake),
                name=f"selecta-{self.pool}-{number}",
                daemon=True,
            )
            for number, (runner, wake) in enumerate(zip(self.runners, self._wakes, strict=True))
        ]
        for thread in self._threads:
            thread.start()

    def wake(self, pool: str) -> None:
        """The store's waker: new work in `pool` has just been committed."""
        if pool != self.pool or self._stop.is_set():
            return
        for wake in self._wakes:
            wake.set()
        if self.preempt:
            self.give_way()

    def give_way(self) -> str | None:
        """Ask the youngest speculative attempt in a full pool to stop (at once, if it's ours).

        Returns its attempt id, or None when nothing needs to give way.
        """
        try:
            target = self.store.request_preemption(self.pool, slots=self.slots)
        except Exception:  # noqa: BLE001 - preemption is an optimisation; work still finishes
            log.warning("Couldn't check for preemption in pool %s", self.pool, exc_info=True)
            return None
        if target is not None:
            for runner in self.runners:
                signals = runner.live.get(target)
                if signals is not None:
                    signals.stop_for(signals.cancel, "preempt")
        return target

    def _loop(self, runner: WorkerRunner, wake: threading.Event) -> None:
        while True:
            wake.clear()
            with self._gate:
                if self._stop.is_set():
                    return
                try:
                    self.store.touch_worker(runner.caps.worker_id)
                    claim = self.store.claim(self.pool, runner.caps)
                except Exception:  # noqa: BLE001 - a failed claim must not kill the thread
                    log.exception("Claiming in pool %s failed", self.pool)
                    claim = None
            if claim is None:
                wake.wait(runner.idle_s)
                continue
            try:
                runner.run_claim(claim)
            except Exception:  # noqa: BLE001 - the lease runs out and the reaper retries it
                log.exception("Running attempt %s failed", claim.attempt_id)

    def stop(self, timeout: float | None = 30.0) -> bool:
        """Finish what's running and claim nothing new. True when every thread has finished."""
        with self._gate:
            self._stop.set()
        self.store.remove_waker(self.wake)
        for wake in self._wakes:
            wake.set()
        for thread in self._threads:
            thread.join(timeout)
        finished = not any(thread.is_alive() for thread in self._threads)
        if finished:
            for runner in self.runners:
                self.store.retire_worker(runner.caps.worker_id)
        return finished


__all__ = ["DurableStore", "LocalRunner", "RunResult", "WorkerRunner"]
