"""Turn word links found in lyrics into rendered hand-offs a person can judge.

This is the deep end of the funnel: every step costs more than the last, so each only runs on what
got through the one before. Lyrics find the links in seconds. Musical fit needs analysed songs.
Stems and word timing run only on links that still look good.

A link has to fit musically before the words count for anything. The listener's verdict on the
first word reel was that it felt like "we are just using the words because it happens to match".
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
from selecta.planner_core.fit import TimbreSpace

# which hand-offs two songs can carry is decided in the planner core, from song facts alone, and
# stays importable from here
from selecta.planner_core.wordreel import (
    BLEND_MAX_GAP,
    BLEND_MAX_KEY_DISTANCE,
    BLEND_MIN_GRID,
    CUT_MAX_GAP,
    DEFAULT_QUOTAS,
    LINE_SEARCH_AFTER,
    MAX_TIMBRE,
    MIN_RIDE_SINGING,
    MODE_PAYOFF,
    RIDE_BARS,
    RIDE_LENGTHS,
    ROLL_MIN_TEMPO_RATIO,
    WINDOW_LEAD,
    WINDOW_TAIL,
    line_window,
    modes_for,
    music_fit,
    rank_links,
    ride_entry_line,
    ride_exit_line,
    ride_lengths,
    ride_lines,
    roll_suits,
)
from selecta.render.engine import Rendered, SongCache, render
from selecta.stems import band_of, separate_window
from selecta.styles.wordplay import (
    Stem,
    phrase_roll,
    word_blend,
    word_cut,
    word_exchange,
)

__all__ = [
    "BLEND_MAX_GAP",
    "BLEND_MAX_KEY_DISTANCE",
    "BLEND_MIN_GRID",
    "CUT_MAX_GAP",
    "DEFAULT_QUOTAS",
    "MAX_TIMBRE",
    "MIN_RIDE_SINGING",
    "MODE_PAYOFF",
    "RIDE_BARS",
    "RIDE_LENGTHS",
    "ROLL_MIN_TEMPO_RATIO",
    "WINDOW_LEAD",
    "WINDOW_TAIL",
    "CannotTrust",
    "Phrase",
    "WordTake",
    "analyse_links",
    "build_takes",
    "line_window",
    "locate_line_edge",
    "locate_phrase",
    "locate_voice_edge",
    "modes_for",
    "music_fit",
    "rank_links",
    "ride_entry_line",
    "ride_exit_line",
    "ride_lengths",
    "ride_lines",
    "roll_suits",
    "voice_edge",
]

LINE_SEARCH_BEFORE = 0.6
SECOND_LOOK_SECONDS = 0.4
MAX_WANDER_SECONDS = 0.08
"""Align twice over different windows. A phrase that moves more than this was never pinned down."""
MIN_AGREEMENT = 0.55
"""How well the fit matches an unguided reading, by word starts or letters, whichever is higher."""
CHECK_MARGIN = 3.0
MIN_VOICE_DB = -38.0
EDGE_FRAME_SECONDS = 0.02
VOICE_REST_DB = 24.0
"""This far below a line's loud parts, the voice counts as having stopped."""
MIN_REST_SECONDS = 0.12
EDGE_WORD_SECONDS = 0.3
MAX_WORD_SECONDS = 3.5


class CannotTrust(ValueError):
    """The word timing for this line isn't reliable enough to cut on."""

    song_id: int | None = None


@dataclass(frozen=True)
class Phrase:
    words: list[Word]
    agreement: float
    voice: Stem
    band: Stem


@dataclass
class WordTake:
    style: str
    link: LyricLink
    rendered: Rendered
    report: AuditReport


def _fit_line(
    settings: Settings, aligner: Aligner, song: SongInfo, line: Line
) -> tuple[list[Word], list[Word], float, np.ndarray, float, float, Stem, Stem]:
    """Fit a line's words to the separated voice, or raise if the fit can't be trusted."""
    origin, length, next_start = line_window(song, line)
    stems = separate_window(settings, Path(song.path), origin, length)
    vocal = sf.read(stems.vocals, dtype="float32")[0]

    def clip(lo: float, hi: float) -> np.ndarray:
        return vocal[max(int((lo - origin) * SAMPLE_RATE), 0) : int((hi - origin) * SAMPLE_RATE)]

    lo = max(line.start - LINE_SEARCH_BEFORE, origin)
    hi = min(next_start + 0.3, line.end + LINE_SEARCH_AFTER)
    words = aligner.align(clip(lo, hi), SAMPLE_RATE, line.text, lo)
    lo_wide = max(lo - SECOND_LOOK_SECONDS, origin)
    second = aligner.align(clip(lo_wide, hi + SECOND_LOOK_SECONDS), SAMPLE_RATE, line.text, lo_wide)
    if not words or len(second) != len(words):
        problem = CannotTrust("couldn't fit the line")
        problem.song_id = song.id
        raise problem
    lo_check = max(lo - CHECK_MARGIN, origin)
    score = aligner.check(clip(lo_check, hi + CHECK_MARGIN), SAMPLE_RATE, words, lo_check)
    if score < MIN_AGREEMENT:
        problem = CannotTrust(f"only {score:.0%} agreement with an unguided reading")
        problem.song_id = song.id
        raise problem
    return (
        words,
        second,
        score,
        vocal,
        origin,
        next_start,
        Stem(str(stems.vocals), origin, "vocals", length),
        Stem(str(band_of(stems)), origin, "band", length),
    )


