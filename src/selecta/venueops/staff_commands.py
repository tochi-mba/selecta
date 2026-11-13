"""Typed staff steering commands for a venue night (ADR-0430, AV-0430-02 to AV-0430-05).

Staff never type free text at Autopilot. They pick one of a closed set of commands: more energy,
less energy, hold a genre, skip the next song, extend the current song, Pause, emergency Stop and
hand to manual. Each command is checked before it is accepted and then lives through one plain
lifecycle:

    pending -> applied | rejected | superseded

A steering command is pending until the seam it applies at is reached, and it names that seam, so
the dashboard can say "changes at the next blend" instead of pretending the room already changed.
A seam that is already committed (rendering or mixing in) is never touched: the command waits for
the next free seam or, if there is none, is rejected with a reason. A newer command of the same
kind supersedes an older pending one, so two taps of More energy never stack silently.

Pause and hand to manual apply at once through Autopilot's own staff controls
(`selecta.autopilot.takeover`), which Autopilot can't block. Emergency Stop also applies at once,
supersedes everything still pending and is idempotent: a second Stop returns the first Stop's
record and changes nothing. Expert controls (the mix editor, Workshop and the rest) are never
hidden by the dashboard; `EXPERT_CONTROLS` lists the paths that must stay reachable.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from selecta.autopilot import takeover
from selecta.autopilot.night_session import NightSession, SessionState

FLAG = "venue.staff_dashboard"


class CommandKind(StrEnum):
    MORE_ENERGY = "more_energy"
    LESS_ENERGY = "less_energy"
    HOLD_GENRE = "hold_genre"
    SKIP_NEXT = "skip_next"
    EXTEND_CURRENT = "extend_current"
    PAUSE = "pause"
    EMERGENCY_STOP = "emergency_stop"
    HAND_TO_MANUAL = "hand_to_manual"


class CommandState(StrEnum):
    PENDING = "pending"
    APPLIED = "applied"
    REJECTED = "rejected"
    SUPERSEDED = "superseded"


TERMINAL = frozenset({CommandState.APPLIED, CommandState.REJECTED, CommandState.SUPERSEDED})


class ApplyAt(StrEnum):
    NOW = "now"
    NEXT_SEAM = "next_seam"  # the first seam that isn't committed yet
    CURRENT_OUTRO = "current_outro"  # the seam that ends the current song


@dataclass(frozen=True)
class Param:
    kind: type
    low: int = 0
    high: int = 0
    default: Any = None
    required: bool = False


@dataclass(frozen=True)
class Spec:
    kind: CommandKind
    label: str
    apply_at: ApplyAt
    group: str
    params: Mapping[str, Param] = field(default_factory=dict)


SPECS: dict[CommandKind, Spec] = {
    spec.kind: spec
    for spec in (
        Spec(CommandKind.MORE_ENERGY, "More energy", ApplyAt.NEXT_SEAM, "energy",
             {"steps": Param(int, 1, 2, 1)}),
        Spec(CommandKind.LESS_ENERGY, "Less energy", ApplyAt.NEXT_SEAM, "energy",
             {"steps": Param(int, 1, 2, 1)}),
        Spec(CommandKind.HOLD_GENRE, "Hold genre", ApplyAt.NEXT_SEAM, "genre",
             {"genre": Param(str, 1, 40, required=True)}),
        Spec(CommandKind.SKIP_NEXT, "Skip next", ApplyAt.NEXT_SEAM, "skip"),
        Spec(CommandKind.EXTEND_CURRENT, "Extend current", ApplyAt.CURRENT_OUTRO, "extend",
             {"seconds": Param(int, 15, 240, 60)}),
        Spec(CommandKind.PAUSE, "Pause", ApplyAt.NOW, "pause"),
        Spec(CommandKind.EMERGENCY_STOP, "Stop", ApplyAt.NOW, "stop"),
        Spec(CommandKind.HAND_TO_MANUAL, "Hand to manual", ApplyAt.NOW, "manual"),
    )
}
STEERING = frozenset(
    {CommandKind.MORE_ENERGY, CommandKind.LESS_ENERGY, CommandKind.HOLD_GENRE,
     CommandKind.SKIP_NEXT, CommandKind.EXTEND_CURRENT}
)


@dataclass(frozen=True)
class ExpertControl:
    id: str
    label: str
    path: str


# Expert paths that stay reachable whatever the dashboard shows (AV-0430-05, AV-0439-05).
EXPERT_CONTROLS: tuple[ExpertControl, ...] = (
    ExpertControl("listen", "Listen and transport", "/listen"),
    ExpertControl("edit_mix", "Edit the mix", "/mix/current/edit"),
    ExpertControl("mixes", "Mixes", "/mixes"),
    ExpertControl("library", "Library", "/library"),
    ExpertControl("discover", "Discover", "/discover"),
    ExpertControl("lucy", "Lucy", "/mixes/lucy"),
    ExpertControl("workshop", "Workshop", "/workshop"),
)


class CommandError(ValueError):
    """Input that isn't a command at all (unknown kind, bad parameter). Never recorded."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class Horizon:
    """What the plan looks like when a command arrives: the seams it could apply at."""

    next_seam_id: str | None = None
    next_seam_committed: bool = False  # rendering or already mixing in: can't be changed
    following_seam_id: str | None = None
    has_next: bool = False
    current_extendable: bool = True
    genres: tuple[str, ...] = ()


