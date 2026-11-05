"""Word boundaries and the safety gate used before a word can become a cut point."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from selecta.lyrics.lrclib import Line


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float
    confidence: float


def provisional_words(line: Line) -> list[Word]:
    """A line-level fallback for highlighting only; never trusted for audio cuts."""
    words = line.words
    weights = np.array([max(1, len(word)) for word in words], dtype=float)
    edges = np.r_[0.0, np.cumsum(weights) / max(weights.sum(), 1)]
    return [
        Word(
            word,
            line.start + edges[i] * (line.end - line.start),
            line.start + edges[i + 1] * (line.end - line.start),
            0.25,
        )
        for i, word in enumerate(words)
    ]


def energy_minimum_boundary(
    envelope: np.ndarray, guess: float, sample_rate: int, reach: float = 0.08
) -> float:
    centre = int(guess * sample_rate)
    radius = int(reach * sample_rate)
    lo, hi = max(0, centre - radius), min(envelope.size, centre + radius + 1)
    return (lo + int(np.argmin(envelope[lo:hi]))) / sample_rate if hi > lo else guess


def cut_safe(word: Word, minimum_confidence: float = 0.7) -> bool:
    return word.confidence >= minimum_confidence and word.end - word.start >= 0.08
