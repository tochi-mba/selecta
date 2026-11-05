"""Render any transition a person asks for, keep the result, and say how it went.

Every seam is a small request: which songs, which move, and any choices the person made.
The same request always gives the same files, so changing your mind back costs nothing. Rendering
runs on one worker thread, because it's heavy and this machine has four cores. Nothing here runs
while the browser plays: it only ever receives finished audio.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
from collections import deque
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from pathlib import Path

import soundfile as sf

from selecta import db, jobs
from selecta.analysis.song import Cue, SongInfo, load_song
from selecta.audit.checks import AuditReport, Check, audit
from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE, Settings
from selecta.lyrics.align import Aligner
from selecta.lyrics.lrclib import Line
from selecta.lyrics.match import LyricLink, SongFacts, discover
from selecta.planner.choose import choose_transition, enumerate_candidates, tempo_gap
from selecta.planner.fit import MAX_FOLDED_GAP, folded_gap
from selecta.planner.wordreel import (
    CannotTrust,
    locate_line_edge,
    locate_phrase,
    modes_for,
    ride_lengths,
    ride_lines,
)
from selecta.render.engine import Rendered, SongCache, in_context, render
from selecta.stems import prune_cache
from selecta.styles import all_recipes
from selecta.styles.wordplay import phrase_roll, vocal_ride, word_blend, word_cut, word_exchange

RENDER_VERSION = 1
PREVIEW_SECONDS = 12.0
IDLE_CHECK_SECONDS = 3.0
MIX_CHECK_SECONDS = 2.0
# who goes first: what's about to be heard, the rest of the mix, other requests, then spare time
URGENT, MIX, LATER, PREPARING = range(4)
UNSURE_WORDS = "Selecta can’t tell exactly when these words are sung, so it won’t cut on them."
PLACEMENTS_TO_TRY = 4

MOVES: dict[str, tuple[str, str]] = {
    "auto": ("Let Selecta pick", "The best move for these two songs that passes its checks."),
    "bass_swap_blend": ("Blend", "Both songs play in time, and they trade the bass halfway."),
    "vocal_ride": ("Vocal ride", "B's band comes in under A's voice, before B starts singing."),
    "filter_sweep": ("Filter sweep", "A filters away upward as B opens up."),
    "tempo_ramp": ("Tempo ramp", "Both songs drift to a shared speed for a short overlap."),
    "word_blend": ("Word blend", "A vocal ride that hands over on a phrase both songs share."),
    "word_exchange": (
        "Call and response",
        "The voices trade a phrase over B's band until B keeps it.",
    ),
    "phrase_roll": ("Phrase roll", "A's phrase repeats, faster and faster, into B singing it."),
    "word_cut": ("Word cut", "A sets a phrase up, and B sings it."),
    "cut_on_one": ("Cut", "A clean cut onto B's downbeat."),
    "echo_out": ("Echo out", "A's last beat rings on as B lands under it."),
    "delay_throw": ("Delay throw", "A's last word is thrown into a delay as B slams in."),
    "reverb_wash": ("Reverb wash", "A dissolves into a room as B arrives."),
}
WORD_MOVES = {"word_blend", "word_exchange", "phrase_roll", "word_cut"}
STEM_MOVES = WORD_MOVES | {"vocal_ride"}


@dataclass(frozen=True)
class SeamRequest:
    a: int
    b: int
    move: str = "auto"
    bars: int | None = None
    exit_bar: int | None = None
    entry_bar: int | None = None
    phrase: str | None = None
    soft: bool = False
    """Selecta chose this move, not the person, so if it doesn't pass, use whatever does."""

    @property
    def key(self) -> str:
        text = json.dumps([asdict(self), ANALYSIS_VERSION, RENDER_VERSION], sort_keys=True)
        return hashlib.sha256(text.encode()).hexdigest()[:20]


class CannotRender(ValueError):
    """This move can't work on these two songs. The message says why, in plain words."""


def links_between(a: SongInfo, b: SongInfo) -> list[LyricLink]:
    """Places where A can finish a line on a phrase that B opens a line with."""
    if not (a.lines and b.lines):
        return []
    found = discover(
        {a.id: a.lines, b.id: b.lines},
        facts={
            a.id: SongFacts(a.artist, a.title, a.duration),
            b.id: SongFacts(b.artist, b.title, b.duration),
        },
        keep_all_pairs=True,
    )
    return [link for link in found if link.song_a == a.id and link.song_b == b.id]


