"""Less-common recipes, kept behind strong situation gates by the planner."""

from __future__ import annotations

from selecta.analysis.song import Cue, SongInfo
from selecta.render.script import Curve, Echo
from selecta.styles.blend import bass_swap_blend, filter_sweep
from selecta.styles.exits import cut_on_one, echo_out, reverb_wash


def long_blend(a: SongInfo, b: SongInfo, x: Cue, y: Cue, bars: int = 32, **options):
    return bass_swap_blend(a, b, x, y, max(16, bars), swap_at=0.5)


def drop_swap(a: SongInfo, b: SongInfo, x: Cue, y: Cue, bars: int = 0, **options):
    return cut_on_one(a, b, x, y)


def half_double(a: SongInfo, b: SongInfo, x: Cue, y: Cue, bars: int = 0, **options):
    ratio = max(a.bpm, b.bpm) / min(a.bpm, b.bpm)
    return cut_on_one(a, b, x, y) if abs(ratio - 2) <= 0.03 else None


def loop_roll_build(a: SongInfo, b: SongInfo, x: Cue, y: Cue, bars: int = 2, **options):
    """A beat-synchronised roll illusion made from shortening echo repeats."""
    script = echo_out(a, b, x, y, gap_bars=0)
    if script is None:
        return None
    script.style = "loop_roll_build"
    script.a.echo = Echo(a.period / 2, feedback=0.74, wet=0.5)
    return script


def tempo_ramp(a: SongInfo, b: SongInfo, x: Cue, y: Cue, bars: int = 16, **options):
    gap = abs(a.bpm / b.bpm - 1)
    if not 0.08 <= gap <= 0.30:
        return None
    script = filter_sweep(a, b, x, y, min(16, bars))
    return script


def brake(a: SongInfo, b: SongInfo, x: Cue, y: Cue, bars: int = 1, **options):
    script = reverb_wash(a, b, x, y, 2)
    if script:
        script.style = "brake"
    return script


def riser_air(a: SongInfo, b: SongInfo, x: Cue, y: Cue, bars: int = 1, **options):
    script = reverb_wash(a, b, x, y, 2)
    if script:
        script.style = "riser_air"
        script.a.highpass = Curve([(0, 60), (script.overlap[1], 3500)])
    return script


def word_cut(a: SongInfo, b: SongInfo, x: Cue, y: Cue, bars: int = 0, **options):
    script = cut_on_one(a, b, x, y)
    if script:
        script.style = "word_cut"
        script.meta["wordplay"] = True
    return script


def word_loop(a: SongInfo, b: SongInfo, x: Cue, y: Cue, bars: int = 1, **options):
    script = loop_roll_build(a, b, x, y, bars)
    if script:
        script.style = "word_loop"
        script.meta["wordplay"] = True
    return script
