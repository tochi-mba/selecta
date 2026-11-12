"""The local app's durable job host (SC-0394-04, ADR-0394).

With `core.durable_local_jobs` on, every local audio job goes through a durable job database of
the library home's own (`work.sqlite`, built by the shared Alembic migrations, separate from the
library database so the library file's schema is untouched), through the same fenced `JobStore`
the cloud uses:

- seam renders (with the stem splits and word timing they do, studio sessions and spare-time
  preparation) run in the seam worker process, which claims them from the `cpu-heavy` pool;
- song analysis runs in one warm analysis worker process, from a pool of its own;
- exports and the lyric lookup run on threads of the app itself, as they did before.

The app's side (`LocalWork`) owns the store, runs the in-process runners and an upkeep thread
that reaps lapsed leases and promotes due retries (the cloud's maintenance leader does that), and
starts the worker processes when there is work for them. Work survives restarts: a job queued,
or running when the app stopped or crashed, runs on the next start, once its lease lapses, and
fenced completion means it publishes once.

Worker processes get no pipe at all: stdin, stdout and stderr go nowhere, and each watches the
app's process instead of an input pipe to know when to stop. On Windows a helper that inherits a
pipe its parent waits on freezes at startup, so none is ever passed down (`spawn_worker`).

The order is the seam worker's own, mapped onto lanes and urgency as §4A.5 describes
(`scheduling.policy.RANKS`); `local_policy()` keeps interactive work strictly ahead of standard,
since one person's current mix must never wait behind anything.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

import psutil
from sqlalchemy.engine import Engine

from selecta.persistence import make_engine, migrate
from selecta.scheduling.policy import PolicyConfig
from selecta.work.enqueue import Enqueued, JobSpec
from selecta.work.ports import ProcessFlags
from selecta.work.store import JobStore
from selecta.workers.context import Handler
from selecta.workers.runner import LocalRunner

log = logging.getLogger(__name__)

FLAG = "core.durable_local_jobs"
DATABASE = "work.sqlite"
LOCAL_WORKSPACE = "local"
"""The local app has one owner and one workspace; every local job is filed under this id."""

SEAM_POOL = "cpu-heavy"
ANALYSIS_POOL = "local-analysis"
"""Analysis has its own worker process, so it has its own pool (`JobSpec.pool`)."""
EXPORT_POOL = "export"
LYRICS_POOL = "cpu-light"
PARENT_ENV = "SELECTA_PARENT_PID"
PARENT_CHECK_SECONDS = 2.0


def local_policy() -> PolicyConfig:
    """The cloud policy with the local app's two differences: interactive work always goes
    before standard work (the seam about to be heard, then the rest of the mix), and a pool keeps
    no headroom free of spare-time work, because each local pool is one worker process that
    gives way at its next `check_in()` instead."""
    return PolicyConfig(
        strict_lanes=True,
        speculative_headroom_slots=0,
        speculative_headroom_share=0.0,
        job_batch=64,
    )


def open_engine(home: Path) -> Engine:
    """The home's job database at the newest schema (made on first use)."""
    home.mkdir(parents=True, exist_ok=True)
    engine = make_engine(f"sqlite:///{(home / DATABASE).as_posix()}")
    migrate.upgrade(engine)
    return engine


def open_store(home: Path) -> JobStore:
    """The home's job store, with the local order and this process's flags."""
    return JobStore(open_engine(home), local_policy(), flags=ProcessFlags())


