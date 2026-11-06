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
import tempfile
import threading
import time
from collections import Counter, deque
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import soundfile as sf

from selecta import db, jobs
from selecta.analysis.song import Cue, SongInfo, load_song
from selecta.arrange import (
    TAKES,
    WontWork,
    arc_of,
    arrangements,
    as_array,
    can_arrange,
    listen,
    repair,
    taste_from,
    why_it_cant,
)
from selecta.audit.checks import AuditReport, Check, audit, beat_offset
from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE, Settings
from selecta.eta import JobClock, combine
from selecta.lyrics.align import Aligner
from selecta.lyrics.lrclib import Line
from selecta.lyrics.match import LyricLink, SongFacts, discover
from selecta.planner.choose import choose_transition, enumerate_candidates, tempo_gap
from selecta.planner.fit import MAX_FOLDED_GAP, folded_gap
from selecta.planner.memory import RULES_VERSION, SeamMemory
from selecta.planner.wordreel import (
    CannotTrust,
    line_window,
    locate_phrase,
    locate_voice_edge,
    modes_for,
    ride_lengths,
    ride_lines,
)
from selecta.render.engine import Rendered, SongCache, in_context, render
from selecta.render.intertwine import can_intertwine, intertwine_windows, render_intertwined
from selecta.render.script import Part, TransitionScript, Warp
from selecta.stems import prune_cache, seconds_separating, window_is_ready
from selecta.studio import (
    LANES,
    SIDES,
    clean_shape,
    find_placement,
    prepare_session,
    render_shape,
    why_no_studio,
    windows_to_separate,
)
from selecta.styles import all_recipes
from selecta.styles.wordplay import phrase_roll, vocal_ride, word_blend, word_cut, word_exchange

RENDER_VERSION = 2
PREVIEW_SECONDS = 12.0
IDLE_CHECK_SECONDS = 3.0
MEMORY_SECONDS = 5.0
RIDES_BEFORE_OTHERS = 0.35
NEAR_MISS = {"beat alignment": 20.0, "level fall": 3.0, "entry level": 1.5}
"""How far past its limit each forgiving check can go, in its own units."""
MIX_CHECK_SECONDS = 2.0
# who goes first: what's about to be heard, a song someone asked for once whatever plays before it
# is done, the rest of the mix, mixes in the render line, other requests, then spare time
URGENT, REQUEST, MIX, LINE, LATER, PREPARING = range(6)
UNSURE_WORDS = "Selecta can’t tell exactly when these words are sung, so it won’t cut on them."
PLACEMENTS_TO_TRY = 4

