"""TransitionScript: a transition described as data.

A recipe is a small function that returns one of these. One `render` plays any script and the
audit can measure any result, so adding a style never touches the engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from selecta.analysis.song import SongInfo


class Curve:
    """A value that changes over output time, defined by points and interpolated linearly."""

    def __init__(self, points: list[tuple[float, float]]):
        ordered = sorted(points, key=lambda p: p[0])
        self.times = np.array([p[0] for p in ordered], dtype=np.float64)
        self.values = np.array([p[1] for p in ordered], dtype=np.float64)

    @classmethod
    def constant(cls, value: float) -> Curve:
        return cls([(0.0, value)])

    def sample(self, count: int, sample_rate: int) -> np.ndarray:
        times = np.arange(count, dtype=np.float64) / sample_rate
        return np.interp(times, self.times, self.values).astype(np.float32)

    def is_constant(self, value: float) -> bool:
        return bool(np.all(np.abs(self.values - value) < 1e-9))


def fade_in(start: float, end: float, steps: int = 48) -> Curve:
    """Equal power rise, for joining two different songs."""
    points = [(start - 1e-6, 0.0)]
    for i in range(steps + 1):
        x = i / steps
        points.append((start + (end - start) * x, float(np.sin(x * np.pi / 2))))
    return Curve(points)


def fade_out(start: float, end: float, steps: int = 48) -> Curve:
    points = []
    for i in range(steps + 1):
        x = i / steps
        points.append((start + (end - start) * x, float(np.cos(x * np.pi / 2))))
    points.append((end + 1e-6, 0.0))
    return Curve(points)


def step(time: float, before: float, after: float, ramp: float = 0.01) -> Curve:
    return Curve([(time - ramp / 2, before), (time + ramp / 2, after)])


def sweep(start: float, end: float, from_hz: float, to_hz: float, steps: int = 48) -> Curve:
    """A filter move: logarithmic in frequency, linear in time."""
    points = []
    for i in range(steps + 1):
        x = i / steps
        frequency = from_hz * (to_hz / from_hz) ** x
        points.append((start + (end - start) * x, frequency))
    return Curve(points)


@dataclass
class Warp:
    """Maps output time to source time, piecewise linear between matched points."""

    output: np.ndarray
    source: np.ndarray

    def __post_init__(self) -> None:
        self.output = np.asarray(self.output, dtype=np.float64)
        self.source = np.asarray(self.source, dtype=np.float64)

    @classmethod
    def identity(cls, output_start: float, source_start: float, duration: float) -> Warp:
        return cls(
            np.array([output_start, output_start + duration]),
            np.array([source_start, source_start + duration]),
        )

    @property
    def is_identity(self) -> bool:
        dt = np.diff(self.output)
        ds = np.diff(self.source)
        return bool(np.all(np.abs(ds / dt - 1.0) < 2e-4))

    @property
    def max_stretch(self) -> float:
        """The largest tempo change this warp asks for, as a fraction."""
        return float(np.max(np.abs(np.diff(self.source) / np.diff(self.output) - 1.0)))

    def trimmed(self, start: float, end: float) -> Warp:
        """The same mapping, covering only this stretch of output time."""
        inside = (self.output > start) & (self.output < end)
        output = np.concatenate(([start], self.output[inside], [end]))
        return Warp(output, np.interp(output, self.output, self.source))

    def source_at(self, time: np.ndarray | float) -> np.ndarray | float:
        return np.interp(time, self.output, self.source)

    def output_at(self, time: np.ndarray | float) -> np.ndarray | float:
        return np.interp(time, self.source, self.output)


@dataclass
class Echo:
    delay_seconds: float
    feedback: float = 0.6
    wet: float = 0.35
    return_highpass_hz: float = 250.0
    damp_lowpass_hz: float = 6000.0


@dataclass
class Wash:
    wet: float = 0.38
    decay_seconds: float = 2.2
    damping: float = 0.45
    return_highpass_hz: float = 350.0


@dataclass
class Part:
    song: SongInfo
    warp: Warp
    source_path: str | None = None
    gain: Curve = field(default_factory=lambda: Curve.constant(1.0))
    low: Curve = field(default_factory=lambda: Curve.constant(1.0))
    mid: Curve = field(default_factory=lambda: Curve.constant(1.0))
    high: Curve = field(default_factory=lambda: Curve.constant(1.0))
    highpass: Curve | None = None
    lowpass: Curve | None = None
    echo: Echo | None = None
    echo_send: Curve | None = None
    wash: Wash | None = None
    wash_send: Curve | None = None
    window_origin: float = 0.0
    """Where `source_path` starts in the song, for a stem file covering only part of it."""
    render_from: float | None = None
    render_until: float | None = None
    """Output times to read audio between. The warp still describes the whole song's timing."""
    follows_b: bool = False
    """An extra layer of song B, which has to take the same small timing nudge as B."""

    @property
    def heard_warp(self) -> Warp:
        if self.render_until is None and self.render_from is None:
            return self.warp
        first = float(self.warp.output[0]) if self.render_from is None else self.render_from
        last = float(self.warp.output[-1]) if self.render_until is None else self.render_until
        return self.warp.trimmed(first, last)

    @property
    def output_start(self) -> float:
        return float(self.warp.output[0])

    @property
    def output_end(self) -> float:
        return float(self.warp.output[-1])

    @property
    def audio_path(self) -> str:
        return self.source_path or self.song.path


@dataclass
class TransitionScript:
    style: str
    duration: float
    a: Part
    b: Part
    overlap: tuple[float, float]
    """Output seconds when both songs sound. Equal values mean no overlap, as in a cut."""
    expects_beats_aligned: bool = False
    quiet_allowed: float = 0.0
    """Output seconds of intended silence, so the audit doesn't flag a deliberate gap."""
    extras: list[Part] = field(default_factory=list)
    """More layers on the same timeline, such as one word of a separated voice."""
    meta: dict = field(default_factory=dict)

    @property
    def a_source_start(self) -> float:
        """Where native playback of A hands over to this clip."""
        return float(self.a.warp.source_at(0.0))

    @property
    def b_source_end(self) -> float:
        """Where native playback of B takes over after this clip."""
        return float(self.b.warp.source_at(self.duration))
