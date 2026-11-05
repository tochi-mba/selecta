import numpy as np
from helpers import song_from_track
from synth import make_track

from selecta.config import SAMPLE_RATE
from selecta.render.intertwine import _curve, _fit, can_intertwine


def test_automation_scales_with_musical_duration():
    curve = _curve(SAMPLE_RATE * 32, [(0, 0), (14, 1), (28, 0)])
    assert abs(float(curve[SAMPLE_RATE * 16, 0]) - 1) < 0.001
    assert curve.shape == (SAMPLE_RATE * 32, 1)


def test_short_stems_are_padded_without_changing_channels():
    source = np.ones((100, 2), dtype=np.float32)
    fitted = _fit(source, 1)
    assert fitted.shape == (SAMPLE_RATE, 2)
    assert np.all(fitted[:100] == 1)
    assert np.all(fitted[100:] == 0)


def test_intertwine_gate_requires_compatible_tracks_and_sixteen_bars(tmp_path):
    a = song_from_track(tmp_path, "intertwine-a", make_track(bpm=120, bars=64, seed=1))
    b = song_from_track(tmp_path, "intertwine-b", make_track(bpm=121, bars=64, seed=2))
    assert can_intertwine(a, b)

    b.bpm = 130
    assert not can_intertwine(a, b)

    b.bpm = 121
    b.grid_confidence = 0.4
    assert not can_intertwine(a, b)
