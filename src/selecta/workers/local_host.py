"""The local app's durable job host: the first slice of moving local audio jobs (SC-0394-04).

The local app still runs its seam worker pipe, analysis subprocess and JSON export jobs. This is
where they move to, one job type at a time: a durable job database of its own in the library home
(`work.sqlite`, built by the shared Alembic migrations, separate from the library database so the
library file's schema is untouched), a `JobStore` with the local entitlements, a `LocalRunner`
per pool, and a small upkeep thread that reaps lapsed leases and promotes due retries, which in
Cloud is the maintenance leader's job.

Work survives restarts: a job queued or running when the app stopped (or crashed) is run on the
next start, after its lease lapses. It is behind `core.durable_local_jobs`, off by default, and
nothing in the app starts it yet; with the flag off the local app behaves exactly as before.

What remains of SC-0394-04: start this from `api.serve()` when the flag is on, register the
`export.render`, seam render and `analyse.song` handlers that wrap today's engine functions,
read job status from this store instead of `seam.json` files, export records and the process
dict, and then remove the pipe, the subprocess and the JSON records. The owner's listening check
that transitions sound the same follows that migration.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.engine import Engine

from selecta.persistence import make_engine, migrate
from selecta.work.enqueue import Enqueued, JobSpec
from selecta.work.store import JobStore
from selecta.workers.context import Handler
from selecta.workers.runner import LocalRunner

log = logging.getLogger(__name__)

FLAG = "core.durable_local_jobs"
DATABASE = "work.sqlite"
LOCAL_WORKSPACE = "local"
"""The local app has one owner and one workspace; every local job is filed under this id."""


def open_engine(home: Path) -> Engine:
    """The home's job database at the newest schema (made on first use)."""
    home.mkdir(parents=True, exist_ok=True)
    engine = make_engine(f"sqlite:///{(home / DATABASE).as_posix()}")
    migrate.upgrade(engine)
    return engine


@dataclass
class LocalWork:
    """The running host: one store, a runner per pool and the upkeep thread."""

    store: JobStore
    runners: list[LocalRunner]
    upkeep_s: float = 1.0
    _stop: threading.Event = field(default_factory=threading.Event)
    _upkeep: threading.Thread | None = None

    def start(self) -> None:
        self.tick()
        for runner in self.runners:
            runner.start()
        self._upkeep = threading.Thread(target=self._loop, name="selecta-local-upkeep", daemon=True)
        self._upkeep.start()

    def tick(self) -> None:
        """Reap lapsed leases and promote due retries, as the maintenance leader does in Cloud."""
        try:
            self.store.reap_expired()
            self.store.promote_due_retries()
        except Exception:  # noqa: BLE001 - upkeep is retried on the next tick
            log.exception("Local job upkeep failed")

    def _loop(self) -> None:
        while not self._stop.wait(self.upkeep_s):
            self.tick()

    def enqueue(self, job_type: str, **values) -> Enqueued:
        return self.store.enqueue(JobSpec(LOCAL_WORKSPACE, job_type, **values))

    def stop(self, timeout: float | None = 30.0) -> bool:
        """Let running handlers finish and publish; claim nothing new."""
        self._stop.set()
        finished = all(runner.stop(timeout) for runner in self.runners)
        if self._upkeep is not None:
            self._upkeep.join(timeout)
        self.store.engine.dispose()
        return finished


def open_local_work(
    home: Path,
    handlers: Mapping[str, Handler],
    *,
    pools: Mapping[str, int] | None = None,
    upkeep_s: float = 1.0,
    **runner_options,
) -> LocalWork:
    """Build (not start) the host for `home`. `pools` maps each pool to its thread count."""
    store = JobStore(open_engine(home))
    runners = [
        LocalRunner(store, pool, handlers, threads=threads, **runner_options)
        for pool, threads in (pools or {"cpu-heavy": 1}).items()
    ]
    return LocalWork(store, runners, upkeep_s)
