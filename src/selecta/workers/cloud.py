"""Run ``python -m selecta.workers.cloud`` for a Cloud worker of one pool.

`SELECTA_WORKER_POOL` picks the pool (default cpu-light); the worker registers only the handlers
whose catalogue pool matches: play.proxy on cpu-light, analyse.song and seam.render on cpu-heavy,
export.render on export.
"""

from __future__ import annotations

import os
import shutil
import signal
import threading
from pathlib import Path

from selecta.observability import errors, metrics, tracing
from selecta.scheduling.policy import WorkerCaps
from selecta.work.catalogue import lookup
from selecta.workers import engine_handlers
from selecta.workers.audio_handlers import handlers
from selecta.workers.remote import RemoteWorkerClient
from selecta.workers.runner import WorkerRunner


def handlers_for(pool: str, ffmpeg: str) -> dict:
    every = {**handlers(ffmpeg=ffmpeg), **engine_handlers.handlers(ffmpeg=ffmpeg)}
    return {name: handler for name, handler in every.items() if lookup(name).pool == pool}


def main() -> None:
    gateway = os.environ["SELECTA_WORKER_GATEWAY_URL"]
    token = os.environ["SELECTA_WORKER_BOOTSTRAP_TOKEN"]
    ffmpeg = shutil.which(os.environ.get("SELECTA_FFMPEG", "ffmpeg"))
    if ffmpeg is None:
        raise RuntimeError("Install ffmpeg before starting the Cloud worker.")
    pool = os.environ.get("SELECTA_WORKER_POOL", "cpu-light")
    registry = handlers_for(pool, ffmpeg)
    if not registry:
        raise RuntimeError(f"This worker has no handlers for the {pool} pool.")
    tracing.configure_from_environment("worker")
    errors.configure_from_environment("worker")
    metrics.configure_from_environment("worker")
    caps = WorkerCaps(
        pool=pool,
        slots=1,
        job_types=frozenset(registry),
        engine_version=int(os.environ.get("SELECTA_WORKER_ENGINE_VERSION", "1")),
        scratch_mb=int(os.environ.get("SELECTA_WORKER_SCRATCH_MB", "4096")),
    )
    stop = threading.Event()
    # Finish the current leased attempt, then stop claiming new work.
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    client = RemoteWorkerClient.register(
        gateway,
        caps,
        bootstrap_token=token,
        storage_hosts=tuple(
            filter(
                None,
                (
                    part.strip()
                    for part in os.environ.get("SELECTA_WORKER_STORAGE_HOSTS", "").split(",")
                ),
            )
        ),
    )
    try:
        scratch = os.environ.get("SELECTA_WORKER_SCRATCH_ROOT")
        WorkerRunner(
            client, client.caps, registry, scratch_root=Path(scratch) if scratch else None
        ).serve(stop)
    finally:
        client.close()


if __name__ == "__main__":
    main()
