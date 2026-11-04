"""Plays any TransitionScript into audio."""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field

import numpy as np

from selecta import audio as audio_io
from selecta.config import SAMPLE_RATE
from selecta.render import dsp
from selecta.render.script import Part, TransitionScript

_SEAM_SECONDS = 0.03


class SongCache:
    """Decoded songs, since a run of renders tends to reuse the same few."""

    def __init__(self, capacity: int = 6):
        self.capacity = capacity
        self._songs: OrderedDict[str, np.ndarray] = OrderedDict()

    def get(self, path: str) -> np.ndarray:
        if path in self._songs:
            self._songs.move_to_end(path)
            return self._songs[path]
        decoded = audio_io.decode(path)
        self._songs[path] = decoded
        while len(self._songs) > self.capacity:
            self._songs.popitem(last=False)
        return decoded


@dataclass
class Rendered:
    script: TransitionScript
    audio: np.ndarray
    a_dry: np.ndarray
    b_dry: np.ndarray
    drift_ms: dict[str, float] = field(default_factory=dict)

    @property
    def seconds(self) -> float:
        return self.audio.shape[0] / SAMPLE_RATE


def _part_audio(part: Part, source: np.ndarray, count: int) -> tuple[np.ndarray, float]:
    """The part's song, placed on the output timeline, before any mixing moves."""
    output = np.zeros((count, 2), dtype=np.float32)
    start_sample = int(round(part.output_start * SAMPLE_RATE))

    if part.warp.is_identity:
        source_start = float(part.warp.source[0])
        begin = int(round(source_start * SAMPLE_RATE))
        length = min(
            count - start_sample,
            source.shape[0] - begin,
            int(round((part.output_end - part.output_start) * SAMPLE_RATE)),
        )
        if length > 0 and begin >= 0:
            output[start_sample : start_sample + length] = source[begin : begin + length]
        return output, 0.0

    stretched, drift = dsp.stretch_to_warp(source, part.warp.output, part.warp.source, 0.0)
    length = min(stretched.shape[0], count - start_sample)
    output[start_sample : start_sample + length] = stretched[:length]
    return output, drift


def _apply_moves(part: Part, placed: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Apply EQ, filters and fader. Returns the dry signal and any effect tails."""
    count = placed.shape[0]
    signal = placed * float(10.0 ** (part.song.gain_db / 20.0))

    if not (part.low.is_constant(1.0) and part.mid.is_constant(1.0) and part.high.is_constant(1.0)):
        low, mid, high = dsp.split_bands(signal)
        signal = (
            low * part.low.sample(count, SAMPLE_RATE)[:, None]
            + mid * part.mid.sample(count, SAMPLE_RATE)[:, None]
            + high * part.high.sample(count, SAMPLE_RATE)[:, None]
        )
    if part.highpass is not None:
        signal = dsp.sweep_filter(signal, part.highpass.sample(count, SAMPLE_RATE), highpass=True)
    if part.lowpass is not None:
        signal = dsp.sweep_filter(signal, part.lowpass.sample(count, SAMPLE_RATE), highpass=False)

    tails = np.zeros_like(signal)
    if part.echo is not None and part.echo_send is not None:
        send = signal * part.echo_send.sample(count, SAMPLE_RATE)[:, None]
        tails += dsp.echo_tail(
            send,
            part.echo.delay_seconds,
            part.echo.feedback,
            part.echo.wet,
            part.echo.return_highpass_hz,
            part.echo.damp_lowpass_hz,
            count,
        )
    if part.wash is not None and part.wash_send is not None:
        send = signal * part.wash_send.sample(count, SAMPLE_RATE)[:, None]
        tails += dsp.reverb_tail(
            send,
            part.wash.room_size,
            part.wash.damping,
            part.wash.wet,
            part.wash.return_highpass_hz,
        )
    return signal * part.gain.sample(count, SAMPLE_RATE)[:, None], tails


def render(script: TransitionScript, cache: SongCache | None = None) -> Rendered:
    cache = cache or SongCache()
    count = int(round(script.duration * SAMPLE_RATE))

    placed_a, drift_a = _part_audio(script.a, cache.get(script.a.song.path), count)
    placed_b, drift_b = _part_audio(script.b, cache.get(script.b.song.path), count)
    dry_a, tails_a = _apply_moves(script.a, placed_a)
    dry_b, tails_b = _apply_moves(script.b, placed_b)

    mixed = dsp.limit(dry_a + dry_b + tails_a + tails_b)
    return Rendered(
        script,
        mixed,
        dry_a,
        dry_b,
        {"a": round(drift_a * 1000, 2), "b": round(drift_b * 1000, 2)},
    )


def in_context(
    rendered: Rendered, before: float, after: float, cache: SongCache | None = None
) -> tuple[np.ndarray, float]:
    """Native A, the clip, then native B: what a listener actually hears.

    Returns the audio and the offset where the clip begins. The seams are short linear
    crossfades, because each side holds the same song at the same position.
    """
    cache = cache or SongCache()
    script = rendered.script
    a_native = cache.get(script.a.song.path)
    b_native = cache.get(script.b.song.path)
    gain_a = float(10.0 ** (script.a.song.gain_db / 20.0))
    gain_b = float(10.0 ** (script.b.song.gain_db / 20.0))

    a_end = int(round(script.a_source_start * SAMPLE_RATE))
    a_start = max(0, a_end - int(before * SAMPLE_RATE))
    seam = int(_SEAM_SECONDS * SAMPLE_RATE)
    head = a_native[a_start : a_end + seam] * gain_a

    b_start = int(round(script.b_source_end * SAMPLE_RATE))
    b_end = min(b_native.shape[0], b_start + int(after * SAMPLE_RATE))
    tail = b_native[max(0, b_start - seam) : b_end] * gain_b

    clip = rendered.audio
    fade_up = np.linspace(0.0, 1.0, seam, dtype=np.float32)[:, None]
    total = head.shape[0] - seam + clip.shape[0] - seam + tail.shape[0]
    out = np.zeros((total, 2), dtype=np.float32)
    out[: head.shape[0]] = head
    out[head.shape[0] - seam : head.shape[0]] *= 1.0 - fade_up

    clip_at = head.shape[0] - seam
    faded = clip.copy()
    faded[:seam] *= fade_up
    faded[-seam:] *= 1.0 - fade_up
    out[clip_at : clip_at + clip.shape[0]] += faded

    tail_at = clip_at + clip.shape[0] - seam
    faded_tail = tail.copy()
    faded_tail[:seam] *= fade_up
    out[tail_at : tail_at + tail.shape[0]] += faded_tail
    return dsp.limit(out), clip_at / SAMPLE_RATE
