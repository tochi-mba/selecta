"""Word links, word timing and the hand-offs built on them, using synthetic audio only."""

import numpy as np
import pytest
import soundfile as sf
from helpers import song_from_track
from synth import SR, make_track

from selecta.audit.checks import BEAT_LIMIT_MS, audit
from selecta.audit.deep import sung_overlap_seconds
from selecta.lyrics.align import (
    Word,
    agreement,
    best_path,
    letter_match,
    letters_heard,
    settle_edges,
    spell,
    word_starts_heard,
    words_from_path,
)
from selecta.lyrics.lrclib import Line
from selecta.lyrics.match import LyricLink, SongFacts, discover
from selecta.planner.wordreel import modes_for, rank_links, ride_lengths, ride_lines
from selecta.render.engine import _part_audio, render
from selecta.render.script import Part, Warp
from selecta.stems import StemWindow, _prune, band_of
from selecta.styles.wordplay import (
    Stem,
    _answer_gaps,
    _handoff_shift,
    _quick_steps,
    felt_bpm,
    phrase_roll,
    roll_shape,
    vocal_ride,
    word_blend,
    word_cut,
    word_exchange,
)

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
    """Two songs close in tempo, with phrases placed on real beats, and stems that cover all of
    each song. A's voice is a tone, so it can be told apart from everything else."""
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=118, bars=48, seed=2))
    a_at = float(a.beats[100])
    b_at = float(b.beats[60])
    a.lines = [Line(a_at - 3.0, a_at + 0.9, "all I really need is good news")]
    b.lines = [Line(b_at, b_at + 3.0, "good news is on the way")]
    seconds = int(a.duration) + 1
    t = np.arange(SR * seconds) / SR
    voice = 0.2 * np.sin(2 * np.pi * 880 * t).astype(np.float32)
    path = tmp_path / "voice.wav"
    sf.write(path, np.stack((voice, voice), axis=1), SR, subtype="FLOAT")
    phrase_a = [Word("good", a_at, a_at + 0.3, 0.9), Word("news", a_at + 0.3, a_at + 0.8, 0.9)]
    phrase_b = [Word("good", b_at, b_at + 0.3, 0.9), Word("news", b_at + 0.3, b_at + 0.8, 0.9)]
    return a, b, phrase_a, phrase_b, Stem(str(path), 0.0), Stem(a.path, 0.0), Stem(b.path, 0.0)


def _rms(audio):
    return float(np.sqrt(np.mean(audio**2)))


def test_word_cut_lands_b_on_its_word_the_moment_a_reaches_it(word_pair):
    a, b, phrase_a, phrase_b, *_ = word_pair
    script = word_cut(a, b, phrase_a, phrase_b)
    cut = script.meta["cut"]
    assert float(script.a.warp.source_at(cut)) == pytest.approx(phrase_a[0].start - 0.02, abs=1e-6)
    assert float(script.b.warp.source_at(cut)) == pytest.approx(phrase_b[0].start - 0.02, abs=1e-6)
    rendered = render(script)
    assert _rms(rendered.a_dry[int((cut + 0.05) * SR) :]) == 0.0
    assert _rms(rendered.b_dry[: int((cut - 0.05) * SR)]) == 0.0
    assert "phrase integrity" not in [c.name for c in audit(rendered).failures]


def test_word_cut_brings_b_in_early_without_its_bass(word_pair):
    """The listener: "we should start instrumentals sooner before we do it"."""
    a, b, phrase_a, phrase_b, _, _, band_b = word_pair
    script = word_cut(a, b, phrase_a, phrase_b, band_b)
    cut = script.meta["cut"]
    swell = script.extras[0]
    assert swell.output_start < cut - 1.0
    assert swell.low.is_constant(0.0)
    assert float(swell.warp.source_at(cut)) == pytest.approx(phrase_b[0].start - 0.02, abs=1e-3)
    assert np.isfinite(render(script).audio).all()


def _voice_hits(script, voice):
    return sorted(
        (part for part in script.extras if part.source_path == voice.path),
        key=lambda part: part.output_start,
    )


