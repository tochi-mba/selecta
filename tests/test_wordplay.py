"""Word links, word timing and the cuts built on them, using synthetic audio only."""

import numpy as np
import pytest
import soundfile as sf
from helpers import song_from_track
from synth import SR, make_track

from selecta.audit.checks import audit
from selecta.audit.deep import sung_overlap_seconds
from selecta.lyrics.align import (
    Word,
    agreement,
    best_path,
    settle_edges,
    spell,
    word_starts_heard,
    words_from_path,
)
from selecta.lyrics.lrclib import Line
from selecta.lyrics.match import SongFacts, discover
from selecta.render.engine import render
from selecta.stems import _prune
from selecta.styles.wordplay import VocalWindow, word_cut, word_echo, word_roll

LATE = 60.0


def _song(*lines):
    filler = [
        Line(LATE + 30 + i * 3, LATE + 32 + i * 3, f"filler words number {i}") for i in range(6)
    ]
    return [Line(LATE + i * 4, LATE + 3 + i * 4, text) for i, text in enumerate(lines)] + filler


def _facts(artist, title="Untitled", duration=240.0):
    return SongFacts(artist, title, duration)


def _find(links, phrase):
    return [link for link in links if link.phrase == phrase]


def test_a_link_runs_from_the_end_of_one_line_to_the_start_of_another():
    links = discover(
        {1: _song("you have got me on my knees"), 2: _song("on my knees again tonight")},
        facts={1: _facts("One"), 2: _facts("Two")},
    )
    found = _find(links, "on my knees")
    assert [(link.song_a, link.song_b) for link in found] == [(1, 2)]


def test_a_word_in_the_middle_of_a_line_is_no_link():
    links = discover(
        {1: _song("knees are all I have left"), 2: _song("I fell to my knees tonight")},
        facts={1: _facts("One"), 2: _facts("Two")},
    )
    assert not _find(links, "knees")


def test_filler_and_small_words_are_never_a_link():
    """The first listener heard a hand-off on "I" and said it should do better."""
    links = discover(
        {
            1: _song("here is what I said to I", "and so it goes oh"),
            2: _song("I said it", "oh yes"),
        },
        facts={1: _facts("One"), 2: _facts("Two")},
    )
    assert not _find(links, "i")
    assert not _find(links, "oh")


def test_words_match_whole_not_as_part_of_another_word():
    links = discover(
        {1: _song("nothing but a lover"), 2: _song("love is here tonight")},
        facts={1: _facts("One"), 2: _facts("Two")},
    )
    assert not _find(links, "love")
    assert not _find(links, "lover")


def test_a_song_never_links_to_the_same_artist():
    links = discover(
        {1: _song("all I need is the moonlight"), 2: _song("moonlight on the water")},
        facts={1: _facts("Same Person"), 2: _facts("Same Person feat. Guest")},
    )
    assert not links


def test_a_hook_word_outranks_a_passing_word():
    hook = discover(
        {
            1: _song("lost in the moonlight", "lost in the moonlight"),
            2: _song("moonlight on the water", "moonlight on the water"),
        },
        facts={1: _facts("One"), 2: _facts("Two")},
    )
    passing = discover(
        {1: _song("lost in the moonlight"), 2: _song("moonlight on the water")},
        facts={1: _facts("One"), 2: _facts("Two")},
    )
    assert hook[0].score > passing[0].score


def test_a_line_sung_too_fast_to_catch_is_no_link():
    fast = [Line(LATE, LATE + 1.0, "every single word goes past before the moonlight")]
    slow = _song("moonlight on the water")
    assert not discover({1: fast, 2: slow}, facts={1: _facts("One"), 2: _facts("Two")})


def test_spelling_folds_accents_and_drops_what_the_model_cant_say():
    assert spell("Beyoncé's") == "BEYONCE'S"
    assert spell("123") == ""


def _emissions(frames, labels, peaks):
    """Log probabilities that favour blank, except at chosen frames."""
    probabilities = np.full((frames, labels), 0.01)
    probabilities[:, 0] = 0.9
    for frame, label in peaks:
        probabilities[frame] = 0.01
        probabilities[frame, label] = 0.9
    return np.log(probabilities)


def test_the_path_finds_letters_anywhere_in_the_window():
    emissions = _emissions(100, 4, [(40, 1), (55, 3), (70, 2)])
    assert best_path(emissions, np.array([1, 3, 2])).tolist() == [40, 55, 70]


