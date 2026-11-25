"""A stem-intertwined transition: groove continuity, one bass owner, vocals taking turns."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from selecta import flags
from selecta.analysis.song import Cue, SongInfo
from selecta.config import SAMPLE_RATE, Settings

# whether two songs can intertwine, and where, is decided from song facts in the planner core
from selecta.planner_core.stem_gates import can_intertwine, intertwine_cues  # noqa: F401
from selecta.render import dsp
from selecta.render.engine import Rendered, SongCache, render
from selecta.render.script import Curve, TransitionScript
from selecta.render.stem_seam import LANES, Lane, stem_script
from selecta.stems import StemWindow, separate_window

TRANSITION_SECONDS = 28.0


@dataclass(frozen=True)
class Intertwined:
    audio: np.ndarray
    a_start: float
    b_end: float
    exit_cue: Cue
    entry_cue: Cue
    a_dry: np.ndarray
    b_dry: np.ndarray
    b_points: np.ndarray
    a_vocal: Curve
    b_vocal: Curve
    a_drums: Curve
    b_drums: Curve
    rendered: Rendered | None = None
    """The engine's render, with `render.one_engine` on, which the seam is audited and kept from."""


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
    # Points use one nominal 28s timeline, scaled to the actual 16-bar duration.
    times = np.arange(count) / SAMPLE_RATE * TRANSITION_SECONDS / (count / SAMPLE_RATE)
    values = np.interp(times, [p[0] for p in points], [p[1] for p in points])
    return values.astype(np.float32)[:, None]


_pair_that_fits = intertwine_cues


def _vocal_curve(duration: float, points: list[tuple[float, float]]) -> Curve:
    """Mirror the same normalized automation points used by `_curve` on the audio layers."""
    return Curve([(point * duration / TRANSITION_SECONDS, value) for point, value in points])


def _layers(stems: StemWindow, seconds: float, speed: float = 1.0) -> dict[str, np.ndarray]:
    return {name: _fit(_read(path), seconds, speed) for name, path in stems.__dict__.items()}


def intertwine_windows(
    a: SongInfo, b: SongInfo
) -> tuple[tuple[float, float], tuple[float, float]] | None:
    """The stretch of each song this move would split, or None if it can't be done."""
    cues = _pair_that_fits(a, b)
    if cues is None:
        return None
    exit_cue, entry_cue = cues
    a_index = a.beat_index_of_bar(exit_cue.bar - 8)
    a_points = a.beats[a_index : a_index + 16 * a.beats_per_bar + 1]
    window = float(a_points[-1] - a_points[0]) + 5.0
    return (float(a_points[0]), window), (entry_cue.time, window * (a.bpm / b.bpm))


_POINTS = {
    "drums": ([(0, 1), (12, 1), (16, 0)], [(0, 0), (4, 0), (12, 1)]),
    "bass": ([(0, 1), (12, 1), (14, 0)], [(0, 0), (12, 0), (14, 1)]),
    "other": ([(0, 1), (8, 1), (20, 0)], [(0, 0), (8, 0), (20, 1)]),
    "vocals": ([(0, 1), (14, 1), (16, 0)], [(0, 0), (16, 0), (18, 1)]),
}
"""Each lane's automation for A and for B, on the nominal 28 s timeline: one bass owner, handed
over once, and the voices taking turns."""


def _lane_curve(count: int, points: list[tuple[float, float]]) -> Curve:
    """`_curve`'s automation as a curve the engine reads, scaled the same way."""
    scale = count / SAMPLE_RATE / TRANSITION_SECONDS
    return Curve([(point * scale, float(value)) for point, value in points])