def test_phrase_roll_is_built_the_way_the_listener_described(word_pair):
    """ "good news good news, then news news news news, then faster news news news news news,
    and then the next song cuts Good news is on the way" """
    a, b, phrase_a, phrase_b, voice, band_a, band_b = word_pair
    script = phrase_roll(a, b, phrase_a, phrase_b, voice, band_a, band_b)
    hits = _voice_hits(script, voice)
    shape = roll_shape(a, b, phrase_a)
    assert len(hits) == shape.phrase_loops + shape.word_hits + shape.fast_hits
    assert shape.phrase_loops == 2
    phrase_start = phrase_a[0].start - 0.02
    word_start = phrase_a[1].start - 0.02
    sources = [float(hit.warp.source[0]) for hit in hits]
    assert sources[:2] == pytest.approx([phrase_start, phrase_start])
    assert sources[2:] == pytest.approx([word_start] * (len(hits) - 2))
    starts = np.array([hit.output_start for hit in hits])
    gaps = np.diff(starts)
    assert gaps[-1] < gaps[2] * 0.6, "the last hits should be about twice as fast"
    landing = script.meta["landing"]
    assert hits[-1].output_end <= landing + 0.01
    assert starts[0] >= script.overlap[0] - 0.1, "the repeats come after A has sung it"
    assert float(script.b.warp.source_at(landing)) == pytest.approx(
        phrase_b[0].start - 0.02, abs=1e-6
    )


def test_a_rolls_shape_comes_from_its_own_tracks(tmp_path):
    """ "all the phrase rolls shouldnt be exactly the same, it should be dependent on the
    tracks" """

    def words(*lengths, at=40.0):
        found = []
        for length in lengths:
            found.append(Word("word", at, at + length, 0.9))
            at += length
        return found

    fast = song_from_track(tmp_path, "fast", make_track(bpm=128, bars=8, seed=1))
    slow = song_from_track(tmp_path, "slow", make_track(bpm=82, bars=8, seed=2))
    assert roll_shape(fast, fast, words(0.3, 0.4)) != roll_shape(slow, slow, words(0.3, 0.4))
    single = roll_shape(fast, fast, words(0.5))
    assert single.phrase_loops == 0, "one word goes straight to the stutter"
    long_phrase = roll_shape(fast, fast, words(0.8, 0.8, 0.8))
    assert long_phrase.phrase_loops == 1, "a long phrase only repeats once"
    assert roll_shape(fast, fast, words(0.3, 0.4)).phrase_loops == 2


def test_phrase_roll_changes_its_contour_for_a_sparse_lift_vs_a_crowded_drop(tmp_path):
    def words(*lengths, at=40.0):
        result = []
        for length in lengths:
            result.append(Word("word", at, at + length, 0.9))
            at += length
        return result

    sparse = song_from_track(tmp_path, "sparse", make_track(bpm=128, bars=8, seed=3))
    crowded = song_from_track(tmp_path, "crowded", make_track(bpm=128, bars=8, seed=4))
    lift = song_from_track(tmp_path, "lift", make_track(bpm=128, bars=8, seed=5))
    drop = song_from_track(tmp_path, "drop", make_track(bpm=128, bars=8, seed=6))
    sparse.energy_bars[:] = 0.2
    sparse.low_share_bars[:] = 0.08
    crowded.energy_bars[:] = 0.9
    crowded.low_share_bars[:] = 0.5
    lift.energy_bars[:] = 0.9
    lift.low_share_bars[:] = 0.2
    drop.energy_bars[:] = 0.2
    drop.low_share_bars[:] = 0.55
    phrase = words(0.3, 0.4)

    open_roll = roll_shape(sparse, lift, phrase)
    restrained_roll = roll_shape(crowded, drop, phrase)

    assert open_roll != restrained_roll
    assert open_roll.phrase_loops > restrained_roll.phrase_loops
    assert open_roll.acceleration < restrained_roll.acceleration
    assert open_roll.bass_mid_level > restrained_roll.bass_mid_level


def test_a_roll_brings_the_bass_in_steps_not_all_at_once(word_pair):
    """How DJs build it: a little bass, more bass, most of it, then all of it on the landing."""
    a, b, phrase_a, phrase_b, voice, band_a, band_b = word_pair
    script = phrase_roll(a, b, phrase_a, phrase_b, voice, band_a, band_b)
    word_stage, fast_stage, landing = (
        script.meta["word_stage"],
        script.meta["fast_stage"],
        script.meta["landing"],
    )
    leaving = next(p for p in script.extras if p.source_path == band_a.path)
    rising = next(p for p in script.extras if p.source_path == band_b.path)
    assert word_stage < leaving.output_end < landing, "A's band leaves under the word"
    assert rising.output_start == pytest.approx(word_stage)
    level = lambda time: float(np.interp(time, rising.low.times, rising.low.values))  # noqa: E731
    assert level(word_stage + 0.01) == 0.0
    assert 0.0 < level(fast_stage + 0.05) < level(landing - 0.05) < 1.0
    assert level(landing) == 1.0
    assert float(rising.warp.source_at(landing)) == pytest.approx(
        phrase_b[0].start - 0.02, abs=1e-3
    )
    rendered = render(script)
    assert np.isfinite(rendered.audio).all()
    assert "quiet time" not in [c.name for c in audit(rendered).failures], "no holes in the roll"


