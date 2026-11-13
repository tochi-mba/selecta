"""Pause, resume, stop, manual takeover and hand back: staff controls Autopilot can't block
(AV-0424-03).

Every control here is a staff move on `NightSession`, which never consults Autopilot's guard,
level or plan. From every live state (warming, live, paused, manual takeover, winding down) pause,
stop and take over always succeed; repeating one that already holds (pausing a paused session) is
accepted and changes nothing, so a nervous double tap is never an error. Stop works from every
state but ended, including setup and failed, and take over works after a failure so a person can
keep the music going.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from selecta.autopilot.night_session import (
    Actor,
    NightSession,
    SessionError,
    SessionState,
    Transition,
)

S = SessionState

CONTROLS = ("pause", "resume", "stop", "take_over", "hand_back")


@dataclass(frozen=True)
class ControlResult:
    control: str
    changed: bool
    state: SessionState
    transition: Transition | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "control": self.control,
            "changed": self.changed,
            "state": self.state.value,
            "transition": self.transition.to_dict() if self.transition else None,
        }


def _target(session: NightSession, control: str, hand_back_to: SessionState) -> SessionState:
    state = session.state
    if control == "pause":
        return S.PAUSED
    if control == "stop":
        return S.ENDED
    if control == "take_over":
        return S.MANUAL_TAKEOVER
    if control == "resume":
        if state is not S.PAUSED or session.paused_from is None:
            raise SessionError("not_paused", "Only a paused session can resume.")
        return session.paused_from
    if control == "hand_back":
        if state is not S.MANUAL_TAKEOVER:
            raise SessionError("not_taken_over", "Only a session a person took over can be "
                               "handed back.")
        if hand_back_to not in {S.LIVE, S.WINDING_DOWN}:
            raise SessionError("bad_hand_back", "Hand back goes to live or winding down.")
        return hand_back_to
    raise SessionError("unknown_control", f"There's no control called {control!r}.")


def apply(
    session: NightSession,
    control: str,
    *,
    reason: str = "",
    hand_back_to: SessionState = S.LIVE,
) -> ControlResult:
    """Run one staff control. Raises `SessionError` only for a control that has no meaning in
    the current state (resume when not paused, anything after ended except stop)."""
    with session._lock:
        target = _target(session, control, SessionState(hand_back_to))
        if session.state is target:
            return ControlResult(control, False, session.state)
        if control == "pause" and session.state in {S.SETUP, S.FAILED}:
            # Nothing is playing yet or any more, so there is nothing to pause.
            return ControlResult(control, False, session.state)
        step = session.move(target, Actor.STAFF, reason or control)
        return ControlResult(control, True, session.state, step)


def pause(session: NightSession, reason: str = "") -> ControlResult:
    return apply(session, "pause", reason=reason)


def resume(session: NightSession, reason: str = "") -> ControlResult:
    return apply(session, "resume", reason=reason)


def stop(session: NightSession, reason: str = "") -> ControlResult:
    return apply(session, "stop", reason=reason)


def take_over(session: NightSession, reason: str = "") -> ControlResult:
    return apply(session, "take_over", reason=reason)


def hand_back(session: NightSession, to: SessionState = S.LIVE, reason: str = "") -> ControlResult:
    return apply(session, "hand_back", reason=reason, hand_back_to=to)


def available_controls(session: NightSession) -> list[str]:
    """The controls a person can use now, for the UI and API."""
    state = session.state
    if state is S.ENDED:
        return []
    found = ["stop"]
    if state in {S.WARMING, S.LIVE, S.MANUAL_TAKEOVER, S.WINDING_DOWN, S.PAUSED}:
        found.append("pause")
    if state is S.PAUSED:
        found.append("resume")
    if state is not S.SETUP:
        found.append("take_over")
    if state is S.MANUAL_TAKEOVER:
        found.append("hand_back")
    return [c for c in CONTROLS if c in found]


__all__ = [
    "CONTROLS",
    "ControlResult",
    "apply",
    "available_controls",
    "hand_back",
    "pause",
    "resume",
    "stop",
    "take_over",
]
