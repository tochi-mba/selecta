"""Whether two songs can carry a stem move, asked before anyone spends minutes splitting stems.

These are cheap checks on song facts only: tempo, key, beat grids and where the cues fall. The
splitting, listening and rendering that follow stay in `selecta.studio`, `selecta.arrange` and
`selecta.render.intertwine`, which import these from here.
"""

from __future__ import annotations

from dataclasses import dataclass

from selecta.analysis.key import camelot_distance
from selecta.analysis.song import Cue, SongInfo
from selecta.planner_core.choose import tempo_gap
from selecta.planner_core.wordreel import modes_for

# ---- the Seam Studio's placement (selecta.studio)

STUDIO_OVERLAP_BARS = (16, 12, 8)
STUDIO_MAX_TEMPO_GAP = 0.08
STUDIO_MIN_GRID = 0.55


@dataclass(frozen=True)
class Placement:
    exit_cue: Cue
    entry_cue: Cue
    bars: int


def find_placement(
    a: SongInfo,
    b: SongInfo,
    exit_bar: int | None = None,
    entry_bar: int | None = None,
    leave_after: float | None = None,
) -> Placement | None:
    """Where these two can overlap, longest first. Long overlaps are the ones the listener likes."""
    if abs(a.bpm / b.bpm - 1.0) > STUDIO_MAX_TEMPO_GAP or a.beats_per_bar != b.beats_per_bar:
        return None
    if min(a.grid_confidence, b.grid_confidence) < STUDIO_MIN_GRID:
        return None
    exits = [c for c in a.exit_cues() if exit_bar is None or c.bar == exit_bar] or a.exit_cues()
    entries = [c for c in b.entry_cues() if entry_bar is None or c.bar == entry_bar]
    entries = entries or b.entry_cues()
    for bars in STUDIO_OVERLAP_BARS:
        beats = bars * a.beats_per_bar
        for exit_cue in exits:
            if exit_cue.bar < bars // 2:
                continue
            if leave_after is not None and a.bar_time(exit_cue.bar - bars // 2) < leave_after:
                continue
            if a.beat_index_of_bar(exit_cue.bar - bars // 2) + beats >= len(a.beats):
                continue
            for entry_cue in entries:
                if b.beat_index_of_bar(entry_cue.bar) + beats < len(b.beats):
                    return Placement(exit_cue, entry_cue, bars)
    return None


# ---- strip and land (selecta.arrange)

ARRANGE_CLOSE_TEMPO = 0.045
ARRANGE_SHORTEST_OVERLAP = 12
ARRANGE_MIN_GRID = 0.8


def can_arrange(a: SongInfo, b: SongInfo) -> bool:
    """Cheap checks before spending minutes splitting stems."""
    return why_it_cant(a, b) is None


def why_it_cant(a: SongInfo, b: SongInfo) -> str | None:
    gap = tempo_gap(a, b)
    if gap > ARRANGE_CLOSE_TEMPO:
        return f"The songs are {gap:.0%} apart in tempo, too far to play their parts together."
    if min(a.grid_confidence, b.grid_confidence) < ARRANGE_MIN_GRID:
        return "This needs a steadier beat in both songs."
    if "word_blend" not in modes_for(a, b):
        return "These two are too far apart in key for their melodies to overlap."
    place = find_placement(a, b)
    if place is None or place.bars < ARRANGE_SHORTEST_OVERLAP:
        return "These two don't have enough clear bars to line their stems up."
    return None


# ---- intertwined stems (selecta.render.intertwine)


def intertwine_cues(a: SongInfo, b: SongInfo) -> tuple[Cue, Cue] | None:
    """Where sixteen bars of both songs can trade layers, or None if they can't."""
    if abs(a.bpm / b.bpm - 1.0) > 0.03:
        return None
    if min(a.grid_confidence, b.grid_confidence) < 0.55:
        return None
    if a.beats_per_bar != b.beats_per_bar or camelot_distance(a.camelot, b.camelot) > 1:
        return None
    exits, entries = a.exit_cues(), b.entry_cues()
    if not exits or not entries:
        return None
    beats = 16 * a.beats_per_bar
    for exit_cue in exits:
        if exit_cue.bar < 8:
            continue
        a_index = a.beat_index_of_bar(exit_cue.bar - 8)
        if a_index + beats >= len(a.beats):
            continue
        for entry_cue in entries:
            b_index = b.beat_index_of_bar(entry_cue.bar)
            if b_index + beats < len(b.beats):
                return exit_cue, entry_cue
    return None


def can_intertwine(a: SongInfo, b: SongInfo) -> bool:
    """Cheap musical and phrase-length gates, before the expensive stem separation."""
    return intertwine_cues(a, b) is not None
