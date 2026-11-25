"""When a room's taps are enough to mean something (ADR-0488).

A heart is one guest's. The planner should learn from rooms, not from one person, and never
from one person joining many times, so a room adds to what the planner knows only once enough
of the people in it agreed. The big screen says "the room loved that blend" on a slightly
higher bar, because saying it aloud to a room that mostly did not tap would be untrue.

Both bars are a head count and a share of the guests online, and both must be met.
"""

from __future__ import annotations

import math

LOVE = "love"
BLEND = "blend"
KINDS = (LOVE, BLEND)

TEACH_GUESTS = 2
TEACH_SHARE = 0.15
SAY_GUESTS = 3
SAY_SHARE = 0.20


def _past(taps: int, online: int, guests: int, share: float) -> bool:
    return taps >= guests and taps >= math.ceil(share * max(online, 1))


def room_counts(taps: int, online: int) -> bool:
    """Does this room's love for a song or a blend count towards what the planner learns?"""
    return _past(taps, online, TEACH_GUESTS, TEACH_SHARE)


def worth_saying(taps: int, online: int) -> bool:
    """Did enough of the room tap for the big screen to say the room loved it?"""
    return _past(taps, online, SAY_GUESTS, SAY_SHARE)


__all__ = ["BLEND", "KINDS", "LOVE", "room_counts", "worth_saying"]
