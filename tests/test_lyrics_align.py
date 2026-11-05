from __future__ import annotations

import numpy as np

from selecta.lyrics.align import Word, cut_safe, energy_minimum_boundary, provisional_words
from selecta.lyrics.lrclib import Line


def test_provisional_words_fill_line_but_are_never_cut_safe():
    words = provisional_words(Line(10.0, 14.0, "hold this exact position"))
    assert words[0].start == 10.0
    assert words[-1].end == 14.0
    assert all(not cut_safe(word) for word in words)


def test_verified_words_and_energy_minimum_are_cut_safe():
    envelope = np.ones(1000)
    envelope[490] = 0
    boundary = energy_minimum_boundary(envelope, 0.5, 1000, 0.02)
    assert boundary == 0.49
    assert cut_safe(Word("night", boundary, 0.8, 0.9))
    assert not cut_safe(Word("x", 0.0, 0.05, 0.99))
