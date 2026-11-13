"""Deterministic, internally generated PCM/WAV test signals. No licensed media."""

from __future__ import annotations

import hashlib
import math
import struct
import wave
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AudioFixture:
    path: Path
    sample_rate: int
    frames: int
    channels: int
    pcm_sha256: str  # LOCAL-ONLY test provenance, never cloud metadata
    synthetic: bool = True


def make_synthetic_wave(
    target: Path,
    *,
    recording_number: int,
    duration_ms: int = 120,
    sample_rate: int = 8_000,
    channels: int = 1,
) -> AudioFixture:
    """Write a stable sine-mixture test tone; unique, distinguishable per recording.

    Frequencies are deterministic and generated from math, not a recording or sample.
    Small duration keeps scenario matrices cheap; frame count is exact.
    """
    if recording_number < 0 or duration_ms <= 0 or sample_rate < 1_000:
        raise ValueError("invalid synthetic audio parameters")
    if channels not in (1, 2):
        raise ValueError("channels must be mono or stereo")
    frames = (sample_rate * duration_ms) // 1_000
    if frames < 1:
        raise ValueError("duration yields no frames")
    frequency = 173 + (recording_number * 59) % 1200
    output = bytearray()
    for frame in range(frames):
        t = frame / sample_rate
        # 0.24 peak amplitude, deterministic envelope to avoid clicks.
        envelope = min(1.0, frame / 24, (frames - frame - 1) / 24)
        sample = int(
            32767
            * 0.24
            * max(0, envelope)
            * (
                0.73 * math.sin(2 * math.pi * frequency * t)
                + 0.27 * math.sin(2 * math.pi * frequency * 1.5 * t)
            )
        )
        output.extend(struct.pack("<h", sample) * channels)
    target.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(target), "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(bytes(output))
    return AudioFixture(target, sample_rate, frames, channels, hashlib.sha256(output).hexdigest())


def validate_synthetic_wave(fixture: AudioFixture) -> None:
    if not fixture.synthetic:
        raise AssertionError("never accept unknown-source audio as synthetic")
    with wave.open(str(fixture.path), "rb") as handle:
        if (handle.getnchannels(), handle.getframerate(), handle.getnframes()) != (
            fixture.channels,
            fixture.sample_rate,
            fixture.frames,
        ):
            raise AssertionError("audio format or length has changed")
        if handle.getsampwidth() != 2:
            raise AssertionError("unexpected PCM format")
        pcm = handle.readframes(handle.getnframes())
    if hashlib.sha256(pcm).hexdigest() != fixture.pcm_sha256:
        raise AssertionError("synthetic audio content changed")


def corrupt_wave(path: Path, *, truncate_bytes: int = 7) -> bytes:
    """Truncate actual bytes (not only a boolean) and return prior content for repair."""
    original = path.read_bytes()
    if len(original) <= truncate_bytes:
        raise ValueError("fixture too short for truncation")
    path.write_bytes(original[:truncate_bytes])
    return original
