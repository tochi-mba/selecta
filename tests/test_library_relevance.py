"""The library search's ranking: forgiving about punctuation, never about what was typed."""

from __future__ import annotations

import pytest

from selecta.library.relevance import match_label, relevance


def _rank(query: str, title: str, artist: str = "Someone") -> int | None:
    return relevance(query, 1, artist, title)


def test_a_symbol_after_a_word_ends_the_word():
    assert _rank("100%", "100% Love") == 30  # the title starts with the whole word
    assert _rank("100%", "1000 Days") is None
    assert _rank("hey!", "Heyday") is None
    assert _rank("hey!", "Hey! Ya") == 30


def test_without_a_symbol_the_start_of_a_word_still_matches():
    assert _rank("100", "1000 Days") == 30
    assert _rank("100", "100% Love") == 30
    assert _rank("lov", "100% Love") == 35


@pytest.mark.parametrize(
    ("query", "title"), [("ac dc", "AC/DC"), ("acdc!", "ACDC"), ("AC/DC", "AC-DC")]
)
def test_punctuation_between_words_is_still_forgiven(query, title):
    assert _rank(query, title) == 10


def test_a_whole_word_can_sit_inside_a_name_and_an_artist():
    assert _rank("love!", "100% Love Song") == 35
    assert _rank("love!", "Lovers") is None
    assert relevance("smith!", 1, "John Smith", "Song") == 45
    assert relevance("smith!", 1, "Smithers", "Song") is None


def test_ids_exact_names_and_short_typos():
    assert relevance("7", 7, "A", "B") == 0
    assert _rank("", "Anything") == 100
    assert _rank("lvoe", "Love") is None  # too short to guess at
    assert _rank("Bohemian Rapsody", "Bohemian Rhapsody") is not None
    assert match_label(_rank("Bohemian Rapsody", "Bohemian Rhapsody")).startswith("Approximate")
