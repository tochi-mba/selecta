"""One drummer when the patterns fight (docs/research/transition-craft-2.md, 2.3).

Beat-locking checks that two songs' beats line up, never whether their drum patterns reinforce
each other. Four on the floor over a broken beat, or straight eighths over a swung groove, clash
even with the beats locked. A DJ lets only one song's drums sound while the patterns fight.

This compares the two songs' stored bar patterns (`features.rhythm_bars`: a 16-step onset
pattern of the low band, then of the high band, and a swing number per bar) over the bars that
will play together. A song analysed before the patterns existed has none, and gets no opinion.
Every number here is provisional: no rated seam has tested it yet.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from selecta import flags
from selecta.analysis.song import SongInfo
from selecta.planner_core.fit import fold_ratio

STEPS = 16
"""Steps per band in a stored bar pattern (`features.PATTERN_STEPS`)."""

CLASH_BELOW = 0.5
"""Patterns less alike than this fight. On the synthetic design pairs a four-on-the-floor house
groove against itself scored about 1.0, against a broken beat or a swung groove well under this.
Provisional until the owner has listened."""
SWING_FREE = 0.03
"""A swing gap this small is the same feel."""
SWING_WEIGHT = 3.0
"""How much a swing gap beyond that counts: straight against triplet swing (0.5 against 0.67)
takes about 0.4 off the similarity."""
ONE_DRUMMER_COST = 0.06
"""What a clash still costs a bass-swap blend built in its one-drummer form: without stems the
handover is by frequency band, and the snare's body and the mids still overlap."""
DRUM_CLASH_COST = 0.15
"""What a clash costs a beat-locked move with no one-drummer form, at its worst."""


@dataclass(frozen=True)
class RhythmFit:
    similarity: float
    """About 1 for the same pattern, near 0 or below for patterns that fight."""
    pattern: float
    """The mean correlation of the two bands' step patterns."""
    swing_gap: float | None
    """How far apart the two swings sit, or None where it isn't compared (half or double time)."""


def _squeeze(mean: np.ndarray) -> np.ndarray:
    """A bar pattern heard at twice its speed: each band's 16 steps pooled in pairs, twice over,
    so one bar of a double-time song lines up with one bar of the other."""
    out = []
    for band in range(mean.size // STEPS):
        steps = mean[band * STEPS : (band + 1) * STEPS]
        half = np.maximum(steps[0::2], steps[1::2])
        out.append(np.concatenate((half, half)))
    return np.concatenate(out)


def _correlation(x: np.ndarray, y: np.ndarray) -> float | None:
    if float(x.std()) < 1e-3 or float(y.std()) < 1e-3:
        return None
    return float(np.corrcoef(x, y)[0, 1])


def rhythm_fit(
    a: SongInfo, b: SongInfo, exit_bar: int, entry_bar: int, bars: int
) -> RhythmFit | None:
    """How alike the two songs' drums are over the overlap: A's bars before the exit, B's after
    its entry, B's count scaled by `fold_ratio`. None where either song has no pattern or the
    bars hold no drums to compare: no opinion."""
    if a.pattern_bars is None or b.pattern_bars is None or bars <= 0:
        return None
    fold = fold_ratio(a, b)
    b_bars = max(int(round(bars * fold)), 1)
    a_block = a.pattern_bars[max(exit_bar - bars, 0) : max(exit_bar, 0)]
    b_block = b.pattern_bars[max(entry_bar, 0) : max(entry_bar, 0) + b_bars]
    if a_block.size == 0 or b_block.size == 0:
        return None
    a_mean, b_mean = a_block.mean(axis=0), b_block.mean(axis=0)
    if fold > 1.0:
        b_mean = _squeeze(b_mean)
    elif fold < 1.0:
        a_mean = _squeeze(a_mean)
    heard = []
    for band in range(a_mean.size // STEPS):
        # a band either song leaves empty (no hats, say) has nothing to fight with
        steps = slice(band * STEPS, (band + 1) * STEPS)
        value = _correlation(a_mean[steps], b_mean[steps])
        if value is not None:
            heard.append(value)
    if not heard:
        return None
    pattern = float(np.mean(heard))
    swing_gap = None
    if fold == 1.0 and a.swing_bars is not None and b.swing_bars is not None:
        # swing is a share of one beat, so it only compares at one pulse
        a_swing = a.swing_bars[max(exit_bar - bars, 0) : max(exit_bar, 0)]
        b_swing = b.swing_bars[max(entry_bar, 0) : max(entry_bar, 0) + b_bars]
        if a_swing.size and b_swing.size:
            swing_gap = abs(float(np.median(a_swing)) - float(np.median(b_swing)))
    similarity = pattern - SWING_WEIGHT * max((swing_gap or 0.0) - SWING_FREE, 0.0)
    return RhythmFit(round(similarity, 4), round(pattern, 4), swing_gap)


def clash_severity(fit: RhythmFit | None) -> float:
    """0 for patterns that sit together, rising to 1 as they fight harder."""
    if fit is None or fit.similarity >= CLASH_BELOW:
        return 0.0
    return float(min((CLASH_BELOW - fit.similarity) / CLASH_BELOW, 1.0))


def one_drummer(a: SongInfo, b: SongInfo, exit_bar: int, entry_bar: int, bars: int) -> bool:
    """Whether a blend over these bars should let only one song's drums sound at a time. Always
    False with `planner.rhythm_fit` off, so nothing is read and no script changes."""
    if not flags.on("planner.rhythm_fit"):
        return False
    return clash_severity(rhythm_fit(a, b, exit_bar, entry_bar, bars)) > 0.0
