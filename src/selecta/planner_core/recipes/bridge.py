"""Tempo bridge: cross a tempo gap too wide to beat-lock, where the change can't be heard.

Overlaps more than 4.5 percent apart in tempo were liked once in 10, and the old 4-bar
`tempo_ramp`, which stretched both songs over a short overlap, 0 times in 3. A DJ bridges such a
gap slowly instead: sixteen bars, never four, with the outgoing song stripped to something the ear
doesn't track for pitch, the tempo walked steadily to the next song's, and then the next song
brought in at its own speed (transition-craft-2.md 4.5, technique-catalogue.md).

Bar by bar: one bar of A as it is; then sixteen bars of A's clean phrase (looped where the song
has no sixteen clean bars of its own, through `recipes.loop`) with its bass out, its mids down
and a highpass up, each bar a step closer to B's tempo, every step the same size; then eight bars
where B enters on that phrase line at its native speed, untouched, A still at B's tempo under it
and fading out. Pitch never moves: every change of speed is a time-stretch, never varispeed. Only
A is ever stretched, and never by more than `MAX_STRETCH`.

Without stems this is the whole move, and it plays in every studio. A stem form, A's drums alone
over the bridge, waits on stem lanes the planner core may not import (docs/todo).
"""

from __future__ import annotations

import numpy as np

from selecta.analysis.song import Cue, SongInfo
from selecta.planner_core.fit import CLOSE_TEMPO
from selecta.planner_core.recipes import Room
from selecta.planner_core.recipes.blend import _FADE_SHARE
from selecta.planner_core.recipes.loop import (
    SideA,
    Windows,
    a_parts,
    clean_run,
    continued,
    steady,
)
from selecta.render.script import Curve, Part, TransitionScript, Warp, fade_in, fade_out

BRIDGE_BARS = 16
"""Sixteen bars for the walk: the retired ramp's four were all disliked (0 of 3)."""
LAND_BARS = 8
"""B and A together once A has arrived; 8 bars or more were liked 16 times in 19."""
WINDOW_BARS = 8
"""A's side is laid out in 8-bar windows: one phrase, a loop of it where needed, and short
enough that the browser's 60 second stretch limit is never reached."""
MAX_STRETCH = 0.08
"""The most A's tempo may move: about 8 percent, the research's ceiling and the audit's limit."""
LEAD_BARS = 1
TAIL_BARS = 2
BASS_OUT_BARS = 1
STRIP_BARS = 2
STRIPPED_MID = 0.6
STRIPPED_HIGHPASS_HZ = 300.0
LANDING_HIGHPASS_HZ = 1200.0
"""How far A is stripped: bass out over the first bar, mids down about 4 dB and a highpass up to
300 Hz over two, then rising on as B takes over. Provisional until rated."""


def _stretch(a: SongInfo, b: SongInfo) -> float:
    """How far A's tempo has to move, in either direction of measuring."""
    return max(abs(b.bpm / a.bpm - 1.0), abs(a.bpm / b.bpm - 1.0))


