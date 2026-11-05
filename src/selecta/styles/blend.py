"""Beatmatched moves. One low end at all times, because two kicks in one band fight each other."""

from __future__ import annotations

from selecta.analysis.song import Cue, SongInfo
from selecta.render.script import Curve, Part, TransitionScript, fade_in, fade_out, sweep
from selecta.styles.timing import BlendTiming, blend_timing, tempo_gap

_FADE_SHARE = 0.65
RAMP_MIN_GAP = 0.05
RAMP_LONG_BEATS = 32


def _swap_time(timing: BlendTiming, bars: int, beats_per_bar: int, swap_at: float) -> float:
    """Trade the bass on a bar line, never between bars."""
    bar_seconds = (timing.overlap_end - timing.overlap_start) / bars
    swap_bar = max(1, round(bars * swap_at))
    return timing.overlap_start + swap_bar * bar_seconds


def _low_curves(swap: float, beat: float) -> tuple[Curve, Curve]:
    a_low = Curve([(swap - beat / 2, 1.0), (swap + beat / 2, 0.0)])
    b_low = Curve([(swap - beat / 2, 0.0), (swap + beat / 2, 1.0)])
    return a_low, b_low


def bass_swap_blend(
    a: SongInfo,
    b: SongInfo,
    exit_cue: Cue,
    entry_cue: Cue,
    bars: int = 16,
    swap_at: float = 0.5,
    **options,
) -> TransitionScript | None:
    timing = blend_timing(a, b, exit_cue.bar, entry_cue.bar, bars)
    if timing is None:
        return None
    start, end = timing.overlap_start, timing.overlap_end
    span = (end - start) * _FADE_SHARE
    swap = _swap_time(timing, bars, a.beats_per_bar, swap_at)
    a_low, b_low = _low_curves(swap, timing.master_period)
    return TransitionScript(
        style="bass_swap_blend",
        duration=timing.duration,
        a=Part(song=a, warp=timing.a_warp, gain=fade_out(end - span, end), low=a_low),
        b=Part(song=b, warp=timing.b_warp, gain=fade_in(start, start + span), low=b_low),
        overlap=(start, end),
        expects_beats_aligned=True,
        meta={"bars": bars, "swap": swap, "period": timing.master_period},
    )


def tempo_ramp(
    a: SongInfo,
    b: SongInfo,
    exit_cue: Cue,
    entry_cue: Cue,
    bars: int = 4,
    swap_at: float = 0.5,
    **options,
) -> TransitionScript | None:
    """Carry a wider tempo gap the way a DJ rides the pitch fader. A drifts over eight bars to a
    tempo the two songs meet at, they overlap briefly in time, and B drifts on to its own speed.
    Each song only moves about half the gap, and neither change is sudden."""
    if tempo_gap(a, b) < RAMP_MIN_GAP:
        return None
    timing = blend_timing(a, b, exit_cue.bar, entry_cue.bar, bars, ramp_beats=RAMP_LONG_BEATS)
    if timing is None:
        return None
    start, end = timing.overlap_start, timing.overlap_end
    span = (end - start) * _FADE_SHARE
    swap = _swap_time(timing, bars, a.beats_per_bar, swap_at)
    a_low, b_low = _low_curves(swap, timing.master_period)
    return TransitionScript(
        style="tempo_ramp",
        duration=timing.duration,
        a=Part(song=a, warp=timing.a_warp, gain=fade_out(end - span, end), low=a_low),
        b=Part(song=b, warp=timing.b_warp, gain=fade_in(start, start + span), low=b_low),
        overlap=(start, end),
        expects_beats_aligned=True,
        meta={"bars": bars, "swap": swap, "period": timing.master_period},
    )


def filter_sweep(
    a: SongInfo,
    b: SongInfo,
    exit_cue: Cue,
    entry_cue: Cue,
    bars: int = 8,
    swap_at: float = 0.5,
    **options,
) -> TransitionScript | None:
    timing = blend_timing(a, b, exit_cue.bar, entry_cue.bar, bars)
    if timing is None:
        return None
    start, end = timing.overlap_start, timing.overlap_end
    swap = _swap_time(timing, bars, a.beats_per_bar, swap_at)
    a_low, b_low = _low_curves(swap, timing.master_period)
    fade = (end - start) * 0.35
    return TransitionScript(
        style="filter_sweep",
        duration=timing.duration,
        a=Part(
            song=a,
            warp=timing.a_warp,
            gain=fade_out(end - fade, end),
            low=a_low,
            highpass=sweep(start, end, 30.0, 2000.0),
        ),
        b=Part(
            song=b,
            warp=timing.b_warp,
            gain=fade_in(start, start + fade),
            low=b_low,
            lowpass=sweep(start, end, 300.0, 20000.0),
        ),
        overlap=(start, end),
        expects_beats_aligned=True,
        meta={"bars": bars, "swap": swap, "period": timing.master_period},
    )