def _steady(words: list[Word], second: list[Word], indices: range) -> None:
    """The words a cut depends on must stay put across two looks. Others in the line may wander."""
    wander = max(abs(words[i].start - second[i].start) for i in indices)
    if wander > MAX_WANDER_SECONDS:
        raise CannotTrust(f"timing moved {wander * 1000:.0f} ms between two looks")


def _settled(
    words: list[Word], indices: range, vocal: np.ndarray, origin: float, next_start: float
) -> list[Word]:
    settled = []
    for i in indices:
        latest = words[i + 1].start if i + 1 < len(words) else next_start - 0.03
        settled.append(settle_edges(words[i], vocal, SAMPLE_RATE, origin, latest))
    if any(word.end - word.start > MAX_WORD_SECONDS for word in settled):
        raise CannotTrust("a word ran implausibly long")
    first = int((settled[0].start - origin) * SAMPLE_RATE)
    voice = vocal[max(first, 0) : int((settled[-1].end - origin) * SAMPLE_RATE)]
    level = 20 * np.log10(max(float(np.sqrt(np.mean(voice**2))), 1e-7)) if voice.size else -120.0
    if level < MIN_VOICE_DB:
        raise CannotTrust("no clear voice at those times")
    return settled


def locate_phrase(
    settings: Settings,
    aligner: Aligner,
    song: SongInfo,
    line: Line,
    phrase: str,
    at_end: bool,
) -> Phrase:
    """Find the shared words in the separated voice, or raise if they can't be trusted."""
    fit = _fit_line(settings, aligner, song, line)
    words, second, score, vocal, origin, next_start, voice, band = fit
    size = len(phrase.split())
    if len(words) < size:
        raise CannotTrust("couldn't fit the line")
    span = range(len(words) - size, len(words)) if at_end else range(size)
    if tuple(words[i].text for i in span) != normalise(phrase):
        raise CannotTrust("line text doesn't match the phrase")
    _steady(words, second, span)
    return Phrase(_settled(words, span, vocal, origin, next_start), score, voice, band)


