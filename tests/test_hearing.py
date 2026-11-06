"""Playing back what Selecta detected has to be true to what it detected."""

from __future__ import annotations

import json

import numpy as np
import pytest
import soundfile as sf
from helpers import song_from_track
from synth import make_track

import selecta.discovery.hearing as hearing
from selecta.config import SAMPLE_RATE, Settings
from selecta.discovery.hearing import (
    STEPS,
    _in_step,
    audition_folder,
    chord_name,
    chord_track,
    make_audition,
    read_chords,
)
from selecta.stems import cache_roots


def _bar(root: int, minor: bool = False) -> np.ndarray:
    bar = np.zeros(12)
    third = 3 if minor else 4
    bar[[root % 12, (root + third) % 12, (root + 7) % 12]] = 1.0
    return bar


@pytest.mark.parametrize("root", range(12))
@pytest.mark.parametrize("minor", [False, True])
def test_every_chord_is_read_as_itself(root, minor):
    assert read_chords(np.array([_bar(root, minor)])) == [(root, minor)]


def test_a_few_stray_notes_do_not_change_the_reading():
    noisy = _bar(9, True) + np.random.default_rng(1).random(12) * 0.15
    assert read_chords(np.array([noisy])) == [(9, True)]


def test_chords_get_the_names_a_musician_would_use():
    assert chord_name(0, False) == "C"
    assert chord_name(9, True) == "Am"
    assert chord_name(10, False) == "Bb"
    assert chord_name(6, True) == "F#m"


def _strongest_hertz(audio: np.ndarray) -> float:
    mono = audio.mean(axis=1)
    spectrum = np.abs(np.fft.rfft(mono * np.hanning(mono.size)))
    return float(np.fft.rfftfreq(mono.size, 1 / SAMPLE_RATE)[int(np.argmax(spectrum))])


def test_the_played_chord_is_the_chord_it_read():
    track = chord_track([(9, True)], np.array([0.0]), 2.0)
    mono = track.mean(axis=1)
    spectrum = np.abs(np.fft.rfft(mono * np.hanning(mono.size)))
    freqs = np.fft.rfftfreq(mono.size, 1 / SAMPLE_RATE)
    loud = freqs[spectrum > spectrum.max() * 0.4]
    notes = {int(round(12 * np.log2(f / 261.63))) % 12 for f in loud if f > 60}
    assert notes <= {9, 0, 4}, "only A, C and E"
    assert {9, 0, 4} & notes


def test_each_chord_starts_on_its_bar_and_the_track_keeps_its_length():
    track = chord_track([(0, False), (7, False)], np.array([0.5, 1.5]), 2.5)
    assert track.shape == (int(2.5 * SAMPLE_RATE), 2)
    assert np.abs(track[: int(0.49 * SAMPLE_RATE)]).max() == 0.0
    assert np.abs(track[int(0.55 * SAMPLE_RATE) : int(0.6 * SAMPLE_RATE)]).max() > 0.01
    after_change = track[int(1.55 * SAMPLE_RATE) :]
    assert _strongest_hertz(after_change) != _strongest_hertz(track[: int(1.45 * SAMPLE_RATE)])


def test_more_bars_than_chords_is_fine():
    assert chord_track([(0, False)], np.array([0.0, 1.0, 2.0]), 3.0).shape[0] == 3 * SAMPLE_RATE


def test_moving_a_passage_keeps_its_length_and_moves_its_pitch():
    seconds = np.arange(4 * SAMPLE_RATE) / SAMPLE_RATE
    tone = np.sin(2 * np.pi * 440.0 * seconds).astype(np.float32) * 0.5
    audio = np.stack((tone, tone), axis=1)
    moved = _in_step(audio, 2, 3.0)
    assert moved.shape == (3 * SAMPLE_RATE, 2)
    assert _strongest_hertz(moved) == pytest.approx(440.0 * 2 ** (2 / 12), abs=4.0)


@pytest.fixture
def pair(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=32, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=110, bars=32, seed=2))
    a.id, b.id = 1, 2
    rows = np.array([_bar(root) for root in (0, 5, 7, 9) * 8], dtype=np.float32)
    a.chroma_bars, b.chroma_bars = rows, np.roll(rows, 10, axis=1)
    return a, b


def _payload(a, b, transpose=2):
    a_times, b_times = a.bar_times, b.bar_times
    return {
        "a_bar": 4,
        "b_bar": 8,
        "bars": 8,
        "transpose": transpose,
        "a_at": float(a_times[4]),
        "a_end": float(a_times[12]),
        "b_at": float(b_times[8]),
        "b_end": float(b_times[16]),
    }


def test_an_audition_has_every_step_in_time_with_the_first_song(tmp_path, pair):
    a, b = pair
    settings = Settings(tmp_path / "home")
    info = make_audition(settings, 7, a, b, _payload(a, b))
    folder = audition_folder(settings, 7)
    seconds = float(a.bar_times[12] - a.bar_times[4])
    assert info["seconds"] == pytest.approx(seconds, abs=0.01)
    for step in STEPS:
        audio, rate = sf.read(folder / f"{step}.flac")
        assert rate == SAMPLE_RATE
        assert audio.shape[0] == pytest.approx(seconds * SAMPLE_RATE, abs=2)
        assert np.abs(audio).max() > 0.01, f"{step} should make a sound"
        assert np.abs(audio).max() <= 1.0


def test_an_audition_says_which_chord_is_on_which_bar(tmp_path, pair):
    a, b = pair
    info = make_audition(Settings(tmp_path / "home"), 7, a, b, _payload(a, b))
    assert info["chords"] == ["C", "F", "G", "A"] * 2
    assert len(info["bar_starts"]) == 8
    assert info["bar_starts"][0] == 0.0
    assert info["bar_starts"] == sorted(info["bar_starts"])
    assert info["bar_starts"][-1] < info["seconds"]


@pytest.mark.parametrize(("transpose", "semitones"), [(2, 2), (6, 6), (7, -5), (11, -1), (0, 0)])
def test_the_second_song_moves_the_shorter_way(
    tmp_path, pair, monkeypatch, transpose, semitones
):
    a, b = pair
    asked = []

    def noting(audio, moved_by, seconds):
        asked.append(moved_by)
        return audio[: int(seconds * SAMPLE_RATE)]

    monkeypatch.setattr(hearing, "_in_step", noting)
    settings = Settings(tmp_path / str(transpose))
    assert make_audition(settings, 7, a, b, _payload(a, b, transpose))["semitones"] == semitones
    assert asked == [semitones]


def test_an_audition_is_only_made_once(tmp_path, pair, monkeypatch):
    a, b = pair
    settings = Settings(tmp_path / "home")
    first = make_audition(settings, 7, a, b, _payload(a, b))

    def must_not_decode(*_args, **_kwargs):
        raise AssertionError("it's already made")

    monkeypatch.setattr(hearing, "decode", must_not_decode)
    assert make_audition(settings, 7, a, b, _payload(a, b)) == first


def test_auditions_count_as_cache_so_they_stay_under_the_storage_limit(tmp_path):
    settings = Settings(tmp_path)
    assert audition_folder(settings, 7).parent in cache_roots(settings)


def test_what_is_saved_is_plain_json(tmp_path, pair):
    a, b = pair
    settings = Settings(tmp_path / "home")
    info = make_audition(settings, 7, a, b, _payload(a, b))
    saved = json.loads((audition_folder(settings, 7) / "info.json").read_text("utf-8"))
    assert saved == info
