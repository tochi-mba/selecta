"""The bounded AI DJ director (ADR-0428, AV-0428-02 to AV-0428-05).

The director turns a staff request into one typed `director_intent` and, if the caller may and
the music may, applies it to the tentative part of the horizon. That is all it can do:

- Realtime boundary (AV-0428-02): this module imports the horizon, ranking and intent schema
  and nothing that plays, renders or schedules audio. Its only write is
  `HorizonStore.replan`, which the horizon fences to the tentative window, so the song playing
  now, the locked next song and sample-clock timing are out of its reach. A test walks the
  imports to keep it that way.
- RBAC and rights (AV-0428-03): only `DIRECTOR_ROLES` may issue or undo intents. A queued song
  must be in the venue's pool, licensed and clean against the venue's `HardConstraints`; every
  replan goes through `ranking`, which never ranks an unlicensed or breaching song.
- Timeouts (AV-0428-04): the model is called through an injectable `ModelClient` on a worker
  thread with a deadline. A timeout, an error or an answer outside the schema keeps the current
  plan and is written to the log; the night carries on without the model.
- Inspectable, undoable (AV-0428-05): every attempt is a `LogEntry` with the intent, who asked,
  the horizon revisions before and after and a diff of the tentative window. `undo` restores the
  tentative window of the revision before, as a new revision (history is never rewritten), and
  ends the intent's effect.

Adjustments expire: each applied intent stops shaping replans at its `expires_at`.
"""

from __future__ import annotations

import concurrent.futures
import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any, Protocol

from pydantic import ValidationError

from selecta.autopilot import director_intent as di
from selecta.autopilot.horizon import Horizon, HorizonError, HorizonStore, ReplanEvent, Slot
from selecta.autopilot.ranking import Candidate, Context, eligibility, plan_window
from selecta.autopilot.venue_policy import HardConstraints

DIRECTOR_ROLES = frozenset({"owner", "editor"})
MODEL_TIMEOUT_SECONDS = 4.0
WINDOW = 8
LOG_LIMIT = 500


class DirectorError(ValueError):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class Caller:
    user_id: str
    role: str


class ModelClient(Protocol):
    def propose(self, *, request: str, schema: Mapping[str, Any],
                context: Mapping[str, Any]) -> Any: ...


@dataclass
class LogEntry:
    id: str
    at: datetime
    user_id: str
    role: str
    status: str
    request: str | None = None
    intent: dict[str, Any] | None = None
    message: str = ""
    before_revision: int | None = None
    after_revision: int | None = None
    diff: dict[str, list[str]] = field(default_factory=dict)
    expires_at: datetime | None = None
    undone_by: str | None = None
    undoes: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "at": self.at.isoformat(),
            "user_id": self.user_id,
            "role": self.role,
            "status": self.status,
            "request": self.request,
            "intent": self.intent,
            "message": self.message,
            "before_revision": self.before_revision,
            "after_revision": self.after_revision,
            "diff": self.diff,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "undone_by": self.undone_by,
            "undoes": self.undoes,
        }


def slot_of(candidate: Candidate, source: str = "director") -> Slot:
    facts = candidate.facts
    return Slot(
        track_id=facts.id, artist=facts.artist, energy=facts.energy, bpm=facts.bpm,
        key=candidate.key, genres=facts.genres, duration=candidate.duration, source=source,
    )


def diff(before: Sequence[Slot], after: Sequence[Slot]) -> dict[str, list[str]]:
    old = [s.track_id for s in before]
    new = [s.track_id for s in after]
    return {
        "before": old,
        "after": new,
        "removed": [t for t in old if t not in new],
        "added": [t for t in new if t not in old],
    }


def merge_pinned(current: Sequence[Slot], fresh: Sequence[Slot], length: int) -> list[Slot]:
    """Keep every pinned slot at its index; fill the other places from `fresh`."""
    pinned = {i: s for i, s in enumerate(current) if s.pinned}
    taken = {s.track_id for s in pinned.values()}
    filler = [s for s in fresh if s.track_id not in taken]
    out: list[Slot] = []
    for index in range(max(length, (max(pinned) + 1) if pinned else 0)):
        if index in pinned:
            out.append(pinned[index])
        elif filler:
            out.append(filler.pop(0))
    return out


