"""T0010: the fixture audio is deterministic and each named fixture behaves as its name says."""

import numpy as np
import soxr
from audio_fixtures import (
    INVALID_GRIDS,
    cue_bars,
    drifting,
    fallback_pair,
    off_grid_time,
    steady,
)
from helpers import song_from_track
from synth import SR

from selecta import audio
from selecta.analysis.beats import build_grid, onset_envelope, regularize
from selecta.analysis.features import FEATURE_SR
from selecta.planner.choose import choose_transition


def _env(track):
    mono = soxr.resample(audio.to_mono(track.audio), SR, FEATURE_SR)
    return onset_envelope(mono.astype(np.float32))


def test_fixture_audio_is_identical_every_time():
    first, again = steady(), steady()
    assert np.array_equal(first.audio, again.audio)
    assert np.array_equal(first.beats, again.beats)
    assert not np.array_equal(first.audio, steady(seed=2).audio)


def test_a_valid_grid_is_found_exactly():
    track = steady()
    grid = build_grid(track.beats, track.downbeats, _env(track))
    assert grid is not None and grid.constant_tempo
    assert abs(grid.bpm - 120) < 0.1
    assert np.max(np.abs(grid.beats - track.beats)) < 0.02


def test_a_drifting_grid_is_valid_but_not_steady():
    track = drifting()
    grid = build_grid(track.beats, track.downbeats, _env(track))
    assert grid is not None and not grid.constant_tempo
    assert grid.tempo_stability < 1.0


def test_invalid_grids_are_rejected_or_repaired():
    track = steady()
    env = _env(track)
    assert build_grid(INVALID_GRIDS["too_few"](track), track.downbeats, env) is None
    assert build_grid(INVALID_GRIDS["empty"](track), track.downbeats, env) is None
    for name in ("spurious", "gappy"):
        repaired = regularize(INVALID_GRIDS[name](track))
        assert repaired.size == track.beats.size, name
        assert np.max(np.abs(repaired - track.beats)) < 0.02, name


def test_cue_positions_sit_on_known_bars(tmp_path):
    track = steady()
    cues = cue_bars(track)
    for time in cues.values():
        assert np.min(np.abs(track.downbeats - time)) < 1e-9
    assert np.min(np.abs(track.beats - off_grid_time(track))) > 0.2
    song = song_from_track(tmp_path, "cues", track)
    for cue in song.entry_cues(min_remaining=10.0) + song.exit_cues(min_played=10.0):
        assert np.min(np.abs(track.downbeats - cue.time)) < 0.02, cue


def test_the_fallback_pair_falls_back_to_a_playable_exit(tmp_path):
    first, second = fallback_pair()
    a = song_from_track(tmp_path, "a", first)
    b = song_from_track(tmp_path, "b", second)
    choice = choose_transition(a, b, style="bass_swap_blend")
    assert choice.fell_back
    assert choice.rendered.audio.size > 0