def _why_unavailable(move: str, a: SongInfo, b: SongInfo, has_link: bool) -> str | None:
    gap = tempo_gap(a, b)
    if move in WORD_MOVES and not has_link:
        return "These two songs don't share a phrase at a line end and a line start."
    modes = modes_for(a, b)
    if move in WORD_MOVES and move not in modes:
        if move == "phrase_roll":
            if a.family == "rock":
                return "A stutter fights a rock song, so this one's out."
            return "B feels much slower than A, so a roll would promise a drop it can't deliver."
        if move == "word_cut":
            return f"The songs are {gap:.0%} apart in tempo, too far for a bare cut to carry."
        return f"The songs are {gap:.0%} apart in tempo or too far apart in key to play together."
    if move == "vocal_ride":
        if "word_blend" not in modes:
            return f"The songs are {gap:.0%} apart in tempo or too far apart in key."
        if ride_lines(a, b) is None:
            return "A isn't singing enough near a place it could finish."
        return None
    if move in WORD_MOVES or move == "auto":
        return None
    if not enumerate_candidates(a, b, move):
        if move in {"bass_swap_blend", "filter_sweep"}:
            if gap > 0.08:
                return f"The songs are {gap:.0%} apart in tempo, too far to play together."
            return "One song's beat grid is unsure, or a vocal or key would clash."
        if move == "tempo_ramp":
            if gap < 0.05:
                return "The tempos are already close, so a normal blend does this better."
            return f"A {gap:.0%} tempo gap is too wide, or a vocal or key would clash."
        if folded_gap(a, b) > MAX_FOLDED_GAP:
            return f"The songs are {folded_gap(a, b):.0%} apart in tempo, too far to cut across."
        return "B has no strong place to land at a level that matches A."
    return None


def seam_options(a: SongInfo, b: SongInfo) -> dict:
    """Everything a person could choose for this seam, with a reason for anything ruled out."""
    links = links_between(a, b)
    moves = []
    for name, (label, description) in MOVES.items():
        reason = _why_unavailable(name, a, b, bool(links))
        moves.append(
            {
                "name": name,
                "label": label,
                "description": description,
                "available": reason is None,
                "reason": reason,
            }
        )
    return {
        "moves": moves,
        "exits": [
            {"bar": cue.bar, "time": round(cue.time, 2), "kind": cue.kind}
            for cue in sorted(a.exit_cues()[:12], key=lambda c: c.time)
        ],
        "entries": [
            {"bar": cue.bar, "time": round(cue.time, 2), "kind": cue.kind}
            for cue in sorted(b.entry_cues()[:12], key=lambda c: c.time)
        ],
        "lengths": [4, 8, 16, 32],
        "links": [
            {
                "phrase": link.phrase,
                "line_a": link.line_a.text,
                "line_b": link.line_b.text,
                "score": link.score,
            }
            for link in links[:8]
        ],
        "tempo_gap": round(tempo_gap(a, b) * 100, 1),
        "keys": [a.camelot, b.camelot],
    }


CHECK_WORDS = {
    "beat alignment": ("Beats line up", "Beats drift apart"),
    "vocal overlap": ("Vocals take turns", "Two voices clash"),
    "phrase integrity": ("Nothing cut mid-line", "A line gets cut off"),
    "quiet time": ("No gap in the sound", "There's a quiet gap"),
    "entry level": ("B doesn't jump out", "B comes in too loud"),
    "level fall": ("The level holds up", "The level drops after the seam"),
    "low end clash": ("Clean low end", "Two bass lines fight"),
    "harmony": ("Keys sit together", "The keys clash"),
    "true peak": ("No clipping", "It clips"),
    "stretch": ("Tempo change is gentle", "Tempo is stretched too far"),
}


def _plain_checks(report: AuditReport) -> list[dict]:
    return [
        {
            "name": check.name,
            "passed": check.passed,
            "text": CHECK_WORDS.get(check.name, (check.name, check.name))[0 if check.passed else 1],
            "value": f"{check.value}{check.unit}",
        }
        for check in report.checks
    ]


def _chosen_cue(song: SongInfo, bar: int) -> Cue:
    return Cue(bar, song.bar_time(bar), "chosen", 0.5, 0)


