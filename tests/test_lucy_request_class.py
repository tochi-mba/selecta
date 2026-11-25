"""Which kind of turn a message is (`lucy.cloud_agent.request_class`, ADR-0404).

The classifier used to return planning or everyday only, so Premium's deep plans and quick turns
could never be counted as sold. These tests pin all four kinds, the edges between them, and the
words that used to be read as a length by mistake ("2 house tracks").
"""

from __future__ import annotations

import pytest

from selecta.ai import allowance
from selecta.ai.registry import RequestClass, Tier
from selecta.lucy.cloud_agent import (
    DEEP_PLAN_MINUTES,
    QUICK_WORDS,
    asked_minutes,
    request_class,
)

Q, E, P, D = (RequestClass(name) for name in ("quick", "everyday", "planning", "deep_plan"))


def test_every_kind_of_turn_the_plans_sell_can_be_asked_for():
    asked = {
        request_class("what's playing next?"),
        request_class("tell me why these two songs blend well together, with examples please"),
        request_class("make a 1 hour mix for a house party"),
        request_class("make a 3 hour mix for a house party"),
    }
    assert asked == set(RequestClass)


@pytest.mark.parametrize("words", [
    "make a 1 hour mix for a house party",
    "Build me a playlist of afrobeats",
    "create a set for the gym",
    "plan a mix for tonight",
    "start a new mix with Rema",
    "MAKE A MIX",
    "90 minutes of afrobeats",
    "45 min of soul",
    "45min of soul",
    "1.5 hours of soul",
    "a 1-hour set please",
    "make a mix 1 hour 30 min",
    "make a mix, 1 hour and 59 minutes",
    "play something for 0 hours",
])
def test_a_whole_new_mix_or_a_named_length_is_a_planning_turn(words):
    assert request_class(words) is P


@pytest.mark.parametrize("words", [
    "make a 2 hour mix",
    "make a 2-hour mix",
    "make a 2hr mix",
    "make a 2h mix",
    "2h30 of amapiano",
    "120 minutes of amapiano",
    "150 min of amapiano",
    "make a mix, 1 hour and 60 minutes",
    "2.5 hours of soul",
    "build me a three-hour set",
    "create a TWELVE hour playlist",
    "make a 1000 hour mix",
    "plan a wedding playlist",
    "make a mix for the festival",
    "make an all-night mix",
    "start an all night set",
    "start a set for the whole evening",
    "build a playlist for the entire party",
    "make an all-day mix",
])
def test_a_long_mix_or_a_long_event_is_a_deep_plan(words):
    assert request_class(words) is D


@pytest.mark.parametrize("words", [
    "a wedding",  # a long event, but no mix is asked for
    "what do people play at a festival?",
    "I was up all night",
    "three hours is a long time to dance without a break, do you think so too",
])
def test_a_long_event_alone_is_not_a_deep_plan(words):
    assert request_class(words) is not D


@pytest.mark.parametrize("words", [
    "what's playing next?",
    "what’s playing next?",  # a curly apostrophe, as a phone types it
    "whats next",
    "WHAT'S NEXT",
    "who sings this?",
    "whose song is this",
    "which song is this?",
    "when does this mix end?",
    "where is that song in the mix",
    "how long is this mix?",
    "how many songs do I have?",
    "how much of my library is ready?",
    "  what is this song?  ",
    "\"what is this song?\"",
    "¿what is this?",
    "what",  # a question word alone still reads as a question
])
def test_a_short_question_that_asks_for_no_mix_is_a_quick_turn(words):
    assert request_class(words) is Q


@pytest.mark.parametrize("words", [
    "hello",
    "play Rema",
    "skip this song",
    "can you make it longer?",  # a request, however it is punctuated
    "swap the third and fourth songs?",
    "why?",
    "whatever you think is best",
    "whenever",
    "however long it takes",
    "how are you",
    "tell me why these two songs blend well together, with examples please",
    "how many songs do I have by Rema in my whole library right now",  # too long to be quick
    "one hour of highlife",  # a length in words alone, with no mix asked for
    "a wedding",
])
def test_everything_else_is_an_everyday_turn(words):
    assert request_class(words) is E


def test_the_quick_limit_is_a_number_of_words():
    question = "what " + " ".join(["la"] * (QUICK_WORDS - 1))
    assert len(question.split()) == QUICK_WORDS and request_class(question) is Q
    assert request_class(question + " la") is E


@pytest.mark.parametrize("words", [None, "", "   ", "\n\t", "?", "...", "🎉"])
def test_no_words_or_only_marks_is_an_everyday_turn(words):
    assert request_class(words) is E


@pytest.mark.parametrize("words", [
    "play 2 house tracks",
    "5 hip hop songs",
    "3 hits from the 90s",
    "10 minor key songs",
    "2 minimal techno tracks",
    "play 99 problems",
    "songs from 1999",
    "the top 40",
])
def test_a_number_before_another_word_is_not_a_length(words):
    assert asked_minutes(words) == 0
    assert request_class(words) is E


@pytest.mark.parametrize(("words", "minutes"), [
    ("", 0),
    ("no length here", 0),
    ("1 hour", 60),
    ("2 hours", 120),
    ("2hrs", 120),
    ("2 h", 120),
    ("2-hour", 120),
    ("1.5 hours", 90),
    ("0.5 hours", 30),
    ("90 minutes", 90),
    ("90min", 90),
    ("90 mins", 90),
    ("1 hour 30 min", 90),
    ("2 hours 30 minutes", 150),
    ("2h30", 120),
    ("two hours", 120),
    ("Twelve Hours", 720),
    ("thirteen hours", 0),  # only one to twelve are read as words
    ("1 hour or 2 hours", 120),  # the longest length asked for, not their sum
    ("30 minutes or 45 minutes", 45),
    ("0 hours", 0),
])
def test_the_length_asked_for_in_minutes(words, minutes):
    assert asked_minutes(words) == minutes


def test_the_deep_plan_line_is_two_hours():
    assert DEEP_PLAN_MINUTES == 120
    assert request_class("make a 119 minute mix") is P
    assert request_class("make a 120 minute mix") is D


def test_planning_wins_over_a_question_and_a_long_message():
    assert request_class("what would a 1 hour mix of Rema look like?") is P
    assert request_class("how long would it take to make a 3 hour mix?") is D
    long_ask = "please " * 60 + "make a mix"
    assert request_class(long_ask) is P


def test_a_very_long_message_is_classified_without_trouble():
    assert request_class("la " * 20_000) is E
    assert request_class("9" * 5_000 + " hours of soul") is D


@pytest.mark.parametrize("tier", list(Tier))
@pytest.mark.parametrize("words", [
    "what's playing next?", "play Rema", "make a 1 hour mix", "make a 3 hour mix", "", None,
])
def test_every_class_a_message_can_get_counts_against_an_allowance_the_plan_has(tier, words):
    """Whatever the classifier answers, the plan has a bucket for it, so no message is refused
    only because of how it was read."""
    bucket = allowance.bucket_for(tier, request_class(words))
    assert allowance.ALLOWANCES[tier].get(bucket, 0) > 0
