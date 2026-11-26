"""Loop-made room: a long blend for a song whose own ending leaves nowhere clean to blend over.

A song that sings up to its exit, or ends after a short outro, leaves the planner an echo or a
cut, the moves the owner rated lowest. A DJ loops the last clean phrase instead, four or eight
bars, and mixes over it as if the song had a long outro (transition-craft-2.md 2.4). The rules
come from that research: whole bars on the grid, 4 or 8 of them; no bar with singing; never
across a section change; the first pass is the song's own audio carrying on, so nobody hears
where the loop began; and no more than four passes, with a filter moving over the repeats.

A loop is not something a warp can say, since a warp only runs forwards through a song. So each
pass is its own part of the script, a window of the same bars, joined to the one before by a
short linear crossfade that ends on the bar line and sums to one. The renderer needs nothing new.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from selecta.analysis.song import Cue, SongInfo
from selecta.planner_core.fit import fold_ratio
from selecta.planner_core.recipes import Room
from selecta.planner_core.recipes.blend import _FADE_SHARE, _low_curves, _swap_position
from selecta.planner_core.recipes.timing import (
    A_NATIVE_MAX_GAP,
    RAMP_BEATS,
    SETTLE_BEATS,
    SETTLED_GAP,
    _b_grid,
    _ramped_times,
)
from selecta.render.script import Curve, Part, TransitionScript, Warp, fade_in, fade_out, sweep

LOOP_LENGTHS = (8, 4)
"""Whole bars, longest first: a longer loop repeats less often."""
MAX_PASSES = 4
"""More than four passes of one loop wears on a listener (DJ TechTools, Crossfader)."""
JOIN_SECONDS = 0.01
"""Each join's crossfade, ending exactly on the bar line so the next downbeat is whole."""
SUNG_SECONDS = 0.05
"""Singing a bar may hold and still count as clean: a breath, or a line's rounded end."""
EDGE_SECONDS = 0.1
"""How far either side of a bar a line still counts, so a pickup into the next line is caught."""
DRUMS_SHARE = 0.6
"""A looped bar carries at least this share of the song's usual energy, so the drums are in."""
STEADY_SHARE = 0.25
"""Every looped bar within this share of the loop's own median energy: no build or drop inside."""
GRID_WOBBLE = 0.03
"""Each beat in a looped bar within 3 percent of the song's period, or the joins would flam."""
SWEEP_FROM_HZ = 20.0
SWEEP_TO_HZ = 400.0
"""The repeats' highpass rises this far by the end of the overlap: movement, so the loop
doesn't sit still, and A thins out as B takes over. Provisional until rated."""


@dataclass(frozen=True)
class Windows:
    """A's side of a script as windows of its own bars played end to end. `starts` are bar
    numbers in A, each window `bars` long; a window repeated is a loop."""

    starts: tuple[int, ...]
    bars: int

    @property
    def total_bars(self) -> int:
        return len(self.starts) * self.bars

    @property
    def passes(self) -> int:
        """The most times any one window plays."""
        return max(self.starts.count(start) for start in self.starts)


def _bar_end(song: SongInfo, bar: int) -> float | None:
    index = song.beat_index_of_bar(bar) + song.beats_per_bar
    if bar + 1 >= song.bar_starts.size and index >= song.beats.size:
        return None
    return float(song.beats[min(index, song.beats.size - 1)])


def _clean_bar(song: SongInfo, bar: int, usual_energy: float) -> bool:
    """No singing, the drums in, and a steady grid, all read from the song's stored facts."""
    if bar < 0 or bar >= song.bar_starts.size:
        return False
    start, end = song.bar_time(bar), _bar_end(song, bar)
    if end is None:
        return False
    if not song.instrumental and (
        song.vocal_seconds(start - EDGE_SECONDS, end + EDGE_SECONDS) > SUNG_SECONDS
    ):
        return False
    if song.energy_bars.size > bar and song.energy_bars[bar] < DRUMS_SHARE * usual_energy:
        return False
    first = song.beat_index_of_bar(bar)
    intervals = np.diff(song.beats[first : first + song.beats_per_bar + 1])
    if intervals.size < song.beats_per_bar:
        return False
    return bool(np.all(np.abs(intervals / song.period - 1.0) <= GRID_WOBBLE))