def test_the_path_ignores_louder_letters_it_wasnt_asked_for():
    emissions = _emissions(100, 4, [(10, 2), (40, 1), (70, 2)])
    assert best_path(emissions, np.array([1, 2])).tolist() == [40, 70]


def test_word_times_and_scores_follow_each_words_own_letters():
    positions = np.array([10, 12, 14, 20, 30, 32])
    probabilities = np.array([0.9, 0.9, 0.9, 0.0, 0.3, 0.3])
    words = words_from_path(["cat", "up"], ["CAT", "UP"], positions, probabilities, 0.02, 100.0)
    assert [word.text for word in words] == ["cat", "up"]
    assert words[0].start == pytest.approx(100.2)
    assert words[0].end == pytest.approx(100.3)
    assert words[0].confidence == pytest.approx(0.9)
    assert words[1].start == pytest.approx(100.6)
    assert words[1].confidence == pytest.approx(0.3)


def test_an_unguided_reading_finds_where_words_begin():
    # blank=0, letters 1 and 2, separator 3: "1 1 | 2" with blanks between
    labels = np.array([0, 0, 1, 0, 1, 3, 3, 0, 2, 2, 3, 0])
    assert word_starts_heard(labels, 3, 0.02) == pytest.approx([0.04, 0.16])


def test_agreement_counts_fitted_words_that_start_where_words_were_heard():
    words = [Word("a", 1.0, 1.2, 0.5), Word("b", 2.0, 2.2, 0.5), Word("c", 3.0, 3.2, 0.5)]
    assert agreement(words, [1.02, 2.09, 3.5]) == pytest.approx(2 / 3)
    assert agreement(words, []) == 0.0
    assert agreement([], [1.0]) == 0.0


def test_a_held_note_keeps_going_past_the_last_letter():
    voice = np.zeros(SR * 3, dtype=np.float32)
    t = np.arange(SR * 2) / SR
    voice[SR // 2 : SR // 2 + t.size] = 0.3 * np.sin(2 * np.pi * 300 * t)
    guess = Word("knees", 0.6, 0.9, 0.8)
    settled = settle_edges(guess, voice, SR, 0.0, 3.0)
    assert settled.end == pytest.approx(2.5, abs=0.02)
    assert settled.start == pytest.approx(0.5, abs=0.09)


def test_a_held_word_stops_at_whatever_comes_next():
    voice = 0.3 * np.ones(SR * 3, dtype=np.float32)
    settled = settle_edges(Word("knees", 0.6, 0.9, 0.8), voice, SR, 0.0, 1.4)
    assert settled.end == pytest.approx(1.4, abs=0.02)


def test_real_singing_overlap_counts_only_when_both_voices_sound():
    tone = 0.1 * np.sin(2 * np.pi * 300 * np.arange(SR * 4) / SR).astype(np.float32)
    silent = np.zeros_like(tone)
    a = np.concatenate((tone, silent))
    b = np.concatenate((silent, tone))
    assert sung_overlap_seconds(a, b) < 0.2
    assert sung_overlap_seconds(a, a) == pytest.approx(4.0, abs=0.2)


def test_pruning_removes_whole_windows_and_spares_priority_ones(tmp_path):
    for name, size in (("oldest", 1000), ("keeper", 1000), ("newest", 1000)):
        folder = tmp_path / name
        folder.mkdir()
        (folder / "vocals.wav").write_bytes(b"0" * size)
        (folder / "drums.wav").write_bytes(b"0" * size)
    import os
    import time

    now = time.time()
    for age, name in ((300, "keeper"), (200, "oldest"), (100, "newest")):
        for path in (tmp_path / name).iterdir():
            os.utime(path, (now - age, now - age))
    _prune(tmp_path, 4000, keep={"keeper"})
    assert not (tmp_path / "oldest").exists()
    assert (tmp_path / "keeper" / "vocals.wav").exists()
    assert (tmp_path / "newest" / "drums.wav").exists()


@pytest.fixture
def word_pair(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=95, bars=48, seed=2))
    a.lines = [Line(40.0, 42.0, "you have got me on my knees")]
    b.lines = [Line(30.0, 33.0, "on my knees tonight")]
    origin = 30.0
    t = np.arange(SR * 20) / SR
    voice = 0.2 * np.sin(2 * np.pi * 440 * t).astype(np.float32)
    path = tmp_path / "voice.wav"
    sf.write(path, np.stack((voice, voice), axis=1), SR, subtype="FLOAT")
    phrase_a = [
        Word("on", 41.0, 41.1, 0.9),
        Word("my", 41.1, 41.2, 0.9),
        Word("knees", 41.2, 41.7, 0.9),
    ]
    phrase_b = [
        Word("on", 30.0, 30.2, 0.9),
        Word("my", 30.2, 30.4, 0.9),
        Word("knees", 30.4, 31.0, 0.9),
    ]
    return a, b, phrase_a, phrase_b, VocalWindow(str(path), origin)


