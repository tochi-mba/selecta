import numpy as np
import pytest
import soundfile as sf
from helpers import song_from_track
from synth import make_track

from selecta.analysis.song import Cue
from selecta.config import SAMPLE_RATE, Settings
from selecta.render.intertwine import (
    _curve,
    _fit,
    _pair_that_fits,
    _read,
    can_intertwine,
    render_intertwined,
)
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

    b.grid_confidence = 0.95
    b.camelot = "1A"
    assert not can_intertwine(a, b)

    b.camelot = "8A"
    b.beats_per_bar = 3
    assert not can_intertwine(a, b)

    b.beats_per_bar = 4
    a.exit_cues = lambda: []
    assert not can_intertwine(a, b)

    a.exit_cues = lambda: [Cue(32, a.bar_time(32), "phrase", 0.8, 8)]
    b.entry_cues = lambda: []
    assert not can_intertwine(a, b)


def test_intertwine_gate_skips_cues_without_room_until_it_finds_a_valid_pair(tmp_path):
    a = song_from_track(tmp_path, "cue-room-a", make_track(bpm=120, bars=64, seed=1))
    b = song_from_track(tmp_path, "cue-room-b", make_track(bpm=120, bars=64, seed=2))
    outgoing = [
        Cue(4, a.bar_time(4), "too early", 1.0, 0),
        Cue(60, a.bar_time(60), "too late", 0.9, 0),
        Cue(32, a.bar_time(32), "fits", 0.8, 0),
    ]
    incoming = [
        Cue(56, b.bar_time(56), "too late", 0.9, 0),
        Cue(0, b.bar_time(0), "fits", 0.8, 0),
    ]
    a.exit_cues = lambda: outgoing
    b.entry_cues = lambda: incoming

    assert _pair_that_fits(a, b) == (outgoing[-1], incoming[-1])

    a.exit_cues = lambda: [Cue(32, a.bar_time(32), "fits", 0.8, 0)]
    b.entry_cues = lambda: [Cue(56, b.bar_time(56), "too late", 0.9, 0)]
    assert _pair_that_fits(a, b) is None


def test_intertwine_read_rejects_a_wrong_sample_rate(monkeypatch, tmp_path):
    monkeypatch.setattr("selecta.render.intertwine.sf.read", lambda *_args, **_kwargs: ([], 48000))

    with pytest.raises(ValueError, match="unexpected stem rate 48000"):
        _read(tmp_path / "wrong-rate.wav")


def test_short_stems_are_stretched_before_being_padded(monkeypatch):
    source = np.ones((SAMPLE_RATE, 2), dtype=np.float32)
    seen = {}

    def stretch(audio, output, source_points, origin):
        seen["output"] = output
        seen["source"] = source_points
        seen["origin"] = origin
        return np.full((SAMPLE_RATE * 2, 2), 0.5, dtype=np.float32), 0.0

    monkeypatch.setattr("selecta.render.intertwine.dsp.stretch_to_warp", stretch)

    fitted = _fit(source, 2, speed=1.1)

    assert fitted.shape == (SAMPLE_RATE * 2, 2)
    assert fitted[0, 0] == 0.5
    assert np.array_equal(seen["output"], [0, 2])
    assert np.array_equal(seen["source"], [0, 2.2])
    assert seen["origin"] == 0


def test_intertwined_render_rejects_an_ineligible_pair_before_separating(tmp_path, monkeypatch):
    a = song_from_track(tmp_path, "ineligible-a", make_track(bpm=120, bars=64, seed=1))
    b = song_from_track(tmp_path, "ineligible-b", make_track(bpm=130, bars=64, seed=2))
    monkeypatch.setattr(
        "selecta.render.intertwine.separate_window",
        lambda *_: pytest.fail("ineligible pairs must not start stem separation"),
    )

    with pytest.raises(ValueError, match="tempo, grid, key, or phrase checks"):
        render_intertwined(Settings(tmp_path), a, b)


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
