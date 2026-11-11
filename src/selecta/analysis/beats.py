"""Beat and bar grids.

beat-this gives beats on a 20 ms grid and its downbeats can wander. A DJ needs better than that:
two kicks 40 ms apart read as two hits. So the raw output gets its phase refined against real
onsets, gets fitted to a straight line when the song really is steady, and gets a confidence
score that decides how much the rest of Selecta may trust it.
"""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np
import torch
from scipy.ndimage import median_filter
from scipy.signal import savgol_filter

ONSET_HOP = 128
ONSET_SR = 22_050
ONSET_HOP_TIME = ONSET_HOP / ONSET_SR
STEADY_TOLERANCE = 0.03
STEADY_SHARE = 0.7
STEADY_MAX_RMS_MS = 16.0
SMOOTH_WINDOW_BEATS = 17


@dataclass
class BeatGrid:
    beats: np.ndarray
    bar_starts: np.ndarray
    raw_beats: np.ndarray
    raw_downbeats: np.ndarray
    beats_per_bar: int
    bpm: float
    constant_tempo: bool
    grid_rms_ms: float
    onset_agreement: float
    downbeat_regularity: float
    tempo_stability: float
    confidence: float

    def bar_times(self) -> np.ndarray:
        return self.beats[self.bar_starts]


class BeatTracker:
    """Loads the model once, since a run over the library reuses it thousands of times."""

    def __init__(self, checkpoint: str = "small0"):
        from selecta.modes.models import require_model

        require_model(f"beat_this.{checkpoint}")
        from beat_this.inference import Audio2Beats

        self.checkpoint = checkpoint
        with torch.inference_mode():
            self._model = Audio2Beats(checkpoint_path=checkpoint, device="cpu", dbn=False)

    def raw(self, mono: np.ndarray, sample_rate: int) -> tuple[np.ndarray, np.ndarray]:
        with torch.inference_mode():
            beats, downbeats = self._model(mono.astype(np.float64), sample_rate)
        return np.asarray(beats, dtype=np.float64), np.asarray(downbeats, dtype=np.float64)


def onset_envelope(mono_22k: np.ndarray) -> np.ndarray:
    return librosa.onset.onset_strength(
        y=mono_22k, sr=ONSET_SR, hop_length=ONSET_HOP, n_fft=1024, aggregate=np.median
    )


def regularize(beats: np.ndarray) -> np.ndarray:
    """Drop spurious beats and fill gaps, so beat indices count musical beats."""
    if beats.size < 4:
        return beats
    period = float(np.median(np.diff(beats)))
    out = [float(beats[0])]
    for beat in beats[1:]:
        gap = beat - out[-1]
        if gap < 0.55 * period:
            continue
        steps = int(round(gap / period))
        if steps >= 2:
            # fix the start first: a generator reading out[-1] would see each beat it just added
            last = out[-1]
            out.extend(last + gap * k / steps for k in range(1, steps))
        out.append(float(beat))
    return np.asarray(out, dtype=np.float64)


def _peak_offsets(
    beats: np.ndarray, env: np.ndarray, window: float = 0.04
) -> tuple[np.ndarray, np.ndarray]:
    reach = int(round(window / ONSET_HOP_TIME))
    centres = np.round(beats / ONSET_HOP_TIME).astype(int)
    offsets = np.zeros_like(beats)
    strengths = np.zeros_like(beats)
    for i, centre in enumerate(centres):
        lo, hi = max(centre - reach, 0), min(centre + reach + 1, env.size)
        if hi <= lo:
            continue
        peak = lo + int(np.argmax(env[lo:hi]))
        offsets[i] = (peak - centre) * ONSET_HOP_TIME
        strengths[i] = env[peak]
    return offsets, strengths


def _strong_mask(strengths: np.ndarray, env: np.ndarray) -> np.ndarray:
    threshold = max(float(np.median(env)) * 2.0, float(np.percentile(env, 70)))
    return strengths >= threshold


def _coherence(beats: np.ndarray, periods: np.ndarray) -> np.ndarray:
    phases = np.exp(2j * np.pi * beats[None, :] / periods[:, None])
    return np.abs(phases.mean(axis=1))


def _constant_grid(beats: np.ndarray) -> tuple[np.ndarray, float, float] | None:
    """Try to explain the beats as one steady tempo.

    Rather than counting beats, which one slip throws off for the rest of the song, this looks for
    the period that makes the most beats fall in phase. Stretches where the tracker wandered, or
    locked onto the offbeat, simply don't vote. Programmed music really is this steady, so a good
    fit gives a grid far better than the tracker's own 20 ms output. Returns the grid, the share of
    beats that agree with it, and the fit error in ms, or None if the song isn't steady.
    """
    typical = float(np.median(np.diff(beats)))
    coarse = typical * np.linspace(0.97, 1.03, 1201)
    period = float(coarse[int(np.argmax(_coherence(beats, coarse)))])
    fine = period * np.linspace(0.9995, 1.0005, 201)
    period = float(fine[int(np.argmax(_coherence(beats, fine)))])

    angle = float(np.angle(np.exp(2j * np.pi * beats / period).mean()))
    offset = angle / (2 * np.pi) * period
    index = np.round((beats - offset) / period)
    residual = beats - (offset + index * period)
    inliers = np.abs(residual) <= STEADY_TOLERANCE
    share = float(inliers.mean())
    if share < STEADY_SHARE or inliers.sum() < 16:
        return None

    slope, intercept = np.polyfit(index[inliers], beats[inliers], 1)
    fitted = beats[inliers] - (slope * index[inliers] + intercept)
    rms_ms = float(np.sqrt(np.mean(fitted**2)) * 1000)
    if rms_ms > STEADY_MAX_RMS_MS:
        return None
    first, last = int(index.min()), int(index.max())
    grid = slope * np.arange(first, last + 1) + intercept
    return grid, share, rms_ms


