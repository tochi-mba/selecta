"""Turn word links found in lyrics into rendered cuts a person can judge.

This is the deep end of the funnel: every step costs more than the last, so each only runs on what
got through the one before. Lyrics find the links in seconds. Songs get analysed only if a link
needs them. Stems and word timing run only on the links that still look good.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from selecta.analysis.song import SongInfo, load_song
from selecta.audit.checks import AuditReport, audit
from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE, Settings
from selecta.lyrics.align import Aligner, Word, settle_edges
from selecta.lyrics.lrclib import Line
from selecta.lyrics.match import LyricLink, normalise
from selecta.planner.fit import TimbreSpace, folded_gap
from selecta.render.engine import Rendered, SongCache, render
from selecta.stems import separate_window
from selecta.styles.wordplay import VocalWindow, word_cut, word_echo, word_roll

STEM_LEAD = 5.0
STEM_TAIL = 6.0
LINE_SEARCH_BEFORE = 0.6
LINE_SEARCH_AFTER = 3.5
SECOND_LOOK_SECONDS = 0.4
MAX_WANDER_SECONDS = 0.08
"""Align twice over different windows. A phrase that moves more than this was never pinned down."""
MIN_AGREEMENT = 0.6
"""Share of the line's fitted words that start where an unguided reading also hears a word."""
MIN_VOICE_DB = -38.0
MAX_WORD_SECONDS = 3.5

MAX_LINK_TIMBRE = 1.6
MAX_LINK_TEMPO_GAP = 0.30
"""A shared phrase is a musical reason of its own, so a link can cross more than a plain cut."""

MODES = ("word_cut", "word_echo", "word_roll")


@dataclass(frozen=True)
class Phrase:
    words: list[Word]
    score: float
    wander: float
    window: VocalWindow
    free_before: float


@dataclass
class WordTake:
    style: str
    link: LyricLink
    rendered: Rendered
    report: AuditReport
    phrase_a: Phrase
    phrase_b: Phrase


def _neighbours(song: SongInfo, line: Line) -> tuple[Line | None, Line | None]:
    earlier = [other for other in song.lines if other.start < line.start]
    later = [other for other in song.lines if other.start > line.start]
    return (earlier[-1] if earlier else None), (later[0] if later else None)


def locate_phrase(
    settings: Settings,
    aligner: Aligner,
    song: SongInfo,
    line: Line,
    phrase: str,
    at_end: bool,
) -> Phrase | None:
    """Find the shared words in the separated voice, or None if they can't be trusted."""
    before, after = _neighbours(song, line)
    origin = max(0.0, line.start - STEM_LEAD)
    next_start = after.start if after else line.end + LINE_SEARCH_AFTER
    length = max(line.end, next_start) + STEM_TAIL - origin
    stems = separate_window(settings, Path(song.path), origin, length)
    vocal = sf.read(stems.vocals, dtype="float32")[0]

    def aligned(lo: float, hi: float) -> list[Word]:
        first, last = int((lo - origin) * SAMPLE_RATE), int((hi - origin) * SAMPLE_RATE)
        return aligner.align(vocal[max(first, 0) : last], SAMPLE_RATE, line.text, max(lo, origin))

    lo = line.start - LINE_SEARCH_BEFORE
    hi = min(next_start + 0.3, line.end + LINE_SEARCH_AFTER)
    words = aligned(lo, hi)
    second = aligned(lo - SECOND_LOOK_SECONDS, hi + SECOND_LOOK_SECONDS)
    size = len(phrase.split())
    if len(words) < size or len(second) != len(words):
        return None
    span = range(len(words) - size, len(words)) if at_end else range(size)
    if tuple(words[i].text for i in span) != normalise(phrase):
        return None

    wander = max(abs(words[i].start - second[i].start) for i in span)
    score = aligner.check(
        vocal[max(int((lo - origin) * SAMPLE_RATE), 0) : int((hi - origin) * SAMPLE_RATE)],
        SAMPLE_RATE,
        words,
        max(lo, origin),
    )
    if wander > MAX_WANDER_SECONDS or score < MIN_AGREEMENT:
        return None

    settled = []
    for i in span:
        latest = words[i + 1].start if i + 1 < len(words) else next_start - 0.03
        settled.append(settle_edges(words[i], vocal, SAMPLE_RATE, origin, latest))
    if any(word.end - word.start > MAX_WORD_SECONDS for word in settled):
        return None
    lo_sample = int((settled[0].start - origin) * SAMPLE_RATE)
    hi_sample = int((settled[-1].end - origin) * SAMPLE_RATE)
    voice = vocal[lo_sample:hi_sample]
    if (
        voice.size == 0
        or 20 * np.log10(max(float(np.sqrt(np.mean(voice**2))), 1e-7)) < MIN_VOICE_DB
    ):
        return None

    free_before = line.start - before.end if before else line.start
    free_before += max(settled[0].start - line.start, 0.0)
    return Phrase(settled, score, wander, VocalWindow(str(stems.vocals), origin), free_before)