def _section_start(song: SongInfo, bar: int) -> int:
    """The first bar of the section holding `bar`, or 0 when the song has no sections."""
    for section in song.sections:
        if section["start_bar"] <= bar < section["end_bar"]:
            return int(section["start_bar"])
    return 0


def clean_run(song: SongInfo, exit_bar: int, limit: int) -> int:
    """How many whole bars just before `exit_bar` are clean, up to `limit`, never reaching back
    past the start of the section the last of them sits in. Zero when singing can't be checked."""
    if not (song.vocals_known or song.instrumental) or exit_bar < 1:
        return 0
    usual = float(np.median(song.energy_bars)) if song.energy_bars.size else 0.0
    floor = _section_start(song, exit_bar - 1)
    run = 0
    while run < limit and exit_bar - 1 - run >= floor:
        if not _clean_bar(song, exit_bar - 1 - run, usual):
            break
        run += 1
    return run


def steady(song: SongInfo, first_bar: int, bars: int) -> bool:
    """Whether these bars hold one level: a loop over a build or a drop repeats the change."""
    energy = song.energy_bars[first_bar : first_bar + bars]
    if energy.size < bars:
        return energy.size == 0
    middle = float(np.median(energy))
    return bool(np.all(np.abs(energy - middle) <= STEADY_SHARE * max(middle, 1e-6)))


def loop_window(song: SongInfo, exit_bar: int, bars: int) -> Windows | None:
    """The loop that makes a `bars`-long overlap ending at `exit_bar`, or None where the song
    has room of its own there, or no clean phrase to loop. The first pass is A's own bars."""
    run = clean_run(song, exit_bar, bars)
    if run >= bars:
        return None
    for length in LOOP_LENGTHS:
        passes = bars // length
        if length > run or bars % length or not 2 <= passes <= MAX_PASSES:
            continue
        start = exit_bar - length
        if steady(song, start, length):
            return Windows((start,) * passes, length)
    return None


def loop_room_fits(a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, bars: int):
    """Where loop room plays for this cue pair, or None where it doesn't belong."""
    windows = loop_window(a, exit_cue.bar, bars)
    if windows is None:
        return None
    return Room(b_enters_bar=windows.starts[0], overlap_bars=bars, loop_bars=windows.bars)


# --- Parts --------------------------------------------------------------------------------------


def continued(song: SongInfo, first: int, count: int) -> np.ndarray:
    """`count + 1` beat times from beat `first` on, carried at the song's period past its end.
    Used only for the timing A would have had, never for audio that plays."""
    found = song.beats[first : first + count + 1]
    missing = count + 1 - found.size
    if missing <= 0:
        return found
    last = found[-1] if found.size else song.beats[-1]
    return np.concatenate((found, last + song.period * np.arange(1, missing + 1)))


def _scaled(curve: Curve, points: list[tuple[float, float]]) -> Curve:
    """`curve` times a piecewise-linear window, sampled wherever either one bends."""
    window_times = np.array([time for time, _ in points])
    window_values = np.array([value for _, value in points])
    times = np.union1d(curve.times, window_times)
    values = np.interp(times, curve.times, curve.values) * np.interp(
        times, window_times, window_values
    )
    return Curve(list(zip(times.tolist(), values.tolist(), strict=True)))


def _led_in(warp: Warp, seconds: float) -> Warp:
    """The warp reaching `seconds` earlier at its first piece's rate, for the join's fade in."""
    rate = (warp.source[1] - warp.source[0]) / (warp.output[1] - warp.output[0])
    return Warp(
        np.concatenate(([warp.output[0] - seconds], warp.output)),
        np.concatenate(([warp.source[0] - seconds * rate], warp.source)),
    )


