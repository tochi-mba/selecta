"""The repair rule: what to do after a take is rendered and heard.

A studio renders a candidate, audits it, and hands the audit's numbers back here as `AuditFacts`.
The rule says what comes next: accept it, try another candidate (the one most likely to fix what
failed), tighten the beats and render again, or give up to the fallback cut. It reads nothing but
the ranked options and the facts, so the Desktop, a cloud worker and the member's browser all
decide the same way. Everything here has a JSON form for that browser port.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

MAX_REPAIRS = 4
"""Renders after the first before giving up to the fallback cut."""

NEAR_MISS = {"beat alignment": 20.0, "level fall": 3.0, "entry level": 1.5}
"""How far past its limit a check may land and still count as a near miss."""

BEAT_CHECK = "beat alignment"

ACCEPT = "accept"
TRY = "try"
TIGHTEN = "tighten"
KEEP = "keep"
FALLBACK = "fallback"

RULE_SCHEMA = 1
_TAG = "$type"


def _number(value: float) -> float | dict:
    value = float(value)
    if math.isfinite(value):
        return value
    return {_TAG: "float", "value": repr(value)}


def _read_number(value: Any) -> float:
    if isinstance(value, dict) and value.get(_TAG) == "float":
        return float(value["value"])
    return float(value)


@dataclass(frozen=True)
class FailedCheck:
    """One audit check that didn't pass: its name, how it measured, its limit, and the fix it
    names (`shorten`, `move_cue`, `close_gap`, `change_recipe` or none)."""

    name: str
    value: float
    limit: float
    fix: str | None = None

    def to_json(self) -> dict:
        return {
            "name": self.name,
            "value": _number(self.value),
            "limit": _number(self.limit),
            "fix": self.fix,
        }

    @classmethod
    def from_json(cls, data: dict) -> FailedCheck:
        return cls(
            str(data["name"]),
            _read_number(data["value"]),
            _read_number(data["limit"]),
            data.get("fix"),
        )


@dataclass(frozen=True)
class AuditFacts:
    """What the rule reads from an audit: whether it passed, and each failed check."""

    passed: bool
    failures: tuple[FailedCheck, ...] = ()

    def to_json(self) -> dict:
        return {"passed": self.passed, "failures": [check.to_json() for check in self.failures]}

    @classmethod
    def from_json(cls, data: dict) -> AuditFacts:
        return cls(
            bool(data["passed"]),
            tuple(FailedCheck.from_json(item) for item in data.get("failures") or ()),
        )


def _cue_json(cue: tuple) -> list:
    bar, time, kind, quality, vocal_free_bars = cue
    return [int(bar), _number(time), str(kind), _number(quality), int(vocal_free_bars)]


def _read_cue(data: list) -> tuple:
    bar, time, kind, quality, vocal_free_bars = data
    return (int(bar), _read_number(time), str(kind), _read_number(quality), int(vocal_free_bars))


@dataclass(frozen=True)
class Option:
    """One ranked candidate as the rule sees it. Each cue is every field of the `Cue`, in order,
    so two cues compare exactly as the dataclasses do."""

    move: str
    bars: int
    exit_cue: tuple
    entry_cue: tuple

    @property
    def key(self) -> tuple:
        """What makes two candidates the same attempt: move, exit bar, entry bar and length."""
        return (self.move, self.exit_cue[0], self.entry_cue[0], self.bars)

    @classmethod
    def of(cls, candidate: Any) -> Option:
        """The rule's view of a `planner_core.choose.Candidate`."""
        return cls(
            candidate.recipe.name,
            candidate.bars,
            _cue_fields(candidate.exit_cue),
            _cue_fields(candidate.entry_cue),
        )

    def to_json(self) -> dict:
        return {
            "move": self.move,
            "bars": int(self.bars),
            "exit_cue": _cue_json(self.exit_cue),
            "entry_cue": _cue_json(self.entry_cue),
        }

    @classmethod
    def from_json(cls, data: dict) -> Option:
        return cls(
            str(data["move"]),
            int(data["bars"]),
            _read_cue(data["exit_cue"]),
            _read_cue(data["entry_cue"]),
        )


def _cue_fields(cue: Any) -> tuple:
    return (cue.bar, cue.time, cue.kind, cue.quality, cue.vocal_free_bars)


