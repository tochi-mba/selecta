"""The repair rule decides exactly as the render loop in planner/choose.py and seam_making did.

Every case below was worked out from the loop as it stood before the planner core (choose.py's
`choose_transition` and `_next_candidate`, seam_making's `tighten_beats` and `_closer`, and
seam_kinds' `good_enough`), and `_old_loop` replays that loop's choices for a direct comparison.
"""

from __future__ import annotations

import itertools
import json
import math

import numpy as np
import pytest

from selecta.analysis.song import Cue
from selecta.planner_core.choose import Candidate, _key
from selecta.planner_core.recipes import Recipe
from selecta.planner_core.repair import (
    ACCEPT,
    FALLBACK,
    KEEP,
    MAX_REPAIRS,
    TIGHTEN,
    TRY,
    Attempted,
    AuditFacts,
    FailedCheck,
    Option,
    RepairStep,
    closer,
    good_enough,
    next_step,
    take_step,
)


def _cue(bar: int, kind: str = "chorus") -> tuple:
    return (bar, bar * 2.0, kind, 0.8, 0)


BLEND_16 = Option("bass_swap_blend", 16, _cue(100), _cue(8))
BLEND_8 = Option("bass_swap_blend", 8, _cue(100), _cue(8))
BLEND_16_MOVED = Option("bass_swap_blend", 16, _cue(96), _cue(8))
ECHO = Option("echo_out", 0, _cue(100), _cue(8))
CUT = Option("cut_on_one", 0, _cue(100), _cue(8))
POOL = [BLEND_16, BLEND_8, BLEND_16_MOVED, ECHO, CUT]

PASSED = AuditFacts(True)


def _failed(*fixes: str | None) -> AuditFacts:
    checks = tuple(FailedCheck(f"check {i}", 2.0, 1.0, fix) for i, fix in enumerate(fixes))
    return AuditFacts(False, checks)


@pytest.mark.parametrize(
    ("pool", "attempts", "max_repairs", "expected"),
    [
        # the best ranked option goes first; nothing ranked, or no renders allowed, is the cut
        (POOL, [], MAX_REPAIRS, RepairStep(TRY, 0)),
        ([], [], MAX_REPAIRS, RepairStep(FALLBACK)),
        (POOL, [], -1, RepairStep(FALLBACK)),
        # a take that passed is kept
        (POOL, [Attempted(0, PASSED)], MAX_REPAIRS, RepairStep(ACCEPT, 0)),
        (POOL, [Attempted(0, _failed("shorten")), Attempted(1, PASSED)], 4, RepairStep(ACCEPT, 1)),
        # shorten: the same move, shorter
        (POOL, [Attempted(0, _failed("shorten"))], MAX_REPAIRS, RepairStep(TRY, 1)),
        # move_cue or close_gap: the same move at other cues (8 bars sits at the same cues)
        (POOL, [Attempted(0, _failed("move_cue"))], MAX_REPAIRS, RepairStep(TRY, 2)),
        (POOL, [Attempted(0, _failed("close_gap"))], MAX_REPAIRS, RepairStep(TRY, 2)),
        # any other fix, or none named: another move
        (POOL, [Attempted(0, _failed("change_recipe"))], MAX_REPAIRS, RepairStep(TRY, 3)),
        (POOL, [Attempted(0, _failed(None))], MAX_REPAIRS, RepairStep(TRY, 3)),
        # shorten with nothing shorter left falls through to another move
        (POOL, [Attempted(1, _failed("shorten"))], MAX_REPAIRS, RepairStep(TRY, 3)),
        # shorten is looked at before move_cue when both are named
        (POOL, [Attempted(0, _failed("move_cue", "shorten"))], MAX_REPAIRS, RepairStep(TRY, 1)),
        # with no other move left, anything untried
        (
            [BLEND_16, BLEND_8],
            [Attempted(0, _failed("change_recipe"))],
            MAX_REPAIRS,
            RepairStep(TRY, 1),
        ),
        # everything tried: the cut
        ([BLEND_16], [Attempted(0, _failed("shorten"))], MAX_REPAIRS, RepairStep(FALLBACK)),
        # a recipe that built no script moves on in rank order, whatever came before
        (POOL, [Attempted(0, None)], MAX_REPAIRS, RepairStep(TRY, 1)),
        (POOL, [Attempted(3, _failed("shorten")), Attempted(0, None)], 4, RepairStep(TRY, 1)),
        # renders after the first are capped at max_repairs; scripts never built don't count
        (POOL, [Attempted(i, _failed("change_recipe")) for i in range(4)], 4, RepairStep(TRY, 4)),
        (POOL, [Attempted(i, _failed("change_recipe")) for i in range(5)], 4, RepairStep(FALLBACK)),
        (POOL, [Attempted(0, _failed(None)), Attempted(3, _failed(None))], 1, RepairStep(FALLBACK)),
        (POOL, [Attempted(0, None), Attempted(1, _failed(None))], 0, RepairStep(FALLBACK)),
        (POOL, [Attempted(0, None), Attempted(1, None)], 0, RepairStep(TRY, 2)),
    ],
)
def test_next_step_matches_the_old_loop(pool, attempts, max_repairs, expected):
    assert next_step(pool, attempts, max_repairs) == expected