MOVES: dict[str, tuple[str, str]] = {
    "auto": ("Let Selecta pick", "The best move for these two songs that passes its checks."),
    "bass_swap_blend": ("Blend", "Both songs play in time, and they trade the bass halfway."),
    "vocal_ride": ("Vocal ride", "B's band comes in under A's voice, before B starts singing."),
    "stem_studio": ("Your stems", "You chose which stems play when, in the studio."),
    "stem_arrange": (
        "Strip and land",
        "A strips down to its melody, B is teased, then B's bass and drums land.",
    ),
    "stem_intertwine": (
        "Intertwined stems",
        "Trade drums, bass and harmonic layers over sixteen bars, with vocals taking turns.",
    ),
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
STEM_MOVES = WORD_MOVES | {"vocal_ride", "stem_intertwine", "stem_studio", "stem_arrange"}
STUDIO_SESSION = "studio_session"
NOT_IN_THE_CHOOSER = {"stem_studio"}
SESSION_MOVES = {"stem_studio", "stem_arrange", STUDIO_SESSION}


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
    shape: str | None = None
    """For the Seam Studio: which stems play when, as a person chose them."""
    leave_after: float | None = None
    """The seam into A lands this late, so this one can't start any sooner. Seconds into A."""

    @property
    def key(self) -> str:
        fields = asdict(self)
        # seams from before these existed keep their keys, and their audio
        for name in ("shape", "leave_after"):
            if fields[name] is None:
                del fields[name]
        text = json.dumps([fields, ANALYSIS_VERSION, RENDER_VERSION], sort_keys=True)
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
    if move == "stem_arrange":
        return why_it_cant(a, b)
    if move == "stem_intertwine":
        return (
            None
            if can_intertwine(a, b)
            else (
                "This needs a close tempo and key, reliable beat grids, and sixteen bars of room."
            )
        )
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
        if name in NOT_IN_THE_CHOOSER:
            continue
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
    studio_reason = why_no_studio(a, b)
    return {
        "moves": moves,
        "studio": {"available": studio_reason is None, "reason": studio_reason},
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


def _closer(report: AuditReport, than: AuditReport) -> bool:
    """Is this take nearer to clean than that one?"""
    miss = lambda r: (len(r.failures), sum(c.value - c.limit for c in r.failures))  # noqa: E731
    return miss(report) < miss(than)


def tighten_beats(rendered: Rendered, cache: SongCache) -> tuple[Rendered, AuditReport]:
    """The render measures exactly how far apart the beats landed, so a steady gap can be closed
    with a second take rather than warned about. A live DJ only gets the one."""
    report = audit(rendered)
    if not any(check.name == "beat alignment" for check in report.failures):
        return rendered, report
    offset = beat_offset(rendered)
    if offset is None:
        return rendered, report
    script = rendered.script
    b = script.b.song

    def later(part: Part) -> Part:
        if part.song is not b:
            return part
        return replace(part, warp=Warp(part.warp.output, part.warp.source - offset))

    second = render(
        replace(script, b=later(script.b), extras=[later(part) for part in script.extras]), cache
    )
    second_report = audit(second)
    return (second, second_report) if _closer(second_report, report) else (rendered, report)


def _exits_after(a: SongInfo, leave_after: float | None) -> list | None:
    """Every place A could finish once it has played for long enough, or None for no limit."""
    if leave_after is None:
        return None
    found = [cue for cue in a.exit_cues() if a.bar_time(cue.bar) >= leave_after]
    return found or a._exit_cues_after(leave_after, True)


def _too_soon(script: TransitionScript, request: SeamRequest) -> bool:
    return request.leave_after is not None and script.a_source_start < request.leave_after


def _bar_cue_render(
    request: SeamRequest,
    a: SongInfo,
    b: SongInfo,
    cache: SongCache,
    worked_before: tuple[int, int, int] | None = None,
) -> tuple[Rendered, AuditReport, str]:
    recipe = all_recipes()[request.move]
    pool = enumerate_candidates(a, b, request.move, exits=_exits_after(a, request.leave_after))
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
        if worked_before is not None:
            # where this move landed well last time is the first place to try it this time
            pool = sorted(
                pool,
                key=lambda c: (c.exit_cue.bar, c.entry_cue.bar, c.bars) != worked_before,
            )
        # with a limit, plenty of these won't get as far as being tried, so they don't count
        tries = [
            (item.exit_cue, item.entry_cue, item.bars, "; ".join(item.reasons))
            for item in (pool if request.leave_after is not None else pool[:PLACEMENTS_TO_TRY])
        ]
    best = None
    placed = 0
    for exit_cue, entry_cue, bars, why in tries:
        script = recipe.make(a, b, exit_cue, entry_cue, bars)
        if script is None or _too_soon(script, request):
            continue
        if placed == PLACEMENTS_TO_TRY:
            break
        placed += 1
        script.meta.update(exit_bar=exit_cue.bar, entry_bar=entry_cue.bar, placed_bars=bars)
        rendered, report = tighten_beats(render(script, cache), cache)
        if report.passed:
            return rendered, report, why
        if best is None or _closer(report, best[1]):
            best = (rendered, report, why)
    if best is None:
        raise CannotRender("Those cue points don't leave enough room for this move.")
    return best


def windows_for(request: SeamRequest, a: SongInfo, b: SongInfo) -> list[tuple[str, float, float]]:
    """The stretches of song this seam will split, worked out before it starts. A word move takes
    under a minute with its stems ready and over five without, so this is most of what makes a
    time estimate right or wrong. A seam left to choose would try a ride first."""
    if request.move in {"vocal_ride", "auto"}:
        lines = ride_lines(a, b)
        pairs = [(a, lines[0]), (b, lines[1])] if lines else []
    elif request.move in WORD_MOVES:
        links = links_between(a, b)
        if request.phrase:
            links = [link for link in links if link.phrase == request.phrase] or links
        pairs = [(a, links[0].line_a), (b, links[0].line_b)] if links else []
    elif request.move == "stem_intertwine":
        windows = intertwine_windows(a, b)
        if windows is None:
            return []
        return [(a.path, *windows[0]), (b.path, *windows[1])]
    else:
        return []
    return [(song.path, *line_window(song, line)[:2]) for song, line in pairs]


def _session_for(
    settings: Settings, request: SeamRequest, a: SongInfo, b: SongInfo
) -> tuple[Path, dict]:
    """The stems for this pair laid out, shared with the studio so neither splits them twice."""
    session_request = SeamRequest(
        a.id, b.id, STUDIO_SESSION, exit_bar=request.exit_bar, entry_bar=request.entry_bar
    )
    folder = settings.renders_dir / "seams" / session_request.key
    try:
        session = json.loads((folder / "session.json").read_text("utf-8"))
    except (OSError, ValueError):
        return folder, _make_session(settings, session_request, a, b)
    # the cache can clear files at any time, so a layout on its own isn't enough
    stems = (folder / f"{side}_{lane}.flac" for side in SIDES for lane in LANES)
    if not all(stem.exists() for stem in stems):
        return folder, _make_session(settings, session_request, a, b)
    return folder, session


def _arranged(
    settings: Settings, request: SeamRequest, a: SongInfo, b: SongInfo, memory: SeamMemory
) -> tuple[Rendered, AuditReport, str]:
    """Listen to both songs' stems, make the best arrangement it can, render it, check it, and go
    again with a specific fix for anything that didn't pass."""
    if request.leave_after is not None and request.exit_bar is None:
        place = find_placement(a, b, leave_after=request.leave_after)
        if place is None:
            raise CannotRender("There's nowhere late enough in the song to do this.")
        request = replace(request, exit_bar=place.exit_cue.bar)
    folder, session = _session_for(settings, request, a, b)
    hearing = listen(folder, float(session["seconds"]))
    try:
        to_try = arrangements(hearing, taste_from(memory), memory.pair_shapes.get((a.id, b.id)))
    except WontWork as problem:
        raise CannotRender(str(problem)) from problem
    why = f"{a.title} strips down to its melody, then {b.title} lands."
    best = None
    tried: list[dict] = []
    while to_try and len(tried) < TAKES:
        shape = to_try.pop(0)
        if shape in tried:
            continue
        tried.append(shape)
        rendered = render_shape(a, b, folder, session, shape, style="stem_arrange")
        rendered.script.meta["arc"] = [round(float(v), 1) for v in arc_of(as_array(shape), hearing)]
        report = audit(rendered)
        if report.passed:
            return rendered, report, why
        if best is None or _closer(report, best[1]):
            best = (rendered, report, why)
        fix = repair(shape, [check.name for check in report.failures], hearing)
        if fix is not None:
            to_try.insert(0, fix)
    return best


def _make_session(settings: Settings, request: SeamRequest, a: SongInfo, b: SongInfo) -> dict:
    """Lay out a pair's stems for the studio, and keep the layout beside them."""
    folder = settings.renders_dir / "seams" / request.key
    try:
        session = prepare_session(settings, a, b, folder, request.exit_bar, request.entry_bar)
    except (ValueError, OSError, RuntimeError) as problem:
        raise CannotRender(str(problem)) from problem
    (folder / "session.json").write_text(json.dumps(session), "utf-8")
    return session


def _stem_render(
    settings: Settings,
    aligner: Aligner | None,
    request: SeamRequest,
    a: SongInfo,
    b: SongInfo,
    cache: SongCache,
) -> tuple[Rendered, AuditReport, str]:
    if request.move == "stem_studio":
        folder, session = _session_for(settings, request, a, b)
        shape = clean_shape(request.shape)
        rendered = render_shape(a, b, folder, session, shape)
        heard = listen(folder, float(session["seconds"]))
        rendered.script.meta["arc"] = [round(float(v), 1) for v in arc_of(as_array(shape), heard)]
        return rendered, audit(rendered), "You chose which stems play when."
    if request.move == "stem_intertwine":
        try:
            transition = render_intertwined(settings, a, b)
        except (ValueError, OSError, RuntimeError) as problem:
            raise CannotRender(str(problem)) from problem
        duration = transition.audio.shape[0] / SAMPLE_RATE
        output_beats = a.beats[
            a.beat_index_of_bar(transition.exit_cue.bar - 8) : a.beat_index_of_bar(
                transition.exit_cue.bar - 8
            )
            + 16 * a.beats_per_bar
            + 1
        ]
        output = output_beats - transition.a_start
        script = TransitionScript(
            style="stem_intertwine",
            duration=duration,
            a=Part(
                a,
                Warp.identity(0.0, transition.a_start, duration),
                gain=transition.a_drums,
            ),
            b=Part(
                b,
                Warp(output, transition.b_points),
                gain=transition.b_drums,
            ),
            overlap=(0.0, duration),
            expects_beats_aligned=True,
            meta={
                "period": a.period,
                "bars": 16,
                "vocal_gains": {"a": transition.a_vocal, "b": transition.b_vocal},
            },
        )
        rendered = Rendered(script, transition.audio, transition.a_dry, transition.b_dry)
        return (
            rendered,
            audit(rendered),
            "Drums and harmonic beds cross; bass swaps once; vocals take turns.",
        )
    if request.move == "vocal_ride":
        lines = ride_lines(a, b, request.leave_after)
        if lines is None:
            raise CannotRender("A isn't singing enough near a place it could finish.")
        edge_a = locate_voice_edge(settings, a, lines[0], at_end=True)
        edge_b = locate_voice_edge(settings, b, lines[1], at_end=False)
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
        if request.leave_after is not None:
            links = [link for link in links if link.line_a.start >= request.leave_after]
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
    rendered, report = tighten_beats(render(script, cache), cache)
    return rendered, report, why


def _switch_at(rendered: Rendered) -> float:
    """When the listener's attention moves to B, in seconds into the clip."""
    return float(rendered.script.overlap[1])


def fallback_order(
    a: int, b: int, can_ride: bool, used: Counter[str], can_strip: bool = False
) -> list[str]:
    """What to try when a planned move can't work, with the rest of the mix in mind. Whatever the
    mix has used least comes first, so a fallback doesn't add to what it already has plenty of.
    Reverb stays last of the effects, because the listener doesn't care for it."""
    total = sum(used.values())
    rides_full = used["vocal_ride"] >= max(1.0, RIDES_BEFORE_OTHERS * total)
    blends = sorted(("filter_sweep", "bass_swap_blend", "tempo_ramp"), key=lambda move: used[move])
    effects = sorted(
        ("delay_throw", "echo_out"),
        key=lambda move: (used[move], hashlib.sha1(f"{a}{b}{move}".encode()).digest()),
    )
    ride = ["vocal_ride"] if can_ride else []
    strip = ["stem_arrange"] if can_strip else []
    middle = [*blends, *ride, *strip] if rides_full else [*ride, *strip, *blends]
    return [*middle, *effects, "reverb_wash"]


def good_enough(report: AuditReport) -> bool:
    """Passed, or only a near miss on checks that have proved stricter than the ear. None of the
    measurements told good seams from bad on the listening reels, and the beat check misreads
    syncopated drums, so a near miss is worth far more than falling back to a cut."""
    for check in report.failures:
        slack = NEAR_MISS.get(check.name)
        if slack is None or check.value > check.limit + slack:
            return False
    return True


def _what_failed(report: AuditReport) -> str:
    names = ", ".join(check.name for check in report.failures)
    return f"It didn't pass: {names}"


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
                meta.unlink(missing_ok=True)
                if meta.name == "seam.json":
                    (meta.parent / "clip.flac").unlink(missing_ok=True)
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
        shape=seam.get("shape"),
        leave_after=seam.get("leave_after"),
    )


def failed_checks(checks: Iterable[Check]) -> list[str]:
    return [check.name for check in checks if not check.passed]


def line_from(data: list) -> Line:
    return Line(float(data[0]), float(data[1]), str(data[2]))
