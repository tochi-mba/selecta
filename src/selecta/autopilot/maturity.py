"""Autonomy maturity levels for Autopilot, as data plus the rules for each (AV-0424-01).

Five levels, from L0 (a person does everything, SelectaDJ only suggests) to L4 (SelectaDJ runs a
whole evening unattended inside the venue's policy). Each level lists exactly which Autopilot
actions it permits; anything not listed is refused. Human controls (pause, resume, stop, manual
takeover, hand back) are not Autopilot actions and are never gated by a level: every level keeps
them, which `night_session` enforces as well.

A level is only usable when its prerequisites are met: L3 and L4 need a published venue policy,
L4 needs explicit staff consent for an unattended evening. `highest_permitted` says the highest
level a venue can run right now, never a level whose prerequisites are missing.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, IntEnum
from typing import Any


class MaturityLevel(IntEnum):
    L0_MANUAL = 0
    L1_SUGGEST = 1
    L2_SUPERVISED = 2
    L3_ATTENDED = 3
    L4_UNATTENDED = 4


class Action(str, Enum):
    """Things Autopilot itself may do, never a staff member's own control."""

    SUGGEST_NEXT = "suggest_next"
    QUEUE_WITH_CONFIRMATION = "queue_with_confirmation"
    CHOOSE_NEXT = "choose_next"
    START_TRANSITION = "start_transition"
    REPLAN_HORIZON = "replan_horizon"
    MOVE_BETWEEN_DAYPARTS = "move_between_dayparts"
    WIND_DOWN_AT_CLOSE = "wind_down_at_close"
    RUN_WITHOUT_STAFF = "run_without_staff"


# Staff controls that no level may remove or gate.
HUMAN_CONTROLS = ("pause", "resume", "stop", "take_over", "hand_back")


@dataclass(frozen=True)
class LevelRules:
    level: MaturityLevel
    name: str
    summary: str
    actions: frozenset[Action]
    needs_policy: bool = False
    needs_unattended_consent: bool = False
    staff_present: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "level": int(self.level),
            "code": f"L{int(self.level)}",
            "name": self.name,
            "summary": self.summary,
            "actions": sorted(a.value for a in self.actions),
            "human_controls": list(HUMAN_CONTROLS),
            "needs_policy": self.needs_policy,
            "needs_unattended_consent": self.needs_unattended_consent,
            "staff_present": self.staff_present,
        }


_L1 = frozenset({Action.SUGGEST_NEXT, Action.QUEUE_WITH_CONFIRMATION})
_L2 = _L1 | {Action.CHOOSE_NEXT, Action.START_TRANSITION}
_L3 = _L2 | {Action.REPLAN_HORIZON, Action.MOVE_BETWEEN_DAYPARTS, Action.WIND_DOWN_AT_CLOSE}
_L4 = _L3 | {Action.RUN_WITHOUT_STAFF}

LEVELS: dict[MaturityLevel, LevelRules] = {
    MaturityLevel.L0_MANUAL: LevelRules(
        MaturityLevel.L0_MANUAL, "Manual",
        "A person chooses and plays every song. SelectaDJ does nothing on its own.",
        frozenset()),
    MaturityLevel.L1_SUGGEST: LevelRules(
        MaturityLevel.L1_SUGGEST, "Suggestions",
        "SelectaDJ suggests the next song; a person confirms each one before it is queued.",
        _L1),
    MaturityLevel.L2_SUPERVISED: LevelRules(
        MaturityLevel.L2_SUPERVISED, "Supervised",
        "SelectaDJ picks and blends the next songs while a person watches.",
        _L2),
    MaturityLevel.L3_ATTENDED: LevelRules(
        MaturityLevel.L3_ATTENDED, "Attended evening",
        "SelectaDJ plans ahead across dayparts within the venue policy, with staff nearby.",
        _L3, needs_policy=True),
    MaturityLevel.L4_UNATTENDED: LevelRules(
        MaturityLevel.L4_UNATTENDED, "Unattended evening",
        "SelectaDJ runs the evening within the venue policy without staff watching.",
        _L4, needs_policy=True, needs_unattended_consent=True, staff_present=False),
}


def rules(level: MaturityLevel | int) -> LevelRules:
    return LEVELS[MaturityLevel(level)]


def may(level: MaturityLevel | int, action: Action | str) -> bool:
    """Whether Autopilot at `level` may take `action`. Unknown actions are refused."""
    try:
        wanted = Action(action)
    except ValueError:
        return False
    return wanted in rules(level).actions


def is_human_control(name: str) -> bool:
    return name in HUMAN_CONTROLS


def missing_for(
    level: MaturityLevel | int, *, has_policy: bool, unattended_consent: bool
) -> list[str]:
    """What stops a venue running at `level`; empty when nothing does."""
    need = rules(level)
    found: list[str] = []
    if need.needs_policy and not has_policy:
        found.append("venue_policy")
    if need.needs_unattended_consent and not unattended_consent:
        found.append("unattended_consent")
    return found


def highest_permitted(*, has_policy: bool, unattended_consent: bool) -> MaturityLevel:
    for level in sorted(MaturityLevel, reverse=True):
        if not missing_for(level, has_policy=has_policy, unattended_consent=unattended_consent):
            return level
    return MaturityLevel.L0_MANUAL


__all__ = [
    "HUMAN_CONTROLS",
    "LEVELS",
    "Action",
    "LevelRules",
    "MaturityLevel",
    "highest_permitted",
    "is_human_control",
    "may",
    "missing_for",
    "rules",
]