def bridge_windows(a: SongInfo, exit_bar: int) -> Windows | None:
    """A's side for the bridge and the landing: its own clean bars before the exit as far as they
    go in whole phrases, then the last phrase again until 24 bars are filled. None when A has no
    clean, steady phrase ending at `exit_bar`."""
    total = BRIDGE_BARS + LAND_BARS
    run = clean_run(a, exit_bar, total)
    own = run // WINDOW_BARS * WINDOW_BARS
    if own == 0 or not steady(a, exit_bar - WINDOW_BARS, WINDOW_BARS):
        return None
    starts = [exit_bar - own + i * WINDOW_BARS for i in range(own // WINDOW_BARS)]
    starts += [exit_bar - WINDOW_BARS] * ((total - own) // WINDOW_BARS)
    windows = Windows(tuple(starts), WINDOW_BARS)
    return windows if windows.passes <= 4 else None


def tempo_bridge_fits(a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, bars: int):
    """Where the bridge plays for this cue pair, or None where it doesn't belong: songs close
    enough to blend, too far apart to bridge, or an A with no clean phrase to carry."""
    gap = abs(a.bpm / b.bpm - 1.0)
    if gap <= CLOSE_TEMPO or _stretch(a, b) > MAX_STRETCH or bars != BRIDGE_BARS:
        return None
    windows = bridge_windows(a, exit_cue.bar)
    if windows is None:
        return None
    return Room(
        b_enters_bar=windows.starts[-1],
        overlap_bars=LAND_BARS,
        loop_bars=WINDOW_BARS,
    )


def _bar_lines(
    a: SongInfo, b: SongInfo, windows: Windows, b_start: int
) -> tuple[SideA, Warp, float, float, float] | None:
    """A's output bar lines: its lead bar as it is, the bridge bars stepping evenly to B's tempo,
    then the landing bars pinned to B's own bar lines, B playing at its own speed throughout."""
    bpb = a.beats_per_bar
    first = a.beat_index_of_bar(windows.starts[0])
    if first - LEAD_BARS * bpb < 0 or b_start < 0:
        return None
    land_beats = LAND_BARS * bpb
    tail_beats = TAIL_BARS * bpb
    if b_start + land_beats + tail_beats >= b.beats.size:
        return None
    b_lines = b.beats[b_start : b_start + land_beats + 1 : bpb]
    lead = a.beats[first - LEAD_BARS * bpb : first + 1 : bpb]
    sources = []
    for start in windows.starts:
        index = a.beat_index_of_bar(start)
        source = a.beats[index : index + windows.bars * bpb + 1 : bpb]
        if source.size != windows.bars + 1:
            return None
        sources.append(source)
    step = (b.bpm - a.bpm) / BRIDGE_BARS
    lines = [lead[-1] - lead[0]]
    bar = 0
    for source in sources:
        for length in np.diff(source):
            if bar < BRIDGE_BARS:
                # each bridge bar a constant tempo, each one the same step nearer B's
                lines.append(lines[-1] + length * a.bpm / (a.bpm + step * (bar + 1)))
            else:
                landed = bar - BRIDGE_BARS
                lines.append(lines[BRIDGE_BARS] + b_lines[landed + 1] - b_lines[0])
            bar += 1
    lines = np.array(lines)
    outputs = []
    for index in range(len(sources)):
        output = lines[index * windows.bars : (index + 1) * windows.bars + 1]
        outputs.append(np.concatenate(([0.0], output)) if index == 0 else output)
    bar_sources = [np.concatenate(([lead[0]], sources[0]))] + sources[1:]
    natural_source = continued(a, first - LEAD_BARS * bpb, (lines.size) * bpb)[::bpb]
    natural = Warp(np.concatenate(([0.0], lines)), natural_source)
    arrival = float(lines[BRIDGE_BARS])
    end = float(lines[-1])
    tail_end = float(b.beats[b_start + land_beats + tail_beats])
    duration = arrival + tail_end - float(b.beats[b_start])
    b_warp = Warp.identity(arrival, float(b.beats[b_start]), duration - arrival)
    return SideA(outputs, bar_sources, natural), b_warp, arrival, end, duration


def _strip(start: float, bar: float, arrival: float, end: float) -> tuple[Curve, Curve, Curve]:
    """A's low band, mid band and highpass over the bridge and the landing."""
    low = Curve([(start, 1.0), (start + bar * BASS_OUT_BARS, 0.0)])
    mid = Curve([(start, 1.0), (start + bar * STRIP_BARS, STRIPPED_MID)])
    points = []
    for i in range(25):
        x = i / 24
        points.append((start + bar * STRIP_BARS * x, 20.0 * (STRIPPED_HIGHPASS_HZ / 20.0) ** x))
    for i in range(25):
        x = i / 24
        rise = (LANDING_HIGHPASS_HZ / STRIPPED_HIGHPASS_HZ) ** x
        points.append((arrival + (end - arrival) * x + 1e-6, STRIPPED_HIGHPASS_HZ * rise))
    return low, mid, Curve(points)


def tempo_bridge(
    a: SongInfo,
    b: SongInfo,
    exit_cue: Cue,
    entry_cue: Cue,
    bars: int = BRIDGE_BARS,
    **options,
) -> TransitionScript | None:
    if tempo_bridge_fits(a, b, exit_cue, entry_cue, bars) is None:
        return None
    windows = bridge_windows(a, exit_cue.bar)
    if windows is None or a.beats_per_bar != b.beats_per_bar:
        return None
    laid = _bar_lines(a, b, windows, b.beat_index_of_bar(entry_cue.bar))
    if laid is None:
        return None
    side, b_warp, arrival, end, duration = laid
    start = float(side.outputs[0][1])
    period = 60.0 / b.bpm
    bar = period * a.beats_per_bar
    span = (end - arrival) * _FADE_SHARE
    low, mid, highpass = _strip(start, bar, arrival, end)
    gain = fade_out(end - span, end)
    first, extras, vocal_gain = a_parts(a, side, gain, low, mid, highpass)
    # the audit steps beats from the overlap's start, so it starts a whole number of B's beats
    # before B arrives; the overlap covers the bridge so the level checks hear A before it
    # was stripped against B after it has taken over
    overlap_start = arrival - np.floor((arrival - start) / period + 1e-9) * period
    return TransitionScript(
        style="tempo_bridge",
        duration=duration,
        a=first,
        b=Part(song=b, warp=b_warp, gain=fade_in(arrival, arrival + span)),
        overlap=(float(overlap_start), end),
        expects_beats_aligned=True,
        extras=extras,
        meta={
            "bars": BRIDGE_BARS,
            "land_bars": LAND_BARS,
            "period": period,
            "bridge_start": start,
            "arrival": arrival,
            "tempo_from": a.bpm,
            "tempo_to": b.bpm,
            "stem_lanes": True,
            "vocal_gains": {"a": vocal_gain},
            "loop": {
                "starts": list(windows.starts),
                "bars": windows.bars,
                "joins": [float(output[0]) for output in side.outputs[1:]],
            },
        },
    )
