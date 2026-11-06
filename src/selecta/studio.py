"""The Seam Studio: both songs' voice, drums, bass and melody, lined up bar for bar.

A session splits the stretch where two songs meet into eight stems on one shared timeline, so a
person can turn any of them on or off for any stretch and hear it straight away in the browser. What
they settle on is its shape, and rendering that shape gives a seam like any other, which the mix
plays and the listener can rate.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from selecta.analysis.song import Cue, SongInfo
from selecta.config import SAMPLE_RATE, Settings
from selecta.render import dsp
from selecta.render.engine import Rendered
from selecta.render.intertwine import _fit, _read
from selecta.render.script import Curve, Part, TransitionScript, Warp
from selecta.stems import separate_window, window_is_ready

LANES = ("vocals", "drums", "bass", "other")
SIDES = ("a", "b")
CELLS = 8
"""However long the overlap, the grid has this many steps, so it stays easy to read and tap."""
OVERLAP_BARS = (16, 12, 8)
MAX_TEMPO_GAP = 0.08
MIN_GRID = 0.55
EDGE_SECONDS = 0.012
WINDOW_MARGIN = 5.0

Shape = dict[str, dict[str, list[int]]]

START_SHAPE: Shape = {
    "a": {
        "vocals": [1, 1, 1, 1, 1, 1, 0, 0],
        "drums": [1, 1, 1, 1, 1, 1, 0, 0],
        "bass": [1, 1, 1, 1, 0, 0, 0, 0],
        "other": [1, 1, 1, 1, 1, 0, 0, 0],
    },
    "b": {
        "vocals": [0, 0, 0, 0, 0, 0, 1, 1],
        "drums": [0, 0, 1, 1, 1, 1, 1, 1],
        "bass": [0, 0, 0, 0, 1, 1, 1, 1],
        "other": [0, 0, 0, 1, 1, 1, 1, 1],
    },
}
"""A starting point: B's drums come in early, there's one bass at a time, and voices trade late."""


@dataclass(frozen=True)
class Placement:
    exit_cue: Cue
    entry_cue: Cue
    bars: int


def find_placement(
    a: SongInfo, b: SongInfo, exit_bar: int | None = None, entry_bar: int | None = None
) -> Placement | None:
    """Where these two can overlap, longest first. Long overlaps are the ones the listener likes."""
    if abs(a.bpm / b.bpm - 1.0) > MAX_TEMPO_GAP or a.beats_per_bar != b.beats_per_bar:
        return None
    if min(a.grid_confidence, b.grid_confidence) < MIN_GRID:
        return None
    exits = [c for c in a.exit_cues() if exit_bar is None or c.bar == exit_bar] or a.exit_cues()
    entries = [c for c in b.entry_cues() if entry_bar is None or c.bar == entry_bar]
    entries = entries or b.entry_cues()
    for bars in OVERLAP_BARS:
        beats = bars * a.beats_per_bar
        for exit_cue in exits:
            if exit_cue.bar < bars // 2:
                continue
            if a.beat_index_of_bar(exit_cue.bar - bars // 2) + beats >= len(a.beats):
                continue
            for entry_cue in entries:
                if b.beat_index_of_bar(entry_cue.bar) + beats < len(b.beats):
                    return Placement(exit_cue, entry_cue, bars)
    return None


def why_no_studio(a: SongInfo, b: SongInfo) -> str | None:
    """A reason in plain words if these two can't be laid out together, or None if they can."""
    if find_placement(a, b) is not None:
        return None
    gap = abs(a.bpm / b.bpm - 1.0)
    if gap > MAX_TEMPO_GAP:
        return f"These two are {gap:.0%} apart in tempo, too far to play their stems together."
    return "These two don't have enough clear bars to line their stems up."


