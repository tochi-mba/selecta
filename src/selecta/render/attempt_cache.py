"""Optional persistent cache for concrete render attempts on trusted hosted workers."""

from __future__ import annotations

import errno
import json
import os
import time
from collections.abc import Iterator, Mapping
from contextlib import ExitStack, contextmanager
from pathlib import Path
from zipfile import BadZipFile

import numpy as np

from selecta import jobs
from selecta.config import SAMPLE_RATE
from selecta.render.cache_key import concrete_render_key
from selecta.render.engine import Rendered, SongCache, render
from selecta.render.script import TransitionScript

MAX_ENTRY_BYTES = 64 * 1024 * 1024
MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024
MAX_IDLE_SECONDS = 7 * 24 * 60 * 60


@contextmanager
def _lock(path: Path) -> Iterator[None]:
    """An OS-owned lock released even when the worker process exits."""
    with path.open("a+b") as handle:
        if os.name == "nt":
            import msvcrt

            def acquire() -> None:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)

            def release() -> None:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            def acquire() -> None:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)

            def release() -> None:
                fcntl.flock(handle, fcntl.LOCK_UN)

        while True:
            jobs.check_in()
            try:
                acquire()
                break
            except OSError as error:
                if error.errno not in (errno.EAGAIN, errno.EACCES, errno.EDEADLK):
                    raise
                time.sleep(0.05)
        try:
            yield
        finally:
            release()


class RenderAttemptCache:
    def __init__(
        self, directory: Path, sources: Mapping[int | str, str], runtime_version: str
    ) -> None:
        self.directory = directory
        self.sources = sources
        self.runtime_version = runtime_version

    def __call__(self, script: TransitionScript, songs: SongCache) -> Rendered:
        key = concrete_render_key(script, self.sources, runtime_version=self.runtime_version)
        if key is None:
            return render(script, songs)
        path = self.directory / f"{key}.npz"
        shard = f"render-{key[:2]}"
        with ExitStack() as locks:
            try:
                self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
                # Sharded lock names bound the files retained for cross-process locks.
                locks.enter_context(_lock(self.directory / f"{shard}.lock"))
            except OSError:
                return render(script, songs)
            reused = self._read(path, script)
            if reused is not None:
                return reused
            take = render(script, songs)
            self._write(path, take)
            return take

    def _prune(self, needed: int = 0, *, replacing: Path | None = None) -> bool:
        cutoff = time.time() - MAX_IDLE_SECONDS
        entries = []
        for path in self.directory.glob("*.npz"):
            if path == replacing or len(path.stem) != 64:
                continue
            try:
                stat = path.stat()
                if stat.st_mtime < cutoff:
                    path.unlink()
                    continue
            except FileNotFoundError:
                continue
            except PermissionError:
                # Windows can refuse deletion while another worker has the file open.
                if not path.exists():
                    continue
                stat = path.stat()
            entries.append((stat.st_mtime, path, stat.st_size))

        total = sum(size for _, _, size in entries)
        for _, path, size in sorted(entries):
            if total + needed <= MAX_CACHE_BYTES:
                break
            try:
                path.unlink(missing_ok=True)
            except PermissionError:
                continue
            total -= size
        return total + needed <= MAX_CACHE_BYTES

    @staticmethod
    def _read(path: Path, script: TransitionScript) -> Rendered | None:
        try:
            stat = path.stat()
            if stat.st_size > MAX_ENTRY_BYTES or stat.st_mtime < time.time() - MAX_IDLE_SECONDS:
                return None
            with np.load(path, allow_pickle=False) as data:
                arrays = [data[name] for name in ("audio", "a_dry", "b_dry")]
                shape = (int(round(script.duration * SAMPLE_RATE)), 2)
                if any(
                    array.shape != shape or array.dtype != np.float32 or not np.isfinite(array).all()
                    for array in arrays
                ):
                    return None
                drift = json.loads(str(data["drift"]))
                if not isinstance(drift, dict):
                    return None
            try:
                os.utime(path, None)
            except OSError:
                pass
            return Rendered(script, *arrays, drift)
        except (OSError, ValueError, KeyError, EOFError, BadZipFile):
            return None

    def _write(self, path: Path, take: Rendered) -> None:
        if sum(part.nbytes for part in (take.audio, take.a_dry, take.b_dry)) >= MAX_ENTRY_BYTES:
            return
        temporary = self.directory / "pending.tmp"
        try:
            with _lock(self.directory / "lifecycle.lock"):
                try:
                    with temporary.open("wb") as output:
                        np.savez(
                            output,
                            audio=take.audio,
                            a_dry=take.a_dry,
                            b_dry=take.b_dry,
                            drift=json.dumps(take.drift_ms),
                        )
                    size = temporary.stat().st_size
                    if size <= MAX_ENTRY_BYTES and self._prune(size, replacing=path):
                        os.replace(temporary, path)
                finally:
                    temporary.unlink(missing_ok=True)
        except OSError:
            # Unavailable or full cache volumes leave the render result usable.
            pass
