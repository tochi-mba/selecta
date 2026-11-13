"""A venue's night session and the legal moves between its states (AV-0424-02).

States: setup, warming, live, paused, manual takeover, winding down, ended, failed. `LEGAL` lists
every move each state allows; anything else is refused with `SessionError`. Who makes a move
matters:

- Staff may make any legal move. Staff moves never ask Autopilot: no Autopilot guard, plan or
  failure can block pause, stop or manual takeover (see `takeover.py`, AV-0424-03).
- Autopilot may only make the few forward moves in `AUTOPILOT_MOVES`, only when its maturity
  level permits the matching action, and only after the optional `guard` agrees. It can never
  leave paused or manual takeover; only a person resumes or hands back.
- The system (a crash, a lost device) may move any live state to failed. From failed, staff can
  still take over or stop.

Pause remembers the state it paused, and resume returns exactly there.

Sessions are kept in memory by `SessionStore` (one per Cloud process), a reference model until
a table exists; a restart forgets them (recorded as remaining work on ADR-0424).
"""

from __future__ import annotations

import itertools
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from selecta.autopilot.maturity import Action, MaturityLevel, may


class SessionState(StrEnum):
    SETUP = "setup"
    WARMING = "warming"
    LIVE = "live"
    PAUSED = "paused"
    MANUAL_TAKEOVER = "manual_takeover"
    WINDING_DOWN = "winding_down"
    ENDED = "ended"
    FAILED = "failed"


class Actor(StrEnum):
    STAFF = "staff"
    AUTOPILOT = "autopilot"
    SYSTEM = "system"


S = SessionState

LEGAL: dict[SessionState, frozenset[SessionState]] = {
    S.SETUP: frozenset({S.WARMING, S.ENDED, S.FAILED}),
    S.WARMING: frozenset({S.LIVE, S.PAUSED, S.MANUAL_TAKEOVER, S.WINDING_DOWN, S.ENDED,
                          S.FAILED}),
    S.LIVE: frozenset({S.PAUSED, S.MANUAL_TAKEOVER, S.WINDING_DOWN, S.ENDED, S.FAILED}),
    S.PAUSED: frozenset({S.WARMING, S.LIVE, S.WINDING_DOWN, S.MANUAL_TAKEOVER, S.ENDED,
                         S.FAILED}),
    S.MANUAL_TAKEOVER: frozenset({S.LIVE, S.WINDING_DOWN, S.PAUSED, S.ENDED, S.FAILED}),
    S.WINDING_DOWN: frozenset({S.ENDED, S.PAUSED, S.MANUAL_TAKEOVER, S.FAILED}),
    S.FAILED: frozenset({S.MANUAL_TAKEOVER, S.ENDED}),
    S.ENDED: frozenset(),
}

# States in which music may be going out, so every human control must work.
LIVE_STATES = frozenset({S.WARMING, S.LIVE, S.PAUSED, S.MANUAL_TAKEOVER, S.WINDING_DOWN})
TERMINAL = frozenset({S.ENDED})

# Autopilot's own forward moves and the maturity action each needs.
AUTOPILOT_MOVES: dict[tuple[SessionState, SessionState], Action] = {
    (S.WARMING, S.LIVE): Action.CHOOSE_NEXT,
    (S.WARMING, S.WINDING_DOWN): Action.WIND_DOWN_AT_CLOSE,
    (S.LIVE, S.WINDING_DOWN): Action.WIND_DOWN_AT_CLOSE,
    (S.WINDING_DOWN, S.ENDED): Action.WIND_DOWN_AT_CLOSE,
}

Guard = Callable[["NightSession", SessionState], bool]
Clock = Callable[[], datetime]


def utc_now() -> datetime:
    return datetime.now(UTC)