def test_the_last_repeat_rings_on_into_b(word_pair):
    a, b, phrase_a, phrase_b, voice, band_a, band_b = word_pair
    script = phrase_roll(a, b, phrase_a, phrase_b, voice, band_a, band_b)
    hits = _voice_hits(script, voice)
    assert hits[-1].echo is not None
    assert all(hit.echo is None for hit in hits[:-1])


def test_a_single_word_rolls_without_a_phrase_stage(word_pair):
    a, b, phrase_a, phrase_b, voice, band_a, band_b = word_pair
    script = phrase_roll(a, b, phrase_a[-1:], phrase_b, voice, band_a, band_b)
    shape = roll_shape(a, b, phrase_a[-1:])
    assert len(_voice_hits(script, voice)) == shape.word_hits + shape.fast_hits


def _exchange_pair(word_pair, gaps=True):
    a, b, phrase_a, phrase_b, voice, band_a, band_b = word_pair
    start = phrase_b[0].start
    spacing = 5.0 if gaps else 1.1
    b.lines = [
        Line(start + i * spacing, start + i * spacing + 1.0, f"b sings line {i}") for i in range(10)
    ]
    return a, b, phrase_a, phrase_b, voice, band_a, band_b


def test_call_and_response_drops_a_into_the_gaps_b_leaves(word_pair):
    """B plays its song, and A calls back in the room between B's own lines."""
    a, b, phrase_a, phrase_b, voice, band_a, band_b = _exchange_pair(word_pair)
    script = word_exchange(a, b, phrase_a, phrase_b, voice, band_a, band_b, bars=4)
    assert script is not None
    assert script.style == "word_exchange"
    calls = [part for part in script.extras if part.source_path == voice.path][1:]
    assert 1 <= len(calls) == script.meta["calls"] <= 3
    for call in calls:
        source = float(script.b.warp.source_at(call.output_start))
        for line in b.lines:
            assert not line.start < source < line.end, "A never talks over B"
    assert float(calls[0].gain.values[1]) > float(calls[-1].gain.values[1]) or len(calls) == 1
    assert calls[-1].echo is not None, "A's last call rings away"
    assert np.isfinite(render(script).audio).all()


def test_a_busy_hook_with_no_gaps_gets_no_call_and_response(word_pair):
    """It depends on the song: where B never stops singing, the move doesn't happen."""
    a, b, phrase_a, phrase_b, voice, band_a, band_b = _exchange_pair(word_pair, gaps=False)
    assert word_exchange(a, b, phrase_a, phrase_b, voice, band_a, band_b, bars=4) is None


def test_the_number_of_answers_comes_from_the_song(tmp_path):
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=64, seed=2))
    roomy = [Line(40.0 + i * 5, 41.0 + i * 5, "line words here") for i in range(10)]
    tight = [
        Line(40.0, 41.0, "a"),
        Line(41.2, 42.0, "b"),
        Line(46.0, 47.0, "c"),
        Line(47.2, 48.0, "d"),
    ]
    b.lines = roomy
    assert len(_answer_gaps(b, 38.0, 1.0)) == 3
    b.lines = tight
    assert len(_answer_gaps(b, 38.0, 1.0)) == 2


def test_a_rides_length_comes_from_how_long_a_is_singing(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=96, seed=1))
    a.lines = [Line(100.0 + i, 100.9 + i, "words") for i in range(30)]
    assert ride_lengths(a, 130.0)[0] == 12, "sung all the way through, so as long as stems allow"
    a.lines = [Line(120.0, 130.0, "one long line")]
    longest = ride_lengths(a, 130.0)[0]
    assert longest < 12, "only one line to carry it"


def test_as_band_waits_for_as_voice_before_it_leaves(word_pair):
    """A's voice comes in late on some songs. The band can't leave the singer with nothing."""
    a, b, phrase_a, phrase_b, voice, band_a, band_b = word_pair
    end = phrase_a[-1].end
    a.lines = [Line(end - 5.0, end, "a late line of singing")]
    script = vocal_ride(a, b, phrase_a[-1], phrase_b[0], voice, band_a, band_b, bars=8)
    band_gain = script.a.gain
    leaves = float(band_gain.times[2])
    assert leaves >= float(script.a.warp.output_at(end - 5.0)) - 0.01


