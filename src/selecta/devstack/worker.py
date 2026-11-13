"""The local Cloud worker for `dev.cmd cloud`: real handlers, claiming from the local database.

In a deployment a worker enrols with the worker gateway (PostgreSQL only) and reads and writes
objects through signed URLs. Here one process runs the same `WorkerRunner` and the same handlers
(`play.proxy` for the player, plus analysis, seam and export rendering) directly against the
durable `JobStore`, with the gateway's checks: plan entitlements, feature flags, emergency
controls, and the output verifier that re-hashes every published file. `LocalCloudStore` is the
small part the gateway would otherwise do: hand a handler its declared inputs and give it an
attempt-scoped place to publish outputs, both in the on-disk object store.

Run by the launcher as `python -m selecta.devstack.worker`.
"""

from __future__ import annotations

import os
import re
import shutil
import signal
import sqlite3
import threading
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from sqlalchemy.exc import OperationalError

from selecta.admin.state import DbWorkControls
from selecta.devstack import guard
from selecta.devstack.cloud_app import use_disk_storage
from selecta.devstack.settings import DevSettings
from selecta.flags.rules import RulesCache
from selecta.persistence import make_engine
from selecta.storage.artifacts import Buckets, R2ArtifactStore
from selecta.storage.keys import derived_key
from selecta.storage.r2 import file_sha256
from selecta.work import cloud_ports
from selecta.work.catalogue import POOLS, lookup
from selecta.work.ports import ArtifactOutput
from selecta.work.store import JobStore
from selecta.workers.audio_handlers import handlers as audio_handlers
from selecta.workers.context import InputInvalid
from selecta.workers.engine_handlers import handlers as engine_handlers
from selecta.workers.runner import LocalRunner

_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\.[A-Za-z0-9]{1,16}){0,2}$")


class LocalCloudStore(JobStore):
    """`JobStore` plus the gateway's input and output slots, over the on-disk object store."""

    def __init__(self, engine, artifacts: R2ArtifactStore, **options: Any) -> None:
        super().__init__(engine, **options)
        self.artifacts = artifacts

    def download_input(self, context, selector: str | int, destination: Path | None = None) -> Path:
        ref = context.job.input_ref if isinstance(context.job.input_ref, Mapping) else {}
        keys = ref.get("objects", [])
        if not isinstance(keys, list):
            raise InputInvalid("A worker job's object inputs must be a list.")
        if isinstance(selector, bool):
            raise InputInvalid("The requested input index is invalid.")
        if isinstance(selector, int):
            if not 0 <= selector < len(keys):
                raise InputInvalid("The claimed job has no input at that position.")
            key = keys[selector]
        elif selector in keys:
            key = selector
        else:
            raise InputInvalid("The claimed job has no input with that name.")
        key = context._own_key(key)
        scratch = Path(context.scratch).resolve()
        target = Path(destination) if destination is not None else scratch / Path(key).name
        target = (target if target.is_absolute() else scratch / target).resolve()
        if not target.is_relative_to(scratch):
            raise InputInvalid("Input files must be downloaded inside the attempt scratch folder.")
        target.parent.mkdir(parents=True, exist_ok=True)
        with self.artifacts.open_input(key) as found:
            shutil.copyfile(found, target)
        return target

    def publish_artifact(
        self,
        context,
        kind: str,
        input_hash: str,
        source: Path,
        name: str,
        *,
        provenance: Mapping[str, Any] | None = None,
        protected: bool = False,
    ) -> ArtifactOutput:
        if not _NAME.fullmatch(name):
            raise InputInvalid("The artifact file name is unsafe.")
        key = derived_key(context.job.workspace_id, kind, input_hash, context.attempt_id, name)
        size, digest = self.artifacts.publish(key, Path(source))
        if (size, digest) != file_sha256(Path(source)):
            raise InputInvalid("The stored output doesn't match the file the handler made.")
        return ArtifactOutput(kind, input_hash, [key], digest, size, provenance, protected)


def handlers(ffmpeg: str) -> dict:
    return {**audio_handlers(ffmpeg=ffmpeg), **engine_handlers(ffmpeg=ffmpeg)}


def _register_with_retry(
    runner: LocalRunner, *, timeout_s: float = 120.0, retry_s: float = 0.75
) -> None:
    """Wait for transient SQLite writer contention, never hide other SQL errors.

    Registration happens before any of this process's claim loops run. The API
    and seed process may still briefly hold the single SQLite writer slot.
    """
    deadline = time.monotonic() + timeout_s
    attempts = 0
    while True:
        try:
            runner.register()
            return
        except OperationalError as problem:
            if not isinstance(problem.orig, sqlite3.OperationalError):
                raise
            if "locked" not in str(problem.orig).lower():
                raise
            attempts += 1
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError(
                    f"SQLite stayed locked while registering the {runner.pool} worker pool. "
                    "Stop other Selecta development processes using the same data folder, "
                    "then restart the stack; no database files should be deleted."
                ) from problem
            print(
                f"[WORKER] SQLite busy registering {runner.pool} (attempt {attempts}); "
                f"retrying for up to {remaining:.0f}s.",
                flush=True,
            )
            time.sleep(min(retry_s, remaining))


def main() -> None:
    guard.require_development()
    settings = DevSettings.from_environment()
    ffmpeg = shutil.which(os.environ.get("SELECTA_FFMPEG", "ffmpeg"))
    if ffmpeg is None:
        raise SystemExit("Install ffmpeg: the local worker needs it to prepare playback files.")
    engine = make_engine(settings.database_url)
    objects = use_disk_storage(settings)
    rules = RulesCache(engine, max_age=5.0)
    store = LocalCloudStore(
        engine,
        R2ArtifactStore(
            objects,
            Buckets(
                originals="sel-originals",
                derived="sel-derived",
                exports="sel-exports",
                staging="sel-staging",
            ),
            scratch=settings.data / "scratch",
        ),
        entitlements=cloud_ports.CloudJobEntitlements(engine),
        flags=cloud_ports.CloudJobFlags(engine, rules),
        verifier=cloud_ports.R2OutputVerifier(),
        controls=DbWorkControls(),
    )
    registry = handlers(ffmpeg)
    runners = []
    for pool in POOLS:
        mine = {name: handler for name, handler in registry.items() if lookup(name).pool == pool}
        if not mine:
            continue
        runner = LocalRunner(
            store,
            pool,
            mine,
            name=f"dev-{pool}",
            scratch_root=settings.data / "scratch",
            idle_s=0.5,
        )
        runners.append(runner)
    # Register every pool before starting any claim/heartbeat threads. With SQLite,
    # the previous interleaving let the first pool contend with later registrations.
    for runner in runners:
        _register_with_retry(runner)
    for runner in runners:
        runner.start()
        print(f"[WORKER] {runner.pool}: {', '.join(sorted(runner.runners[0].handlers))}", flush=True)
    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    print("[WORKER] Ready: claiming Cloud jobs from the local database.", flush=True)
    while not stop.is_set():
        time.sleep(0.5)
    for runner in runners:
        runner.stop(timeout=10)


if __name__ == "__main__":
    main()
