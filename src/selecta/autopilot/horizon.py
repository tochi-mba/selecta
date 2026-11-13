"""The rolling musical horizon for an Autopilot night (ADR-0426).

A horizon has three parts, and only the last one may ever change by replanning:

- `committed`: the song playing now. Its audio is already going out, so nothing rewrites it.
- `locked`: the song that plays next. Its transition is being prepared (rendered, checked), so a
  replan that changed it could leave the player with no prepared audio. It is fixed too.
- `tentative`: the speculative window after that. Replans, the AI director and staff edits all
  work here, and only here.

Every change makes a new immutable `Horizon` with `revision + 1`. A `ReplanEvent` names the
revision it was planned against; one planned against an older revision is refused as stale
(`StaleReplan`), so a slow planner can't overwrite a newer plan. A replan that tries to touch the
committed or locked song, or that drops or moves a song staff pinned by hand, is refused
(`FenceViolation`). `advance()` is the one move that changes the fixed part: the committed song
ends, the locked song becomes committed and the first tentative song is locked.

`HorizonStore` keeps every revision per workspace and session, in memory, so the director can
undo to an earlier tentative window. A restart forgets it (remaining work: a Cloud table).
Nothing here touches audio or transport; the player reads `committed` and `locked`.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

MAX_TENTATIVE = 40
SOURCES = ("autopilot", "staff", "director")
REPLAN_ACTORS = ("autopilot", "staff", "director", "system")


class HorizonError(ValueError):
    """A horizon change that can't be made, said plainly."""

    code = "horizon_error"


class StaleReplan(HorizonError):
    code = "stale_revision"


class FenceViolation(HorizonError):
    code = "fence_violation"


@dataclass(frozen=True)
class Slot:
    """One song in the horizon. `pinned` means staff put it there by hand, so automatic
    replans keep it, in its place relative to the other pinned songs."""

    track_id: str
    artist: str = ""
    energy: float | None = None
    bpm: float | None = None
    key: str | None = None
    genres: tuple[str, ...] = ()
    duration: float = 210.0
    technique: str = "auto"
    source: str = "autopilot"
    pinned: bool = False

    def __post_init__(self) -> None:
        if not str(self.track_id).strip():
            raise HorizonError("Every horizon slot needs a track id")
        if self.source not in SOURCES:
            raise HorizonError(f"A slot's source is one of {', '.join(SOURCES)}")
        if self.duration <= 0:
            raise HorizonError("A slot's duration must be positive")

    def to_dict(self) -> dict[str, Any]:
        return {
            "track_id": self.track_id,
            "artist": self.artist,
            "energy": self.energy,
            "bpm": self.bpm,
            "key": self.key,
            "genres": list(self.genres),
            "duration": self.duration,
            "technique": self.technique,
            "source": self.source,
            "pinned": self.pinned,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Slot:
        try:
            return cls(
                track_id=str(data["track_id"]),
                artist=str(data.get("artist") or ""),
                energy=None if data.get("energy") is None else float(data["energy"]),
                bpm=None if data.get("bpm") is None else float(data["bpm"]),
                key=None if data.get("key") in (None, "") else str(data["key"]),
                genres=tuple(str(g) for g in data.get("genres") or ()),
                duration=float(data.get("duration") or 210.0),
                technique=str(data.get("technique") or "auto"),
                source=str(data.get("source") or "autopilot"),
                pinned=data.get("pinned") is True,
            )
        except (KeyError, TypeError, ValueError) as error:
            raise HorizonError(f"A slot couldn't be read: {error}") from error


@dataclass(frozen=True)
class Horizon:
    session_id: str
    revision: int
    committed: Slot | None
    locked: Slot | None
    tentative: tuple[Slot, ...] = ()
    reason: str = "start"
    actor: str = "system"
    at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def __post_init__(self) -> None:
        if len(self.tentative) > MAX_TENTATIVE:
            raise HorizonError(f"The tentative window holds at most {MAX_TENTATIVE} songs")

    @property
    def fixed_ids(self) -> tuple[str, ...]:
        return tuple(slot.track_id for slot in (self.committed, self.locked) if slot)

    @property
    def sequence(self) -> tuple[Slot, ...]:
        return tuple(s for s in (self.committed, self.locked) if s) + self.tentative

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "revision": self.revision,
            "committed": self.committed.to_dict() if self.committed else None,
            "locked": self.locked.to_dict() if self.locked else None,
            "tentative": [slot.to_dict() for slot in self.tentative],
            "reason": self.reason,
            "actor": self.actor,
            "at": self.at.isoformat(),
        }


@dataclass(frozen=True)
class ReplanEvent:
    """A new tentative window, planned against `base_revision`. `expect_committed` and
    `expect_locked` say which fixed songs the planner saw; if either has moved on since, the
    plan was made for a different moment and is refused."""

    base_revision: int
    tentative: tuple[Slot, ...]
    reason: str = "replan"
    actor: str = "autopilot"
    expect_committed: str | None = None
    expect_locked: str | None = None