def test_an_option_with_the_same_key_as_one_tried_is_never_tried_again():
    twin = Option("bass_swap_blend", 16, (100, 9.9, "verse", 0.1, 2), (8, 1.0, "verse", 0.2, 1))
    pool = [BLEND_16, twin, ECHO]
    assert next_step(pool, [Attempted(0, None)]) == RepairStep(TRY, 2)


def test_option_key_is_the_loops_candidate_key():
    exit_cue, entry_cue = Cue(100, 200.5, "after chorus", 0.9, 2), Cue(8, 16.0, "chorus", 0.7, 0)
    candidate = Candidate(Recipe("bass_swap_blend", None, True), exit_cue, entry_cue, 16, 0.5)
    option = Option.of(candidate)
    assert option.key == _key(candidate)
    assert option.exit_cue == (100, 200.5, "after chorus", 0.9, 2)


def _old_loop(pool: list[Option], audits: dict[int, AuditFacts | None], max_repairs: int):
    """choose_transition and _next_candidate as they were, over options, returning the order
    tried and how it ended. `audits` says what each option's take heard (None: no script)."""

    def key(o):
        return (o.move, o.exit_cue[0], o.entry_cue[0], o.bars)

    def next_candidate(failed, report, tried):
        fixes = {check.fix for check in report.failures}
        remaining = [c for c in pool if key(c) not in tried]
        if "shorten" in fixes:
            shorter = [c for c in remaining if c.move == failed.move and c.bars < failed.bars]
            if shorter:
                return shorter[0]
        if "move_cue" in fixes or "close_gap" in fixes:
            moved = [
                c
                for c in remaining
                if c.move == failed.move
                and (c.exit_cue != failed.exit_cue or c.entry_cue != failed.entry_cue)
            ]
            if moved:
                return moved[0]
        other = [c for c in remaining if c.move != failed.move]
        return other[0] if other else (remaining[0] if remaining else None)

    tried, order = set(), []
    candidate = pool[0] if pool else None
    renders = 0
    while candidate is not None and renders <= max_repairs:
        tried.add(key(candidate))
        index = pool.index(candidate)
        order.append(index)
        report = audits[index]
        if report is None:
            candidate = next((c for c in pool if key(c) not in tried), None)
            continue
        renders += 1
        if report.passed:
            return order, ("accept", index)
        candidate = next_candidate(candidate, report, tried)
    return order, ("fallback", None)


def _new_loop(pool: list[Option], audits: dict[int, AuditFacts | None], max_repairs: int):
    attempts, order = [], []
    step = next_step(pool, attempts, max_repairs)
    while step.action == TRY:
        order.append(step.option)
        attempts.append(Attempted(step.option, audits[step.option]))
        step = next_step(pool, attempts, max_repairs)
        if step.action == ACCEPT:
            return order, ("accept", step.option)
    return order, ("fallback", None)


HEARD = [None, PASSED, _failed("shorten"), _failed("move_cue"), _failed("change_recipe")]


@pytest.mark.parametrize("max_repairs", [0, 1, 4])
def test_the_rule_replays_the_old_loop_over_every_mix_of_outcomes(max_repairs):
    pool = POOL[:4]
    for outcome in itertools.product(HEARD, repeat=len(pool)):
        audits = dict(enumerate(outcome))
        assert _new_loop(pool, audits, max_repairs) == _old_loop(pool, audits, max_repairs)