@dataclass
class SideA:
    """A's side laid out: each window's output bar lines and source bar lines, and where A
    would have been had it simply played on (the first part's whole-song timing)."""

    outputs: list[np.ndarray]
    sources: list[np.ndarray]
    natural: Warp


def a_parts(
    a: SongInfo,
    side: SideA,
    gain: Curve,
    low: Curve,
    mid: Curve | None = None,
    highpass: Curve | None = None,
    repeat_highpass: Curve | None = None,
) -> tuple[Part, list[Part], Curve]:
    """A's first part, the later windows as extras, and the gain the vocal checks should read
    for A. The first part plays the lead-in and the first window, then stops on the first join;
    its fader carries on, so the audit hears every pass as side A, but only the first part is
    ever read for singing, because every later pass is clean by design. Each join fades the
    outgoing window down and the incoming one up over the same few milliseconds before the bar
    line, linear both ways, so the two always sum to one."""
    joins = [float(output[0]) for output in side.outputs[1:]]
    mid = mid or Curve.constant(1.0)
    first_end = joins[0]
    first = Part(
        song=a,
        warp=side.natural,
        gain=_scaled(
            gain, [(first_end - JOIN_SECONDS, 1.0), (first_end, 0.0), (first_end + 1e-4, 1.0)]
        ),
        low=low,
        mid=mid,
        highpass=highpass,
        render_until=first_end,
    )
    heard_for_vocals = _scaled(gain, [(first_end - JOIN_SECONDS, 1.0), (first_end, 0.0)])
    extras = []
    for index, (output, source) in enumerate(zip(side.outputs[1:], side.sources[1:], strict=True)):
        start, end = float(output[0]), float(output[-1])
        window = [(start - JOIN_SECONDS, 0.0), (start, 1.0)]
        if index + 1 < len(joins):
            window += [(end - JOIN_SECONDS, 1.0), (end, 0.0)]
        extras.append(
            Part(
                song=a,
                warp=_led_in(Warp(output, source), JOIN_SECONDS * 1.5),
                gain=_scaled(gain, window),
                low=low,
                mid=mid,
                highpass=repeat_highpass or highpass,
            )
        )
    return first, extras, heard_for_vocals


# --- Loop room ------------------------------------------------------------------------------------


@dataclass
class LoopTiming:
    side: SideA
    b_warp: Warp
    overlap_start: float
    overlap_end: float
    duration: float
    master_period: float


