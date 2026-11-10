"""Worker scaling benchmark 1 to 32 (ADR-0396 SC-0396-04, docs/saas/15-stress-testing.md).

Starts N workers against one job store, each claiming, "working" for a fixed simulated time and
completing, and measures finished jobs per second for each N. Throughput should rise with N
until something shared (the claim's database round trips, row locks, the connection pool) stops
it; `analyse` reports whether the rise is monotonic and names the first worker count whose gain
over the last is under 10% as the bottleneck.

    python tests/load/worker_scaling.py --database-url postgresql+psycopg://... \
        --workers 1,2,4,8,16,32 --jobs-per-worker 40 --work-ms 50

Locally this measures the control plane only (simulated work, one process). The staging run uses
real Cloud workers through the gateway; record both in docs/saas/15-stress-testing.md.
"""

from __future__ import annotations

import argparse
import itertools
import json
import sys
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass

from sqlalchemy.engine import Engine

from selecta.persistence import make_engine, migrate
from selecta.scheduling.policy import WorkerCaps
from selecta.work.enqueue import JobSpec
from selecta.work.ports import AccountStanding
from selecta.work.store import JobStore

POOL = "cpu-light"
JOB_TYPE = "lyrics.fetch"
FLAT = 0.10
UNLIMITED = {"interactive": 1_000, "standard": 1_000, "speculative": 1_000}


class Unlimited:
    """Premium with no per-account caps, so the benchmark finds the shared bottleneck."""

    def standing(self, workspace_id: str) -> AccountStanding:
        return AccountStanding(tier="premium", caps=UNLIMITED)


def unlimited_store(engine: Engine) -> JobStore:
    return JobStore(engine, entitlements=Unlimited())


@dataclass(frozen=True)
class Run:
    workers: int
    jobs: int
    seconds: float

    @property
    def per_second(self) -> float:
        return self.jobs / self.seconds if self.seconds > 0 else 0.0


@dataclass(frozen=True)
class Analysis:
    runs: tuple[Run, ...]
    monotonic: bool
    bottleneck: int | None
    """First worker count whose throughput gain over the previous count is under 10%."""


def analyse(runs: Sequence[Run], flat: float = FLAT) -> Analysis:
    ordered = tuple(sorted(runs, key=lambda run: run.workers))
    monotonic = all(b.per_second >= a.per_second for a, b in itertools.pairwise(ordered))
    bottleneck = next(
        (b.workers for a, b in itertools.pairwise(ordered)
         if b.per_second < a.per_second * (1 + flat)),
        None,
    )
    return Analysis(ordered, monotonic, bottleneck)


def measure(
    store_for: Callable[[], JobStore], workers: int, jobs_per_worker: int, work_s: float,
    workspaces: int = 8,
) -> Run:
    """Enqueue the jobs, then time N workers draining them."""
    store = store_for()
    total = workers * jobs_per_worker
    stamp = f"{time.time_ns()}"
    for index in range(total):
        store.enqueue(JobSpec(f"bench-{index % workspaces}", JOB_TYPE,
                              idempotency_key=f"{stamp}-{index}", est_cost_s=work_s))
    done = [0] * workers
    start = threading.Barrier(workers + 1)

    def work(slot: int) -> None:
        caps = WorkerCaps(POOL, worker_id=f"bench-{stamp}-{slot}")
        start.wait()
        idle = 0
        while idle < 3:
            claim = store.claim(POOL, caps)
            if claim is None:
                idle += 1
                time.sleep(0.01)
                continue
            idle = 0
            store.start(claim.attempt_id, claim.fencing_token)
            time.sleep(work_s)
            store.complete(claim.attempt_id, claim.fencing_token, result={"ok": True})
            done[slot] += 1

    threads = [threading.Thread(target=work, args=(slot,)) for slot in range(workers)]
    for thread in threads:
        thread.start()
    start.wait()
    began = time.perf_counter()
    for thread in threads:
        thread.join()
    # The last three empty polls are not work; take them off the clock.
    seconds = max(time.perf_counter() - began - 0.03, 1e-9)
    return Run(workers, sum(done), seconds)


def benchmark(
    engine: Engine, counts: Sequence[int], jobs_per_worker: int, work_s: float,
    store_factory: Callable[[Engine], JobStore] = unlimited_store,
) -> Analysis:
    return analyse([
        measure(lambda: store_factory(engine), count, jobs_per_worker, work_s)
        for count in counts
    ])


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--workers", default="1,2,4,8,16,32")
    parser.add_argument("--jobs-per-worker", type=int, default=40)
    parser.add_argument("--work-ms", type=float, default=50.0)
    args = parser.parse_args(argv)
    engine = make_engine(args.database_url)
    migrate.upgrade(engine)
    counts = [int(part) for part in args.workers.split(",")]
    result = benchmark(engine, counts, args.jobs_per_worker, args.work_ms / 1000)
    print(json.dumps({
        "runs": [asdict(run) | {"per_second": round(run.per_second, 2)} for run in result.runs],
        "monotonic": result.monotonic,
        "bottleneck": result.bottleneck,
    }, indent=2))
    return 0 if result.monotonic else 1


if __name__ == "__main__":
    sys.exit(main())
