"""Lucy's language grammar: typed hard and soft rules, supersession, contradictions and edits
(ADR-0321, ADR-0324, LU-319-01, LU-300-05)."""

from __future__ import annotations

import pytest

from selecta.lucy import intent
from selecta.lucy.intent import Constraint


def kinds(text: str) -> dict[str, Constraint]:
    return {rule.kind: rule for rule in intent.parse(text, "turn_1")}


def test_strict_ready_only_is_a_hard_rule_and_distinct_from_a_preference():
    for text in (
        "only transitions that are already ready",
        "12 songs, no rendering please",
        "make it ready-only",
        "just use transitions already rendered",
        "nothing new to render",
    ):
        rule = kinds(text)["ready_only"]
        assert rule.strength == "hard" and rule.value is True, text
    prefer = kinds("ideally use transitions that are ready")
    assert "ready_only" not in prefer and prefer["prefer_ready"].strength == "soft"
    relaxed = kinds("you can render new ones now")
    assert "ready_only" not in relaxed and "prefer_ready" in relaxed


def test_counts_durations_tempos_and_families():
    found = kinds("Make me twelve songs of afrobeats around 120 bpm")
    assert found["count"].value == 12 and found["count"].strength == "hard"
    assert found["family"].target == "afro" and found["family"].strength == "soft"
    assert found["tempo_near"].value == 120.0
    strict = kinds("only rap, under 45 minutes, between 90 and 100 bpm")
    assert strict["family_only"].value == "hiphop" and strict["family_only"].strength == "hard"
    assert strict["max_duration"].value == 45.0 and strict["max_duration"].strength == "hard"
    assert strict["tempo_range"].value == [90.0, 100.0]
    assert kinds("an hour of house")["duration"].value == 60.0


def test_names_are_kept_as_names_never_resolved_or_guessed_here():
    found = kinds("start with Burna Boy and end on Wizkid, no Drake, with some Rihanna")
    assert found["start_with"].value == "Burna Boy"
    assert found["end_with"].value == "Wizkid"
    assert found["exclude_artist"].value == "Drake"
    assert found["include_artist"].value == "Rihanna"
    assert kinds("must include Essence")["include_song"].strength == "hard"


def test_generic_words_are_not_mistaken_for_artists():
    found = intent.parse("no repeats and no slow songs, no rendering")
    assert not [rule for rule in found if rule.kind == "exclude_artist"]


@pytest.mark.parametrize(
    ("text", "has_proposal", "expected"),
    [
        ("why did you pick the third song?", True, "question"),
        ("how many songs are ready?", False, "question"),
        ("make me 10 songs", False, "plan"),
        ("make another one", True, "plan"),
        ("swap the second one for something slower", True, "revise"),
        ("remove Drake", True, "revise"),
        ("no Drake", True, "revise"),
        ("approve it", True, "approve"),
        ("remember that I hate long intros", False, "remember"),
        ("hello", False, "chat"),
    ],
)
def test_turn_kinds(text, has_proposal, expected):
    assert intent.classify(text, has_proposal) == expected


def test_a_question_never_counts_as_a_build_request():
    # LU-300-05: read-only explanation never generates a revision
    assert intent.classify("what would happen if we removed song 2?", True) == "question"


def test_latest_rule_supersedes_only_its_own_slot():
    old = intent.parse("12 songs, no Drake, slow burn", "t1")
    new = intent.parse("8 songs", "t2")
    merged = intent.merge(old, new)
    live = {rule.kind: rule for rule in intent.active(merged)}
    assert live["count"].value == 8
    assert live["count"].supersedes is not None
    assert live["exclude_artist"].value == "Drake"  # unrelated rules survive
    assert live["energy_arc"].value == "slow_burn"
    superseded = [rule for rule in merged if rule.status == "superseded"]
    assert [rule.kind for rule in superseded] == ["count"]


def test_including_an_excluded_artist_replaces_the_exclusion():
    merged = intent.merge(intent.parse("no Drake"), intent.parse("with Drake"))
    assert [rule.kind for rule in intent.active(merged)] == ["include_artist"]


def test_ready_only_and_prefer_ready_share_one_slot():
    merged = intent.merge(intent.parse("only already ready transitions"),
                          intent.parse("you can render new ones"))
    assert [rule.kind for rule in intent.active(merged)] == ["prefer_ready"]


def test_contradictions_are_reported_not_resolved():
    rules = [
        Constraint("exclude_artist", "drake", "Drake", "hard"),
        Constraint("start_with", "", "Drake", "hard"),
    ]
    problems = intent.contradictions(rules)
    assert problems and "both wanted and ruled out" in problems[0]["text"]
    same_ends = [
        Constraint("count", "", 5, "hard"),
        Constraint("start_with", "", "Song A", "hard"),
        Constraint("end_with", "", "Song A", "hard"),
    ]
    assert intent.contradictions(same_ends)
    too_many = [Constraint("count", "", 1, "hard"),
                Constraint("include_song", "a", "A", "hard"),
                Constraint("include_song", "b", "B", "hard")]
    assert any("only has 1" in p["text"] for p in intent.contradictions(too_many))


def test_removing_a_rule_marks_only_that_rule():
    rules = intent.parse("12 songs, no Drake")
    target = rules[0]
    after = intent.remove(rules, target.id)
    assert [rule.status for rule in after] == ["removed", "active"]


def test_critique_edits():
    ops = intent.critique_ops("swap the second one for something slower and remove Drake")
    assert {"op": "remove", "target": "Drake"} in ops
    assert {"op": "replace", "target": "the second one", "with": "something slower"} in ops
    move = intent.critique_ops("move Paper Moon to the end")
    assert move == [{"op": "move", "target": "Paper Moon", "direction": "later", "to_edge": True}]
    assert intent.critique_ops("add two more songs") == [{"op": "grow", "by": 2}]
    assert intent.critique_ops("lock Neon Rain") == [{"op": "lock", "target": "Neon Rain"}]


def test_rules_round_trip_through_a_snapshot():
    rule = intent.parse("only already ready transitions", "turn_9")[0]
    again = Constraint.from_dict({**rule.as_dict(), "label": "ignored"})
    assert again == rule
    assert intent.describe(rule) == "Only transitions that are already ready to play"