def _bar_cue_render(
    request: SeamRequest, a: SongInfo, b: SongInfo, cache: SongCache
) -> tuple[Rendered, AuditReport, str]:
    recipe = all_recipes()[request.move]
    pool = enumerate_candidates(a, b, request.move)
    if request.bars is not None and recipe.beatmatched:
        narrowed = [c for c in pool if c.bars == request.bars]
        pool = narrowed or pool
    if request.exit_bar is not None:
        pool = [c for c in pool if c.exit_cue.bar == request.exit_bar] or pool
    if request.entry_bar is not None:
        pool = [c for c in pool if c.entry_cue.bar == request.entry_bar] or pool
    if not pool and request.exit_bar is None and request.entry_bar is None:
        raise CannotRender(_why_unavailable(request.move, a, b, False) or "No place to do this.")
    if request.exit_bar is not None or request.entry_bar is not None or not pool:
        default_bars = request.bars or (recipe.lengths[0] if recipe.beatmatched else 0)
        best = pool[0] if pool else None
        exit_cue = (
            _chosen_cue(a, request.exit_bar) if request.exit_bar is not None else best.exit_cue
        )
        entry_cue = (
            _chosen_cue(b, request.entry_bar) if request.entry_bar is not None else best.entry_cue
        )
        bars = request.bars or (best.bars if best else default_bars)
        tries = [
            (exit_cue, entry_cue, bars, "; ".join(best.reasons) if best else "your cue points")
        ]
    else:
        tries = [
            (item.exit_cue, item.entry_cue, item.bars, "; ".join(item.reasons))
            for item in pool[:PLACEMENTS_TO_TRY]
        ]
    first = None
    for exit_cue, entry_cue, bars, why in tries:
        script = recipe.make(a, b, exit_cue, entry_cue, bars)
        if script is None:
            continue
        rendered = render(script, cache)
        report = audit(rendered)
        if report.passed:
            return rendered, report, why
        first = first or (rendered, report, why)
    if first is None:
        raise CannotRender("Those cue points don't leave enough room for this move.")
    return first


def _stem_render(
    settings: Settings,
    aligner: Aligner,
    request: SeamRequest,
    a: SongInfo,
    b: SongInfo,
    cache: SongCache,
) -> tuple[Rendered, AuditReport, str]:
    if request.move == "vocal_ride":
        lines = ride_lines(a, b)
        if lines is None:
            raise CannotRender("A isn't singing enough near a place it could finish.")
        edge_a = locate_line_edge(settings, aligner, a, lines[0], at_end=True)
        edge_b = locate_line_edge(settings, aligner, b, lines[1], at_end=False)
        script = None
        for bars in [request.bars] if request.bars else ride_lengths(a, edge_a.words[0].end):
            script = vocal_ride(
                a,
                b,
                edge_a.words[0],
                edge_b.words[0],
                edge_a.voice,
                edge_a.band,
                edge_b.band,
                bars,
            )
            if script is not None:
                break
        why = f"“{lines[0].text}” rides B's band, then “{lines[1].text}”"
    else:
        links = links_between(a, b)
        if request.phrase:
            links = [link for link in links if link.phrase == request.phrase] or links
        if not links:
            raise CannotRender("These two songs don't share a phrase to hand over on.")
        link = links[0]
        phrase_a = locate_phrase(settings, aligner, a, link.line_a, link.phrase, at_end=True)
        phrase_b = locate_phrase(settings, aligner, b, link.line_b, link.phrase, at_end=False)
        why = f"“{link.line_a.text}” into “{link.line_b.text}”"
        if request.move == "phrase_roll":
            script = phrase_roll(
                a, b, phrase_a.words, phrase_b.words, phrase_a.voice, phrase_a.band, phrase_b.band
            )
        elif request.move == "word_exchange":
            script = None
            for bars in [request.bars] if request.bars else ride_lengths(a, phrase_a.words[-1].end):
                script = word_exchange(
                    a,
                    b,
                    phrase_a.words,
                    phrase_b.words,
                    phrase_a.voice,
                    phrase_a.band,
                    phrase_b.band,
                    bars,
                )
                if script is not None:
                    break
        elif request.move == "word_cut":
            script = word_cut(a, b, phrase_a.words, phrase_b.words, phrase_b.band)
        else:
            script = None
            for bars in [request.bars] if request.bars else ride_lengths(a, phrase_a.words[-1].end):
                script = word_blend(
                    a,
                    b,
                    phrase_a.words,
                    phrase_b.words,
                    phrase_a.voice,
                    phrase_a.band,
                    phrase_b.band,
                    bars,
                )
                if script is not None:
                    break
    if script is None:
        raise CannotRender("The beats and the words don't line up for this move here.")
    rendered = render(script, cache)
    return rendered, audit(rendered), why


