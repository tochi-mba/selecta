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

from selecta.analysis.key import camelot_distance
from selecta.analysis.song import SongInfo, load_song
from selecta.audit.checks import AuditReport, audit
from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE, Settings
from selecta.lyrics.align import Aligner, Word, settle_edges
from selecta.lyrics.lrclib import Line
from selecta.lyrics.match import LyricLink, normalise
from selecta.planner.fit import TimbreSpace, level_step
from selecta.render.engine import Rendered, SongCache, render
from selecta.stems import band_of, separate_window
from selecta.styles.wordplay import (
    Stem,
    felt_bpm,
    phrase_roll,
    vocal_ride,
    word_blend,
    word_cut,
    word_exchange,
)

WINDOW_LEAD = 30.0
"""B's band can start this long before its voice, which is what the stems are for."""
WINDOW_TAIL = 8.0
LINE_SEARCH_BEFORE = 0.6
LINE_SEARCH_AFTER = 3.5
SECOND_LOOK_SECONDS = 0.4
MAX_WANDER_SECONDS = 0.08
"""Align twice over different windows. A phrase that moves more than this was never pinned down."""
MIN_AGREEMENT = 0.55
"""How well the fit matches an unguided reading, by word starts or letters, whichever is higher."""
CHECK_MARGIN = 3.0
MIN_VOICE_DB = -38.0
MAX_WORD_SECONDS = 3.5

BLEND_MAX_GAP = 0.08
BLEND_MAX_KEY_DISTANCE = 2
BLEND_MIN_GRID = 0.55
ROLL_MIN_TEMPO_RATIO = 0.88
"""A roll promises a drop. Reel 2's hype song into a much slower one felt like a broken promise."""
CUT_MAX_GAP = 0.06
"""A bare cut only felt right where the pulse carried across. The best one was 4.5% apart."""
MAX_TIMBRE = 1.6
DEFAULT_QUOTAS = {"word_blend": 3, "word_exchange": 3, "phrase_roll": 3, "word_cut": 1}
MODE_PAYOFF = {"word_blend": 1.0, "word_exchange": 0.95, "phrase_roll": 0.85, "word_cut": 0.6}


RIDE_BARS = 4
RIDE_LENGTHS = (16, 12, 8, 4)
MIN_RIDE_SINGING = 0.35


class CannotTrust(ValueError):
    """The word timing for this line isn't reliable enough to cut on."""


@dataclass(frozen=True)
class Phrase:
    words: list[Word]
    agreement: float
    voice: Stem
    band: Stem


