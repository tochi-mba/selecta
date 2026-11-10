"""SF-0214-05: the Listen waveform is the song's own measured loudness envelope, not a drawing."""

import numpy as np

from selecta.analysis.features import waveform_peaks


def test_peaks_follow_the_audio_and_silence_stays_flat():
    rate = 1000
    t = np.arange(rate * 4) / rate
    tone = np.sin(2 * np.pi * 50 * t)
    mono = np.concatenate([np.zeros(rate * 4), tone * 0.25, tone]).astype(np.float32)
    peaks = waveform_peaks(mono, bins=12)
    assert peaks.dtype == np.uint8 and peaks.size == 12
    assert peaks[:4].tolist() == [0, 0, 0, 0]
    assert all(60 <= value <= 68 for value in peaks[4:8])
    assert peaks[8:].tolist() == [255, 255, 255, 255]


def test_same_audio_gives_the_same_peaks():
    rng = np.random.default_rng(7)
    mono = rng.standard_normal(48000).astype(np.float32)
    assert np.array_equal(waveform_peaks(mono, bins=40), waveform_peaks(mono.copy(), bins=40))


def test_all_silence_is_flat_rather_than_invented():
    assert waveform_peaks(np.zeros(9000, dtype=np.float32), bins=9).tolist() == [0] * 9