def test_take_step_tightens_only_when_the_beats_missed_then_keeps_the_closer_take():
    beats = AuditFacts(False, (FailedCheck("beat alignment", 30.0, 20.0, "change_recipe"),))
    other = AuditFacts(False, (FailedCheck("harmony", 0.3, 0.16, "shorten"),))
    assert take_step(PASSED) == RepairStep(KEEP, take=0)
    assert take_step(other) == RepairStep(KEEP, take=0)
    assert take_step(beats) == RepairStep(TIGHTEN)
    # fewer failures wins, then less over the limits; a tie keeps the first take
    assert take_step(beats, PASSED) == RepairStep(KEEP, take=1)
    assert take_step(beats, beats) == RepairStep(KEEP, take=0)
    nearer = AuditFacts(False, (FailedCheck("beat alignment", 22.0, 20.0, "change_recipe"),))
    assert take_step(beats, nearer) == RepairStep(KEEP, take=1)
    two = AuditFacts(False, beats.failures + other.failures)
    assert take_step(beats, two) == RepairStep(KEEP, take=0)


def test_closer_counts_failures_before_how_far_over():
    one_far = AuditFacts(False, (FailedCheck("a", 10.0, 1.0),))
    two_near = AuditFacts(False, (FailedCheck("a", 1.1, 1.0), FailedCheck("b", 1.1, 1.0)))
    assert closer(one_far, two_near)
    assert not closer(two_near, one_far)
    assert not closer(one_far, one_far)


def _near(*checks: tuple[str, float, float]) -> AuditFacts:
    return AuditFacts(not checks, tuple(FailedCheck(n, v, limit) for n, v, limit in checks))


def test_good_enough_allows_only_near_misses_on_the_checks_stricter_than_the_ear():
    assert good_enough(_near())
    assert good_enough(_near(("beat alignment", 35.0, 20.0)))
    assert good_enough(_near(("beat alignment", 40.0, 20.0)))
    assert not good_enough(_near(("beat alignment", 60.0, 20.0)))
    assert good_enough(_near(("level fall", 6.5, 3.5)))
    assert not good_enough(_near(("level fall", 6.6, 3.5)))
    assert good_enough(_near(("entry level", 4.0, 2.5)))
    assert not good_enough(_near(("quiet time", 3.0, 1.2)))
    assert not good_enough(_near(("beat alignment", 35.0, 20.0), ("harmony", 2.0, 1.0)))


def _through_text(data: dict) -> dict:
    return json.loads(json.dumps(data))


def test_audit_facts_and_every_rule_value_round_trip_through_json():
    facts = AuditFacts(
        False,
        (
            FailedCheck("beat alignment", 31.25, 20.0, "change_recipe"),
            FailedCheck("true peak", math.inf, -1.0, None),
            FailedCheck("harmony", 0.1 + 0.2, 0.16, "shorten"),
        ),
    )
    back = AuditFacts.from_json(_through_text(facts.to_json()))
    assert back == facts
    assert AuditFacts.from_json(_through_text(PASSED.to_json())) == PASSED

    exit_cue = (64, np.float64(123.456789), "after chorus", 0.75, 3)
    option = Option("filter_sweep", 8, exit_cue, _cue(0))
    assert Option.from_json(_through_text(option.to_json())) == option
    for attempt in (Attempted(2, facts), Attempted(0, None)):
        assert Attempted.from_json(_through_text(attempt.to_json())) == attempt
    for step in (
        RepairStep(TRY, 3),
        RepairStep(ACCEPT, 0),
        RepairStep(FALLBACK),
        RepairStep(TIGHTEN),
        RepairStep(KEEP, take=1),
    ):
        data = _through_text(step.to_json())
        assert data["schema"] == 1
        assert RepairStep.from_json(data) == step


def test_the_rule_decides_the_same_from_json_as_from_objects():
    attempts = [Attempted(0, _failed("move_cue")), Attempted(2, None)]
    pool = [Option.from_json(_through_text(o.to_json())) for o in POOL]
    heard = [Attempted.from_json(_through_text(a.to_json())) for a in attempts]
    assert next_step(pool, heard) == next_step(POOL, attempts)