@dataclass
class _Adjustment:
    entry_id: str
    intent: Any
    expires_at: datetime
    hold_progress: float | None = None


Pool = Callable[[str, str], Sequence[Candidate]]
Limits = Callable[[str, str], HardConstraints]
Progress = Callable[[str, str], float]


class Director:
    def __init__(
        self,
        store: HorizonStore,
        *,
        pool: Pool,
        limits: Limits | None = None,
        progress: Progress | None = None,
        model: ModelClient | None = None,
        clock: Callable[[], datetime] | None = None,
        timeout: float = MODEL_TIMEOUT_SECONDS,
        seed: int | str = 0,
    ) -> None:
        self.store = store
        self._pool = pool
        self._limits = limits or (lambda w, s: HardConstraints(allow_explicit=False))
        self._progress = progress or (lambda w, s: 0.5)
        self.model = model
        self._clock = clock or (lambda: datetime.now(UTC))
        self._timeout = timeout
        self._seed = seed
        self._lock = threading.RLock()
        self._log: dict[tuple[str, str], list[LogEntry]] = {}
        self._active: dict[tuple[str, str], list[_Adjustment]] = {}
        self._calls = concurrent.futures.ThreadPoolExecutor(max_workers=2,
                                                            thread_name_prefix="director")

    # Reading ------------------------------------------------------------------------------

    def log(self, workspace: str, session_id: str) -> list[LogEntry]:
        with self._lock:
            return list(self._log.get((workspace, session_id), ()))

    def _entry(self, workspace: str, session_id: str, caller: Caller, status: str,
               **values: Any) -> LogEntry:
        with self._lock:
            entries = self._log.setdefault((workspace, session_id), [])
            entry = LogEntry(id=f"i{len(entries) + 1}", at=self._clock(), user_id=caller.user_id,
                             role=caller.role, status=status, **values)
            entries.append(entry)
            del entries[: max(0, len(entries) - LOG_LIMIT)]
            return entry

    def active(self, workspace: str, session_id: str) -> list[_Adjustment]:
        now = self._clock()
        with self._lock:
            live = [a for a in self._active.get((workspace, session_id), ()) if a.expires_at > now]
            self._active[(workspace, session_id)] = live
            return list(live)

    def context(self, workspace: str, session_id: str, horizon: Horizon) -> Context:
        """The ranking context with every unexpired adjustment applied."""
        bias = 0.0
        lean: dict[str, float] = {}
        artists: set[str] = set()
        tracks: set[str] = set()
        progress = self._progress(workspace, session_id)
        for adj in self.active(workspace, session_id):
            intent = adj.intent
            if isinstance(intent, di.EnergyIntent):
                bias += intent.bias
            elif isinstance(intent, di.GenreLean):
                lean[intent.genre] = max(lean.get(intent.genre, 0.0), intent.weight)
            elif isinstance(intent, di.AvoidArtist):
                artists.add(intent.artist)
            elif isinstance(intent, di.Skip):
                tracks.add(intent.track_id)
            elif isinstance(intent, di.Hold) and adj.hold_progress is not None:
                progress = adj.hold_progress
        bias = max(-di.MAX_ENERGY_SHIFT, min(di.MAX_ENERGY_SHIFT, bias))
        fixed = [s for s in (horizon.committed, horizon.locked) if s]
        last = fixed[-1] if fixed else None
        return Context(
            played=tuple(s.track_id for s in fixed),
            played_artists=tuple(s.artist for s in fixed),
            progress=progress, energy_bias=bias,
            current_bpm=last.bpm if last else None, current_key=last.key if last else None,
            current_energy=last.energy if last else None, genre_lean=lean,
            avoid_artists=frozenset(artists), avoid_tracks=frozenset(tracks),
        )

    # Writing ------------------------------------------------------------------------------

    def _authorise(self, caller: Caller) -> None:
        if caller.role not in DIRECTOR_ROLES:
            raise DirectorError("forbidden", "Only venue owners and editors can direct Autopilot",
                                403)

    def _current(self, workspace: str, session_id: str) -> Horizon:
        current = self.store.current(workspace, session_id)
        if current is None:
            raise DirectorError("no_horizon", "This session has no horizon yet", 404)
        return current

    def _window(self, workspace: str, session_id: str, horizon: Horizon,
                intent: Any) -> list[Slot]:
        pool = list(self._pool(workspace, session_id))
        limits = self._limits(workspace, session_id)
        context = self.context(workspace, session_id, horizon)
        fixed = set(horizon.fixed_ids)
        if isinstance(intent, di.Skip):
            if intent.track_id in fixed:
                raise DirectorError(
                    "fenced", "That song is playing or locked next; skip it from the controls",
                    409)
            if intent.track_id not in {s.track_id for s in horizon.tentative}:
                raise DirectorError("not_planned", "That song isn't in the plan ahead", 409)
        if isinstance(intent, di.QueueTrack):
            match = next((c for c in pool if c.id == intent.track_id), None)
            if match is None:
                raise DirectorError("not_in_pool", "That song isn't in this venue's music", 409)
            reasons = [r for r in eligibility(match, context, limits) if r != "played_recently"]
            if reasons:
                raise DirectorError("not_allowed",
                                    f"That song can't play here: {', '.join(reasons)}", 409)
        length = max(WINDOW, len(horizon.tentative))
        current = [
            s for s in horizon.tentative
            if not (isinstance(intent, di.Skip) and s.track_id == intent.track_id)
        ]
        if isinstance(intent, di.Skip):
            context = replace(context, avoid_tracks=context.avoid_tracks | {intent.track_id})
        fresh = [slot_of(c, "director")
                 for c in plan_window(pool, context, limits, seed=self._seed, length=length)]
        if isinstance(intent, di.Skip):
            # Only the skipped song goes; the rest of the window stays, topped up at the end.
            have = {s.track_id for s in current}
            window = current + [s for s in fresh if s.track_id not in have]
            return window[:length]
        window = merge_pinned(current, fresh, length)
        if isinstance(intent, di.QueueTrack):
            queued = slot_of(next(c for c in pool if c.id == intent.track_id), "director")
            window = [s for s in window if s.track_id != queued.track_id]
            position = min(intent.position, len(window))
            while position < len(window) and window[position].pinned:
                position += 1
            window.insert(position, queued)
            window = window[:max(length, position + 1)]
        return window

    def apply(self, workspace: str, session_id: str, caller: Caller, intent: Any,
              request: str | None = None) -> LogEntry:
        self._authorise(caller)
        if isinstance(intent, Mapping):
            try:
                intent = di.parse_intent(intent)
            except ValidationError as error:
                raise DirectorError("invalid_intent", str(error.errors()[:3]), 422) from error
        with self._lock:
            current = self._current(workspace, session_id)
            try:
                window = self._window(workspace, session_id, current, intent)
            except DirectorError as error:
                self._entry(workspace, session_id, caller, "refused", request=request,
                            intent=intent.model_dump(), message=str(error),
                            before_revision=current.revision)
                raise
            now = self._clock()
            expires = intent.expires_at(now)
            try:
                after = self.store.replan(workspace, session_id, ReplanEvent(
                    base_revision=current.revision, tentative=tuple(window),
                    reason=f"director:{intent.kind}", actor="director",
                    expect_locked=current.locked.track_id if current.locked else None,
                ))
            except HorizonError as error:
                self._entry(workspace, session_id, caller, "refused", request=request,
                            intent=intent.model_dump(), message=str(error),
                            before_revision=current.revision)
                raise DirectorError(error.code, str(error), 409) from error
            entry = self._entry(
                workspace, session_id, caller, "applied", request=request,
                intent=intent.model_dump(), message=intent.reason,
                before_revision=current.revision, after_revision=after.revision,
                diff=diff(current.tentative, after.tentative), expires_at=expires,
            )
            hold = self._progress(workspace, session_id) if isinstance(intent, di.Hold) else None
            self._active.setdefault((workspace, session_id), []).append(
                _Adjustment(entry.id, intent, expires, hold))
            return entry

    def interpret(self, workspace: str, session_id: str, caller: Caller,
                  request: str) -> LogEntry:
        """Ask the model for one intent and apply it; any model trouble keeps the plan."""
        self._authorise(caller)
        current = self._current(workspace, session_id)
        request = " ".join(str(request or "").split())[:500]
        if self.model is None:
            return self._entry(workspace, session_id, caller, "model_unavailable",
                               request=request, before_revision=current.revision,
                               message="No AI service is set up; the plan is unchanged")
        context = {
            "now_playing": current.committed.track_id if current.committed else None,
            "next": current.locked.track_id if current.locked else None,
            "ahead": [s.track_id for s in current.tentative],
            "kinds": list(di.KINDS),
        }
        future = self._calls.submit(self.model.propose, request=request, schema=di.schema(),
                                    context=context)
        try:
            raw = future.result(timeout=self._timeout)
        except concurrent.futures.TimeoutError:
            future.cancel()
            return self._entry(workspace, session_id, caller, "timeout", request=request,
                               before_revision=current.revision,
                               message="The AI took too long; the plan is unchanged")
        except Exception as error:  # noqa: BLE001 - any model failure keeps the plan
            return self._entry(workspace, session_id, caller, "model_error", request=request,
                               before_revision=current.revision,
                               message=f"The AI failed ({type(error).__name__}); "
                                       "the plan is unchanged")
        try:
            intent = di.parse_intent(raw)
        except ValidationError:
            return self._entry(workspace, session_id, caller, "invalid", request=request,
                               before_revision=current.revision,
                               message="The AI's answer wasn't an allowed change; "
                                       "the plan is unchanged")
        return self.apply(workspace, session_id, caller, intent, request=request)

    def undo(self, workspace: str, session_id: str, caller: Caller, entry_id: str) -> LogEntry:
        self._authorise(caller)
        with self._lock:
            target = next((e for e in self.log(workspace, session_id) if e.id == entry_id), None)
            if target is None:
                raise DirectorError("not_found", "There's no director change with that id", 404)
            if target.status != "applied" or target.undone_by:
                raise DirectorError("not_undoable", "Only an applied, not yet undone change "
                                    "can be undone", 409)
            before = self.store.revision(workspace, session_id, target.before_revision or 0)
            if before is None:
                raise DirectorError("history_gone", "That revision is no longer kept", 410)
            current = self._current(workspace, session_id)
            gone = set(current.fixed_ids) | {
                h.committed.track_id for h in self.store.history(workspace, session_id)
                if h.committed
            }
            restored = [s for s in before.tentative if s.track_id not in gone]
            kept = {s.track_id for s in restored}
            restored += [s for s in current.tentative if s.pinned and s.track_id not in kept]
            after = self.store.replan(workspace, session_id, ReplanEvent(
                base_revision=current.revision, tentative=tuple(restored),
                reason=f"undo:{entry_id}", actor="staff",
            ))
            self._active[(workspace, session_id)] = [
                a for a in self._active.get((workspace, session_id), ()) if a.entry_id != entry_id
            ]
            entry = self._entry(
                workspace, session_id, caller, "undone", undoes=entry_id,
                before_revision=current.revision, after_revision=after.revision,
                diff=diff(current.tentative, after.tentative),
                message=f"Restored the plan from revision {before.revision}",
            )
            target.undone_by = entry.id
            return entry

    def close(self) -> None:
        self._calls.shutdown(wait=False, cancel_futures=True)


__all__ = [
    "DIRECTOR_ROLES",
    "Caller",
    "Director",
    "DirectorError",
    "LogEntry",
    "ModelClient",
    "diff",
    "merge_pinned",
    "slot_of",
]
