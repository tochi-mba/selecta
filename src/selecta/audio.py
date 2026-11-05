"""The one decode path.

Analysis, rendering and playback all use samples from here. Decoders disagree about MP3
start delay by tens of milliseconds, which is enough to ruin a word-level cut, so nothing
else in Selecta is allowed to decode an original file.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from selecta.config import SAMPLE_RATE

CHANNELS = 2


class DecodeError(RuntimeError):
    pass


def decode(
    path: str | Path,
    start: float | None = None,
    duration: float | None = None,
    sample_rate: int = SAMPLE_RATE,
) -> np.ndarray:
    """Decode to float32 stereo with shape (samples, 2).

    The seek is placed after the input so it is sample accurate rather than keyframe accurate.
    """
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path)]
    if start:
        cmd += ["-ss", f"{start:.6f}"]
    if duration is not None:
        cmd += ["-t", f"{duration:.6f}"]
    cmd += ["-map", "0:a:0", "-vn", "-f", "f32le", "-ac", str(CHANNELS), "-ar", str(sample_rate)]
    cmd += ["-"]
    result = subprocess.run(cmd, capture_output=True, check=False)
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise DecodeError(f"ffmpeg could not decode {path}: {message}")
    samples = np.frombuffer(result.stdout, dtype=np.float32)
    usable = samples.size - samples.size % CHANNELS
    return samples[:usable].reshape(-1, CHANNELS).copy()


def to_mono(audio: np.ndarray) -> np.ndarray:
    return audio.mean(axis=1) if audio.ndim == 2 else audio


def db_to_gain(db: float) -> float:
    return float(10.0 ** (db / 20.0))


def gain_to_db(gain: float, floor: float = -120.0) -> float:
    return float(20.0 * np.log10(max(gain, 10.0 ** (floor / 20.0))))