def _rms(audio):
    return float(np.sqrt(np.mean(audio**2)))


def test_word_cut_lands_b_on_its_word_the_moment_a_reaches_it(word_pair):
    a, b, phrase_a, phrase_b, _ = word_pair
    script = word_cut(a, b, phrase_a, phrase_b)
    cut = script.meta["cut"]
    assert float(script.a.warp.source_at(cut)) == pytest.approx(41.0 - 0.02, abs=1e-6)
    assert float(script.b.warp.source_at(cut)) == pytest.approx(30.0 - 0.02, abs=1e-6)
    rendered = render(script)
    assert _rms(rendered.a_dry[int((cut + 0.05) * SR) :]) == 0.0
    assert _rms(rendered.b_dry[: int((cut - 0.05) * SR)]) == 0.0
    assert "phrase integrity" not in [c.name for c in audit(rendered).failures]


def test_word_echo_stops_the_band_and_lands_b_on_a_beat_of_a(word_pair):
    a, b, phrase_a, phrase_b, voice = word_pair
    b.lines = [Line(28.0, 29.98, "right before"), *b.lines]
    script = word_echo(a, b, phrase_a, phrase_b, voice)
    drop = script.meta["cut"]
    landing = script.meta["landing"]
    assert float(script.a.warp.source_at(drop)) == pytest.approx(41.2 - 0.02, abs=1e-6)
    beats = (landing - drop) / a.period
    assert beats == pytest.approx(round(beats))
    assert float(script.b.warp.source_at(landing)) == pytest.approx(30.0 - 0.02, abs=1e-6)
    rendered = render(script)
    assert _rms(rendered.a_dry[int((drop + 0.05) * SR) :]) == 0.0
    assert script.b.output_start == pytest.approx(landing)
    gap = rendered.audio[int((drop + 0.6) * SR) : int((landing - 0.01) * SR)]
    assert _rms(gap) > 0.001, "the word should still be ringing"
    assert np.isfinite(rendered.audio).all()


def test_a_long_held_word_rings_until_b_lands_with_no_dead_air(word_pair):
    a, b, phrase_a, phrase_b, voice = word_pair
    script = word_echo(a, b, [Word("knees", 41.2, 44.0, 0.9)], phrase_b, voice)
    wait_after_word = script.meta["landing"] - script.meta["cut"] - 2.8
    assert 0 < wait_after_word <= 2.6


def test_word_roll_repeats_faster_and_lands_on_beat_four(word_pair):
    a, b, phrase_a, phrase_b, voice = word_pair
    script = word_roll(a, b, phrase_a, phrase_b, voice)
    drop = script.meta["cut"]
    beat = a.period
    assert script.meta["landing"] == pytest.approx(drop + 4 * beat)
    starts = sorted(part.output_start for part in script.extras)
    assert [round((s - drop) / beat, 3) for s in starts] == [0.0, 1.0, 2.0, 2.5, 3.0, 3.5]
    assert all(part.source_path == voice.path for part in script.extras)
    rendered = render(script)
    assert np.isfinite(rendered.audio).all()
    assert _rms(rendered.a_dry[int((drop + 0.05) * SR) :]) == 0.0


def test_b_only_prerolls_into_silence_of_its_own(word_pair):
    a, b, phrase_a, phrase_b, voice = word_pair
    b.lines = [Line(29.0, 30.0, "right before"), *b.lines]
    tight = word_echo(a, b, phrase_a, phrase_b, voice)
    b.lines = b.lines[1:]
    open_up = word_echo(a, b, phrase_a, phrase_b, voice)
    assert tight.b.output_start >= open_up.b.output_start
    assert open_up.b.lowpass is not None