@dataclass
class StaffCommand:
    id: str
    kind: CommandKind
    params: dict[str, Any]
    state: CommandState
    apply_at: ApplyAt
    seam_id: str | None
    submitted_at: float
    by: str
    resolved_at: float | None = None
    reason: str = ""
    superseded_by: str | None = None

    @property
    def label(self) -> str:
        return SPECS[self.kind].label

    def words(self) -> str:
        """What staff read about this command, in plain words."""
        if self.state is CommandState.PENDING:
            if self.apply_at is ApplyAt.CURRENT_OUTRO:
                return f"{self.label}: waiting, changes before this song ends."
            return f"{self.label}: waiting, changes at the next blend."
        if self.state is CommandState.APPLIED:
            return f"{self.label}: done."
        if self.state is CommandState.SUPERSEDED:
            return f"{self.label}: replaced by a newer choice."
        return f"{self.label}: not done. {self.reason}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind.value,
            "label": self.label,
            "params": dict(self.params),
            "state": self.state.value,
            "apply_at": self.apply_at.value,
            "seam_id": self.seam_id,
            "submitted_at": self.submitted_at,
            "resolved_at": self.resolved_at,
            "by": self.by,
            "reason": self.reason,
            "superseded_by": self.superseded_by,
            "words": self.words(),
        }


def parse_kind(raw: str | CommandKind) -> CommandKind:
    try:
        return CommandKind(raw)
    except ValueError:
        raise CommandError("unknown_command", f"There's no staff command called {raw!r}.") from None


def check_params(kind: CommandKind, raw: Mapping[str, Any] | None) -> dict[str, Any]:
    """The command's parameters, defaults filled in, or `CommandError`."""
    spec = SPECS[kind]
    raw = dict(raw or {})
    unknown = set(raw) - set(spec.params)
    if unknown:
        raise CommandError("bad_param", f"{spec.label} doesn't take {sorted(unknown)}.")
    out: dict[str, Any] = {}
    for name, param in spec.params.items():
        if name not in raw:
            if param.required:
                raise CommandError("bad_param", f"{spec.label} needs a {name}.")
            out[name] = param.default
            continue
        value = raw[name]
        if param.kind is int:
            if isinstance(value, bool) or not isinstance(value, int):
                raise CommandError("bad_param", f"{name} must be a whole number.")
            if not param.low <= value <= param.high:
                raise CommandError(
                    "bad_param", f"{name} must be between {param.low} and {param.high}."
                )
        else:
            if not isinstance(value, str) or not param.low <= len(value.strip()) <= param.high:
                raise CommandError("bad_param", f"{name} must be {param.low} to {param.high} "
                                   "characters.")
            value = value.strip()
        out[name] = value
    return out


