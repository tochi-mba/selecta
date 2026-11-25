"""Which word and voice hand-offs two songs can carry, read from their facts and timed lyrics.

A link has to fit musically before the words count for anything. The listener's verdict on the
first word reel was that it felt like "we are just using the words because it happens to match".
Finding the words in the separated voice, and rendering, stay in `selecta.planner.wordreel`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from selecta import flags
from selecta.analysis.key import camelot_distance
from selecta.analysis.song import SongInfo
from selecta.planner_core.fit import (
    ROLL_MAX_KEYS,
    STEADY_GRID,
    TimbreSpace,
    felt_bpm,
    folded_gap,
    level_step,
)

if TYPE_CHECKING:
    from selecta.lyrics.lrclib import Line
    from selecta.lyrics.match import LyricLink

WINDOW_LEAD = 30.0
"""B's band can start this long before its voice, which is what the stems are for."""
WINDOW_TAIL = 8.0
LINE_SEARCH_AFTER = 3.5

BLEND_MAX_GAP = 0.08
"""The widest gap stretching can close at all (the audit refuses more than 8%). Taste is stricter:
outside a wordplay showcase the planner holds blends to fit.CLOSE_TEMPO."""
BLEND_MAX_KEY_DISTANCE = 2
BLEND_MIN_GRID = STEADY_GRID
ROLL_MIN_TEMPO_RATIO = 0.88
"""A roll promises a drop. Reel 2's hype song into a much slower one felt like a broken promise."""
CUT_MAX_GAP = 0.06
"""A bare cut only felt right where the pulse carried across. The best one was 4.5% apart."""
MAX_TIMBRE = 1.6
DEFAULT_QUOTAS = {"word_blend": 3, "word_exchange": 3, "phrase_roll": 3, "word_cut": 1}
MODE_PAYOFF = {"word_blend": 1.0, "word_exchange": 0.95, "phrase_roll": 0.85, "word_cut": 0.6}


RIDE_BARS = 4
RIDE_LENGTHS = (16, 12, 8, 4)
MIN_RIDE_SINGING = 0.5


def line_window(song: SongInfo, line: Line) -> tuple[float, float, float]:
    """The stretch of a song to split for one line: where it starts, how long it is, and when the
    next line begins. Worked out from the lyrics alone, so what's needed is known in advance."""
    later = [other.start for other in song.lines if other.start > line.start]
    origin = max(0.0, line.start - WINDOW_LEAD)
    next_start = later[0] if later else line.end + LINE_SEARCH_AFTER
    return origin, max(line.end, next_start) + WINDOW_TAIL - origin, next_start


def ride_lengths(a: SongInfo, end: float) -> tuple[int, ...]:
    """How many bars this ride could run, longest first, as far as A's own singing can carry it.

    The listener's favourite move, so it shouldn't be the same length on every song.
    """
    bar = a.period * a.beats_per_bar
    fit = []
    for bars in RIDE_LENGTHS:
        seconds = bars * bar
        if seconds > WINDOW_LEAD - 3.0:
            continue
        if a.vocal_seconds(end - seconds, end) / seconds >= MIN_RIDE_SINGING:
            fit.append(bars)
    return tuple(fit) or (8, 4)


def ride_lines(
    a: SongInfo, b: SongInfo, leave_after: float | None = None
) -> tuple[Line, Line] | None:
    """A line for A's voice to finish on, and the line B's voice should start with.

    A has to be singing through the ride, or there's no voice to carry over B's band. B starts best
    on the first line of a chorus, which then lands as A's voice ends.
    """
    out, into = ride_exit_line(a, leave_after), ride_entry_line(b)
    return (out, into) if out is not None and into is not None else None


def ride_exit_line(a: SongInfo, leave_after: float | None = None) -> Line | None:
    """The line A's voice is best off finishing a ride on, if it has one, with the ride starting
    no sooner than `leave_after`."""
    if not a.lines:
        return None
    ride = RIDE_BARS * a.period * a.beats_per_bar
    chorus_ends = {float(a.bar_time(bar)) for bar in a.chorus_end_bars()}
    best_a: tuple[float, Line] | None = None
    for line in a.lines:
        if line.start < 60.0 or a.duration - line.end < 15.0 or len(line.words) < 2:
            continue
        if leave_after is not None and line.end - ride < leave_after:
            continue
        sung = a.vocal_seconds(line.end - ride, line.end) / ride
        if sung < MIN_RIDE_SINGING:
            continue
        near_chorus_end = any(abs(line.end - end) < 4.0 for end in chorus_ends)
        score = sung + (0.5 if near_chorus_end else 0.0)
        if best_a is None or score > best_a[0]:
            best_a = (score, line)
    return best_a[1] if best_a else None