def _switch_at(rendered: Rendered) -> float:
    """When the listener's attention moves to B, in seconds into the clip."""
    return float(rendered.script.overlap[1])


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
        self._arrived = threading.Event()
        self._running_rank = PREPARING
        self._mix_checked_at = 0.0
        self._mix_waiting = False
        self.next_mix_seam: Callable[[], SeamRequest | None] = lambda: None
        self.keep_for_now: Callable[[], set[str]] = set
        self.next_idle_job: Callable[[], SeamRequest | None] = lambda: None
        self._worker: subprocess.Popen | None = None
        self.prepare_links = False
        self._cache = SongCache(capacity=7)
        self._aligner: Aligner | None = None

    def folder(self, key: str) -> Path:
        return self.root / key

    def status(self, key: str) -> dict:
        """What's on disk comes first, because that's where the worker reports. Nothing is under
        way once the worker has gone, so a crash can't leave a seam "rendering" forever."""
        state = self._last_known(key)
        if state["status"] in {"queued", "rendering"} and self._worker_has_gone():
            return {"status": "none", "key": key}
        return state

    def _last_known(self, key: str) -> dict:
        meta = self.folder(key) / "seam.json"
        if meta.exists():
            try:
                return json.loads(meta.read_text("utf-8"))
            except (OSError, ValueError):
                pass  # mid-write: what we last knew will do for this moment
        with self._lock:
            state = self._states.get(key)
        return state if state is not None else {"status": "none", "key": key}

    def _worker_has_gone(self) -> bool:
        return self._worker is not None and self._worker.poll() is not None

    def submit(self, request: SeamRequest, urgent: bool = False) -> dict:
        """Ask the worker for a seam. Anything done or under way stays as it is. Urgent is for
        what a person just tapped or is about to hear: it goes ahead of everything, even a seam
        already waiting."""
        key = request.key
        current = self.status(key)
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
        self._worker.stdin.write(json.dumps({"request": asdict(request), "urgent": urgent}) + "\n")
        self._worker.stdin.flush()
        return state

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

    def ask(self, request: SeamRequest, urgent: bool = False) -> None:
        with self._lock:
            self._urgent = deque(item for item in self._urgent if item.key != request.key)
            self._later = deque(item for item in self._later if item.key != request.key)
            if urgent:
                self._urgent.appendleft(request)
            else:
                self._later.append(request)
        self._arrived.set()

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

    def _next_job(self) -> SeamRequest:
        """What's about to be heard, then the rest of the mix in order, then anything else a person
        asked for. Only spare time goes on preparing word links."""
        while True:
            self._arrived.clear()
            with self._lock:
                if self._urgent:
                    self._running_rank = URGENT
                    return self._urgent.popleft()
            request = self.next_mix_seam()
            if request is not None:
                self._running_rank = MIX
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
            self._arrived.wait(IDLE_CHECK_SECONDS)

    def _give_way(self) -> bool:
        """Is something more important waiting than what's running now?"""
        rank = self._running_rank
        if rank <= URGENT:
            return False
        if self._urgent:
            return True
        if rank <= MIX:
            return False
        now = time.monotonic()
        if now - self._mix_checked_at > MIX_CHECK_SECONDS:
            self._mix_checked_at = now
            self._mix_waiting = self.next_mix_seam() is not None
        if self._mix_waiting:
            return True
        return rank > LATER and bool(self._later)

    def _mark_rendering(self, request: SeamRequest) -> None:
        folder = self.folder(request.key)
        folder.mkdir(parents=True, exist_ok=True)
        state = {"status": "rendering", "key": request.key, "request": asdict(request)}
        (folder / "seam.json").write_text(json.dumps(state), "utf-8")

    def run_forever(self) -> None:
        conn = db.connect(self.settings.db_path)
        jobs.give_way_when(self._give_way)
        while True:
            request = self._next_job()
            jobs.set_render_priority(self._running_rank != PREPARING)
            self._mark_rendering(request)
            try:
                self.render_now(conn, request)
            except jobs.Interrupted:
                # it was only spare-time work or further down the line, so it's simply not done yet
                (self.folder(request.key) / "seam.json").unlink(missing_ok=True)
                continue
            except CannotTrust:
                self._save_failure(request, UNSURE_WORDS)
            except CannotRender as problem:
                self._save_failure(request, str(problem))
            except Exception as problem:  # noqa: BLE001 - a failed seam must not end the worker
                self._save_failure(request, f"Something went wrong: {problem}")
            prune_cache(self.settings, {request.key} | self.keep_for_now())

    def _save_failure(self, request: SeamRequest, error: str) -> dict:
        """Remember what didn't work, so spare time isn't spent trying it again."""
        result = {
            "status": "failed",
            "key": request.key,
            "request": asdict(request),
            "error": error,
        }
        folder = self.folder(request.key)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "seam.json").write_text(json.dumps(result, indent=1), "utf-8")
        return result

    def render_now(self, conn: sqlite3.Connection, request: SeamRequest) -> dict:
        a = load_song(conn, self.settings, request.a)
        b = load_song(conn, self.settings, request.b)
        fell_back = False
        rendered: Rendered | None = None
        if request.move != "auto":
            try:
                rendered, report, why = self._chosen_move(request, a, b)
            except (CannotRender, CannotTrust):
                if not request.soft:
                    raise
            if request.soft and rendered is not None and not report.passed:
                rendered = None
        if rendered is None:
            rendered, report, why, fell_back = self._best_move(a, b)
        return self._save(request, rendered, report, why, fell_back)

    def _chosen_move(self, request: SeamRequest, a: SongInfo, b: SongInfo):
        if request.move in STEM_MOVES:
            if self._aligner is None:
                self._aligner = Aligner(str(self.settings.models_dir))
            return _stem_render(self.settings, self._aligner, request, a, b, self._cache)
        if request.move in MOVES:
            return _bar_cue_render(request, a, b, self._cache)
        raise CannotRender(f"There's no move called {request.move}.")

    def _best_move(self, a: SongInfo, b: SongInfo):
        """The best move that passes. The vocal ride is the listener's favourite, so it's tried
        first wherever two songs can carry it."""
        if "word_blend" in modes_for(a, b) and ride_lines(a, b) is not None:
            try:
                rendered, report, why = self._chosen_move(
                    SeamRequest(a.id, b.id, "vocal_ride"), a, b
                )
                if report.passed:
                    return rendered, report, why, False
            except (CannotRender, CannotTrust):
                pass
        choice = choose_transition(a, b, cache=self._cache)
        why = "; ".join(choice.candidate.reasons)
        return choice.rendered, choice.report, why, choice.fell_back

    def _save(
        self,
        request: SeamRequest,
        rendered: Rendered,
        report: AuditReport,
        why: str,
        fell_back: bool,
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
            "a_source_start": float(script.a_source_start),
            "b_source_end": float(script.b_source_end),
            "duration": float(script.duration),
            "switch_at": _switch_at(rendered),
            "preview_seam": float(clip_at + script.overlap[0]),
            "bars": int(script.meta.get("bars", 0) or 0),
            "passed": report.passed,
            "checks": _plain_checks(report),
        }
        (folder / "seam.json").write_text(json.dumps(result, indent=1), "utf-8")
        return result

    def rate(self, key: str, rating: str, note: str = "") -> dict:
        status = self.status(key)
        if status["status"] != "ready":
            raise CannotRender("That seam hasn't finished rendering.")
        status["rating"] = rating
        status["note"] = note
        (self.folder(key) / "seam.json").write_text(json.dumps(status, indent=1), "utf-8")
        return status


def request_from(a: int, b: int, seam: dict | None) -> SeamRequest:
    seam = seam or {}
    return SeamRequest(
        a=a,
        b=b,
        move=seam.get("move") or "auto",
        bars=seam.get("bars"),
        exit_bar=seam.get("exit_bar"),
        entry_bar=seam.get("entry_bar"),
        phrase=seam.get("phrase"),
        soft=bool(seam.get("soft", False)),
    )


def failed_checks(checks: Iterable[Check]) -> list[str]:
    return [check.name for check in checks if not check.passed]


def line_from(data: list) -> Line:
    return Line(float(data[0]), float(data[1]), str(data[2]))