def loop_lock(
    a: SongInfo, b: SongInfo, windows: Windows, b_start: int, fold: float = 1.0
) -> LoopTiming | None:
    """`beat_lock` (timing.py) for a side of A that loops: the same lead-in, master tempo and
    B grid, with A's output beats running on through each pass of the same source bars."""
    bpb = a.beats_per_bar
    first = a.beat_index_of_bar(windows.starts[0])
    per = windows.bars * bpb
    count = per * len(windows.starts)
    folded_bpm = b.bpm / fold
    gap = abs(a.bpm / folded_bpm - 1.0)
    a_native = gap <= A_NATIVE_MAX_GAP
    pre = bpb if a_native else RAMP_BEATS
    post = SETTLE_BEATS if gap <= SETTLED_GAP else RAMP_BEATS
    if first - pre < 0 or b_start < 0:
        return None
    sources = [
        a.beats[a.beat_index_of_bar(s) : a.beat_index_of_bar(s) + per + 1] for s in windows.starts
    ]
    if any(source.size != per + 1 for source in sources):
        return None
    b_beats = _b_grid(b, b_start, count + post, fold)
    if b_beats is None:
        return None
    lead_source = a.beats[first - pre : first + 1]
    if a_native:
        lead = lead_source - lead_source[0]
        master = a.bpm
        shared = [lead[-1:]]
        for source in sources:
            shared.append(shared[-1][-1] + source[1:] - source[0])
        shared = np.concatenate(shared)
    else:
        master = float(np.sqrt(a.bpm * folded_bpm))
        lead = _ramped_times(np.diff(lead_source), 1.0, master / a.bpm)
        shared = lead[-1] + np.arange(count + 1) * (60.0 / master)
    tail = shared[-1] + _ramped_times(np.diff(b_beats[count:]), master / folded_bpm, 1.0)
    b_output = np.concatenate((shared[:-1], tail))
    keep_b = np.unique(np.concatenate((np.arange(0, b_output.size, bpb), [b_output.size - 1])))

    outputs, bar_sources = [], []
    for index, source in enumerate(sources):
        output = shared[index * per : (index + 1) * per + 1]
        if index == 0:
            output = np.concatenate((lead[:-1], output))
            source = np.concatenate((lead_source[:-1], source))
        outputs.append(output[::bpb])
        bar_sources.append(source[::bpb])
    natural_output = np.concatenate((lead[:-1], shared))
    natural_source = continued(a, first - pre, natural_output.size - 1)
    natural = Warp(natural_output[::bpb], natural_source[::bpb])
    return LoopTiming(
        side=SideA(outputs, bar_sources, natural),
        b_warp=Warp(b_output[keep_b], b_beats[keep_b]),
        overlap_start=float(shared[0]),
        overlap_end=float(shared[-1]),
        duration=float(tail[-1]),
        master_period=60.0 / master,
    )


def loop_room(
    a: SongInfo,
    b: SongInfo,
    exit_cue: Cue,
    entry_cue: Cue,
    bars: int = 8,
    swap_at: float | None = None,
    **options,
) -> TransitionScript | None:
    """The bass-swap blend (blend.py) over a loop of A's last clean bars. B comes in on the
    loop's first pass, which is A's own audio carrying on; every later pass is a repeat, with a
    highpass rising slowly over them; the bass is traded on a bar line, one low end at a time."""
    windows = loop_window(a, exit_cue.bar, bars)
    if windows is None or a.beats_per_bar != b.beats_per_bar:
        return None
    timing = loop_lock(a, b, windows, b.beat_index_of_bar(entry_cue.bar), fold_ratio(a, b))
    if timing is None:
        return None
    start, end = timing.overlap_start, timing.overlap_end
    span = (end - start) * _FADE_SHARE
    swap_at = _swap_position(a, b, exit_cue.bar, entry_cue.bar) if swap_at is None else swap_at
    swap = start + max(1, round(bars * swap_at)) * (end - start) / bars
    a_low, b_low = _low_curves(swap, timing.master_period)
    first_repeat = float(timing.side.outputs[1][0])
    first, extras, vocal_gain = a_parts(
        a,
        timing.side,
        fade_out(end - span, end),
        a_low,
        repeat_highpass=sweep(first_repeat, end, SWEEP_FROM_HZ, SWEEP_TO_HZ),
    )
    return TransitionScript(
        style="loop_room",
        duration=timing.duration,
        a=first,
        b=Part(song=b, warp=timing.b_warp, gain=fade_in(start, start + span), low=b_low),
        overlap=(start, end),
        expects_beats_aligned=True,
        extras=extras,
        meta={
            "bars": bars,
            "swap": swap,
            "swap_at": swap_at,
            "period": timing.master_period,
            # every pass of the loop is part of side A for the audit's beat, bass and harmony
            # checks, as each stem lane is in a stem seam
            "stem_lanes": True,
            "vocal_gains": {"a": vocal_gain},
            "loop": {
                "start_bar": windows.starts[0],
                "bars": windows.bars,
                "passes": len(windows.starts),
                "joins": [float(output[0]) for output in timing.side.outputs[1:]],
            },
        },
    )