def intertwine_script(
    a: SongInfo,
    b: SongInfo,
    a_points: np.ndarray,
    b_points: np.ndarray,
    stems_a: StemWindow,
    stems_b: StemWindow,
    windows: tuple[tuple[float, float], tuple[float, float]],
) -> TransitionScript:
    """The same seam as a script: each stem a part with its own automation, and B pinned to A's
    downbeats exactly as the old mix stretched it."""
    a_start = float(a_points[0])
    duration = float(a_points[-1] - a_start)
    count = int(round(duration * SAMPLE_RATE))
    keep = np.arange(0, 16 * a.beats_per_bar + 1, a.beats_per_bar)
    lanes = {}
    for side, stems, (origin, length) in (("a", stems_a, windows[0]), ("b", stems_b, windows[1])):
        for name in LANES:
            points = _POINTS[name][0 if side == "a" else 1]
            lanes[(side, name)] = Lane(
                str(getattr(stems, name)), origin, length, _lane_curve(count, points)
            )
    return stem_script(
        "stem_intertwine",
        a,
        b,
        duration,
        a_start,
        a_points[keep] - a_start,
        b_points[keep],
        lanes,
        {
            "bars": 16,
            "vocal_gains": {side: lanes[(side, "vocals")].gain for side in ("a", "b")},
        },
    )


def render_intertwined(
    settings: Settings, a: SongInfo, b: SongInfo, cache: SongCache | None = None
) -> Intertwined:
    cues = _pair_that_fits(a, b)
    if cues is None:
        raise ValueError("these tracks don't meet the tempo, grid, key, or phrase checks")
    exit_cue, entry_cue = cues
    a_index = a.beat_index_of_bar(exit_cue.bar - 8)
    b_index = b.beat_index_of_bar(entry_cue.bar)
    beats = 16 * a.beats_per_bar
    a_points = a.beats[a_index : a_index + beats + 1]
    b_points = b.beats[b_index : b_index + beats + 1]
    a_start = float(a_points[0])
    duration = float(a_points[-1] - a_start)
    b_start = entry_cue.time
    window = duration + 5.0
    stems_a = separate_window(settings, Path(a.path), a_start, window)
    speed = a.bpm / b.bpm
    stems_b = separate_window(settings, Path(b.path), b_start, window * speed)
    if flags.on("render.one_engine"):
        windows = ((a_start, window), (b_start, window * speed))
        script = intertwine_script(a, b, a_points, b_points, stems_a, stems_b, windows)
        rendered = render(script, cache)
        return Intertwined(
            rendered.audio,
            a_start,
            script.b_source_end,
            exit_cue,
            entry_cue,
            rendered.a_dry,
            rendered.b_dry,
            b_points,
            script.meta["vocal_gains"]["a"],
            script.meta["vocal_gains"]["b"],
            script.a.gain,
            script.b.gain,
            rendered,
        )
    # the old private mix, kept for render.one_engine off; it goes once the owner has listened
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

    a_drums, b_drums = (_curve(count, points) for points in _POINTS["drums"])
    a_bass, b_bass = (_curve(count, points) for points in _POINTS["bass"])
    a_other, b_other = (_curve(count, points) for points in _POINTS["other"])
    a_vocal, b_vocal = (_curve(count, points) for points in _POINTS["vocals"])

    gain_a = 10.0 ** (a.gain_db / 20.0)
    gain_b = 10.0 ** (b.gain_db / 20.0)
    a_dry = (
        layers_a["drums"] * a_drums
        + layers_a["bass"] * a_bass
        + layers_a["other"] * a_other
        + layers_a["vocals"] * a_vocal
    ) * gain_a
    b_dry = (
        layers_b["drums"] * b_drums
        + layers_b["bass"] * b_bass
        + layers_b["other"] * b_other
        + layers_b["vocals"] * b_vocal
    ) * gain_b
    mixed = dsp.limit(a_dry + b_dry)
    return Intertwined(
        mixed,
        a_start,
        float(b_points[-1]),
        exit_cue,
        entry_cue,
        a_dry,
        b_dry,
        b_points,
        _vocal_curve(duration, [(0, 1), (14, 1), (16, 0)]),
        _vocal_curve(duration, [(0, 0), (16, 0), (18, 1)]),
        _vocal_curve(duration, [(0, 1), (12, 1), (16, 0)]),
        _vocal_curve(duration, [(0, 0), (4, 0), (12, 1)]),
    )
