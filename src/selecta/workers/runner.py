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
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from selecta import jobs as engine_jobs
from selecta.scheduling.policy import WorkerCaps
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
    engine bug instead of being treated as successful no-ops. The runner does not register a
    worker automatically, because enrollment credentials and registration belong to deployment
    setup; call ``store.register_worker(caps)`` once before starting the loop.
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
    ) -> None:
        if caps.worker_id is None:
            raise ValueError("WorkerCaps.worker_id is required for a running worker.")
        if heartbeat_s is None:
            heartbeat_s = float(store.config.heartbeat_s)
        if heartbeat_s <= 0 or idle_s <= 0:
            raise ValueError("heartbeat_s and idle_s must be positive.")
        self.store = store
        self.caps = caps
        self.handlers = dict(handlers)
        self.scratch_root = scratch_root
        if scratch_root is not None:
            scratch_root.mkdir(parents=True, exist_ok=True)
        self.heartbeat_s = heartbeat_s
        self.idle_s = idle_s
        self.clock = clock

    def run_once(self) -> RunResult | None:
        """Claim and run at most one job; return ``None`` when this pool has no eligible work."""
        self.store.touch_worker(self.caps.worker_id)
        claim = self.store.claim(self.caps.pool, self.caps)
        if claim is None:
            return None
        return self.run_claim(claim)

    def run_claim(self, claim: Claim) -> RunResult:
        """Start and execute one already-claimed attempt."""
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
            )
            heartbeat_stop = threading.Event()
            heartbeat = threading.Thread(
                target=self._heartbeat,
                args=(claim, signals, heartbeat_stop, started, job.max_run_s),
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
                    return self._fail(
                        claim,
                        job,
                        ErrorClass.RESOURCE,
                        "The worker exceeded the job's runtime limit.",
                        cost,
                    )
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
                    return self._fail(
                        claim,
                        job,
                        ErrorClass.RESOURCE,
                        "The worker exceeded the job's runtime limit.",
                        cost,
                    )
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
    ) -> None:
        while not stop.wait(self.heartbeat_s):
            if self.clock() - started >= max_run_s:
                signals.stop_for(signals.timed_out, "The worker exceeded the job's runtime limit.")
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
    def _result(
        claim: Claim, job: Job, outcome: AttemptOutcome, detail: str = ""
    ) -> RunResult:
        return RunResult(claim.attempt_id, job.id, str(job.state), str(outcome), detail)

__all__ = ["DurableStore", "RunResult", "WorkerRunner"]
