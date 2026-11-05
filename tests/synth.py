"""Synthesised test tracks with known beats. The repo never contains real music."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SR = 44_100


@dataclass
class SynthTrack:
    audio: np.ndarray
    bpm: float
    beats: np.ndarray
    downbeats: np.ndarray
    root_hz: float


def _kick(sr: int = SR) -> np.ndarray:
    t = np.arange(int(0.16 * sr)) / sr
    return np.sin(2 * np.pi * (55 * t + 40 * (1 - np.exp(-t * 40)) / 40)) * np.exp(-t * 22)


def _snare(rng: np.random.Generator, sr: int = SR) -> np.ndarray:
    t = np.arange(int(0.12 * sr)) / sr
    return (rng.normal(size=t.size) * 0.6 + np.sin(2 * np.pi * 190 * t) * 0.5) * np.exp(-t * 28)


def _hat(rng: np.random.Generator, sr: int = SR) -> np.ndarray:
    t = np.arange(int(0.03 * sr)) / sr
    noise = rng.normal(size=t.size)
    return np.diff(noise, prepend=0.0) * np.exp(-t * 160) * 0.5


def _mix_in(buffer: np.ndarray, sound: np.ndarray, at: float, gain: float) -> None:
    start = int(round(at * SR))
    end = min(start + sound.size, buffer.size)
    if start < buffer.size:
        buffer[start:end] += sound[: end - start] * gain


def make_track(
    bpm: float = 120.0,
    bars: int = 24,
    root_hz: float = 110.0,
    minor: bool = True,
    seed: int = 0,
    lead_in: float = 0.5,
    drift: float = 0.0,
) -> SynthTrack:
    """A four-on-the-floor loop in a known key. `drift` adds slow tempo wander, as a fraction."""
    rng = np.random.default_rng(seed)
    beat_count = bars * 4
    periods = np.full(beat_count, 60.0 / bpm)
    if drift:
        periods *= 1.0 + drift * np.sin(np.linspace(0, 6 * np.pi, beat_count))
    beats = lead_in + np.concatenate(([0.0], np.cumsum(periods)[:-1]))
    total = beats[-1] + periods[-1] + 1.0
    mono = np.zeros(int(total * SR))

    kick, snare, hat = _kick(), _snare(rng), _hat(rng)
    third = 1.189 if minor else 1.26
    chord = [root_hz, root_hz * third, root_hz * 1.498]
    for i, beat in enumerate(beats):
        _mix_in(mono, kick, beat, 0.9 if i % 4 == 0 else 0.7)
        if i % 4 in (1, 3):
            _mix_in(mono, snare, beat, 0.45)
        _mix_in(mono, hat, beat, 0.25)
        _mix_in(mono, hat, beat + periods[i] / 2, 0.18)
        if i % 4 == 0:
            length = int(periods[i] * 4 * SR)
            t = np.arange(length) / SR
            envelope = np.minimum(1.0, t * 40) * np.exp(-t * 0.8)
            bass = np.sin(2 * np.pi * (root_hz / 2) * t) * envelope * 0.35
            pad = sum(np.sin(2 * np.pi * f * 2 * t) for f in chord) * envelope * 0.06
            _mix_in(mono, bass + pad, beat, 1.0)

    mono *= 0.8 / max(float(np.max(np.abs(mono))), 1e-6)
    stereo = np.stack((mono, mono), axis=1).astype(np.float32)
    return SynthTrack(stereo, bpm, beats, beats[::4], root_hz)