def test_rock_songs_dont_stutter_and_bare_cuts_need_a_close_tempo(tmp_path):
    """Every roll out of a rock song on the reels failed, and the best cut was 4.5% apart."""
    rock = song_from_track(tmp_path, "a", make_track(bpm=120, bars=8, seed=1), genre="Rock")
    pop = song_from_track(tmp_path, "b", make_track(bpm=121, bars=8, seed=2), genre="Pop")
    far = song_from_track(tmp_path, "c", make_track(bpm=100, bars=8, seed=3), genre="Pop")
    assert "phrase_roll" not in modes_for(rock, pop)
    assert "phrase_roll" in modes_for(pop, rock)
    assert "word_cut" in modes_for(pop, rock)
    assert "word_cut" not in modes_for(pop, far)


def test_handoff_keeps_bars_together_and_voices_in_order(word_pair):
    a, b, phrase_a, phrase_b, *_ = word_pair
    a_end = phrase_a[-1].end
    shift, handoff_beat = _handoff_shift(a, b, a_end, phrase_b[0].start)
    a_bar_start = int(a.bar_starts[a.bar_at(a_end)])
    b_bar_start = int(b.bar_starts[b.bar_at(phrase_b[0].start)])
    assert (shift - (b_bar_start - a_bar_start)) % a.beats_per_bar == 0
    a_beat = float(np.interp(a_end, a.beats, np.arange(a.beats.size)))
    assert -0.25 <= handoff_beat - a_beat < a.beats_per_bar


def test_word_blend_starts_bs_band_bars_before_its_voice(word_pair):
    a, b, phrase_a, phrase_b, voice, band_a, band_b = word_pair
    script = word_blend(a, b, phrase_a, phrase_b, voice, band_a, band_b, bars=4)
    assert script is not None
    start, handoff = script.overlap
    bar = 60.0 / a.bpm * a.beats_per_bar
    assert handoff - start > 2.5 * bar
    assert script.b.source_path == band_b.path
    assert float(script.b.warp.source_at(handoff)) == pytest.approx(
        phrase_b[0].start - 0.02, abs=1e-3
    )
    assert script.meta["voice_end"] <= handoff + script.meta["period"] / 2
    a_down = float(script.a.warp.source_at(start))
    b_down = float(script.b.warp.source_at(start))
    assert np.min(np.abs(a.bar_times - a_down)) < 0.01, "A starts the overlap on a downbeat"
    assert np.min(np.abs(b.bar_times - b_down)) < 0.01, "so does B"


def test_word_blend_hands_from_one_voice_to_the_other_on_the_beat(word_pair):
    a, b, phrase_a, phrase_b, voice, band_a, band_b = word_pair
    script = word_blend(a, b, phrase_a, phrase_b, voice, band_a, band_b, bars=4)
    handoff = script.meta["handoff"]
    rendered = render(script)
    assert np.isfinite(rendered.audio).all()
    assert _rms(rendered.a_dry[int((handoff - 0.2) * SR) :]) < 1e-3, "A's band has already left"
    assert _rms(rendered.b_dry[int((handoff + 0.2) * SR) :]) == 0.0, "B's full mix has taken over"
    report = audit(rendered)
    assert report.value("beat alignment") <= BEAT_LIMIT_MS
    assert script.extras[-1].follows_b


def test_a_blend_is_refused_when_stems_dont_reach_far_enough_back(word_pair):
    a, b, phrase_a, phrase_b, voice, band_a, band_b = word_pair
    late = Stem(band_b.path, phrase_b[0].start - 1.0)
    assert word_blend(a, b, phrase_a, phrase_b, voice, band_a, late, bars=8) is None


def test_a_hype_song_never_rolls_into_a_much_slower_one(tmp_path):
    """Reel 2 #03: "the roll seems like we expect a drop and then we go into this super slow."""
    hype = song_from_track(tmp_path, "a", make_track(bpm=126, bars=8, seed=1))
    slow = song_from_track(tmp_path, "b", make_track(bpm=102, bars=8, seed=2))
    assert "phrase_roll" not in modes_for(hype, slow)
    assert "phrase_roll" in modes_for(slow, hype)


