"""A stem-intertwined transition: groove continuity, one bass owner, vocals taking turns."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from selecta.analysis.key import camelot_distance
from selecta.analysis.song import Cue, SongInfo
from selecta.config import SAMPLE_RATE, Settings
from selecta.render import dsp
from selecta.stems import StemWindow, separate_window

TRANSITION_SECONDS = 28.0


@dataclass(frozen=True)
class Intertwined:
    audio: np.ndarray
    a_start: float
    b_end: float
    exit_cue: Cue
    entry_cue: Cue


def _read(path: Path) -> np.ndarray:
    audio, rate = sf.read(path, always_2d=True, dtype="float32")
    if rate != SAMPLE_RATE:
        raise ValueError(f"unexpected stem rate {rate}")
    return audio


def _fit(audio: np.ndarray, seconds: float, speed: float = 1.0) -> np.ndarray:
    count = int(round(seconds * SAMPLE_RATE))
    if abs(speed - 1.0) > 0.001:
        output = np.array([0.0, seconds])
        source = np.array([0.0, seconds * speed])
        audio, _ = dsp.stretch_to_warp(audio, output, source, 0.0)
    if audio.shape[0] < count:
        audio = np.pad(audio, ((0, count - audio.shape[0]), (0, 0)))
    return audio[:count]


def _curve(count: int, points: list[tuple[float, float]]) -> np.ndarray:
    # Points describe positions within a 16-bar transition, scaled to its actual tempo.
    times = np.arange(count) / SAMPLE_RATE * TRANSITION_SECONDS / (count / SAMPLE_RATE)
    values = np.interp(times, [p[0] for p in points], [p[1] for p in points])
    return values.astype(np.float32)[:, None]


def _layers(stems: StemWindow, seconds: float, speed: float = 1.0) -> dict[str, np.ndarray]:
    return {name: _fit(_read(path), seconds, speed) for name, path in stems.__dict__.items()}


def render_intertwined(settings: Settings, a: SongInfo, b: SongInfo) -> Intertwined:
    gap = abs(a.bpm / b.bpm - 1.0)
    if gap > 0.03:
        raise ValueError("intertwining is limited to a 3% tempo gap")
    if min(a.grid_confidence, b.grid_confidence) < 0.55:
        raise ValueError("intertwining needs reliable beat grids")
    if a.beats_per_bar != b.beats_per_bar:
        raise ValueError("intertwining needs matching meters")
    if camelot_distance(a.camelot, b.camelot) > 1:
        raise ValueError("tonal stem layering needs compatible keys")
    exit_cue = a.exit_cues()[0]
    entry_cue = b.entry_cues()[0]
    if exit_cue.bar < 8:
        raise ValueError("outgoing cue needs eight bars of lead-in")
    a_index = a.beat_index_of_bar(exit_cue.bar - 8)
    b_index = b.beat_index_of_bar(entry_cue.bar)
    beats = 16 * a.beats_per_bar
    if a_index + beats >= len(a.beats) or b_index + beats >= len(b.beats):
        raise ValueError("stem transition needs sixteen complete bars on both tracks")
    a_points = a.beats[a_index : a_index + beats + 1]
    b_points = b.beats[b_index : b_index + beats + 1]
    a_start = float(a_points[0])
    duration = float(a_points[-1] - a_start)
    b_start = entry_cue.time
    window = duration + 5.0
    stems_a = separate_window(settings, Path(a.path), a_start, window)
    speed = a.bpm / b.bpm
    stems_b = separate_window(settings, Path(b.path), b_start, window * speed)
    layers_a = _layers(stems_a, duration)
    layers_b = {}
    # Pin every downbeat to A's actual grid, including source-window offsets.
    keep = np.arange(0, beats + 1, a.beats_per_bar)
    for name, path in stems_b.__dict__.items():
        aligned, _ = dsp.stretch_to_warp(
            _read(path), a_points[keep] - a_start, b_points[keep] - b_start, 0.0
        )
        layers_b[name] = _fit(aligned, duration)
    count = int(round(duration * SAMPLE_RATE))

    a_drums = _curve(count, [(0, 1), (12, 1), (16, 0)])
    b_drums = _curve(count, [(0, 0), (4, 0), (12, 1)])
    a_bass = _curve(count, [(0, 1), (12, 1), (14, 0)])
    b_bass = _curve(count, [(0, 0), (12, 0), (14, 1)])
    a_other = _curve(count, [(0, 1), (8, 1), (20, 0)])
    b_other = _curve(count, [(0, 0), (8, 0), (20, 1)])
    a_vocal = _curve(count, [(0, 1), (14, 1), (16, 0)])
    b_vocal = _curve(count, [(0, 0), (16, 0), (18, 1)])

    mixed = (
        layers_a["drums"] * a_drums
        + layers_b["drums"] * b_drums
        + layers_a["bass"] * a_bass
        + layers_b["bass"] * b_bass
        + layers_a["other"] * a_other
        + layers_b["other"] * b_other
        + layers_a["vocals"] * a_vocal
        + layers_b["vocals"] * b_vocal
    )
    mixed *= 10.0 ** (min(a.gain_db, b.gain_db) / 20.0)
    return Intertwined(
        dsp.limit(mixed),
        a_start,
        float(b_points[-1]),
        exit_cue,
        entry_cue,
    )
