"""Run ``python -m selecta.workers.cloud`` for the Cloud CPU-light proxy worker."""

from __future__ import annotations

import os
import shutil
import signal
import threading
from pathlib import Path

from selecta.observability import tracing
from selecta.scheduling.policy import WorkerCaps
from selecta.workers.audio_handlers import handlers
from selecta.workers.remote import RemoteWorkerClient
from selecta.workers.runner import WorkerRunner


def main() -> None:
    gateway = os.environ["SELECTA_WORKER_GATEWAY_URL"]
    token = os.environ["SELECTA_WORKER_BOOTSTRAP_TOKEN"]
    ffmpeg = shutil.which(os.environ.get("SELECTA_FFMPEG", "ffmpeg"))
    if ffmpeg is None:
        raise RuntimeError("Install ffmpeg before starting the Cloud worker.")
    registry = handlers(ffmpeg=ffmpeg)
    tracing.configure_from_environment("worker")
    caps = WorkerCaps(
        pool=os.environ.get("SELECTA_WORKER_POOL", "cpu-light"), slots=1, job_types=frozenset(registry),
        engine_version=int(os.environ.get("SELECTA_WORKER_ENGINE_VERSION", "1")),
        scratch_mb=int(os.environ.get("SELECTA_WORKER_SCRATCH_MB", "4096")),
    )
    stop = threading.Event()
    # Finish the current leased attempt, then stop claiming new work.
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    client = RemoteWorkerClient.register(
        gateway, caps, bootstrap_token=token,
        storage_hosts=tuple(filter(None, (
            part.strip() for part in os.environ.get("SELECTA_WORKER_STORAGE_HOSTS", "").split(",")
        ))),
    )
    try:
        scratch = os.environ.get("SELECTA_WORKER_SCRATCH_ROOT")
        WorkerRunner(client, client.caps, registry,
                     scratch_root=Path(scratch) if scratch else None).serve(stop)
    finally:
        client.close()


if __name__ == "__main__":
    main()
