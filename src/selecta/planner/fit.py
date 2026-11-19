"""Whether two songs belong next to each other, measured before anything is rendered.

The first reel's four tempo-free moves all rated badly, and each had joined songs a DJ wouldn't:
a club track into a ballad's intro at a 32% tempo gap, a folk song into trap. Effects can't rescue
a pairing like that, so these checks come first.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

import numpy as np

from selecta.analysis.song import SongInfo

MAX_FOLDED_GAP = 0.16
"""The widest tempo gap a tempo-free move may cross, after folding half and double time."""

MAX_LEVEL_STEP_DB = 4.0
COLD_ENTRY_DB = -3.0
"""A section this far below a song's usual level is an intro or a breakdown, not a landing."""

# The limits below all come from the listener's own ratings (66 seams, re-checked 2026-11-17).
# Every module that gates a move reads them from here, so a limit can't quietly drift apart
# between the planner, the word rules and the fallback path.
CLOSE_TEMPO = 0.045
"""Overlaps within this tempo gap were liked 16 times in 19; beyond it, once in 10."""
FAR_KEYS = 5
"""Songs five or more Camelot steps apart were liked twice in 11, whatever the move."""
STEADY_GRID = 0.8
"""Every rated seam where either beat grid sat between 0.55 and 0.8 was disliked (0 of 6), so
beat-locked moves need this much confidence. Less sure songs still get tempo-free moves."""
MIN_OVERLAP_BARS = 8
"""Every rated 4-bar overlap was disliked (0 of 7); 8 bars or more were liked 16 times in 21."""
ROLL_MAX_GAP = 0.15
ROLL_MAX_KEYS = 3
"""Rolls within 15% tempo and 3 keys were liked 4 times in 5; outside that, 4 in 14."""

_TIMBRE_COEFFICIENTS = slice(1, 14)
_TIMBRE_WIDTH = _TIMBRE_COEFFICIENTS.stop


def folded_gap(a: SongInfo, b: SongInfo) -> float:
    """The tempo gap as it feels, since trackers and producers both double and halve."""
    return min(abs(a.bpm * ratio / b.bpm - 1.0) for ratio in (0.5, 1.0, 2.0))


def fold_ratio(a: SongInfo, b: SongInfo) -> float:
    """How many of B's beats pass for each of A's: 2 against a double-time B, 0.5 against a
    half-time one, 1 otherwise. An 87 BPM song and a 174 BPM one share a single pulse, which is
    how a DJ crosses from hip-hop to drum and bass without touching the pitch."""
    return min((1.0, 2.0, 0.5), key=lambda ratio: abs(a.bpm * ratio / b.bpm - 1.0))


def relative_level(song: SongInfo, first_bar: int, last_bar: int) -> float | None:
    """How loud these bars are against the song's own usual level, in dB."""
    if song.rms_db_bars is None or song.rms_db_bars.size == 0:
        return None
    block = song.rms_db_bars[max(first_bar, 0) : max(last_bar, 0)]
    return float(block.mean() - np.median(song.rms_db_bars)) if block.size else None


def level_step(a: SongInfo, b: SongInfo, exit_bar: int, entry_bar: int) -> float | None:
    """How much louder B's first bars are than A's last, after each song's loudness match."""
    if a.rms_db_bars is None or b.rms_db_bars is None:
        return None
    before = a.rms_db_bars[max(exit_bar - 4, 0) : exit_bar]
    after = b.rms_db_bars[entry_bar : entry_bar + 4]
    if before.size == 0 or after.size == 0:
        return None
    return float((after.mean() + b.gain_db) - (before.mean() + a.gain_db))


def _timbre(song: SongInfo) -> np.ndarray | None:
    bars = song.mfcc_bars
    # too few coefficients (an older or partial analysis) would give a shorter vector than the
    # rest of the library, and np.stack refuses mixed widths, so such a song has no timbre
    if bars is None or bars.ndim != 2 or bars.shape[0] == 0 or bars.shape[1] < _TIMBRE_WIDTH:
        return None
    return bars[:, _TIMBRE_COEFFICIENTS].mean(axis=0)


@dataclass
class TimbreSpace:
    """Distances scaled so 1.0 means a typical pair from this library."""

    mean: np.ndarray
    scale: np.ndarray
    typical: float

    @classmethod
    def fit(cls, songs: Iterable[SongInfo]) -> TimbreSpace | None:
        found = [vector for vector in map(_timbre, songs) if vector is not None]
        if len(found) < 4:
            return None
        vectors = np.stack(found)
        mean, scale = vectors.mean(axis=0), vectors.std(axis=0) + 1e-6
        scaled = (vectors - mean) / scale
        distances = np.sqrt(((scaled[:, None] - scaled[None]) ** 2).sum(-1))
        typical = float(np.median(distances[np.triu_indices(len(found), 1)]))
        return cls(mean, scale, typical or 1.0)

    def distance(self, a: SongInfo, b: SongInfo) -> float | None:
        va, vb = _timbre(a), _timbre(b)
        if va is None or vb is None:
            return None
        return float(np.sqrt((((va - vb) / self.scale) ** 2).sum()) / self.typical)