def _points(a: SongInfo, b: SongInfo, place: Placement) -> tuple[np.ndarray, np.ndarray]:
    beats = place.bars * a.beats_per_bar
    a_index = a.beat_index_of_bar(place.exit_cue.bar - place.bars // 2)
    b_index = b.beat_index_of_bar(place.entry_cue.bar)
    return a.beats[a_index : a_index + beats + 1], b.beats[b_index : b_index + beats + 1]


def _windows(
    a: SongInfo, b: SongInfo, place: Placement
) -> tuple[tuple[float, float], tuple[float, float]]:
    a_points, b_points = _points(a, b, place)
    window = float(a_points[-1] - a_points[0]) + WINDOW_MARGIN
    return (float(a_points[0]), window), (float(b_points[0]), window * a.bpm / b.bpm)


def windows_to_separate(
    settings: Settings,
    a: SongInfo,
    b: SongInfo,
    exit_bar: int | None = None,
    entry_bar: int | None = None,
) -> int:
    """How many stem windows a session still needs, which is nearly all of its waiting time."""
    place = find_placement(a, b, exit_bar, entry_bar)
    if place is None:
        return 0
    a_window, b_window = _windows(a, b, place)
    ready = (
        window_is_ready(settings, Path(a.path), *a_window),
        window_is_ready(settings, Path(b.path), *b_window),
    )
    return sum(not done for done in ready)


def prepare_session(
    settings: Settings,
    a: SongInfo,
    b: SongInfo,
    folder: Path,
    exit_bar: int | None = None,
    entry_bar: int | None = None,
) -> dict:
    """Split both songs and lay all eight stems on A's bars. The first time for a pair of songs
    takes minutes, since it separates two windows. Everything after that is instant."""
    place = find_placement(a, b, exit_bar, entry_bar)
    if place is None:
        raise ValueError(why_no_studio(a, b) or "These two can't be laid out together.")
    beats = place.bars * a.beats_per_bar
    a_points, b_points = _points(a, b, place)
    a_start, b_start = float(a_points[0]), float(b_points[0])
    seconds = float(a_points[-1] - a_start)
    (a_window, b_window) = _windows(a, b, place)
    stems_a = separate_window(settings, Path(a.path), *a_window)
    stems_b = separate_window(settings, Path(b.path), *b_window)
    keep = np.arange(0, beats + 1, max(a.beats_per_bar // 2, 1))
    gain_a, gain_b = 10.0 ** (a.gain_db / 20.0), 10.0 ** (b.gain_db / 20.0)
    folder.mkdir(parents=True, exist_ok=True)
    for lane in LANES:
        first = _fit(_read(getattr(stems_a, lane)), seconds) * gain_a
        aligned, _ = dsp.stretch_to_warp(
            _read(getattr(stems_b, lane)), a_points[keep] - a_start, b_points[keep] - b_start, 0.0
        )
        second = _fit(aligned, seconds) * gain_b
        sf.write(folder / f"a_{lane}.flac", first, SAMPLE_RATE, subtype="PCM_16")
        sf.write(folder / f"b_{lane}.flac", second, SAMPLE_RATE, subtype="PCM_16")
    return {
        "bars": place.bars,
        "cells": CELLS,
        "seconds": seconds,
        "a_start": a_start,
        "b_points": [float(value) for value in b_points],
        "a_points": [float(value) for value in a_points],
        "exit_bar": place.exit_cue.bar,
        "entry_bar": place.entry_cue.bar,
        "start_shape": START_SHAPE,
    }


def clean_shape(raw: str | dict | None) -> Shape:
    """A shape from outside, with anything missing or malformed set to the starting point."""
    try:
        given = json.loads(raw) if isinstance(raw, str) else (raw or {})
    except ValueError:
        given = {}
    shape: Shape = {}
    for side in SIDES:
        shape[side] = {}
        for lane in LANES:
            lanes = given.get(side) if isinstance(given, dict) else None
            cells = lanes.get(lane) if isinstance(lanes, dict) else None
            good = isinstance(cells, list) and len(cells) == CELLS
            shape[side][lane] = (
                [1 if value else 0 for value in cells] if good else list(START_SHAPE[side][lane])
            )
    return shape


def _lane_gain(cells: list[int], seconds: float, count: int) -> np.ndarray:
    """A lane's level over the overlap, with short edges so nothing clicks where it changes."""
    step = seconds / CELLS
    times: list[float] = [0.0]
    values: list[float] = [float(cells[0])]
    for index in range(1, CELLS):
        if cells[index] != cells[index - 1]:
            boundary = index * step
            times += [boundary - EDGE_SECONDS, boundary + EDGE_SECONDS]
            values += [float(cells[index - 1]), float(cells[index])]
    times.append(seconds)
    values.append(float(cells[-1]))
    positions = np.arange(count) / SAMPLE_RATE
    return np.interp(positions, times, values).astype(np.float32)[:, None]


def _curve(cells: list[int], seconds: float) -> Curve:
    step = seconds / CELLS
    points = [(0.0, float(cells[0]))]
    for index in range(1, CELLS):
        points.append((index * step - 0.001, float(cells[index - 1])))
        points.append((index * step + 0.001, float(cells[index])))
    points.append((seconds, float(cells[-1])))
    return Curve(points)


def render_shape(
    a: SongInfo, b: SongInfo, folder: Path, session: dict, shape: Shape
) -> Rendered:
    """Play the chosen shape into a finished seam that the mix can use like any other."""
    seconds = float(session["seconds"])
    count = int(round(seconds * SAMPLE_RATE))
    dry = {}
    for side in SIDES:
        mixed = np.zeros((count, 2), dtype=np.float32)
        for lane in LANES:
            audio = _fit(_read(folder / f"{side}_{lane}.flac"), seconds)[:count]
            mixed += audio * _lane_gain(shape[side][lane], seconds, count)
        dry[side] = mixed
    a_points = np.asarray(session["a_points"], dtype=float)
    b_points = np.asarray(session["b_points"], dtype=float)
    a_start = float(session["a_start"])
    script = TransitionScript(
        style="stem_studio",
        duration=seconds,
        a=Part(a, Warp.identity(0.0, a_start, seconds), gain=_curve(shape["a"]["drums"], seconds)),
        b=Part(b, Warp(a_points - a_start, b_points), gain=_curve(shape["b"]["drums"], seconds)),
        overlap=(0.0, seconds),
        expects_beats_aligned=True,
        meta={
            "period": a.period,
            "bars": int(session["bars"]),
            "vocal_gains": {
                "a": _curve(shape["a"]["vocals"], seconds),
                "b": _curve(shape["b"]["vocals"], seconds),
            },
        },
    )
    return Rendered(script, dsp.limit(dry["a"] + dry["b"]), dry["a"], dry["b"])