@dataclass
class RideTake:
    line_a: Line
    line_b: Line
    rendered: Rendered
    report: AuditReport


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
    later = [other.start for other in song.lines if other.start > line.start]
    origin = max(0.0, line.start - WINDOW_LEAD)
    next_start = later[0] if later else line.end + LINE_SEARCH_AFTER
    length = max(line.end, next_start) + WINDOW_TAIL - origin
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
        raise CannotTrust("couldn't fit the line")
    lo_check = max(lo - CHECK_MARGIN, origin)
    score = aligner.check(clip(lo_check, hi + CHECK_MARGIN), SAMPLE_RATE, words, lo_check)
    if score < MIN_AGREEMENT:
        raise CannotTrust(f"only {score:.0%} agreement with an unguided reading")
    return (
        words,
        second,
        score,
        vocal,
        origin,
        next_start,
        Stem(str(stems.vocals), origin),
        Stem(str(band_of(stems)), origin),
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


def locate_line_edge(
    settings: Settings, aligner: Aligner, song: SongInfo, line: Line, at_end: bool
) -> Phrase:
    """Find the first or last word of a line, for a hand-off with no shared words."""
    fit = _fit_line(settings, aligner, song, line)
    words, second, score, vocal, origin, next_start, voice, band = fit
    span = range(len(words) - 1, len(words)) if at_end else range(1)
    _steady(words, second, span)
    return Phrase(_settled(words, span, vocal, origin, next_start), score, voice, band)


def ride_lengths(a: SongInfo, end: float) -> tuple[int, ...]:
    """How many bars this ride could run, longest first, as far as A's own singing can carry it.

    The listener's favourite move, so it shouldn't be the same length on every song.
    """
    bar = a.period * a.beats_per_bar
    fit = []
    for bars in RIDE_LENGTHS:
        seconds = bars * bar
        if seconds > WINDOW_LEAD - 3.0:
            continue
        if a.vocal_seconds(end - seconds, end) / seconds >= MIN_RIDE_SINGING:
            fit.append(bars)
    return tuple(fit) or (8, 4)


def ride_lines(a: SongInfo, b: SongInfo) -> tuple[Line, Line] | None:
    """A line for A's voice to finish on, and the line B's voice should start with.

    A has to be singing through the ride, or there's no voice to carry over B's band. B starts best
    on the first line of a chorus, which then lands as A's voice ends.
    """
    if not (a.lines and b.lines):
        return None
    ride = RIDE_BARS * a.period * a.beats_per_bar
    chorus_ends = {float(a.bar_time(bar)) for bar in a.chorus_end_bars()}
    best_a: tuple[float, Line] | None = None
    for line in a.lines:
        if line.start < 60.0 or a.duration - line.end < 15.0 or len(line.words) < 2:
            continue
        sung = a.vocal_seconds(line.end - ride, line.end) / ride
        if sung < MIN_RIDE_SINGING:
            continue
        near_chorus_end = any(abs(line.end - end) < 4.0 for end in chorus_ends)
        score = sung + (0.5 if near_chorus_end else 0.0)
        if best_a is None or score > best_a[0]:
            best_a = (score, line)
    if best_a is None:
        return None
    chorus_starts = {float(b.bar_time(bar)) for bar in b.chorus_start_bars()}
    best_b: tuple[float, Line] | None = None
    for i, line in enumerate(b.lines):
        if line.start > b.duration * 0.6 or b.duration - line.start < 60.0 or not line.words:
            continue
        if i and line.start - b.lines[i - 1].end < 0.15:
            continue
        near_chorus = any(abs(line.start - start) < 2.0 for start in chorus_starts)
        score = 1.0 if near_chorus else 0.4
        if line.start < WINDOW_LEAD:
            score -= 0.5
        if best_b is None or score > best_b[0]:
            best_b = (score, line)
    return (best_a[1], best_b[1]) if best_b else None


def build_rides(
    conn: sqlite3.Connection,
    settings: Settings,
    pairs: list[tuple[int, int]],
    wanted: int,
    cache: SongCache | None = None,
    log: Callable[[str], None] = print,
    on_take: Callable[[RideTake], None] | None = None,
) -> list[RideTake]:
    """Vocal rides between songs that can play together, for as many pairs as it takes."""
    cache = cache or SongCache(capacity=6)
    aligner = Aligner(str(settings.models_dir))
    takes: list[RideTake] = []
    for a_id, b_id in pairs:
        if len(takes) >= wanted:
            break
        a = load_song(conn, settings, a_id)
        b = load_song(conn, settings, b_id)
        label = f"{a.name[:32]} > {b.name[:32]}"
        lines = ride_lines(a, b)
        if lines is None:
            log(f"  skip ride {label}: no line for A's voice to ride on")
            continue
        try:
            edge_a = locate_line_edge(settings, aligner, a, lines[0], at_end=True)
            edge_b = locate_line_edge(settings, aligner, b, lines[1], at_end=False)
        except CannotTrust as problem:
            log(f"  skip ride {label}: {problem}")
            continue
        for bars in ride_lengths(a, edge_a.words[0].end):
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
        if script is None:
            log(f"  no ride for {label}: the timing doesn't work out")
            continue
        rendered = render(script, cache)
        report = audit(rendered)
        if not report.passed:
            failed = [f"{c.name} {c.value}{c.unit}" for c in report.failures]
            log(f"  reject ride {label}: {failed}")
            continue
        takes.append(RideTake(lines[0], lines[1], rendered, report))
        if on_take:
            on_take(takes[-1])
        log(f"  keep ride {label}: {lines[0].text[:40]} / {lines[1].text[:40]}")
    return takes


def modes_for(a: SongInfo, b: SongInfo, space: TimbreSpace | None = None) -> tuple[str, ...]:
    """Which hand-offs these two songs can really support, best first."""
    if space is not None:
        distance = space.distance(a, b)
        if distance is not None and distance > MAX_TIMBRE:
            return ()
    modes: list[str] = []
    gap = abs(a.bpm / b.bpm - 1.0)
    if (
        gap <= BLEND_MAX_GAP
        and camelot_distance(a.camelot, b.camelot) <= BLEND_MAX_KEY_DISTANCE
        and min(a.grid_confidence, b.grid_confidence) >= BLEND_MIN_GRID
        and a.beats_per_bar == b.beats_per_bar
    ):
        modes += ["word_blend", "word_exchange"]
    if roll_suits(a, b):
        modes.append("phrase_roll")
    if gap <= CUT_MAX_GAP:
        modes.append("word_cut")
    return tuple(modes)


def roll_suits(a: SongInfo, b: SongInfo) -> bool:
    """A stutter promises a drop, and B has to arrive on something. On the reels, every roll out of
    a rock song failed, and a hype song into a much slower one felt like a broken promise."""
    return a.family != "rock" and felt_bpm(b) >= felt_bpm(a) * ROLL_MIN_TEMPO_RATIO


def music_fit(a: SongInfo, b: SongInfo, space: TimbreSpace | None = None) -> float:
    """How well two songs meet, 0 to 1, apart from any words they share."""
    modes = modes_for(a, b, space)
    if not modes:
        return 0.0
    fit = MODE_PAYOFF[modes[0]]
    if space is not None:
        distance = space.distance(a, b)
        if distance is not None and distance > 1.0:
            fit *= 1.0 - (distance - 1.0) * 0.6
    return fit


def rank_links(
    links: list[LyricLink],
    songs: dict[int, SongInfo],
    space: TimbreSpace | None = None,
) -> list[LyricLink]:
    """Links between analysed songs, best first, by how good the words and the music are together.

    A link that would jump a long way in level at its own place in each song loses out too,
    whatever its words."""
    scored = []
    for link in links:
        a, b = songs.get(link.song_a), songs.get(link.song_b)
        if a is None or b is None:
            continue
        fit = music_fit(a, b, space)
        if fit <= 0.0:
            continue
        step = level_step(a, b, a.bar_at(link.line_a.end), b.bar_at(link.line_b.start))
        if step is not None and abs(step) > 6.0:
            continue
        scored.append((link.score * fit, link))
    scored.sort(key=lambda item: -item[0])
    return [link for _, link in scored]


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