def _smooth_grid(beats: np.ndarray) -> np.ndarray:
    """For music that really moves: follow the tempo, but not the tracker's beat-to-beat noise."""
    intervals = np.diff(beats)
    typical = median_filter(intervals, size=9, mode="nearest")
    clean = np.where(np.abs(intervals / typical - 1.0) > 0.12, typical, intervals)
    rebuilt = beats[0] + np.concatenate(([0.0], np.cumsum(clean)))
    window = min(SMOOTH_WINDOW_BEATS, rebuilt.size if rebuilt.size % 2 else rebuilt.size - 1)
    smooth = savgol_filter(rebuilt, window, 2) if window >= 5 else rebuilt
    drift = median_filter(beats - smooth, size=window, mode="nearest")
    return np.maximum.accumulate(smooth + savgol_filter(drift, window, 1))


def fit_grid(
    raw_beats: np.ndarray, beats: np.ndarray, env: np.ndarray
) -> tuple[np.ndarray, bool, float, float]:
    """Return refined beats, whether tempo is constant, fit error in ms, and onset agreement."""
    constant = _constant_grid(raw_beats)
    if constant is not None:
        grid, _, rms_ms = constant
        is_constant = True
    else:
        grid = _smooth_grid(beats)
        rms_ms = float(np.sqrt(np.mean((grid - beats) ** 2)) * 1000)
        is_constant = False

    offsets, strengths = _peak_offsets(grid, env)
    strong = _strong_mask(strengths, env)
    if strong.sum() >= 8:
        grid = grid + float(np.median(offsets[strong]))

    final_offsets, final_strengths = _peak_offsets(grid, env, window=0.03)
    hit = _strong_mask(final_strengths, env) & (np.abs(final_offsets) <= 0.03)
    return grid, is_constant, rms_ms, float(hit.mean())


def fit_bars(beats: np.ndarray, downbeats: np.ndarray) -> tuple[np.ndarray, int, float]:
    """Choose a bar grid, allowing the phase to shift where a song really changes."""
    if downbeats.size < 2 or beats.size < 4:
        return np.arange(0, beats.size, 4), 4, 0.0

    nearest = np.searchsorted(beats, downbeats)
    nearest = np.clip(nearest, 1, beats.size - 1)
    left = beats[nearest - 1]
    right = beats[nearest]
    index = np.where(downbeats - left < right - downbeats, nearest - 1, nearest)
    index = np.unique(index[np.abs(beats[index] - downbeats) <= 0.09])
    if index.size < 2:
        return np.arange(0, beats.size, 4), 4, 0.0

    gaps = np.diff(index)
    meter = 3 if np.count_nonzero(gaps == 3) > np.count_nonzero(gaps == 4) else 4

    phases = index % meter
    costs = np.full((index.size, meter), np.inf)
    back = np.zeros((index.size, meter), dtype=int)
    switch_cost = 6.0
    costs[0] = (phases[0] != np.arange(meter)).astype(float)
    for i in range(1, index.size):
        mismatch = (phases[i] != np.arange(meter)).astype(float)
        for state in range(meter):
            stay = costs[i - 1, state]
            move = costs[i - 1] + switch_cost
            move[state] = np.inf
            best_move = int(np.argmin(move))
            if stay <= move[best_move]:
                costs[i, state], back[i, state] = stay + mismatch[state], state
            else:
                costs[i, state], back[i, state] = move[best_move] + mismatch[state], best_move

    states = np.zeros(index.size, dtype=int)
    states[-1] = int(np.argmin(costs[-1]))
    for i in range(index.size - 1, 0, -1):
        states[i - 1] = back[i, states[i]]

    regularity = float(np.mean(phases == states))

    bar_starts: list[int] = []
    for i, state in enumerate(states):
        start = 0 if i == 0 else index[i - 1] + 1
        end = beats.size if i == index.size - 1 else index[i] + 1
        first = start + (state - start) % meter
        bar_starts.extend(range(first, end, meter))
    bars = np.unique(np.asarray(bar_starts, dtype=int))
    if bars.size > 1:
        keep = np.concatenate(([True], np.diff(bars) >= meter - 1))
        bars = bars[keep]
    return bars, meter, regularity


def tempo_stability(beats: np.ndarray) -> float:
    """1.0 for a click track, falling as local tempo wanders."""
    if beats.size < 12:
        return 0.0
    local = (beats[8:] - beats[:-8]) / 8.0
    return float(np.clip(1.0 - float(np.std(local) / np.mean(local)) / 0.05, 0.0, 1.0))


def build_grid(
    raw_beats: np.ndarray, raw_downbeats: np.ndarray, env: np.ndarray
) -> BeatGrid | None:
    beats = regularize(raw_beats)
    if beats.size < 16:
        return None
    refined, constant, rms_ms, agreement = fit_grid(raw_beats, beats, env)
    bars, meter, regularity = fit_bars(refined, raw_downbeats)
    stability = 1.0 if constant else tempo_stability(refined)
    bpm = 60.0 / float(np.median(np.diff(refined)))
    confidence = float(
        np.clip((0.5 * agreement + 0.5 * regularity) * (0.35 + 0.65 * stability), 0.0, 1.0)
    )
    return BeatGrid(
        beats=refined,
        bar_starts=bars,
        raw_beats=raw_beats,
        raw_downbeats=raw_downbeats,
        beats_per_bar=meter,
        bpm=bpm,
        constant_tempo=constant,
        grid_rms_ms=rms_ms,
        onset_agreement=agreement,
        downbeat_regularity=regularity,
        tempo_stability=stability,
        confidence=confidence,
    )