def default_modes(number: int) -> tuple[str, ...]:
    """The first two links show every mode, so modes can be compared on the same words."""
    return MODES if number < 2 else (MODES[number % len(MODES)],)


def analyse_links(
    conn: sqlite3.Connection,
    settings: Settings,
    links: list[LyricLink],
    log: Callable[[str], None] = print,
) -> int:
    """Analyse only the songs these links need, which beats waiting for the whole library."""
    finished = {
        row[0]
        for row in conn.execute(
            "SELECT song_id FROM analysis WHERE error IS NULL AND version = ?",
            (ANALYSIS_VERSION,),
        )
    }
    needed = sorted({song for link in links for song in (link.song_a, link.song_b)} - finished)
    if not needed:
        return 0
    from selecta.analysis.pipeline import Analysers, analyse_song

    log(f"Analysing {len(needed)} songs these links need.")
    analysers = Analysers.load(settings)
    for song_id in needed:
        song = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
        analyse_song(conn, settings, song, analysers)
    return len(needed)


def link_is_workable(a: SongInfo, b: SongInfo, space: TimbreSpace | None) -> tuple[bool, str]:
    gap = folded_gap(a, b)
    if gap > MAX_LINK_TEMPO_GAP:
        return False, f"tempo gap {gap:.0%}"
    if space is not None:
        distance = space.distance(a, b)
        if distance is not None and distance > MAX_LINK_TIMBRE:
            return False, f"sound too far apart ({distance:.2f})"
    return True, ""


def _script(style: str, a: SongInfo, b: SongInfo, phrase_a: Phrase, phrase_b: Phrase):
    if style == "word_cut":
        return word_cut(a, b, phrase_a.words, phrase_b.words)
    make = word_echo if style == "word_echo" else word_roll
    return make(a, b, phrase_a.words, phrase_b.words, phrase_a.window, phrase_b.free_before)


def build_takes(
    conn: sqlite3.Connection,
    settings: Settings,
    links: list[LyricLink],
    wanted: int,
    modes_for: Callable[[int], tuple[str, ...]],
    space: TimbreSpace | None = None,
    cache: SongCache | None = None,
    log: Callable[[str], None] = print,
) -> list[WordTake]:
    """Render links in order until `wanted` have at least one take that passes its audit."""
    cache = cache or SongCache(capacity=4)
    aligner = Aligner(str(settings.models_dir))
    takes: list[WordTake] = []
    linked = 0
    for link in links:
        if linked >= wanted:
            break
        try:
            a = load_song(conn, settings, link.song_a)
            b = load_song(conn, settings, link.song_b)
        except KeyError:
            log(f"  not analysed yet: [{link.phrase}]")
            continue
        label = f"[{link.phrase}] {a.name[:32]} > {b.name[:32]}"
        workable, reason = link_is_workable(a, b, space)
        if not workable:
            log(f"  skip {label}: {reason}")
            continue
        phrase_a = locate_phrase(settings, aligner, a, link.line_a, link.phrase, at_end=True)
        phrase_b = locate_phrase(settings, aligner, b, link.line_b, link.phrase, at_end=False)
        if phrase_a is None or phrase_b is None:
            side = "A" if phrase_a is None else "B"
            log(f"  skip {label}: word timing not trustworthy in {side}")
            continue
        kept = 0
        for style in modes_for(linked):
            script = _script(style, a, b, phrase_a, phrase_b)
            if script is None:
                log(f"  no {style} for {label}")
                continue
            rendered = render(script, cache)
            report = audit(rendered)
            if not report.passed:
                failed = [f"{c.name} {c.value}{c.unit}" for c in report.failures]
                log(f"  reject {style} {label}: {failed}")
                continue
            takes.append(WordTake(style, link, rendered, report, phrase_a, phrase_b))
            kept += 1
            log(f"  keep {style} {label}")
        if kept:
            linked += 1
    return takes