def _pinned_order(slots: Iterable[Slot]) -> list[str]:
    return [slot.track_id for slot in slots if slot.pinned]


def check_fence(current: Horizon, event: ReplanEvent) -> None:
    """Raise unless `event` only changes the tentative window of `current`."""
    if event.actor not in REPLAN_ACTORS:
        raise HorizonError(f"A replan comes from one of {', '.join(REPLAN_ACTORS)}")
    if event.base_revision != current.revision:
        raise StaleReplan(
            f"This plan was made for revision {event.base_revision}, "
            f"but the horizon is at revision {current.revision}"
        )
    committed = current.committed.track_id if current.committed else None
    locked = current.locked.track_id if current.locked else None
    if event.expect_committed is not None and event.expect_committed != committed:
        raise FenceViolation("The song playing now has changed since this plan was made")
    if event.expect_locked is not None and event.expect_locked != locked:
        raise FenceViolation("The next song is locked and can't be replaced by a replan")
    fixed = list(current.fixed_ids)
    leading = [s.track_id for s in event.tentative[: len(fixed)]]
    if fixed and leading == fixed:
        # A planner that sends the whole sequence instead of just the window would repeat the
        # fixed songs; refuse it rather than play them twice.
        raise FenceViolation("Send only the tentative window, not the committed songs")
    if event.actor != "staff":
        before = _pinned_order(current.tentative)
        kept = [s.track_id for s in event.tentative if s.track_id in before]
        if kept != before:
            raise FenceViolation("A song staff pinned by hand can't be dropped or moved")


def apply_replan(current: Horizon, event: ReplanEvent, at: datetime | None = None) -> Horizon:
    check_fence(current, event)
    pinned = {s.track_id: s for s in current.tentative if s.pinned}
    window = tuple(
        replace(slot, pinned=True, source=pinned[slot.track_id].source)
        if slot.track_id in pinned and event.actor != "staff"
        else slot
        for slot in event.tentative
    )
    return Horizon(
        session_id=current.session_id,
        revision=current.revision + 1,
        committed=current.committed,
        locked=current.locked,
        tentative=window,
        reason=event.reason,
        actor=event.actor,
        at=at or datetime.now(UTC),
    )


def advance(current: Horizon, at: datetime | None = None) -> Horizon:
    """The committed song has ended: move everything one step along."""
    head, rest = (current.tentative[0], current.tentative[1:]) if current.tentative else (
        None,
        (),
    )
    return Horizon(
        session_id=current.session_id,
        revision=current.revision + 1,
        committed=current.locked,
        locked=head,
        tentative=rest,
        reason="advance",
        actor="system",
        at=at or datetime.now(UTC),
    )


Clock = Callable[[], datetime]


class HorizonStore:
    """Every horizon revision, per workspace and session. Thread-safe; in memory."""

    def __init__(self, clock: Clock | None = None, keep: int = 500) -> None:
        self._clock = clock or (lambda: datetime.now(UTC))
        self._keep = keep
        self._lock = threading.Lock()
        self._history: dict[tuple[str, str], list[Horizon]] = {}

    def start(
        self,
        workspace: str,
        session_id: str,
        committed: Slot | None,
        locked: Slot | None,
        tentative: Iterable[Slot] = (),
    ) -> Horizon:
        horizon = Horizon(
            session_id, 1, committed, locked, tuple(tentative), "start", "system", self._clock()
        )
        with self._lock:
            if (workspace, session_id) in self._history:
                raise HorizonError("This session already has a horizon")
            self._history[(workspace, session_id)] = [horizon]
        return horizon

    def current(self, workspace: str, session_id: str) -> Horizon | None:
        with self._lock:
            found = self._history.get((workspace, session_id))
            return found[-1] if found else None

    def revision(self, workspace: str, session_id: str, revision: int) -> Horizon | None:
        with self._lock:
            for horizon in self._history.get((workspace, session_id), ()):
                if horizon.revision == revision:
                    return horizon
        return None

    def history(self, workspace: str, session_id: str) -> list[Horizon]:
        with self._lock:
            return list(self._history.get((workspace, session_id), ()))

    def _push(self, workspace: str, session_id: str, make: Callable[[Horizon], Horizon]) -> Horizon:
        with self._lock:
            found = self._history.get((workspace, session_id))
            if not found:
                raise HorizonError("This session has no horizon yet")
            nxt = make(found[-1])
            found.append(nxt)
            del found[: max(0, len(found) - self._keep)]
            return nxt

    def replan(self, workspace: str, session_id: str, event: ReplanEvent) -> Horizon:
        return self._push(workspace, session_id, lambda h: apply_replan(h, event, self._clock()))

    def advance(self, workspace: str, session_id: str) -> Horizon:
        return self._push(workspace, session_id, lambda h: advance(h, self._clock()))


__all__ = [
    "FenceViolation",
    "Horizon",
    "HorizonError",
    "HorizonStore",
    "ReplanEvent",
    "Slot",
    "StaleReplan",
    "advance",
    "apply_replan",
    "check_fence",
]
