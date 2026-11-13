"""The one-glance staff dashboard's state model (ADR-0430, AV-0430-01 and AV-0430-03).

One small object tells the staff screen everything it shows: what is playing, what is next, a
one-line summary of the planned horizon, health in plain words, which commands are still pending
and which were applied, and which navigation state the screen is in. The states are closed:

- loading: nothing heard from the night yet.
- setting_up: the night exists but music hasn't started.
- live: Autopilot is choosing (warming up, live or winding down).
- paused: a person paused; Resume is in the player.
- manual: a person took over; steering is off and the expert controls drive.
- offline: the screen lost the night; nothing it sends would arrive, so steering is off.
- failed: Autopilot hit a problem; take over by hand.
- stopped: the night is stopped.

Emergency Stop is always visible in every state. It is enabled in every state but stopped, where
it reads as done, because a repeat Stop is harmless but should not look like it did something.
Expert controls are listed in every state: the dashboard adds a calm view, it never hides tools.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from selecta.autopilot.night_session import SessionState
from selecta.venueops.staff_commands import (
    EXPERT_CONTROLS,
    SPECS,
    STEERING,
    CommandBook,
    CommandKind,
    StaffCommand,
)

OFFLINE_AFTER_SECONDS = 10.0
APPLIED_SHOWN = 5


class NavState(StrEnum):
    LOADING = "loading"
    SETTING_UP = "setting_up"
    LIVE = "live"
    PAUSED = "paused"
    MANUAL = "manual"
    OFFLINE = "offline"
    FAILED = "failed"
    STOPPED = "stopped"


HEADLINES: dict[NavState, str] = {
    NavState.LOADING: "Connecting to tonight's music.",
    NavState.SETTING_UP: "Getting ready. Music hasn't started yet.",
    NavState.LIVE: "Autopilot is playing.",
    NavState.PAUSED: "Paused. Resume from the player when you're ready.",
    NavState.MANUAL: "You have the controls. Autopilot isn't choosing.",
    NavState.OFFLINE: "Lost contact with the music. Changes can't be sent until it's back.",
    NavState.FAILED: "Autopilot hit a problem. Take over by hand to keep the music going.",
    NavState.STOPPED: "Stopped.",
}

SESSION_NAV: dict[SessionState, NavState] = {
    SessionState.SETUP: NavState.SETTING_UP,
    SessionState.WARMING: NavState.LIVE,
    SessionState.LIVE: NavState.LIVE,
    SessionState.WINDING_DOWN: NavState.LIVE,
    SessionState.PAUSED: NavState.PAUSED,
    SessionState.MANUAL_TAKEOVER: NavState.MANUAL,
    SessionState.FAILED: NavState.FAILED,
    SessionState.ENDED: NavState.STOPPED,
}


@dataclass(frozen=True)
class Track:
    title: str
    artist: str
    seconds_left: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"title": self.title, "artist": self.artist, "seconds_left": self.seconds_left}


@dataclass(frozen=True)
class HorizonSummary:
    songs: int = 0
    minutes: float = 0.0

    def words(self) -> str:
        if self.songs <= 0:
            return "Nothing planned after this song yet."
        song_word = "song" if self.songs == 1 else "songs"
        return f"{self.songs} {song_word} planned, about {round(self.minutes)} min."


@dataclass(frozen=True)
class Health:
    level: str = "ok"  # ok, warning or fault
    words: str = "Everything is working."

    def __post_init__(self) -> None:
        if self.level not in {"ok", "warning", "fault"}:
            raise ValueError(f"Unknown health level {self.level!r}.")


@dataclass(frozen=True)
class DashboardInputs:
    loaded: bool = False
    session_state: SessionState | None = None
    seconds_since_heard: float = 0.0
    now: Track | None = None
    next: Track | None = None
    horizon: HorizonSummary = field(default_factory=HorizonSummary)
    health: Health = field(default_factory=Health)


def nav_state(inputs: DashboardInputs, book: CommandBook | None = None) -> NavState:
    if book is not None and book.stopped:
        return NavState.STOPPED
    if not inputs.loaded:
        return NavState.LOADING
    if inputs.seconds_since_heard > OFFLINE_AFTER_SECONDS:
        return NavState.OFFLINE
    if inputs.session_state is None:
        return NavState.MANUAL if book is not None and book.manual else NavState.LIVE
    return SESSION_NAV[inputs.session_state]


def commands_enabled(nav: NavState) -> list[str]:
    """The commands staff can send in this state. Stop is separate and always shown."""
    if nav in {NavState.LIVE}:
        kinds = [k for k in SPECS if k is not CommandKind.EMERGENCY_STOP]
    elif nav is NavState.PAUSED:
        kinds = [k for k in SPECS if k in STEERING] + [CommandKind.HAND_TO_MANUAL]
    elif nav in {NavState.SETTING_UP, NavState.FAILED}:
        kinds = [CommandKind.HAND_TO_MANUAL]
    elif nav is NavState.MANUAL:
        kinds = [CommandKind.PAUSE]
    else:
        kinds = []
    return [k.value for k in kinds]


@dataclass(frozen=True)
class DashboardState:
    nav: NavState
    headline: str
    now: Track | None
    next: Track | None
    horizon: HorizonSummary
    health: Health
    pending: tuple[StaffCommand, ...]
    applied: tuple[StaffCommand, ...]
    enabled: tuple[str, ...]
    stop_enabled: bool

    @property
    def stop_visible(self) -> bool:
        return True

    def announcement(self) -> str:
        """The polite live-region line: the newest change in the command lifecycle."""
        latest = max(
            (*self.pending, *self.applied),
            key=lambda c: c.resolved_at or c.submitted_at,
            default=None,
        )
        return latest.words() if latest else ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "nav": self.nav.value,
            "headline": self.headline,
            "now": self.now.to_dict() if self.now else None,
            "next": self.next.to_dict() if self.next else None,
            "horizon": {
                "songs": self.horizon.songs,
                "minutes": self.horizon.minutes,
                "words": self.horizon.words(),
            },
            "health": {"level": self.health.level, "words": self.health.words},
            "pending": [c.to_dict() for c in self.pending],
            "applied": [c.to_dict() for c in self.applied],
            "enabled": list(self.enabled),
            "stop": {"visible": self.stop_visible, "enabled": self.stop_enabled},
            "announcement": self.announcement(),
            "expert_controls": [
                {"id": c.id, "label": c.label, "path": c.path} for c in EXPERT_CONTROLS
            ],
        }


def build(inputs: DashboardInputs, book: CommandBook | None = None) -> DashboardState:
    nav = nav_state(inputs, book)
    pending = tuple(book.pending()) if book else ()
    resolved = tuple(book.resolved()[-APPLIED_SHOWN:]) if book else ()
    return DashboardState(
        nav=nav,
        headline=HEADLINES[nav],
        now=inputs.now if nav is not NavState.STOPPED else None,
        next=inputs.next if nav in {NavState.LIVE, NavState.PAUSED, NavState.MANUAL} else None,
        horizon=inputs.horizon,
        health=inputs.health,
        pending=pending,
        applied=resolved,
        enabled=tuple(commands_enabled(nav)),
        stop_enabled=nav is not NavState.STOPPED,
    )
