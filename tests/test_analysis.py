import numpy as np
import pytest
import soxr
from synth import SR, make_track

from selecta import audio
from selecta.analysis import beats as beats_module
from selecta.analysis.beats import build_grid, fit_bars, onset_envelope, regularize
from selecta.analysis.features import FEATURE_SR, extract, segment
from selecta.analysis.key import camelot, camelot_distance, chroma_key, keys_compatible


def _env(track):
    mono = soxr.resample(audio.to_mono(track.audio), SR, FEATURE_SR).astype(np.float32)
    return mono, onset_envelope(mono)


def test_regularize_drops_extra_beats_and_fills_gaps():
    beats = np.arange(0, 32) * 0.5
    noisy = np.sort(np.concatenate((np.delete(beats, [10, 11]), [5.2])))

    fixed = regularize(noisy)

    assert fixed.size == beats.size
    assert np.max(np.abs(fixed - beats)) < 0.26


def test_steady_track_snaps_to_a_grid_within_the_audible_limit():
    track = make_track(bpm=124)
    _, env = _env(track)
    rng = np.random.default_rng(1)
    raw = np.round((track.beats + rng.normal(0, 0.006, track.beats.size)) / 0.02) * 0.02

    grid = build_grid(raw, track.downbeats, env)

    assert grid.constant_tempo
    assert abs(grid.bpm - 124) < 0.2
    errors = np.abs(grid.beats - track.beats)
    assert np.median(errors) < 0.012
    assert np.max(errors) < 0.02


def test_drifting_track_keeps_following_the_beat():
    track = make_track(bpm=100, drift=0.03)
    _, env = _env(track)

    grid = build_grid(track.beats, track.downbeats, env)

    assert not grid.constant_tempo
    assert np.median(np.abs(grid.beats - track.beats)) < 0.012
    assert grid.tempo_stability < 1.0


def test_bars_land_on_downbeats_and_can_shift_phase():
    beats = np.arange(64) * 0.5
    first = np.arange(0, 32, 4)
    second = np.arange(34, 64, 4)
    downbeats = beats[np.concatenate((first, second))]

    bars, meter, regularity = fit_bars(beats, downbeats)

    assert meter == 4
    assert regularity > 0.9
    assert set(first) <= set(bars.tolist())
    assert set(second) <= set(bars.tolist())


def test_waltz_is_recognised():
    beats = np.arange(48) * 0.5
    bars, meter, _ = fit_bars(beats, beats[::3])
    assert meter == 3
    assert np.all(np.diff(bars) == 3)


def test_camelot_wheel_known_values():
    assert camelot("A minor") == "8A"
    assert camelot("C major") == "8B"
    assert camelot("F# minor") == "11A"
    assert camelot("Ab major") == "4B"
    assert camelot_distance("8A", "8B") == 1
    assert camelot_distance("12A", "1A") == 1
    assert camelot_distance("8A", "2A") == 6
    assert keys_compatible("A minor", "C major")
    assert not keys_compatible("C major", "F# major")


def test_chroma_key_recovers_a_triad_heavy_profile():
    profile = np.zeros(12)
    profile[[0, 4, 7]] = 1.0
    profile[[2, 5, 9, 11]] = 0.3
    assert chroma_key(profile) == "C major"


def test_segment_finds_the_change_between_two_different_blocks():
    a = np.ones((16, 1)) @ np.array([[1.0, 0.0]])
    b = np.ones((16, 1)) @ np.array([[0.0, 1.0]])
    matrix = np.vstack((a, b))
    similarity = matrix @ matrix.T

    assert (16, 32) in segment(similarity)


def test_features_line_up_with_bars():
    track = make_track(bpm=120, bars=24)
    mono, _ = _env(track)
    bars = track.downbeats
    duration = track.audio.shape[0] / SR

    features = extract(mono, bars, duration)

    assert features.chroma_bars.shape == (bars.size, 12)
    assert features.energy_bars.shape == (bars.size,)
    assert 0.0 <= features.energy <= 1.0
    assert features.sections[0]["start_bar"] == 0
    assert features.sections[-1]["end_bar"] == bars.size


@pytest.mark.slow
def test_full_pipeline_on_a_synthetic_track_with_the_real_models(tmp_path):
    from selecta.analysis.key import KeyDetector
    from selecta.analysis.pipeline import Analysers, analyse_audio
    from selecta.config import load_settings

    settings = load_settings()
    track = make_track(bpm=128, bars=40, root_hz=110.0, minor=True)
    analysers = Analysers(
        beats=beats_module.BeatTracker("small0"), key=KeyDetector(settings.models_dir)
    )

    result = analyse_audio(track.audio, analysers)

    assert abs(result.grid.bpm - 128) < 0.5
    assert np.median(np.abs(result.grid.beats[:64] - track.beats[:64])) < 0.02
    assert result.lufs < 0
