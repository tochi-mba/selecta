"""Render any transition a person asks for, keep the result, and say how it went.

Every seam is a small request: which songs, which move, and any choices the person made.
The same request always gives the same files, so changing your mind back costs nothing. Rendering
runs on one worker thread, because it's heavy and this machine has four cores. Nothing here runs
while the browser plays: it only ever receives finished audio.
"""

from __future__ import annotations

import hashlib
import json
import queue
import sqlite3
import threading
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from pathlib import Path

import soundfile as sf

from selecta import db
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
    ride_lines,
)
from selecta.render.engine import Rendered, SongCache, in_context, render
from selecta.styles import all_recipes
from selecta.styles.wordplay import phrase_roll, vocal_ride, word_blend, word_cut, word_exchange

RENDER_VERSION = 1
PREVIEW_SECONDS = 12.0
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
        for bars in [request.bars] if request.bars else [8, 4]:
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
            script = word_exchange(
                a,
                b,
                phrase_a.words,
                phrase_b.words,
                phrase_a.voice,
                phrase_a.band,
                phrase_b.voice,
                phrase_b.band,
            )
        elif request.move == "word_cut":
            script = word_cut(a, b, phrase_a.words, phrase_b.words, phrase_b.band)
        else:
            script = None
            for bars in [request.bars] if request.bars else [8, 4]:
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
    """Finished seams on disk, and one worker making more."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.root = settings.renders_dir / "seams"
        self._lock = threading.Lock()
        self._states: dict[str, dict] = {}
        self._queue: queue.Queue[SeamRequest] = queue.Queue()
        self._worker: threading.Thread | None = None
        self._cache = SongCache(capacity=6)
        self._aligner: Aligner | None = None

    def folder(self, key: str) -> Path:
        return self.root / key

    def status(self, key: str) -> dict:
        with self._lock:
            state = self._states.get(key)
        if state is not None:
            return state
        meta = self.folder(key) / "seam.json"
        if meta.exists():
            return json.loads(meta.read_text("utf-8"))
        return {"status": "none", "key": key}

    def submit(self, request: SeamRequest) -> dict:
        key = request.key
        current = self.status(key)
        if current["status"] in {"ready", "queued", "rendering"}:
            return current
        state = {"status": "queued", "key": key, "request": asdict(request)}
        with self._lock:
            self._states[key] = state
        self._queue.put(request)
        self._ensure_worker()
        return state

    def _ensure_worker(self) -> None:
        with self._lock:
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._run, daemon=True, name="seams")
                self._worker.start()

    def _run(self) -> None:
        conn = db.connect(self.settings.db_path)
        while True:
            request = self._queue.get()
            key = request.key
            with self._lock:
                self._states[key] = {**self._states[key], "status": "rendering"}
            try:
                result = self.render_now(conn, request)
            except (CannotRender, CannotTrust) as problem:
                result = {
                    "status": "failed",
                    "key": key,
                    "request": asdict(request),
                    "error": str(problem),
                }
            except Exception as problem:  # noqa: BLE001 - a failed seam must not end the worker
                result = {
                    "status": "failed",
                    "key": key,
                    "request": asdict(request),
                    "error": f"Something went wrong rendering this: {problem}",
                }
            with self._lock:
                self._states[key] = result

    def render_now(self, conn: sqlite3.Connection, request: SeamRequest) -> dict:
        a = load_song(conn, self.settings, request.a)
        b = load_song(conn, self.settings, request.b)
        fell_back = False
        if request.move == "auto":
            choice = choose_transition(a, b, cache=self._cache)
            rendered, report = choice.rendered, choice.report
            why = "; ".join(choice.candidate.reasons)
            fell_back = choice.fell_back
        elif request.move in STEM_MOVES:
            if self._aligner is None:
                self._aligner = Aligner(str(self.settings.models_dir))
            rendered, report, why = _stem_render(
                self.settings, self._aligner, request, a, b, self._cache
            )
        elif request.move in MOVES:
            rendered, report, why = _bar_cue_render(request, a, b, self._cache)
        else:
            raise CannotRender(f"There's no move called {request.move}.")
        return self._save(request, rendered, report, why, fell_back)

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
    )


def failed_checks(checks: Iterable[Check]) -> list[str]:
    return [check.name for check in checks if not check.passed]


def line_from(data: list) -> Line:
    return Line(float(data[0]), float(data[1]), str(data[2]))