def ride_entry_line(b: SongInfo) -> Line | None:
    """The line B's voice is best off coming in on, if it has one."""
    if not b.lines:
        return None
    chorus_starts = {float(b.bar_time(bar)) for bar in b.chorus_start_bars()}
    best_b: tuple[float, Line] | None = None
    for i, line in enumerate(b.lines):
        if line.start > b.duration * 0.6 or b.duration - line.start < 60.0 or not line.words:
            continue
        if i and line.start - b.lines[i - 1].end < 0.15:
            continue
        near_chorus = any(abs(line.start - start) < 2.0 for start in chorus_starts)
        score = 1.0 if near_chorus else 0.4
        if line.start < WINDOW_LEAD:
            score -= 0.5
        if best_b is None or score > best_b[0]:
            best_b = (score, line)
    return best_b[1] if best_b else None


def modes_for(a: SongInfo, b: SongInfo, space: TimbreSpace | None = None) -> tuple[str, ...]:
    """Which hand-offs these two songs can really support, best first."""
    if space is not None:
        distance = space.distance(a, b)
        if distance is not None and distance > MAX_TIMBRE:
            return ()
    modes: list[str] = []
    gap = abs(a.bpm / b.bpm - 1.0)
    if flags.on("render.one_engine"):
        # rides lock half and double time to one pulse now, so the same limits read the folded gap
        gap = folded_gap(a, b)
    if (
        gap <= BLEND_MAX_GAP
        and camelot_distance(a.camelot, b.camelot) <= BLEND_MAX_KEY_DISTANCE
        and min(a.grid_confidence, b.grid_confidence) >= BLEND_MIN_GRID
        and a.beats_per_bar == b.beats_per_bar
    ):
        modes += ["word_blend", "word_exchange"]
    if roll_suits(a, b):
        modes.append("phrase_roll")
    if gap <= CUT_MAX_GAP:
        modes.append("word_cut")
    return tuple(modes)


def roll_suits(a: SongInfo, b: SongInfo) -> bool:
    """A stutter promises a drop, and B has to arrive on something. On the reels, every roll out of
    a rock song failed, and a hype song into a much slower one felt like a broken promise. Rolls
    across four or more keys were disliked almost every time, so those are out too."""
    return (
        a.family != "rock"
        and felt_bpm(b) >= felt_bpm(a) * ROLL_MIN_TEMPO_RATIO
        and camelot_distance(a.camelot, b.camelot) <= ROLL_MAX_KEYS
    )


def music_fit(a: SongInfo, b: SongInfo, space: TimbreSpace | None = None) -> float:
    """How well two songs meet, 0 to 1, apart from any words they share."""
    modes = modes_for(a, b, space)
    if not modes:
        return 0.0
    fit = MODE_PAYOFF[modes[0]]
    if space is not None:
        distance = space.distance(a, b)
        if distance is not None and distance > 1.0:
            fit *= 1.0 - (distance - 1.0) * 0.6
    return fit


def rank_links(
    links: list[LyricLink],
    songs: dict[int, SongInfo],
    space: TimbreSpace | None = None,
) -> list[LyricLink]:
    """Links between analysed songs, best first, by how good the words and the music are together.

    A link that would jump a long way in level at its own place in each song loses out too,
    whatever its words."""
    scored = []
    for link in links:
        a, b = songs.get(link.song_a), songs.get(link.song_b)
        if a is None or b is None:
            continue
        fit = music_fit(a, b, space)
        if fit <= 0.0:
            continue
        step = level_step(a, b, a.bar_at(link.line_a.end), b.bar_at(link.line_b.start))
        if step is not None and abs(step) > 6.0:
            continue
        scored.append((link.score * fit, link))
    scored.sort(key=lambda item: -item[0])
    return [link for _, link in scored]