def test_half_time_songs_are_judged_by_the_beat_people_feel(tmp_path):
    """Reel 2 #10, the favourite: a 160 BPM grid that feels like 80, into a song at 113."""
    fast_grid = song_from_track(tmp_path, "a", make_track(bpm=160, bars=8, seed=1))
    faster_feel = song_from_track(tmp_path, "b", make_track(bpm=113, bars=8, seed=2))
    assert felt_bpm(fast_grid) == pytest.approx(80.0)
    assert "phrase_roll" in modes_for(fast_grid, faster_feel)


def test_only_songs_that_can_play_together_get_a_blend(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=8, seed=1), camelot="8A")
    near = song_from_track(tmp_path, "b", make_track(bpm=118, bars=8, seed=2), camelot="9A")
    clashing = song_from_track(tmp_path, "c", make_track(bpm=118, bars=8, seed=3), camelot="2A")
    assert modes_for(a, near)[0] == "word_blend"
    assert "word_blend" not in modes_for(a, clashing)


def test_music_decides_the_order_as_well_as_the_words(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1), camelot="8A")
    fits = song_from_track(tmp_path, "b", make_track(bpm=118, bars=48, seed=2), camelot="8A")
    only_cut = song_from_track(tmp_path, "c", make_track(bpm=108, bars=48, seed=3), camelot="2A")
    none = song_from_track(tmp_path, "d", make_track(bpm=88, bars=48, seed=4), camelot="2A")
    songs = {a.id: a, fits.id: fits, only_cut.id: only_cut, none.id: none}
    line = Line(30.0, 32.0, "text")

    def link(b, score):
        return LyricLink(a.id, b.id, "shared_word", "text", line, line, score)

    ranked = rank_links([link(none, 0.99), link(only_cut, 0.8), link(fits, 0.7)], songs)
    assert [item.song_b for item in ranked] == [fits.id, only_cut.id]


