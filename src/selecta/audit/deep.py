"""Slow checks that listen to separated stems, run only on transitions about to be kept.

Lyric files miss a lot of singing: chops, ad-libs, and whole vocal hooks in dance tracks. The one
blend that rated badly on the first reel passed the lyric-based overlap check at zero seconds, and
its separated stems showed both voices going at once.
"""

from __future__ import annotations

import numpy as np

from selecta.audit.checks import Check
from selecta.config import SAMPLE_RATE
from selecta.render.engine import Rendered
from selecta.stems import separate_audio

SUNG_OVERLAP_LIMIT = 3.5
AUDIBLE_VOCAL_DB = -30.0
"""On the first reel the good blends measured 0 to 2.8 s at this level and the bad one 4.4 s.
That's one bad example, so treat the limit as a starting value."""
_FRAME_SECONDS = 0.05


def audible_frames(vocal: np.ndarray, floor_db: float = AUDIBLE_VOCAL_DB) -> np.ndarray:
    """Which short frames have a voice loud enough to hear, smoothed so one quiet consonant
    doesn't count as the singer having stopped."""
    mono = vocal.mean(axis=1) if vocal.ndim == 2 else vocal
    frame = int(_FRAME_SECONDS * SAMPLE_RATE)
    usable = mono.size - mono.size % frame
    if usable == 0:
        return np.zeros(0, dtype=bool)
    rms = np.sqrt(np.mean(mono[:usable].reshape(-1, frame) ** 2, axis=1))
    loud = 20.0 * np.log10(np.maximum(rms, 1e-7)) >= floor_db
    width = 5
    return np.convolve(loud, np.ones(width), mode="same") >= 2


def sung_overlap_seconds(vocal_a: np.ndarray, vocal_b: np.ndarray) -> float:
    a, b = audible_frames(vocal_a), audible_frames(vocal_b)
    count = min(a.size, b.size)
    return float((a[:count] & b[:count]).sum() * _FRAME_SECONDS)


def sung_overlap(rendered: Rendered) -> Check | None:
    """How long two voices really sing at once, faders included, measured on separated vocals."""
    start, end = rendered.script.overlap
    if end - start < 2.0:
        return None
    lo, hi = int(start * SAMPLE_RATE), int(end * SAMPLE_RATE)
    vocal_a = separate_audio(rendered.a_dry[lo:hi])["vocals"]
    vocal_b = separate_audio(rendered.b_dry[lo:hi])["vocals"]
    seconds = sung_overlap_seconds(vocal_a, vocal_b)
    return Check(
        "sung overlap",
        seconds <= SUNG_OVERLAP_LIMIT,
        round(seconds, 2),
        SUNG_OVERLAP_LIMIT,
        "s",
        fix="move_cue",
    )
