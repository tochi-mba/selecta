"""Render any transition a person asks for, keep the result, and say how it went.

Every seam is a small request: which songs, which move, and any choices the person made.
The same request always gives the same files, so changing your mind back costs nothing. Rendering
runs on one worker thread, because it's heavy and this machine has four cores. Nothing here runs
while the browser plays: it only ever receives finished audio.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from collections import Counter, deque
from collections.abc import Callable, Iterable
from dataclasses import asdict
from pathlib import Path

import soundfile as sf

from selecta import db, jobs
from selecta.analysis.song import SongInfo, load_song
from selecta.arrange import can_arrange
from selecta.audit.checks import AuditReport
from selecta.config import SAMPLE_RATE, Settings
from selecta.eta import JobClock, combine
from selecta.lyrics.align import Aligner
from selecta.planner.choose import choose_transition
from selecta.planner.memory import RULES_VERSION, SeamMemory
from selecta.planner.wordreel import CannotTrust, modes_for, ride_lines
from selecta.render.engine import Rendered, SongCache, in_context
from selecta.seam_kinds import (
    CHECK_WORDS,
    MOVES,
    NEAR_MISS,
    NOT_IN_THE_CHOOSER,
    PLACEMENTS_TO_TRY,
    PREVIEW_SECONDS,
    RENDER_VERSION,
    RIDES_BEFORE_OTHERS,
    SESSION_MOVES,
    STEM_MOVES,
    STUDIO_SESSION,
    UNSURE_WORDS,
    WORD_MOVES,
    CannotRender,
    SeamRequest,
    _plain_checks,
    _what_failed,
    failed_checks,
    fallback_order,
    good_enough,
    line_from,
    request_from,
)
from selecta.seam_making import (
    _arranged,
    _bar_cue_render,
    _chosen_cue,
    _closer,
    _exits_after,
    _make_session,
    _session_for,
    _stem_render,
    _switch_at,
    _too_soon,
    _why_unavailable,
    links_between,
    seam_options,
    tighten_beats,
    windows_for,
)
from selecta.stems import prune_cache, seconds_separating, window_is_ready
from selecta.studio import LANES, SIDES, windows_to_separate

__all__ = [
    "CHECK_WORDS",
    "CannotRender",
    "LATER",
    "LINE",
    "MIX",
    "MOVES",
    "NEAR_MISS",
    "NOT_IN_THE_CHOOSER",
    "PLACEMENTS_TO_TRY",
    "PREPARING",
    "PREVIEW_SECONDS",
    "RENDER_VERSION",
    "REQUEST",
    "RIDES_BEFORE_OTHERS",
    "SESSION_MOVES",
    "STEM_MOVES",
    "STUDIO_SESSION",
    "SeamRequest",
    "SeamStore",
    "UNSURE_WORDS",
    "URGENT",
    "WORD_MOVES",
    "_arranged",
    "_bar_cue_render",
    "_chosen_cue",
    "_closer",
    "_exits_after",
    "_make_session",
    "_plain_checks",
    "_session_for",
    "_stem_render",
    "_switch_at",
    "_too_soon",
    "_what_failed",
    "_why_unavailable",
    "failed_checks",
    "fallback_order",
    "good_enough",
    "line_from",
    "links_between",
    "request_from",
    "seam_options",
    "tighten_beats",
    "windows_for",
]


IDLE_CHECK_SECONDS = 3.0

MEMORY_SECONDS = 5.0

"""How far past its limit each forgiving check can go, in its own units."""

MIX_CHECK_SECONDS = 2.0

# who goes first: what's about to be heard, a song someone asked for once whatever plays before it
# is done, the rest of the mix, mixes in the render line, other requests, then spare time
URGENT, REQUEST, MIX, LINE, LATER, PREPARING = range(6)


def _unlink_after_readers(path: Path) -> None:
    """Windows refuses deletion while a status request has the file open. Wait at most a second."""
    for _ in range(49):
        try:
            path.unlink(missing_ok=True)
            return
        except PermissionError:
            time.sleep(0.02)
    path.unlink(missing_ok=True)


def _swapped_by_old_fallback(state: dict) -> bool:
    """Seams from before cuts became the last resort, where something else stood in for the move."""
    if state.get("status") != "ready" or "tried" in state:
        return False
    return state.get("style") != (state.get("request") or {}).get("move")


class SeamStore:
    """Finished seams on disk. The app asks for more here, and a worker process makes them, so
    rendering can never make the app feel slow. See `selecta.seam_worker`."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.root = settings.renders_dir / "seams"
        self._lock = threading.Lock()
        self._states: dict[str, dict] = {}
        self._urgent: deque[SeamRequest] = deque()
        self._later: deque[SeamRequest] = deque()
        self._requested: deque[tuple[SeamRequest, list[str]]] = deque()
        self._request_keys: set[str] = set()
        self._request_waiting = False
        self._arrived = threading.Event()
        self._running_rank = PREPARING
        self._mix_checked_at = 0.0
        self._active_checked_at = 0.0
        self._running_key = ""
        self._running_is_stale = False
        self._sign_renewed_at = 0.0
        self._mix_waiting = False
        self.next_mix_seam: Callable[[], SeamRequest | None] = lambda: None
        self.keep_for_now: Callable[[], set[str]] = set
        self.mix_moves: Callable[[], Counter[str]] = Counter
        self.next_line_seam: Callable[[], tuple[int, SeamRequest] | None] = lambda: None
        self.draft_moves: Callable[[int], Counter[str]] = lambda _draft: Counter()
        self._running_draft: int | None = None
        self._running_requested: tuple[SeamRequest, list[str]] | None = None
        self._line_waiting = False
        self.memory = SeamMemory()
        self.clock = JobClock(settings.home)
        self._window_specs: dict[str, list[tuple[str, float, float]]] = {}
        self.window_totals: dict[str, int] = {}
        self._quote: float | None = None
        self._remembered: tuple[float, SeamMemory] | None = None
        self._records: dict[Path, tuple[tuple[int, int], dict]] = {}
        self._asked_by_requests: set[str] = set()
        self.next_idle_job: Callable[[], SeamRequest | None] = lambda: None
        self._worker: subprocess.Popen | None = None
        self.prepare_links = False
        self._cache = SongCache(capacity=7)
        self._aligner: Aligner | None = None
        for meta in self.root.glob("*/seam.json"):
            try:
                previous = json.loads(meta.read_text("utf-8"))
                if (
                    previous.get("status") in {"ready", "failed"}
                    and previous.get("key") == meta.parent.name
                ):
                    self._remember(previous)
            except (OSError, ValueError):
                continue

    def folder(self, key: str) -> Path:
        return self.root / key

    def _remember(self, state: dict) -> None:
        history = self.settings.home / "seam-history"
        history.mkdir(parents=True, exist_ok=True)
        target = history / f"{state['key']}.json"
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=history, suffix=".tmp", delete=False
        ) as stream:
            temporary = Path(stream.name)
            json.dump(state, stream)
        try:
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)

    def windows_left(self, request: SeamRequest, a: SongInfo, b: SongInfo) -> int:
        """How many stem windows this seam still has to split. Never gets in the way: an estimate
        that can't be made better isn't worth a seam failing over."""
        try:
            if request.move in SESSION_MOVES:
                session = SeamRequest(
                    a.id,
                    b.id,
                    STUDIO_SESSION,
                    exit_bar=request.exit_bar,
                    entry_bar=request.entry_bar,
                )
                folder = self.folder(session.key)
                laid_out = (folder / "session.json").exists() and all(
                    (folder / f"{side}_{lane}.flac").exists() for side in SIDES for lane in LANES
                )
                if laid_out:
                    return 0
                return windows_to_separate(self.settings, a, b, request.exit_bar, request.entry_bar)
            specs = self._window_specs.get(request.key)
            if specs is None:
                specs = self._window_specs[request.key] = windows_for(request, a, b)
            return sum(
                not window_is_ready(self.settings, Path(path), start, length)
                for path, start, length in specs
            )
        except (OSError, ValueError, KeyError, IndexError, AttributeError, TypeError):
            return 0

    def status(self, key: str) -> dict:
        """What's on disk comes first, because that's where the worker reports. Nothing is under
        way once the worker has gone, so a crash can't leave a seam "rendering" forever."""
        state = self._last_known(key)
        if state["status"] in {"queued", "rendering"} and self._worker_has_gone():
            return {"status": "none", "key": key}
        return state

    def forget_song(self, song_id: int) -> int:
        """A song's analysis was corrected, so what was rendered from the old one no longer stands.
        Only transitions that touch that song go, and only their records: the songs themselves are
        never involved. Says how many."""
        forgotten = 0
        histories = (self.settings.home / "seam-history").glob("*.json")
        for meta in [*self.root.glob("*/seam.json"), *histories]:
            try:
                request = json.loads(meta.read_text("utf-8")).get("request") or {}
            except (OSError, ValueError):
                continue
            if song_id in {request.get("a"), request.get("b")}:
                _unlink_after_readers(meta)
                if meta.name == "seam.json":
                    _unlink_after_readers(meta.parent / "clip.flac")
                    forgotten += 1
                key = request.get("key")
                if key:
                    with self._lock:
                        self._states.pop(key, None)
        self._remembered = None
        return forgotten

    def status_reader(self) -> Callable[[str], dict]:
        """For looking up a lot of seams at once, most of which have never been tried. One look at
        what exists saves asking the disk about each."""
        known: set[str] = set()
        for folder, ending in ((self.root, ""), (self.settings.home / "seam-history", ".json")):
            try:
                known |= {entry.name.removesuffix(ending) for entry in os.scandir(folder)}
            except OSError:
                pass  # nothing has been rendered yet
        with self._lock:
            known |= set(self._states)
        return lambda key: self.status(key) if key in known else {"status": "none", "key": key}

    def _last_known(self, key: str) -> dict:
        meta = self.folder(key) / "seam.json"
        if meta.exists():
            try:
                state = json.loads(meta.read_text("utf-8"))
                if _swapped_by_old_fallback(state):
                    return {"status": "none", "key": key}
                return state
            except (OSError, ValueError):
                pass  # mid-write: what we last knew will do for this moment
        with self._lock:
            state = self._states.get(key)
        if state is None:
            try:
                remembered = json.loads(
                    (self.settings.home / "seam-history" / f"{key}.json").read_text("utf-8")
                )
                if remembered.get("status") == "failed":
                    return remembered
            except (OSError, ValueError):
                pass
        return state if state is not None else {"status": "none", "key": key}

    def _worker_has_gone(self) -> bool:
        return self._worker is not None and self._worker.poll() is not None

    def forget_missing_audio(self, key: str) -> bool:
        """Forget a completed clip whose disposable audio was evicted, retaining its history.

        Failed renders keep their negative cache. Studio preparation has stems rather than
        a clip, so this is only for playable transitions.
        """
        state = self.status(key)
        if (
            state.get("status") != "ready"
            or (state.get("request") or {}).get("move") == STUDIO_SESSION
            or (self.folder(key) / "clip.flac").is_file()
        ):
            return False
        (self.folder(key) / "seam.json").unlink(missing_ok=True)
        with self._lock:
            self._states.pop(key, None)
        return True

    def submit(
        self,
        request: SeamRequest,
        urgent: bool = False,
        retry: bool = False,
        after: list[str] | None = None,
    ) -> dict:
        """Ask the worker for a seam. Anything done or under way stays as it is. Urgent is for a
        seam in the mix that a person just tapped or is about to hear: it goes ahead of the rest of
        the mix, even a seam already waiting. Nothing outside the mix is ever urgent."""
        key = request.key
        current = self.status(key)
        if current["status"] == "failed" and not retry:
            return current
        if current["status"] in {"ready", "rendering"}:
            return current
        if current["status"] == "queued" and not urgent:
            return current
        (self.folder(key) / "seam.json").unlink(missing_ok=True)
        state = {"status": "queued", "key": key, "request": asdict(request)}
        with self._lock:
            self._states[key] = state
        self.start()
        assert self._worker is not None and self._worker.stdin is not None
        message = {"request": asdict(request), "urgent": urgent}
        if after is not None:
            message["after"] = after
            with self._lock:
                self._asked_by_requests.add(key)
        self._worker.stdin.write(json.dumps(message) + "\n")
        self._worker.stdin.flush()
        return state

    def keep_requested(self, wanted: set[str]) -> None:
        """Requests go ahead of the rest of the mix, so what they've stopped needing mustn't. Plans
        change whenever the mix does, and a transition nobody's waiting for has no business holding
        up one that somebody is. If it comes back, it's asked for again from where it got to."""
        with self._lock:
            gone = self._asked_by_requests - wanted
            if not gone:
                return
            self._asked_by_requests -= gone
            for key in gone:
                if self._states.get(key, {}).get("status") == "queued":
                    del self._states[key]
        if self._worker is None or self._worker.poll() is not None:
            return
        assert self._worker.stdin is not None
        try:
            self._worker.stdin.write(json.dumps({"drop": sorted(gone)}) + "\n")
            self._worker.stdin.flush()
        except OSError:
            pass  # it's stopped, so it isn't working on any of them

    def start(self) -> None:
        """Start the worker if it isn't running, which also begins spare-time preparing."""
        with self._lock:
            if self._worker is not None and self._worker.poll() is None:
                return
            command = [sys.executable, "-m", "selecta.seam_worker"]
            if self.prepare_links:
                command.append("--prepare")
            self._worker = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                env={**os.environ, "SELECTA_HOME": str(self.settings.home)},
            )

    # ---- the rest runs in the worker process

    def ask(
        self, request: SeamRequest, urgent: bool = False, after: list[str] | None = None
    ) -> None:
        """Take a job. `after` marks one for a song someone requested: it goes once those seams,
        the ones that will be heard before it, are done, and ahead of the rest of the mix."""
        with self._lock:
            self._urgent = deque(item for item in self._urgent if item.key != request.key)
            self._later = deque(item for item in self._later if item.key != request.key)
            self._requested = deque(i for i in self._requested if i[0].key != request.key)
            if after is not None and not urgent:
                self._requested.append((request, list(after)))
                self._request_keys.add(request.key)
            elif urgent:
                self._urgent.appendleft(request)
            else:
                self._later.append(request)
        self._arrived.set()

    def drop_requests(self, keys: Iterable[str]) -> None:
        """Stop waiting to do these for a request. One already being rendered finishes, since it
        costs nothing to keep and might well be wanted again."""
        gone = set(keys)
        with self._lock:
            self._requested = deque(item for item in self._requested if item[0].key not in gone)
            self._request_keys -= gone

    def remembered(self, fresh: bool = False) -> SeamMemory:
        """Everything finished seams have shown, including ones the render cache has cleared. It's
        kept for a few seconds, since suggestions ask for it with every key pressed."""
        now = time.monotonic()
        if not fresh and self._remembered and now - self._remembered[0] < MEMORY_SECONDS:
            return self._remembered[1]
        states: dict[str, dict] = {}
        histories = (self.settings.home / "seam-history").glob("*.json")
        records: dict[Path, tuple[tuple[int, int], dict]] = {}
        for meta in [*self.root.glob("*/seam.json"), *histories]:
            try:
                facts = meta.stat()
                stamp = (facts.st_mtime_ns, facts.st_size)
                known = self._records.get(meta)
                state = (
                    known[1] if known and known[0] == stamp else json.loads(meta.read_text("utf-8"))
                )
            except (OSError, ValueError):
                continue
            records[meta] = (stamp, state)  # a file that hasn't changed needn't be read again
            states.setdefault(state.get("key", str(meta)), state)
        self._records = records
        memory = SeamMemory.from_states(states.values())
        self._remembered = (now, memory)
        return memory

    def forget_unfinished(self) -> None:
        """Anything marked as under way was cut off when the last worker stopped."""
        if not self.root.is_dir():
            return
        for meta in self.root.glob("*/seam.json"):
            try:
                if json.loads(meta.read_text("utf-8")).get("status") == "rendering":
                    meta.unlink()
            except (OSError, ValueError):
                meta.unlink(missing_ok=True)

    def _next_requested(
        self, whatever_is_ahead: bool = False
    ) -> tuple[SeamRequest, list[str]] | None:
        """The first request whose turn has come: nothing that plays before it is still unfinished.
        Only seams still in the mix hold one up, since the mix may have changed since it was asked
        for, and with `whatever_is_ahead` nothing does, because the mix can't go any further just
        now and a request mustn't wait for something that isn't coming."""
        with self._lock:
            waiting = list(self._requested)
        active = self.keep_for_now()
        unfinished = {"none", "queued", "rendering"}
        for item in waiting:
            request, after = item
            if self.status(request.key)["status"] in {"ready", "failed"}:
                with self._lock:
                    self._requested = deque(i for i in self._requested if i is not item)
                continue
            if whatever_is_ahead:
                return item
            ahead = [key for key in after if not active or key in active]
            if not any(self.status(key)["status"] in unfinished for key in ahead):
                return item
        return None

    def _next_job(self) -> SeamRequest:
        """What's about to be heard, then the rest of the mix in order, then the mixes in the render
        line, then anything else a person asked for. Spare time goes on word links and the library's
        best transitions."""
        while True:
            self._arrived.clear()
            self._running_draft = None
            active = self.keep_for_now()
            with self._lock:
                # anything from a mix that's since been replaced goes behind the one now active
                while self._urgent:
                    request = self._urgent.popleft()
                    if request.move == STUDIO_SESSION:
                        # someone's waiting at the studio, and it isn't part of any mix
                        self._running_rank = URGENT
                        self._running_key = ""
                        return request
                    if not active or request.key in active:
                        self._running_rank = URGENT
                        self._running_key = request.key
                        return request
                    self._later.append(request)
            request = self.next_mix_seam()
            requested = self._next_requested(whatever_is_ahead=request is None)
            if requested is not None:
                with self._lock:
                    self._requested = deque(i for i in self._requested if i is not requested)
                self._running_requested = requested
                self._running_rank = REQUEST
                self._running_key = ""
                return requested[0]
            if request is not None:
                self._running_rank = MIX
                self._running_key = request.key
                return request
            in_line = self.next_line_seam()
            if in_line is not None:
                self._running_draft, request = in_line
                self._running_rank = LINE
                self._running_key = request.key
                return request
            while True:
                with self._lock:
                    request = self._later.popleft() if self._later else None
                if request is None or self.status(request.key)["status"] != "ready":
                    break
            if request is not None:
                self._running_rank = LATER
                return request
            request = self.next_idle_job()
            if request is not None:
                self._running_rank = PREPARING
                return request
            jobs.mark_mix_rendering(self.settings.home, False)
            self._arrived.wait(IDLE_CHECK_SECONDS)

    def _give_way(self) -> bool:
        """Is something more important waiting than what's running now?"""
        rank = self._running_rank
        moment = time.monotonic()
        if rank != PREPARING and moment - self._sign_renewed_at > jobs.MIX_SIGN_RENEW_SECONDS:
            self._sign_renewed_at = moment
            jobs.mark_mix_rendering(self.settings.home, True)
        if rank <= LINE:
            # a seam from a mix that's been replaced stops, however far along it is
            if moment - self._active_checked_at > MIX_CHECK_SECONDS:
                self._active_checked_at = moment
                active = self.keep_for_now()
                self._running_is_stale = (
                    bool(active) and bool(self._running_key) and self._running_key not in active
                )
            if self._running_is_stale:
                return True
        if rank <= URGENT:
            return False
        if self._urgent:
            return True
        if rank <= MIX:
            return False
        if moment - self._mix_checked_at > MIX_CHECK_SECONDS:
            self._mix_checked_at = moment
            self._mix_waiting = self.next_mix_seam() is not None
            self._line_waiting = rank > LINE and self.next_line_seam() is not None
            self._request_waiting = self._next_requested() is not None
        if self._mix_waiting or self._line_waiting or self._request_waiting:
            return True
        return rank > LATER and bool(self._later)

    def _mark_rendering(self, request: SeamRequest) -> None:
        folder = self.folder(request.key)
        folder.mkdir(parents=True, exist_ok=True)
        state = {
            "status": "rendering",
            "key": request.key,
            "request": asdict(request),
            "started_at": time.time(),
        }
        (folder / "seam.json").write_text(json.dumps(state), "utf-8")

    def run_forever(self) -> None:
        conn = db.connect(self.settings.db_path)
        jobs.give_way_when(self._give_way)
        while True:
            request = self._next_job()
            self._running_is_stale = False
            jobs.set_render_priority(self._running_rank != PREPARING)
            jobs.mark_mix_rendering(self.settings.home, self._running_rank != PREPARING)
            self._sign_renewed_at = time.monotonic()
            self._mark_rendering(request)
            self.memory = self.remembered(fresh=True)
            started = time.monotonic()
            splitting_before = seconds_separating()
            self._quote = None
            try:
                self.render_now(conn, request)
                if request.move != STUDIO_SESSION:
                    # the move's own work, since splitting stems is timed and quoted separately
                    total = time.monotonic() - started
                    work = max(total - (seconds_separating() - splitting_before), 0.1)
                    self.clock.record(request.move, work, self._quote, total)
            except jobs.Interrupted:
                # the mix needed the machine. This simply isn't done yet, so it goes back in line
                (self.folder(request.key) / "seam.json").unlink(missing_ok=True)
                if self._running_rank == LATER:
                    with self._lock:
                        self._later.appendleft(request)
                if self._running_rank == REQUEST and self._running_requested is not None:
                    with self._lock:
                        self._requested.appendleft(self._running_requested)
                continue
            except CannotTrust as problem:
                self._save_failure(request, UNSURE_WORDS, problem.song_id)
            except CannotRender as problem:
                self._save_failure(request, str(problem))
            except Exception as problem:  # noqa: BLE001 - a failed seam must not end the worker
                self._save_failure(request, f"Something went wrong: {problem}")
            prune_cache(self.settings, {request.key} | self.keep_for_now() | self._request_keys)

    def _save_failure(
        self, request: SeamRequest, error: str, untimed_song: int | None = None
    ) -> dict:
        """Remember what didn't work, so spare time isn't spent trying it again."""
        result = {
            "status": "failed",
            "key": request.key,
            "request": asdict(request),
            "error": error,
            "untimed_song": untimed_song,
            "rules": RULES_VERSION,
        }
        folder = self.folder(request.key)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "seam.json").write_text(json.dumps(result, indent=1), "utf-8")
        self._remember(result)
        return result

    def render_now(self, conn: sqlite3.Connection, request: SeamRequest) -> dict:
        a = load_song(conn, self.settings, request.a)
        b = load_song(conn, self.settings, request.b)
        if request.move != STUDIO_SESSION:
            windows = [self.clock.estimate("stem_window")] * self.windows_left(request, a, b)
            self._quote = combine([self.clock.estimate(request.move), *windows]).seconds
        if request.move == STUDIO_SESSION:
            windows = windows_to_separate(self.settings, a, b, request.exit_bar, request.entry_bar)
            started = time.monotonic()
            session = _make_session(self.settings, request, a, b)
            splitting = windows * self.clock.estimate("stem_window").seconds
            self.clock.record(STUDIO_SESSION, max(time.monotonic() - started - splitting, 1.0))
            state = {
                **session,
                "status": "ready",
                "key": request.key,
                "request": asdict(request),
                "tried": [],
                "rules": RULES_VERSION,
            }
            (self.folder(request.key) / "seam.json").write_text(json.dumps(state), "utf-8")
            return state
        fell_back = False
        tried: list[dict] = []
        rendered: Rendered | None = None
        near: tuple | None = None
        preference = db.preference(conn, "steering", {}) if conn is not None else {}
        stem_preference = preference.get("stems", "sometimes")
        disabled_planned_stem = (
            request.soft and stem_preference == "never" and request.move in STEM_MOVES
        )
        if disabled_planned_stem:
            tried.append({"move": request.move, "why": "Stem-assisted moves are set to Never."})
        elif request.move != "auto":
            try:
                rendered, report, why = self._chosen_move(request, a, b)
            except CannotTrust as problem:
                if not request.soft:
                    raise
                tried.append({"move": request.move, "why": UNSURE_WORDS, "song": problem.song_id})
            except CannotRender as problem:
                if not request.soft:
                    raise
                tried.append({"move": request.move, "why": str(problem)})
            if request.soft and rendered is not None and not report.passed:
                if good_enough(report):
                    near = (rendered, report, why, request.move)
                else:
                    tried.append({"move": request.move, "why": _what_failed(report)})
                rendered = None
        if rendered is None:
            rendered, report, why, fell_back = self._best_move(
                a,
                b,
                tried,
                request.move,
                near,
                stem_preference=stem_preference,
                leave_after=request.leave_after,
            )
        return self._save(request, rendered, report, why, fell_back, tried)

    def _chosen_move(self, request: SeamRequest, a: SongInfo, b: SongInfo):
        take = self._render_move(request, a, b)
        if _too_soon(take[0].script, request):
            raise CannotRender("This move's place in the song has gone by before it gets there.")
        return take

    def _render_move(self, request: SeamRequest, a: SongInfo, b: SongInfo):
        if request.move == "stem_arrange":
            return _arranged(self.settings, request, a, b, self.memory)
        if request.move in STEM_MOVES:
            if request.move == "stem_intertwine":
                return _stem_render(self.settings, None, request, a, b, self._cache)
            if self._aligner is None:
                self._aligner = Aligner(str(self.settings.models_dir))
            return _stem_render(self.settings, self._aligner, request, a, b, self._cache)
        if request.move in MOVES:
            place = self.memory.placements.get((a.id, b.id, request.move))
            return _bar_cue_render(request, a, b, self._cache, place)
        raise CannotRender(f"There's no move called {request.move}.")

    def _take(
        self, a: SongInfo, b: SongInfo, move: str, tried: list[dict], leave_after: float | None
    ):
        """Render one move, noting why if it can't be done at all."""
        try:
            return self._chosen_move(SeamRequest(a.id, b.id, move, leave_after=leave_after), a, b)
        except CannotTrust as problem:
            tried.append({"move": move, "why": UNSURE_WORDS, "song": problem.song_id})
        except CannotRender as problem:
            tried.append({"move": move, "why": str(problem)})
        return None

    def _best_move(
        self,
        a: SongInfo,
        b: SongInfo,
        tried: list[dict],
        asked: str = "auto",
        near: tuple | None = None,
        stem_preference: str = "sometimes",
        leave_after: float | None = None,
    ):
        """The move that best suits these two and the rest of the mix, taken clean if at all
        possible. None of the seams rated so far with a warning were liked, so any clean take beats
        a near miss, and a near miss is only kept when nothing comes out clean. A cut only if
        nothing else can work, since it's the one the listener likes least. `near` is a near miss
        already in hand."""
        can_ride = "word_blend" in modes_for(a, b) and ride_lines(a, b) is not None
        draft = self._running_draft
        used = self.mix_moves() if draft is None else self.draft_moves(draft)
        moves = fallback_order(a.id, b.id, can_ride, used, can_arrange(a, b))
        if stem_preference == "never":
            moves = [move for move in moves if move not in STEM_MOVES]
        # what's already known to fail isn't worth minutes, and what's known to work goes first
        moves = sorted(
            (move for move in moves if self.memory.move_factor(a.id, b.id, move) > 0),
            key=lambda move: not self.memory.proven(a.id, b.id, move),
        )
        held = near
        for move in moves:
            if move == asked or (move in {"vocal_ride", "stem_arrange"} and held is not None):
                continue  # stems take minutes, which isn't worth it to improve on a near miss
            take = self._take(a, b, move, tried, leave_after)
            if take is None:
                continue
            rendered, report, why = take
            if report.passed:
                return rendered, report, why, asked not in {"auto", move}
            if held is None and good_enough(report):
                held = (rendered, report, why, move)
            tried.append({"move": move, "why": _what_failed(report)})
        if held is not None:
            rendered, report, why, move = held
            tried[:] = [attempt for attempt in tried if attempt["move"] != move]
            return rendered, report, why, asked not in {"auto", move}
        choice = choose_transition(
            a, b, "cut_on_one", cache=self._cache, exits=_exits_after(a, leave_after) or None
        )
        why = "; ".join(choice.candidate.reasons)
        return choice.rendered, choice.report, why, True

    def _save(
        self,
        request: SeamRequest,
        rendered: Rendered,
        report: AuditReport,
        why: str,
        fell_back: bool,
        tried: list[dict] | None = None,
    ) -> dict:
        folder = self.folder(request.key)
        folder.mkdir(parents=True, exist_ok=True)
        script = rendered.script
        sf.write(folder / "clip.flac", rendered.audio, SAMPLE_RATE, subtype="PCM_16")
        heard, clip_at = in_context(rendered, PREVIEW_SECONDS, PREVIEW_SECONDS, self._cache)
        sf.write(folder / "preview.flac", heard, SAMPLE_RATE, subtype="PCM_16")
        result = {
            "status": "ready",
            "key": request.key,
            "request": asdict(request),
            "style": script.style,
            "label": MOVES.get(script.style, (script.style, ""))[0],
            "why": why,
            "fell_back": fell_back,
            "tried": tried or [],
            "rules": RULES_VERSION,
            "exit_bar": script.meta.get("exit_bar"),
            "entry_bar": script.meta.get("entry_bar"),
            "placed_bars": script.meta.get("placed_bars"),
            "shape_used": script.meta.get("shape"),
            "arc": script.meta.get("arc"),
            "a_source_start": float(script.a_source_start),
            "b_source_end": float(script.b_source_end),
            "duration": float(script.duration),
            "switch_at": _switch_at(rendered),
            "preview_seam": float(clip_at + script.overlap[0]),
            "bars": int(script.meta.get("bars", 0) or 0),
            "passed": report.passed,
            "near_miss": not report.passed and good_enough(report),
            "checks": _plain_checks(report),
        }
        (folder / "seam.json").write_text(json.dumps(result, indent=1), "utf-8")
        self._remember(result)
        return result

    def rate(self, key: str, rating: str, note: str = "") -> dict:
        status = self.status(key)
        if status["status"] != "ready":
            raise CannotRender("That seam hasn't finished rendering.")
        status["rating"] = rating
        status["rated_at"] = time.time()
        status["note"] = note
        (self.folder(key) / "seam.json").write_text(json.dumps(status, indent=1), "utf-8")
        self._remember(status)
        return status
