"""T0225: word connections with missing lyric timing, a word sung many times, and duplicate songs."""

from __future__ import annotations

from types import SimpleNamespace

from test_wordplay import _facts, _song

from selecta.lyrics.match import discover
from selecta.seam_making import links_between


def test_a_song_without_timed_lyrics_offers_no_link_and_breaks_nothing():
    links = discover(
        {1: _song("you have got me on my knees"), 2: [], 3: _song("on my knees again tonight")},
        facts={1: _facts("One"), 2: _facts("Untimed"), 3: _facts("Three")},
    )
    assert {(link.song_a, link.song_b) for link in links} == {(1, 3)}
    assert all(2 not in (link.song_a, link.song_b) for link in links)
    timed = SimpleNamespace(id=1, lines=_song("on my knees"), artist="One", title="A", duration=240.0)
    untimed = SimpleNamespace(id=2, lines=[], artist="Two", title="B", duration=240.0)
    assert links_between(timed, untimed) == [] and links_between(untimed, timed) == []


def test_a_word_sung_many_times_is_still_one_link_per_pair():
    many = ["you have got me on my knees"] * 8
    links = discover(
        {1: _song(*many), 2: _song(*(["on my knees again tonight"] * 8))},
        facts={1: _facts("One"), 2: _facts("Two")},
    )
    pairs = [(link.song_a, link.song_b) for link in links]
    assert pairs.count((1, 2)) == 1
    assert len(pairs) == len(set(pairs))


def test_a_duplicate_recording_never_links_to_itself():
    words = _song("all I need is the moonlight", "moonlight on the water")
    links = discover(
        {1: words, 2: list(words)},
        facts={1: _facts("Same Singer", "Moonlight"), 2: _facts("Same Singer", "Moonlight")},
    )
    assert links == []
