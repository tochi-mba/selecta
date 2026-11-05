from __future__ import annotations

import numpy as np

from selecta.config import SAMPLE_RATE
from selecta.render.setmix import join


def test_join_crossfades_without_changing_channels():
    a = np.ones((SAMPLE_RATE, 2), dtype=np.float32)
    b = np.zeros((SAMPLE_RATE, 2), dtype=np.float32)
    mixed = join([a, b], seam_seconds=0.1)
    assert mixed.shape == (int(1.9 * SAMPLE_RATE), 2)
    seam = mixed[int(0.9 * SAMPLE_RATE) : SAMPLE_RATE]
    assert seam[0, 0] > seam[-1, 0]


def test_join_accepts_short_transition_pieces():
    a = np.ones((100, 2), dtype=np.float32)
    b = np.zeros((50, 2), dtype=np.float32)
    assert join([a, b]).shape[1] == 2