class CommandBook:
    """Every staff command of one night, in order, with its lifecycle."""

    def __init__(
        self,
        session: NightSession | None = None,
        *,
        clock: Callable[[], float] = time.time,
        new_id: Callable[[], str] = lambda: uuid.uuid4().hex,
    ) -> None:
        self.session = session
        self.clock = clock
        self.new_id = new_id
        self.commands: list[StaffCommand] = []
        self.stop_command: StaffCommand | None = None
        self.manual = False
        self._lock = threading.RLock()

    # reading
    def pending(self) -> list[StaffCommand]:
        return [c for c in self.commands if c.state is CommandState.PENDING]

    def resolved(self) -> list[StaffCommand]:
        return [c for c in self.commands if c.state in TERMINAL]

    def get(self, command_id: str) -> StaffCommand:
        for command in self.commands:
            if command.id == command_id:
                return command
        raise CommandError("unknown_id", "There's no command with that id.")

    @property
    def stopped(self) -> bool:
        if self.stop_command is not None:
            return True
        return self.session is not None and self.session.state is SessionState.ENDED

    @property
    def in_manual(self) -> bool:
        if self.session is not None:
            return self.session.state is SessionState.MANUAL_TAKEOVER
        return self.manual

    # writing
    def submit(
        self,
        kind: str | CommandKind,
        params: Mapping[str, Any] | None = None,
        horizon: Horizon | None = None,
        *,
        by: str = "staff",
    ) -> StaffCommand:
        kind = parse_kind(kind)
        checked = check_params(kind, params)
        if kind is CommandKind.EMERGENCY_STOP:
            return self.emergency_stop(by=by)
        horizon = horizon or Horizon()
        with self._lock:
            refusal = self._refusal(kind, checked, horizon)
            if refusal is not None:
                return self._record(kind, checked, None, by, CommandState.REJECTED, refusal)
            spec = SPECS[kind]
            if spec.apply_at is ApplyAt.NOW:
                self._run_now(kind, by)
                return self._record(kind, checked, None, by, CommandState.APPLIED)
            seam = self._seam_for(kind, horizon)
            if seam is None:
                return self._record(
                    kind, checked, None, by, CommandState.REJECTED,
                    "Nothing after this song can change yet. Try again in a moment.",
                )
            command = self._record(kind, checked, seam, by, CommandState.PENDING)
            for older in self.pending():
                if older is not command and SPECS[older.kind].group == spec.group:
                    self._finish(older, CommandState.SUPERSEDED, superseded_by=command.id)
            return command

    def emergency_stop(self, *, by: str = "staff") -> StaffCommand:
        """Stop now. Idempotent: a repeat returns the first Stop and changes nothing."""
        with self._lock:
            if self.stop_command is not None:
                return self.stop_command
            if self.session is not None:
                takeover.stop(self.session, reason="emergency stop")
            command = self._record(
                CommandKind.EMERGENCY_STOP, {}, None, by, CommandState.APPLIED
            )
            for older in self.pending():
                self._finish(older, CommandState.SUPERSEDED, superseded_by=command.id,
                             reason="Stopped.")
            self.stop_command = command
            return command

    def seam_reached(self, seam_id: str) -> list[StaffCommand]:
        """The planner reports a seam it has committed with the commands folded in."""
        with self._lock:
            due = [c for c in self.pending() if c.seam_id == seam_id]
            for command in due:
                self._finish(command, CommandState.APPLIED)
            return due

    def seam_refused(self, seam_id: str, reason: str) -> list[StaffCommand]:
        """The planner couldn't honour the commands at this seam; say so instead of hiding it."""
        with self._lock:
            due = [c for c in self.pending() if c.seam_id == seam_id]
            for command in due:
                self._finish(command, CommandState.REJECTED, reason=reason)
            return due

    # internals
    def _refusal(self, kind: CommandKind, params: dict, horizon: Horizon) -> str | None:
        if self.stopped:
            return "Autopilot is stopped."
        if kind in STEERING and self.in_manual:
            return "Staff have the controls now. Use the expert controls, or hand back first."
        if kind is CommandKind.HAND_TO_MANUAL and self.in_manual:
            return None  # a repeat is harmless; takeover treats it as no change
        if kind is CommandKind.SKIP_NEXT and not horizon.has_next:
            return "There's no next song to skip yet."
        if kind is CommandKind.SKIP_NEXT and horizon.next_seam_committed:
            return "The next song is already mixing in. Skip it once it plays."
        if kind is CommandKind.EXTEND_CURRENT:
            if not horizon.current_extendable:
                return "This song can't run longer."
            if horizon.next_seam_committed:
                return "The blend out of this song has already started."
        if kind is CommandKind.HOLD_GENRE and horizon.genres:
            known = {genre.casefold() for genre in horizon.genres}
            if params["genre"].casefold() not in known:
                return f"There's nothing tagged {params['genre']} in tonight's music."
        return None

    def _seam_for(self, kind: CommandKind, horizon: Horizon) -> str | None:
        if SPECS[kind].apply_at is ApplyAt.CURRENT_OUTRO or kind is CommandKind.SKIP_NEXT:
            return horizon.next_seam_id
        if horizon.next_seam_committed:
            return horizon.following_seam_id
        return horizon.next_seam_id

    def _run_now(self, kind: CommandKind, by: str) -> None:
        if kind is CommandKind.PAUSE:
            if self.session is not None:
                takeover.pause(self.session, reason=f"{by}: pause")
        elif kind is CommandKind.HAND_TO_MANUAL:
            if self.session is not None:
                takeover.take_over(self.session, reason=f"{by}: hand to manual")
            self.manual = True
            for older in self.pending():
                self._finish(older, CommandState.SUPERSEDED, reason="Handed to manual.")

    def _record(
        self,
        kind: CommandKind,
        params: dict,
        seam: str | None,
        by: str,
        state: CommandState,
        reason: str = "",
    ) -> StaffCommand:
        now = self.clock()
        command = StaffCommand(
            id=self.new_id(),
            kind=kind,
            params=params,
            state=state,
            apply_at=SPECS[kind].apply_at,
            seam_id=seam,
            submitted_at=now,
            by=by,
            resolved_at=None if state is CommandState.PENDING else now,
            reason=reason,
        )
        self.commands.append(command)
        return command

    def _finish(
        self,
        command: StaffCommand,
        state: CommandState,
        *,
        reason: str = "",
        superseded_by: str | None = None,
    ) -> None:
        if command.state is not CommandState.PENDING:
            raise CommandError(
                "already_resolved", f"{command.label} is already {command.state.value}."
            )
        if state is CommandState.PENDING:
            raise CommandError("bad_transition", "A command can't go back to pending.")
        command.state = state
        command.resolved_at = self.clock()
        command.reason = reason
        command.superseded_by = superseded_by