class SessionError(ValueError):
    """A move the session can't make, with a `code` the API returns."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class Transition:
    from_state: SessionState
    to_state: SessionState
    actor: Actor
    at: datetime
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "from": self.from_state.value,
            "to": self.to_state.value,
            "actor": self.actor.value,
            "at": self.at.isoformat(),
            "reason": self.reason,
        }


class NightSession:
    """One evening at one venue."""

    def __init__(
        self,
        session_id: str,
        venue_id: str,
        *,
        level: MaturityLevel | int = MaturityLevel.L0_MANUAL,
        policy_version: int | None = None,
        clock: Clock = utc_now,
        guard: Guard | None = None,
    ) -> None:
        self.id = session_id
        self.venue_id = venue_id
        self.level = MaturityLevel(level)
        self.policy_version = policy_version
        self.clock = clock
        self.guard = guard
        self.state = S.SETUP
        self.paused_from: SessionState | None = None
        self.created_at = clock()
        self.history: list[Transition] = []
        self._lock = threading.RLock()

    def legal(self, to: SessionState) -> bool:
        to = SessionState(to)
        if to not in LEGAL[self.state]:
            return False
        if self.state is S.PAUSED and to in {S.WARMING, S.LIVE, S.WINDING_DOWN}:
            return to is self.paused_from
        return True

    def autopilot_may(self, to: SessionState) -> bool:
        action = AUTOPILOT_MOVES.get((self.state, SessionState(to)))
        return action is not None and may(self.level, action)

    def move(self, to: SessionState | str, actor: Actor | str = Actor.STAFF,
             reason: str = "") -> Transition:
        to, actor = SessionState(to), Actor(actor)
        with self._lock:
            if not self.legal(to):
                raise SessionError(
                    "illegal_transition",
                    f"A session can't go from {self.state.value} to {to.value}.",
                )
            if actor is Actor.AUTOPILOT:
                if not self.autopilot_may(to):
                    raise SessionError(
                        "autopilot_not_permitted",
                        f"Autopilot at L{int(self.level)} can't move {self.state.value} "
                        f"to {to.value}; a person has to.",
                    )
                if self.guard is not None and not self.guard(self, to):
                    raise SessionError("autopilot_guard_refused", "Autopilot's check refused.")
            if actor is Actor.SYSTEM and to is not S.FAILED:
                raise SessionError("system_only_fails", "The system can only mark a failure.")
            return self._record(to, actor, reason)

    def _record(self, to: SessionState, actor: Actor, reason: str) -> Transition:
        step = Transition(self.state, to, actor, self.clock(), reason)
        if to is S.PAUSED:
            self.paused_from = self.state
        elif self.state is S.PAUSED:
            self.paused_from = None
        self.state = to
        self.history.append(step)
        return step

    def fail(self, reason: str) -> Transition:
        return self.move(S.FAILED, Actor.SYSTEM, reason)

    def to_dict(self) -> dict[str, Any]:
        from selecta.autopilot.takeover import available_controls

        return {
            "id": self.id,
            "venue_id": self.venue_id,
            "state": self.state.value,
            "level": int(self.level),
            "policy_version": self.policy_version,
            "paused_from": self.paused_from.value if self.paused_from else None,
            "created_at": self.created_at.isoformat(),
            "controls": available_controls(self),
            "next_states": sorted(s.value for s in LEGAL[self.state] if self.legal(s)),
            "history": [t.to_dict() for t in self.history],
        }


class SessionStore:
    """Sessions per workspace, in memory."""

    def __init__(self, clock: Clock = utc_now) -> None:
        self.clock = clock
        self._lock = threading.Lock()
        self._ids = itertools.count(1)
        self._sessions: dict[tuple[str, str], NightSession] = {}

    def create(self, workspace: str, venue_id: str, *, level: MaturityLevel | int,
               policy_version: int | None) -> NightSession:
        with self._lock:
            session_id = f"night-{next(self._ids)}"
            session = NightSession(session_id, venue_id, level=level,
                                   policy_version=policy_version, clock=self.clock)
            self._sessions[(workspace, session_id)] = session
            return session

    def get(self, workspace: str, session_id: str) -> NightSession | None:
        with self._lock:
            return self._sessions.get((workspace, session_id))


__all__ = [
    "AUTOPILOT_MOVES",
    "LEGAL",
    "LIVE_STATES",
    "TERMINAL",
    "Actor",
    "NightSession",
    "SessionError",
    "SessionState",
    "SessionStore",
    "Transition",
    "utc_now",
]
