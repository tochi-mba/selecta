"""T0010: deterministic, original fixture audio for analysis and render tests.

Everything here is synthesised from `synth.make_track` with fixed seeds, so it is the same on every
machine and contains no real or licensed music. It holds:

- a steady track whose beat grid is known exactly (`steady`),
- named beat grids that a tracker can get wrong (`INVALID_GRIDS`),
- cue positions that sit on the known bars, and one that does not (`cue_bars`, `off_grid_time`),
- a pair whose requested blend cannot work, so the renderer has to fall back (`fallback_pair`).
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
from synth import SynthTrack, make_track


def steady(bpm: float = 120.0, bars: int = 48, seed: int = 1) -> SynthTrack:
    """A four-on-the-floor loop whose beats and downbeats are exactly known."""
    return make_track(bpm=bpm, bars=bars, seed=seed)


def drifting(bpm: float = 100.0, seed: int = 3) -> SynthTrack:
    """A valid but wandering grid, as a live drummer would play it."""
    return make_track(bpm=bpm, drift=0.03, seed=seed)


def _too_few(track: SynthTrack) -> np.ndarray:
    return track.beats[:8]


def _empty(track: SynthTrack) -> np.ndarray:
    return np.asarray([], dtype=np.float64)


def _spurious(track: SynthTrack) -> np.ndarray:
    """An extra off-beat hit after every bar's first beat, as a tracker fooled by the hat does."""
    extra = track.downbeats + (track.beats[1] - track.beats[0]) * 0.3
    return np.sort(np.concatenate((track.beats, extra)))


def _gappy(track: SynthTrack) -> np.ndarray:
    """Whole beats missing, as when a tracker loses a quiet break."""
    return np.delete(track.beats, [10, 11, 30, 31, 32])


INVALID_GRIDS: dict[str, Callable[[SynthTrack], np.ndarray]] = {
    "too_few": _too_few,
    "empty": _empty,
    "spurious": _spurious,
    "gappy": _gappy,
}


def cue_bars(track: SynthTrack) -> dict[str, float]:
    """Mix-in, mid and mix-out cue times, each on a known downbeat."""
    bars = track.downbeats
    return {
        "mix_in": float(bars[0]),
        "middle": float(bars[bars.size // 2]),
        "mix_out": float(bars[-8]),
    }


def off_grid_time(track: SynthTrack) -> float:
    """A time halfway between two beats, which no cue should ever snap to."""
    return float((track.beats[20] + track.beats[21]) / 2)


def fallback_pair() -> tuple[SynthTrack, SynthTrack]:
    """120 and 85 BPM: too far apart for a beat-matched blend, so a seam must fall back."""
    return make_track(bpm=120, bars=48, seed=1), make_track(bpm=85, bars=48, seed=2)