@dataclass
class LocalWork:
    """The running host: one store, a runner per in-process pool, and the upkeep thread."""

    store: JobStore
    runners: list[LocalRunner]
    upkeep_s: float = 1.0
    watchers: list[Callable[[], None]] = field(default_factory=list)
    """Run on every upkeep tick: they start worker processes that have work waiting."""
    _stop: threading.Event = field(default_factory=threading.Event)
    _upkeep: threading.Thread | None = None

    def start(self) -> None:
        self.tick()
        for runner in self.runners:
            runner.start()
        self._upkeep = threading.Thread(target=self._loop, name="selecta-local-upkeep", daemon=True)
        self._upkeep.start()

    def tick(self) -> None:
        """Reap lapsed leases and promote due retries, as the maintenance leader does in Cloud,
        then let each watcher start what has work waiting."""
        try:
            self.store.reap_expired()
            self.store.promote_due_retries()
        except Exception:  # noqa: BLE001 - upkeep is retried on the next tick
            log.exception("Local job upkeep failed")
        for watch in list(self.watchers):
            try:
                watch()
            except Exception:  # noqa: BLE001 - a watcher tries again on the next tick
                log.exception("A local job watcher failed")

    def _loop(self) -> None:
        while not self._stop.wait(self.upkeep_s):
            self.tick()

    def enqueue(self, job_type: str, **values) -> Enqueued:
        return self.store.enqueue(JobSpec(LOCAL_WORKSPACE, job_type, **values))

    def stop(self, timeout: float | None = 30.0) -> bool:
        """Let running handlers finish and publish; claim nothing new. Work a handler hadn't
        finished by `timeout` resumes on the next start, once its lease lapses."""
        self._stop.set()
        finished = all(runner.stop(timeout) for runner in self.runners)
        if self._upkeep is not None:
            self._upkeep.join(timeout)
        if finished:
            self.store.engine.dispose()
        return finished


def open_local_work(
    home: Path,
    handlers: Mapping[str, Handler],
    *,
    pools: Mapping[str, int] | None = None,
    upkeep_s: float = 1.0,
    store: JobStore | None = None,
    **runner_options,
) -> LocalWork:
    """Build (not start) the host for `home`. `pools` maps each in-process pool to its thread
    count; pools served by worker processes are left out."""
    store = store or open_store(home)
    runners = [
        LocalRunner(store, pool, handlers, threads=threads, **runner_options)
        for pool, threads in (pools if pools is not None else {"cpu-heavy": 1}).items()
    ]
    return LocalWork(store, runners, upkeep_s)


# --- worker processes ---


def spawn_worker(home: Path, module: str, *args: str) -> subprocess.Popen:
    """Start a worker process with no pipe at all, told which process is the app."""
    return subprocess.Popen(
        [sys.executable, "-m", module, *args],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        env={**os.environ, "SELECTA_HOME": str(home), PARENT_ENV: str(os.getpid())},
    )


def _alive(process: psutil.Process, born: float) -> bool:
    try:
        return (
            process.is_running()
            and process.create_time() == born
            and process.status() != psutil.STATUS_ZOMBIE
        )
    except psutil.Error:
        return False


def stop_with_parent(poll_s: float = PARENT_CHECK_SECONDS) -> threading.Thread | None:
    """A worker's side of `spawn_worker`: stop, with every helper it started, when the app's
    process has gone. Without the variable (run by hand) it does nothing."""
    from selecta.jobs import kill_tree_of_children

    try:
        pid = int(os.environ.get(PARENT_ENV, "0") or 0)
    except ValueError:
        pid = 0
    if pid <= 0:
        return None
    try:
        parent = psutil.Process(pid)
        born = parent.create_time()
    except psutil.Error:
        kill_tree_of_children()
        os._exit(0)

    def watch() -> None:
        while _alive(parent, born):
            time.sleep(poll_s)
        kill_tree_of_children()
        os._exit(0)

    thread = threading.Thread(target=watch, name="selecta-app-watch", daemon=True)
    thread.start()
    return thread


class Supervisor:
    """Keeps one worker process running while it has work, restarting it if it died, but never
    more often than `every_s`, so a worker that can't start doesn't spin."""

    def __init__(
        self,
        start: Callable[[], subprocess.Popen],
        wanted: Callable[[], bool],
        every_s: float = 10.0,
    ):
        self._start = start
        self._wanted = wanted
        self.every_s = every_s
        self.process: subprocess.Popen | None = None
        self._started_at = float("-inf")
        self._lock = threading.Lock()

    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def ensure(self, force: bool = False) -> subprocess.Popen | None:
        with self._lock:
            if self.running():
                return self.process
            if not force and time.monotonic() - self._started_at < self.every_s:
                return self.process
            self._started_at = time.monotonic()
            self.process = self._start()
            return self.process

    def __call__(self) -> None:
        """The upkeep watcher."""
        if not self.running() and self._wanted():
            self.ensure()

    def stop(self) -> None:
        from selecta.jobs import kill_tree

        with self._lock:
            if self.running():
                kill_tree(self.process.pid)