def voice_edge(
    vocal: np.ndarray, origin: float, line: Line, next_start: float, at_end: bool
) -> float | None:
    """Where the singing itself stops or starts near a line, read from the separated voice.

    A ride only needs to know when a voice stops and another begins, not which word is which. So
    this works in any language, where fitting words to the voice only works in English. None means
    there's no clear voice here at all.
    """
    mono = vocal.mean(axis=1) if vocal.ndim > 1 else vocal
    hop = int(EDGE_FRAME_SECONDS * SAMPLE_RATE)
    lo = max(line.start - 1.0, origin)
    hi = min(max(line.end, next_start) + 1.0, origin + mono.size / SAMPLE_RATE)
    part = mono[int((lo - origin) * SAMPLE_RATE) : int((hi - origin) * SAMPLE_RATE)]
    if part.size < hop * 10:
        return None
    level = np.sqrt(np.mean(part[: part.size // hop * hop].reshape(-1, hop) ** 2, axis=1))
    loud = float(np.percentile(level, 90))
    if 20.0 * np.log10(max(loud, 1e-7)) < MIN_VOICE_DB:
        return None
    voiced = level > loud * 10.0 ** (-VOICE_REST_DB / 20.0)
    times = lo + (np.arange(level.size) + 0.5) * EDGE_FRAME_SECONDS
    rest = int(MIN_REST_SECONDS / EDGE_FRAME_SECONDS)
    if at_end:
        target = line.end
        reach = (line.start + 0.3 * (line.end - line.start), line.end + 0.8)
        edges = [
            i for i in range(level.size - 1) if voiced[i] and not voiced[i + 1 : i + 1 + rest].any()
        ]
    else:
        target = line.start
        reach = (line.start - 1.0, line.start + 1.0)
        edges = [
            i for i in range(1, level.size) if voiced[i] and not voiced[max(0, i - rest) : i].any()
        ]
    inside = [i for i in edges if reach[0] <= times[i] <= reach[1]]
    if inside:
        return float(times[min(inside, key=lambda i: abs(times[i] - target))])
    # no clean rest, as in rap with no gap between lines: take the quietest moment nearby
    close = np.flatnonzero(np.abs(times - target) <= 0.4)
    if close.size == 0:
        return None
    return float(times[close[int(np.argmin(level[close]))]])


def locate_voice_edge(settings: Settings, song: SongInfo, line: Line, at_end: bool) -> Phrase:
    """Find where a voice stops or starts, for a ride. Uses the same stems as finding its words."""
    origin, length, next_start = line_window(song, line)
    stems = separate_window(settings, Path(song.path), origin, length)
    vocal = sf.read(stems.vocals, dtype="float32")[0]
    edge = voice_edge(vocal, origin, line, next_start, at_end)
    if edge is None:
        problem = CannotTrust("no clear voice near that line")
        problem.song_id = song.id
        raise problem
    text = (line.words[-1] if at_end else line.words[0]) if line.words else ""
    word = (
        Word(text, max(edge - EDGE_WORD_SECONDS, line.start), edge, 1.0)
        if at_end
        else Word(text, edge, edge + EDGE_WORD_SECONDS, 1.0)
    )
    voice = Stem(str(stems.vocals), origin, "vocals", length)
    return Phrase([word], 1.0, voice, Stem(str(band_of(stems)), origin, "band", length))


def locate_line_edge(
    settings: Settings, aligner: Aligner, song: SongInfo, line: Line, at_end: bool
) -> Phrase:
    """Find the first or last word of a line, for a hand-off with no shared words."""
    fit = _fit_line(settings, aligner, song, line)
    words, second, score, vocal, origin, next_start, voice, band = fit
    span = range(len(words) - 1, len(words)) if at_end else range(1)
    _steady(words, second, span)
    return Phrase(_settled(words, span, vocal, origin, next_start), score, voice, band)


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


def _script(style: str, a: SongInfo, b: SongInfo, phrase_a: Phrase, phrase_b: Phrase):
    if style == "word_blend":
        for bars in ride_lengths(a, phrase_a.words[-1].end):
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
                return script
        return None
    if style == "phrase_roll":
        return phrase_roll(
            a, b, phrase_a.words, phrase_b.words, phrase_a.voice, phrase_a.band, phrase_b.band
        )
    if style == "word_exchange":
        for bars in ride_lengths(a, phrase_a.words[-1].end):
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
                return script
        return None
    return word_cut(a, b, phrase_a.words, phrase_b.words, phrase_b.band)


def build_takes(
    conn: sqlite3.Connection,
    settings: Settings,
    links: list[LyricLink],
    quotas: dict[str, int],
    space: TimbreSpace | None = None,
    cache: SongCache | None = None,
    log: Callable[[str], None] = print,
    on_take: Callable[[WordTake], None] | None = None,
) -> list[WordTake]:
    """Render links in order, each as the best hand-off it supports that's still wanted, until
    every quota is met. No song or meaningful word is used twice."""
    cache = cache or SongCache(capacity=4)
    aligner = Aligner(str(settings.models_dir))
    remaining = dict(quotas)
    takes: list[WordTake] = []
    used_words: set[str] = set()
    used_songs: set[int] = set()
    for link in links:
        if not any(remaining.values()):
            break
        words = link.phrase.split()
        if any(word in used_words for word in words if len(word) > 3):
            continue
        if {link.song_a, link.song_b} & used_songs:
            continue
        try:
            a = load_song(conn, settings, link.song_a)
            b = load_song(conn, settings, link.song_b)
        except KeyError:
            continue
        wanted = [mode for mode in modes_for(a, b, space) if remaining.get(mode, 0) > 0]
        if not wanted:
            continue
        label = f"'{link.phrase}' {a.name[:32]} > {b.name[:32]}"
        try:
            phrase_a = locate_phrase(settings, aligner, a, link.line_a, link.phrase, at_end=True)
            phrase_b = locate_phrase(settings, aligner, b, link.line_b, link.phrase, at_end=False)
        except CannotTrust as problem:
            log(f"  skip {label}: {problem}")
            continue
        for style in wanted:
            script = _script(style, a, b, phrase_a, phrase_b)
            if script is None:
                log(f"  no {style} for {label}: the timing doesn't work out")
                continue
            rendered = render(script, cache)
            report = audit(rendered)
            if not report.passed:
                failed = [f"{c.name} {c.value}{c.unit}" for c in report.failures]
                log(f"  reject {style} {label}: {failed}")
                continue
            takes.append(WordTake(style, link, rendered, report))
            if on_take:
                on_take(takes[-1])
            remaining[style] -= 1
            used_words.update(words)
            used_songs.update((link.song_a, link.song_b))
            log(f"  keep {style} {label}")
            break
    return takes