@dataclass(frozen=True)
class Attempted:
    """One option the studio tried, by its place in the ranked list. No audit means the recipe
    couldn't build a script there, so nothing was rendered and no render is counted."""

    option: int
    audit: AuditFacts | None = None

    def to_json(self) -> dict:
        return {
            "option": self.option,
            "audit": None if self.audit is None else self.audit.to_json(),
        }

    @classmethod
    def from_json(cls, data: dict) -> Attempted:
        audit = data.get("audit")
        return cls(int(data["option"]), None if audit is None else AuditFacts.from_json(audit))


@dataclass(frozen=True)
class RepairStep:
    """What to do next. `option` is the place in the ranked list to render (TRY) or the one that
    passed (ACCEPT). `take` says which take to keep after tightening: 0 the first, 1 the second."""

    action: str
    option: int | None = None
    take: int | None = None

    def to_json(self) -> dict:
        return {
            "schema": RULE_SCHEMA,
            "action": self.action,
            "option": self.option,
            "take": self.take,
        }

    @classmethod
    def from_json(cls, data: dict) -> RepairStep:
        option, take = data.get("option"), data.get("take")
        return cls(
            str(data["action"]),
            None if option is None else int(option),
            None if take is None else int(take),
        )


def closer(facts: AuditFacts, than: AuditFacts) -> bool:
    """Is this take nearer to clean than that one? Fewer failures first, then by how far over."""

    def miss(f: AuditFacts) -> tuple[int, float]:
        return len(f.failures), sum(c.value - c.limit for c in f.failures)

    return miss(facts) < miss(than)


def good_enough(facts: AuditFacts) -> bool:
    """Passed, or only a near miss on checks that have proved stricter than the ear. The beat
    check misreads syncopated drums, so a near miss still beats going silent - but of the rated
    seams, every one that shipped with a warning was disliked, so a near miss is only played
    when not even a clean cut can be had."""
    for check in facts.failures:
        slack = NEAR_MISS.get(check.name)
        if slack is None or check.value > check.limit + slack:
            return False
    return True


def _following(
    failed: Option, facts: AuditFacts, options: Sequence[Option], tried: set
) -> int | None:
    """The untried option most likely to fix what just failed, by its place in the list."""
    fixes = {check.fix for check in facts.failures}
    remaining = [(i, o) for i, o in enumerate(options) if o.key not in tried]
    if "shorten" in fixes:
        shorter = [i for i, o in remaining if o.move == failed.move and o.bars < failed.bars]
        if shorter:
            return shorter[0]
    if "move_cue" in fixes or "close_gap" in fixes:
        moved = [
            i
            for i, o in remaining
            if o.move == failed.move
            and (o.exit_cue != failed.exit_cue or o.entry_cue != failed.entry_cue)
        ]
        if moved:
            return moved[0]
    other = [i for i, o in remaining if o.move != failed.move]
    return other[0] if other else (remaining[0][0] if remaining else None)


def next_step(
    options: Sequence[Option],
    attempts: Sequence[Attempted],
    max_repairs: int = MAX_REPAIRS,
) -> RepairStep:
    """What to do after these attempts, best ranked option first.

    ACCEPT the last take if it passed. Otherwise TRY the option most likely to fix what failed: a
    shorter overlap of the same move for `shorten`, other cues for the same move for `move_cue` or
    `close_gap`, else another move, else anything untried. A recipe that built no script just
    moves on to the next untried option in rank order. FALLBACK once nothing is left, or once more
    than `max_repairs` renders after the first have failed.
    """
    renders = sum(attempt.audit is not None for attempt in attempts)
    if not attempts:
        following = 0 if options else None
    else:
        last = attempts[-1]
        if last.audit is not None and last.audit.passed:
            return RepairStep(ACCEPT, last.option)
        tried = {options[attempt.option].key for attempt in attempts}
        if last.audit is None:
            following = next((i for i, o in enumerate(options) if o.key not in tried), None)
        else:
            following = _following(options[last.option], last.audit, options, tried)
    if following is None or renders > max_repairs:
        return RepairStep(FALLBACK)
    return RepairStep(TRY, following)


def take_step(first: AuditFacts, second: AuditFacts | None = None) -> RepairStep:
    """For one take: TIGHTEN when the beats missed, since the render measures exactly how far
    apart they landed and a second take can close a steady gap. Then KEEP whichever take is
    closer to clean (`take` 1 only if the second is strictly closer)."""
    if second is None:
        if any(check.name == BEAT_CHECK for check in first.failures):
            return RepairStep(TIGHTEN)
        return RepairStep(KEEP, take=0)
    return RepairStep(KEEP, take=1 if closer(second, first) else 0)
