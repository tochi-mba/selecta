"""What a job handler gets to work with, and how its exceptions become error classes.

A handler is `handler(job, ctx)`. It does the work in `ctx.scratch` (a private temporary folder,
removed afterwards), reports real units of work with `ctx.progress()`, calls `ctx.check_in()`
between steps, and publishes outputs through `ctx.artifacts`. It returns the job's result (small
JSON, applied by the store inside the completing transaction) or a `JobOutput`.

Files go in and out through one interface whatever the worker runs on (ADR-0397,
docs/saas/10-audio-engine-in-cloud.md §10.1): `ctx.open_input(key)` gives a local path for a
stored object, `ctx.publish(kind, input_hash, path, name)` stores a finished file under this
attempt's own derived key and queues its manifest row, and `ctx.verify(key, size, sha256)` checks
a stored object. The runner hands the context an `ArtifactStore`: `LocalArtifactStore` on the
local app (the file is already on disk) or `R2ArtifactStore` for a worker that holds storage
credentials. A gateway worker holds none, so the same three calls go through its signed URLs.

Engine code that already calls `selecta.jobs.check_in()` needs no change: while a handler runs,
that check is wired to this attempt, so it raises `selecta.jobs.Interrupted` when the attempt is
cancelled, preempted, timed out or has lost its lease.
"""

from __future__ import annotations

import logging
import re
import threading
import time
import traceback
from collections.abc import Callable, Iterator, Mapping
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from selecta import jobs as engine_jobs
from selecta.storage.artifacts import ArtifactStore
from selecta.storage.keys import UnsafeKey, derived_key, workspace_of
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
        *,
        input_urls: tuple[Mapping[str, str], ...] = (),
        output_prefix: str | None = None,
        input_downloader: Callable[[JobContext, str | int, Path | None], Path] | None = None,
        artifact_publisher: Callable[..., ArtifactOutput] | None = None,
        artifact_store: ArtifactStore | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.job = job
        self.attempt_id = attempt_id
        self.fencing_token = fencing_token
        self.scratch = scratch
        self.signals = signals
        self.artifacts = CollectingSink()
        self.input_urls = input_urls
        """Short-lived input URLs supplied by a remote gateway; empty for local workers."""
        self.output_prefix = output_prefix
        """Attempt-scoped derived-object prefix, when the gateway provides one."""
        self._input_downloader = input_downloader
        self._artifact_publisher = artifact_publisher
        self.store = artifact_store
        """Where inputs are read and outputs stored; None for a worker behind the gateway."""
        self._clock = clock
        self.last_progress_at: float | None = None
        """When the handler last reported progress, on `clock` (the runner's, so its watchdog
        can compare); None until the handler reports any."""
        self._report = report_progress
        self._sent_at = -PROGRESS_EVERY_S
        self._lock = threading.Lock()

    def download_input(self, selector: str | int, destination: Path | None = None) -> Path:
        """Download a claimed input to scratch using its short-lived signed URL.

        ``selector`` is an input's declared `name` or its zero-based position. Local-mode
        handlers continue to use their existing paths; this method is available to injected
        remote handlers without adding cloud URLs to the job's durable input reference.
        """
        if self._input_downloader is None:
            raise RuntimeError("This worker context has no remote input downloader.")
        return self._input_downloader(self, selector, destination)

    def publish_artifact(
        self,
        kind: str,
        input_hash: str,
        source: Path,
        name: str,
        *,
        provenance: Mapping[str, Any] | None = None,
        protected: bool = False,
    ) -> ArtifactOutput:
        """Upload one artifact via a signed attempt-scoped slot and queue its manifest row."""
        if self._artifact_publisher is None:
            raise RuntimeError("This worker context has no remote artifact publisher.")
        output = self._artifact_publisher(
            self,
            kind,
            input_hash,
            source,
            name,
            provenance=provenance,
            protected=protected,
        )
        self.artifacts.outputs.append(output)
        return output

    def _own_key(self, key: str) -> str:
        """Refuse a key from another workspace before any store is touched."""
        try:
            owner = workspace_of(key)
        except UnsafeKey as error:
            raise InputInvalid("The job names an object key Selecta doesn't use.") from error
        if owner != self.job.workspace_id:
            raise InputInvalid("The job names an object outside its own workspace.")
        return key

    def open_input(self, key: str) -> AbstractContextManager[Path]:
        """A local path to a stored object of this job's workspace, for a `with` block.

        On a store the file is the stored one (local) or a private download removed afterwards
        (R2). Behind the gateway it's downloaded to scratch through the claim's signed URL.
        """
        self._own_key(key)
        if self.store is not None:
            return self.store.open_input(key)
        if self._input_downloader is None:
            raise RuntimeError("This worker context has no artifact store or input downloader.")
        return self._downloaded(key)

    @contextmanager
    def _downloaded(self, key: str) -> Iterator[Path]:
        path = self.download_input(key)
        try:
            yield path
        finally:
            path.unlink(missing_ok=True)

    def publish(
        self,
        kind: str,
        input_hash: str,
        source: Path,
        name: str,
        *,
        provenance: Mapping[str, Any] | None = None,
        protected: bool = False,
    ) -> ArtifactOutput:
        """Store a finished file as this attempt's output and queue its manifest row.

        The key is always `w/{workspace}/{kind}/{input_hash}/attempts/{attempt}/{name}`, so an
        attempt can only write under its own prefix, and the row records the size and SHA-256
        the store measured, which `complete` then checks again.
        """
        if self.store is None:
            return self.publish_artifact(
                kind, input_hash, source, name, provenance=provenance, protected=protected
            )
        try:
            key = derived_key(self.job.workspace_id, kind, input_hash, self.attempt_id, name)
        except UnsafeKey as error:
            raise InputInvalid(str(error)) from None
        size, sha256 = self.store.publish(key, Path(source))
        output = ArtifactOutput(kind, input_hash, [key], sha256, size, provenance, protected)
        self.artifacts.outputs.append(output)
        return output

    def verify(self, key: str, size: int, sha256: str) -> bool:
        """True when the stored object has exactly this size and SHA-256."""
        self._own_key(key)
        if self.store is None:
            raise RuntimeError("Only a worker with an artifact store can verify objects.")
        return self.store.verify(key, size, sha256)

    def progress(self, done: float, total: float | None = None) -> None:
        """Real work units done (songs, windows, seconds of audio), never elapsed time."""
        moment = self._clock()
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


# A URL's query string: where signed URLs keep their signature and credential.
_URL_QUERY = re.compile(r"(https?://[^\s'\"<>?#]+)\?[^\s'\"<>]*", re.IGNORECASE)


def scrub_urls(text: str) -> str:
    """Drop every URL's query string, so a signed URL in an error can't be reused."""
    return _URL_QUERY.sub(r"\1?<redacted>", text)


def describe(problem: BaseException, limit: int = 4_000) -> str:
    """A plain reason for people, then the traceback's tail for us, kept short.

    The detail is stored with the attempt and shown to staff, and libraries such as httpx put
    the full request URL in their messages, so every URL loses its query string first.
    """
    if isinstance(problem, InputInvalid):
        return scrub_urls(str(problem))
    text = scrub_urls("".join(traceback.format_exception(problem)))
    return text[-limit:]
