import numpy as np
import soundfile as sf
from helpers import song_from_track
from synth import make_track

from selecta.config import SAMPLE_RATE, Settings
from selecta.render.intertwine import _curve, _fit, can_intertwine, render_intertwined
from selecta.stems import StemWindow


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


def test_intertwined_render_swaps_layers_and_vocals_in_the_audio(tmp_path, monkeypatch):
    a = song_from_track(tmp_path, "render-intertwine-a", make_track(bpm=120, bars=64, seed=3))
    b = song_from_track(tmp_path, "render-intertwine-b", make_track(bpm=120, bars=64, seed=4))
    a.lufs = -16.0
    b.lufs = -12.0
    calls = 0

    def separate(_settings, _source, _start, duration):
        nonlocal calls
        calls += 1
        folder = tmp_path / f"stem-window-{calls}"
        folder.mkdir()
        length = int(round(duration * SAMPLE_RATE))
        paths = {}
        for index, name in enumerate(("vocals", "drums", "bass", "other"), 1):
            path = folder / f"{name}.wav"
            audio = np.full((length, 2), index * 0.01, dtype=np.float32)
            sf.write(path, audio, SAMPLE_RATE)
            paths[name] = path
        return StemWindow(**paths)

    def stretch(source, output, _source_times, _origin):
        count = int(round((output[-1] - output[0]) * SAMPLE_RATE))
        fitted = np.zeros((count, 2), dtype=np.float32)
        fitted[: min(count, source.shape[0])] = source[: min(count, source.shape[0])]
        return fitted, 0.0

    monkeypatch.setattr("selecta.render.intertwine.separate_window", separate)
    monkeypatch.setattr("selecta.render.intertwine.dsp.stretch_to_warp", stretch)

    result = render_intertwined(Settings(tmp_path), a, b)

    assert calls == 2
    assert result.audio.shape[0] == result.a_dry.shape[0] == result.b_dry.shape[0]
    assert np.max(np.abs(result.b_dry[: SAMPLE_RATE])) < 1e-5
    assert np.max(np.abs(result.a_dry[-SAMPLE_RATE:])) < 1e-5
    assert result.a_vocal.sample(result.audio.shape[0], SAMPLE_RATE)[-1] == 0
    assert result.b_vocal.sample(result.audio.shape[0], SAMPLE_RATE)[-1] == 1
    a_level = float(np.mean(np.abs(result.a_dry[:SAMPLE_RATE])))
    b_level = float(np.mean(np.abs(result.b_dry[-SAMPLE_RATE:])))
    assert abs(b_level / a_level - 10 ** (-3 / 20)) < 0.01
