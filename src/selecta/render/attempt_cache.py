"""Optional persistent cache for concrete render attempts on trusted hosted workers."""

from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Mapping
from pathlib import Path
from zipfile import BadZipFile

import numpy as np

from selecta.config import SAMPLE_RATE
from selecta.render.cache_key import concrete_render_key
from selecta.render.engine import Rendered, SongCache, render
from selecta.render.script import TransitionScript

MAX_ENTRY_BYTES = 64 * 1024 * 1024


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
        reused = self._read(path, script)
        if reused is not None:
            return reused
        take = render(script, songs)
        self._write(path, take)
        return take

    @staticmethod
    def _read(path: Path, script: TransitionScript) -> Rendered | None:
        try:
            if path.stat().st_size > MAX_ENTRY_BYTES:
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
                return Rendered(script, *arrays, drift)
        except (OSError, ValueError, KeyError, EOFError, BadZipFile):
            return None

    def _write(self, path: Path, take: Rendered) -> None:
        if sum(part.nbytes for part in (take.audio, take.a_dry, take.b_dry)) >= MAX_ENTRY_BYTES:
            return
        temporary = None
        try:
            self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=self.directory, delete=False) as output:
                temporary = Path(output.name)
                np.savez(
                    output,
                    audio=take.audio,
                    a_dry=take.a_dry,
                    b_dry=take.b_dry,
                    drift=json.dumps(take.drift_ms),
                )
            os.replace(temporary, path)
        except OSError:
            # Unavailable or full cache volumes leave the render result usable.
            pass
        finally:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
