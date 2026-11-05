import numpy as np

from selecta.config import SAMPLE_RATE
from selecta.render.intertwine import _curve, _fit


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
