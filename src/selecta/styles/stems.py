"""Stem swaps. They return no script until on-demand stem paths are supplied."""

from __future__ import annotations

from selecta.analysis.song import Cue, SongInfo
from selecta.render.script import Curve, Part, TransitionScript
from selecta.styles.timing import blend_timing


def stem_swap(
    a: SongInfo, b: SongInfo, x: Cue, y: Cue, bars: int = 16, staged: bool = False, **options
):
    a_stem, b_stem = options.get("a_stem"), options.get("b_stem")
    if not a_stem or not b_stem:
        return None
    timing = blend_timing(a, b, x.bar, y.bar, bars)
    if timing is None:
        return None
    start, end = timing.overlap_start, timing.overlap_end
    middle = start + (end - start) * (0.75 if staged else 0.5)
    return TransitionScript(
        "staged_stem_swap" if staged else "vocal_swap",
        timing.duration,
        Part(
            a,
            timing.a_warp,
            source_path=str(a_stem),
            gain=Curve([(start, 1), (middle, 1), (end, 0)]),
        ),
        Part(
            b,
            timing.b_warp,
            source_path=str(b_stem),
            gain=Curve([(start, 0), (middle, 1), (end, 1)]),
        ),
        (start, end),
        True,
        meta={"bars": bars, "period": timing.master_period, "stems": True},
    )


def vocal_swap(a, b, x, y, bars=8, **options):
    return stem_swap(a, b, x, y, bars, False, **options)


def staged_stem_swap(a, b, x, y, bars=16, **options):
    return stem_swap(a, b, x, y, bars, True, **options)


def acapella_bridge(a, b, x, y, bars=8, **options):
    script = stem_swap(a, b, x, y, bars, False, **options)
    if script:
        script.style = "acapella_bridge"
    return script


def exchange(a, b, x, y, bars=4, **options):
    script = stem_swap(a, b, x, y, bars, True, **options)
    if script:
        script.style = "exchange"
        script.meta["wordplay"] = True
    return script
