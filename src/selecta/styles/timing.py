"""Shared timing for recipes where two songs play together.

The master timeline is a list of beat times. Each song's own beats are pinned to it, so even a
song with a wandering tempo stays locked for the whole overlap. A small tempo gap is absorbed by
B alone, leaving A untouched. A bigger gap is split across both songs, because listeners tolerate
two small changes better than one large one (Ishizaki 2009).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from selecta.analysis.song import SongInfo
from selecta.render.script import Warp

A_NATIVE_MAX_GAP = 0.03
RAMP_BEATS = 16
SETTLED_GAP = 0.002
SETTLE_BEATS = 8


@dataclass
class BlendTiming:
    a_warp: Warp
    b_warp: Warp
    overlap_start: float
    overlap_end: float
    duration: float
    tempo_gap: float
    master_period: float


def tempo_gap(a: SongInfo, b: SongInfo) -> float:
    return abs(a.bpm / b.bpm - 1.0)


def _ramped_times(intervals: np.ndarray, start_ratio: float, end_ratio: float) -> np.ndarray:
    """Cumulative output times for source intervals played at a ratio moving linearly."""
    ratios = np.linspace(start_ratio, end_ratio, intervals.size)
    return np.concatenate(([0.0], np.cumsum(intervals / ratios)))


def _pinned_every_bar(output: np.ndarray, source: np.ndarray, bar: int) -> Warp:
    """Pin each bar, not each beat. Bars stay locked, and a song keeps its own feel inside them,
    which also stops any leftover beat-to-beat noise turning into audible tempo wobble."""
    keep = np.unique(np.concatenate((np.arange(0, output.size, bar), [output.size - 1])))
    return Warp(output[keep], source[keep])


def blend_timing(
    a: SongInfo, b: SongInfo, exit_bar: int, entry_bar: int, bars: int, ramp_beats: int = RAMP_BEATS
) -> BlendTiming | None:
    """Work out where every beat lands, or None if the grids don't allow this overlap."""
    if a.beats_per_bar != b.beats_per_bar or exit_bar < bars:
        return None
    a_start = a.beat_index_of_bar(exit_bar - bars)
    a_end = a.beat_index_of_bar(exit_bar)
    b_start = b.beat_index_of_bar(entry_bar)
    beat_count = a_end - a_start
    if beat_count != bars * a.beats_per_bar:
        return None

    gap = tempo_gap(a, b)
    a_native = gap <= A_NATIVE_MAX_GAP
    pre_beats = a.beats_per_bar if a_native else ramp_beats
    post_beats = SETTLE_BEATS if gap <= SETTLED_GAP else ramp_beats
    if a_start - pre_beats < 0 or b_start + beat_count + post_beats >= b.beats.size:
        return None

    a_beats = a.beats[a_start - pre_beats : a_end + 1]
    b_beats = b.beats[b_start : b_start + beat_count + post_beats + 1]

    if a_native:
        lead = np.diff(a.beats[a_start - pre_beats : a_start + 1])
        lead_times = np.concatenate(([0.0], np.cumsum(lead)))
        shared_times = a.beats[a_start : a_end + 1] - a.beats[a_start] + lead_times[-1]
        master_tempo = a.bpm
    else:
        master_tempo = float(np.sqrt(a.bpm * b.bpm))
        lead = np.diff(a.beats[a_start - pre_beats : a_start + 1])
        lead_times = _ramped_times(lead, 1.0, master_tempo / a.bpm)
        period = 60.0 / master_tempo
        shared_times = lead_times[-1] + np.arange(beat_count + 1) * period

    tail_intervals = np.diff(b_beats[beat_count:])
    tail_times = shared_times[-1] + _ramped_times(tail_intervals, master_tempo / b.bpm, 1.0)

    a_output = np.concatenate((lead_times[:-1], shared_times))
    b_output = np.concatenate((shared_times[:-1], tail_times))
    bar = a.beats_per_bar
    a_warp = _pinned_every_bar(a_output, a_beats, bar)
    b_warp = _pinned_every_bar(b_output, b_beats, bar)

    return BlendTiming(
        a_warp=a_warp,
        b_warp=b_warp,
        overlap_start=float(shared_times[0]),
        overlap_end=float(shared_times[-1]),
        duration=float(tail_times[-1]),
        tempo_gap=gap,
        master_period=60.0 / master_tempo,
    )
