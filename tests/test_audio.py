import numpy as np
import soundfile as sf
from synth import SR, make_track

from selecta import audio


def test_decode_matches_the_source_exactly(tmp_path):
    track = make_track(bars=4)
    path = tmp_path / "song.flac"
    sf.write(path, track.audio, SR, subtype="PCM_24")

    decoded = audio.decode(path)

    assert decoded.shape == track.audio.shape
    assert np.max(np.abs(decoded - track.audio)) < 1e-4


def test_seek_is_sample_accurate(tmp_path):
    track = make_track(bars=4)
    path = tmp_path / "song.flac"
    sf.write(path, track.audio, SR, subtype="PCM_24")

    window = audio.decode(path, start=1.0, duration=0.5)

    expected = track.audio[SR : SR + SR // 2]
    assert window.shape == expected.shape
    assert np.max(np.abs(window - expected)) < 1e-4
