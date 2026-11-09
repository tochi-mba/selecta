"""What a job handler gets to work with, and how its exceptions become error classes.

A handler is `handler(job, ctx)`. It does the work in `ctx.scratch` (a private temporary folder,
removed afterwards), reports real units of work with `ctx.progress()`, calls `ctx.check_in()`
between steps, and publishes outputs through `ctx.artifacts`. It returns the job's result (small
JSON, applied by the store inside the completing transaction) or a `JobOutput`.

Engine code that already calls `selecta.jobs.check_in()` needs no change: while a handler runs,
that check is wired to this attempt, so it raises `selecta.jobs.Interrupted` when the attempt is
cancelled, preempted, timed out or has lost its lease.
"""

from __future__ import annotations

import logging
import threading
import time
import traceback
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from selecta import jobs as engine_jobs
from selecta.work.errors import StaleLease
from selecta.work.model import ErrorClass, Job
from selecta.work.ports import ArtifactOutput

log = logging.getLogger(__name__)
PROGRESS_EVERY_S = 5.0
"""Progress reaches the store at most this often (§4A.6 throttles it to one per 5 s)."""


class InputInvalid(Exception):
    """The job's input can't be used (corrupt audio, an unsupported codec, a decode bomb).

    It fails for good with this message as the plain reason; retrying wouldn't help.
    """


class TransientError(Exception):
    """Something outside Selecta failed for now (network, storage, a rate limit). Retried."""


class ResourceExhausted(Exception):
    """Out of memory, GPU memory or scratch disk. Retried on a bigger worker if the pool has one."""


@dataclass(frozen=True)
class JobOutput:
    result: Any = None
    artifacts: tuple[ArtifactOutput, ...] = ()


class ArtifactSink(Protocol):
    def publish(
        self,
        kind: str,
        input_hash: str,
        keys: Any,
        *,
        checksum: str | None = None,
        size_bytes: int | None = None,
        provenance: Mapping[str, Any] | None = None,
        protected: bool = False,
    ) -> None: ...


@dataclass
class CollectingSink:
    """Keeps what a handler publishes, for the runner to send with `complete`."""

    outputs: list[ArtifactOutput] = field(default_factory=list)

    def publish(
        self,
        kind: str,
        input_hash: str,
        keys: Any,
        *,
        checksum: str | None = None,
        size_bytes: int | None = None,
        provenance: Mapping[str, Any] | None = None,
        protected: bool = False,
    ) -> None:
        self.outputs.append(
            ArtifactOutput(kind, input_hash, keys, checksum, size_bytes, provenance, protected)
        )


@dataclass
class AttemptSignals:
    """Why a running attempt should stop, set by its heartbeat thread and the runner."""

    cancel: threading.Event = field(default_factory=threading.Event)
    lost: threading.Event = field(default_factory=threading.Event)
    timed_out: threading.Event = field(default_factory=threading.Event)
    finished: threading.Event = field(default_factory=threading.Event)
    reason: str = ""

    def stop_for(self, event: threading.Event, reason: str) -> None:
        self.reason = self.reason or reason
        event.set()

    def should_stop(self) -> bool:
        return self.cancel.is_set() or self.lost.is_set() or self.timed_out.is_set()


class JobContext:
    def __init__(
        self,
        job: Job,
        attempt_id: str,
        fencing_token: int,
        scratch: Path,
        signals: AttemptSignals,
        report_progress: Callable[[float, float | None], None],
    ):
        self.job = job
        self.attempt_id = attempt_id
        self.fencing_token = fencing_token
        self.scratch = scratch
        self.signals = signals
        self.artifacts = CollectingSink()
        self.last_progress_at: float | None = None
        """Monotonic time of the last progress report; None until the handler reports any."""
        self._report = report_progress
        self._sent_at = 0.0
        self._lock = threading.Lock()

    def progress(self, done: float, total: float | None = None) -> None:
        """Real work units done (songs, windows, seconds of audio), never elapsed time."""
        moment = time.monotonic()
        with self._lock:
            self.last_progress_at = moment
            if moment - self._sent_at < PROGRESS_EVERY_S:
                return
            self._sent_at = moment
        try:
            self._report(done, total)
        except StaleLease:
            self.signals.stop_for(self.signals.lost, "Its lease ran out.")
        except Exception:  # noqa: BLE001 - progress is a courtesy; the work goes on
            log.warning("Couldn't record progress for %s", self.attempt_id, exc_info=True)

    def should_stop(self) -> bool:
        return self.signals.should_stop()

    def check_in(self) -> None:
        """Between steps: stop here if the attempt was cancelled, preempted or lost."""
        if self.should_stop():
            raise engine_jobs.Interrupted


Handler = Callable[[Job, JobContext], Any]


def classify(problem: BaseException) -> ErrorClass:
    """The error class for an exception a handler raised (§4A.7)."""
    if isinstance(problem, InputInvalid):
        return ErrorClass.INPUT_INVALID
    if isinstance(problem, MemoryError | ResourceExhausted):
        return ErrorClass.RESOURCE
    if isinstance(problem, TransientError | ConnectionError | TimeoutError):
        return ErrorClass.TRANSIENT
    return ErrorClass.ENGINE_BUG


def describe(problem: BaseException, limit: int = 4_000) -> str:
    """A plain reason for people, then the traceback's tail for us, kept short."""
    if isinstance(problem, InputInvalid):
        return str(problem)
    text = "".join(traceback.format_exception(problem))
    return text[-limit:]