def test_a_part_reads_a_stem_from_where_the_stem_starts(tmp_path):
    t = np.arange(SR * 4) / SR
    ramp = np.stack((t, t), axis=1).astype(np.float32)
    path = tmp_path / "stem.wav"
    sf.write(path, ramp, SR, subtype="FLOAT")
    song = song_from_track(tmp_path, "s", make_track(bpm=120, bars=8, seed=1))
    part = Part(
        song=song, warp=Warp.identity(1.0, 11.0, 1.0), source_path=str(path), window_origin=10.0
    )
    placed, _ = _part_audio(part, ramp, SR * 3)
    assert placed[SR, 0] == pytest.approx(1.0, abs=1e-3)
    assert placed[SR // 2, 0] == 0.0


def test_a_part_can_stop_reading_before_its_warp_ends(tmp_path):
    song = song_from_track(tmp_path, "s", make_track(bpm=120, bars=8, seed=1))
    ramp = np.ones((SR * 4, 2), dtype=np.float32)
    part = Part(song=song, warp=Warp.identity(0.0, 0.0, 3.0), render_until=1.0)
    placed, _ = _part_audio(part, ramp, SR * 3)
    assert placed[SR // 2, 0] == 1.0
    assert placed[SR + 100, 0] == 0.0
    assert float(part.warp.source_at(2.5)) == 2.5, "timing maths still sees the whole song"


def test_trimming_a_warp_keeps_its_mapping():
    warp = Warp(np.array([0.0, 4.0, 8.0]), np.array([10.0, 14.0, 20.0]))
    cut = warp.trimmed(2.0, 6.0)
    assert cut.output.tolist() == [2.0, 4.0, 6.0]
    assert cut.source.tolist() == [12.0, 14.0, 17.0]


def test_a_band_is_everything_except_the_voice(tmp_path):
    parts = {}
    for name, level in (("vocals", 0.5), ("drums", 0.1), ("bass", 0.2), ("other", 0.3)):
        path = tmp_path / f"{name}.wav"
        sf.write(path, np.full((SR // 10, 2), level, dtype=np.float32), SR, subtype="FLOAT")
        parts[name] = path
    band = sf.read(band_of(StemWindow(**parts)), dtype="float32")[0]
    assert band[100, 0] == pytest.approx(0.6, abs=1e-5)


def test_a_vocal_ride_keeps_as_voice_going_over_bs_band_until_bs_voice_starts(word_pair):
    """The listener: "the prev vocals didnt ride the beat of the next song long enough"."""
    a, b, phrase_a, phrase_b, voice, band_a, band_b = word_pair
    script = vocal_ride(a, b, phrase_a[-1], phrase_b[0], voice, band_a, band_b, bars=4)
    assert script.style == "vocal_ride"
    start, handoff = script.overlap
    a_gone = script.a.gain.times[-1]
    voice_part = script.extras[0]
    assert voice_part.source_path == voice.path
    assert a_gone < handoff, "A's band leaves first"
    assert script.meta["voice_end"] > a_gone, "and A's voice carries on without it"
    assert handoff - a_gone > script.meta["period"], "for a real stretch of B's band"
    assert np.isfinite(render(script).audio).all()


def test_ride_lines_need_a_as_voice_singing_and_prefer_a_chorus_in_b(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=96, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=96, seed=2))
    a.lines = [Line(70.0 + i * 3, 72.9 + i * 3, f"sung line number {i}") for i in range(8)]
    b.lines = [
        Line(40.0, 43.0, "a verse line here"),
        Line(b.bar_time(32) + 0.1, b.bar_time(32) + 3.0, "the chorus starts here"),
    ]
    b.sections = [
        {"start_bar": 0, "end_bar": 32, "label": "verse", "energy": 0.6, "chorus_prob": 0.2},
        {"start_bar": 32, "end_bar": 64, "label": "chorus", "energy": 0.8, "chorus_prob": 0.9},
    ]
    line_a, line_b = ride_lines(a, b)
    assert line_a in a.lines
    assert a.vocal_seconds(line_a.end - 8.0, line_a.end) > 2.0
    assert line_b.text == "the chorus starts here"
    a.lines = [Line(70.0, 71.0, "lonely line")]
    assert ride_lines(a, b) is None


def test_letters_rescue_a_good_line_an_unguided_reading_ran_together():
    """ "NESO ME" for "next to me": the word starts mostly miss, but the letters are close."""
    words = [
        Word("next", 20.7, 21.0, 0.8),
        Word("to", 21.05, 21.25, 0.4),
        Word("me", 21.3, 21.6, 0.9),
    ]
    heard = [(20.74, "N"), (20.8, "E"), (20.9, "S"), (21.1, "O"), (21.3, "M"), (21.4, "E")]
    assert letter_match(words, heard) > 0.55
    assert letter_match(words, [(20.74, "Q"), (21.3, "Z")]) < 0.2


def test_letters_are_read_in_order_without_blanks_or_separators():
    labels = ("-", "|", "A", "B")
    assert letters_heard(np.array([0, 2, 2, 0, 1, 3, 0]), labels, 0.02) == [
        (pytest.approx(0.02), "A"),
        (pytest.approx(0.1), "B"),
    ]


@pytest.mark.parametrize("bpm", [75.0, 118.0, 155.0])
def test_the_quick_steps_stay_on_bs_grid_at_any_tempo(tmp_path, bpm):
    """A fast song's beats once crowded out every hit, which refused the listener's own example."""
    b = song_from_track(tmp_path, "b", make_track(bpm=bpm, bars=48, seed=2))
    enter_b = float(b.beats[60]) - 0.02
    fast = _quick_steps(b, enter_b)
    assert fast.size >= 8
    assert fast[-1] < enter_b
    spacing = np.diff(fast[-8:])
    assert spacing == pytest.approx(np.full(7, spacing[0]), abs=1e-3)
    assert 0.15 < spacing[0] < 0.35


def test_a_ride_times_b_against_as_band_not_as_voice(word_pair):
    """Rap consonants and sung onsets threw the beat check off, and rejected good rides."""
    a, b, phrase_a, phrase_b, voice, band_a, band_b = word_pair
    script = vocal_ride(a, b, phrase_a[-1], phrase_b[0], voice, band_a, band_b, bars=4)
    assert script.a.source_path == band_a.path
    assert script.b.source_path == band_b.path
    assert float(script.a.warp.source_at(0.0)) == script.a_source_start
    start = script.overlap[0]
    a_full = script.extras[1]
    assert a_full.audio_path == a.path
    assert a_full.output_end <= start + 0.1
    assert script.a.render_from < start


def test_a_part_can_start_reading_late(tmp_path):
    song = song_from_track(tmp_path, "s", make_track(bpm=120, bars=8, seed=1))
    part = Part(song=song, warp=Warp.identity(0.0, 0.0, 3.0), render_from=1.0, render_until=2.0)
    placed, _ = _part_audio(part, np.ones((SR * 4, 2), dtype=np.float32), SR * 3)
    assert placed[SR // 2, 0] == 0.0
    assert placed[SR + SR // 2, 0] == 1.0
    assert placed[SR * 2 + SR // 2, 0] == 0.0
