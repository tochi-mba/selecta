"""The rotating on-screen code (ADR-0451, BZ-0451-03).

In on-screen mode the zone's big screen shows a short code that changes every 15 minutes, and a
request is only taken with the code showing now. The code is derived, never stored: an HMAC of
the room's screen seed and the window number under the rooms pepper, mapped onto the same
alphabet as room codes (`selecta.rooms.codes.derive`). Four characters (about 20 bits) is plenty
for a code that lives 15 minutes behind the guest rate limits.

Grace: for `SCREEN_GRACE_S` (60 s) after the code changes, the previous window's code is still
accepted, so a guest who typed it just as it changed isn't refused.
"""

from __future__ import annotations

from selecta.business.rooms.settings import SCREEN_GRACE_S, SCREEN_WINDOW_S
from selecta.rooms import codes

LENGTH = 4


def window(at: float) -> int:
    return int(at // SCREEN_WINDOW_S)


def code_for(seed: str, pepper: bytes, at: float) -> str:
    return codes.derive(f"screen:{seed}:{window(at)}", pepper, LENGTH)


def changes_at(at: float) -> float:
    return (window(at) + 1) * SCREEN_WINDOW_S


def matches(seed: str, pepper: bytes, typed: str | None, at: float) -> bool:
    if not typed:
        return False
    try:
        typed = codes.normalise(typed, LENGTH)
    except codes.InvalidCode:
        return False
    if typed == code_for(seed, pepper, at):
        return True
    started = window(at) * SCREEN_WINDOW_S
    return at - started < SCREEN_GRACE_S and typed == code_for(seed, pepper, started - 1)


__all__ = ["LENGTH", "changes_at", "code_for", "matches", "window"]
