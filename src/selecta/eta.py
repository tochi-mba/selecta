"""How long things will take, worked out from how long they've taken on this machine.

Every job's real time is kept, so estimates start as guesses and quickly become measurements.
Four things keep them honest, each from comparing estimates with what really happened on this PC:

- One real time counts as much as the starting guess, and after that the guess fades quickly.
- How busy the PC is right now counts. The same song took 30 s idle and 12 minutes under load, so
  recent jobs running slow make every estimate longer until things calm down.
- A job that's already running is judged by how long jobs like it took when they ran this long. If
  it has outlasted all the quick ones, it's one of the slow ones, whatever the average says is left.
- Whatever has to finish first is counted, so a wait behind rendering is part of the time quoted.
"""

from __future__ import annotations

import json
import math
import os
import sqlite3
import statistics
import tempfile
import time
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from selecta.config import ANALYSIS_VERSION

KEEP = 40
"""Only recent times count, so estimates follow changes in the machine and the code."""
TRUST_AFTER = 5
"""With fewer times than this, the starting guess still counts as one more time."""
LOAD_AFTER = 5
"""A kind of job needs this many real times before it can say the PC is running slow."""
RECENT_JOBS = 8
SLOWEST_LOAD = 3.0
QUICKEST_LOAD = 0.5
RECENT_SONGS = 8
"""Walking through real analyses, half this recent pace and half the long-run one had the fewest bad
misses, and it follows the PC speeding up and slowing down."""
BUSY_ENOUGH = 1.6
"""Jobs vary by this much anyway, so it takes more than this for the PC to count as busy or idle."""
STEADY_JOBS = {
    "stem_window",
    "cut_on_one",
    "echo_out",
    "delay_throw",
    "reverb_wash",
    "bass_swap_blend",
    "filter_sweep",
    "tempo_ramp",
    "stem_studio",
}
"""Jobs whose time says how busy the PC is. A word move takes 50 s with its stems ready and 330 s
without, which says nothing about the PC, so those don't count."""
LOAD_KEY = "_load"
CHECKS_KEY = "_checks"
KEEP_CHECKS = 40
LONGEST_BELIEVABLE = 3 * 3600.0
"""Anything longer than this was probably a PC asleep, not a job working."""
MOOD = 0.3
"""A PC's speed drifts with whatever else it's doing, and that doesn't average out over more jobs.
Walking through 581 real analyses, the time for the next hundred songs was typically 21% off."""
MANY_SONGS = 25
"""Slow songs are rare and very slow. One song is best judged by the typical rate, and a long run,
which will include its share of slow ones, by the average. Using the average for one song was 20%
too high on real timings."""
SHORTEST_LEFT = 3.0
FILE_NAME = "job-times.json"
MODEL_LOAD_SECONDS = 15.0
ANALYSIS_RATE_GUESS = 0.15
"""Seconds of work per second of audio, until there are real analysis times to go on."""
RECENT_ANALYSES = 100
GUESSES = {
    "cut_on_one": 5.0,
    "echo_out": 10.0,
    "delay_throw": 8.0,
    "reverb_wash": 10.0,
    "bass_swap_blend": 40.0,
    "filter_sweep": 30.0,
    "tempo_ramp": 30.0,
    "vocal_ride": 300.0,
    "word_blend": 120.0,
    "word_exchange": 200.0,
    "phrase_roll": 150.0,
    "word_cut": 100.0,
    "stem_intertwine": 300.0,
    "auto": 150.0,
    "stem_arrange": 300.0,
    "stem_studio": 15.0,
    "studio_session": 60.0,
    "stem_window": 120.0,
    "audition": 15.0,
    "export_per_song": 1.5,
}
"""Measured on a four-core laptop, so a new PC isn't far out from the very first job."""
UNKNOWN_JOB_GUESS = 120.0


@dataclass(frozen=True)
class Estimate:
    seconds: float
    low: float
    high: float
    samples: int = 0
    late: bool = False

    def as_dict(self) -> dict:
        return {
            "seconds": round(self.seconds),
            "low": round(self.low),
            "high": round(self.high),
            "late": self.late,
        }


def _quantile(ordered: list[float], share: float) -> float:
    position = (len(ordered) - 1) * share
    below = math.floor(position)
    above = math.ceil(position)
    return ordered[below] + (ordered[above] - ordered[below]) * (position - below)


def estimate_from(samples: Iterable[float], guess: float) -> Estimate:
    """An expected time and likely range, from past times and a guess to fall back on."""
    ordered = sorted(value for value in samples if value > 0 and math.isfinite(value))
    count = len(ordered)
    if count == 0:
        return Estimate(guess, guess * 0.5, guess * 2.0, 0)
    trim = count // 10
    kept = ordered[trim : count - trim]
    expected = sum(kept) / len(kept)
    low, high = _quantile(ordered, 0.1), _quantile(ordered, 0.9)
    if count < TRUST_AFTER:
        expected = (sum(kept) + guess) / (len(kept) + 1)
        low, high = min(low, expected * 0.6), max(high, expected * 1.6)
    return Estimate(expected, min(low, expected), max(high, expected), count)


def combine(estimates: Iterable[Estimate]) -> Estimate:
    """The time for several jobs one after another. Their surprises partly cancel out, so the
    range grows more slowly than the total, though never below how much a PC's speed can drift."""
    items = list(estimates)
    if not items:
        return Estimate(0.0, 0.0, 0.0)
    if len(items) == 1:
        return items[0]
    seconds = sum(item.seconds for item in items)
    drift = seconds * MOOD
    below = max(math.sqrt(sum((item.seconds - item.low) ** 2 for item in items)), drift)
    above = max(math.sqrt(sum((item.high - item.seconds) ** 2 for item in items)), drift)
    return Estimate(
        seconds,
        max(seconds - below, 0.0),
        seconds + above,
        min(item.samples for item in items),
        any(item.late for item in items),
    )


def still_to_go(estimate: Estimate, elapsed: float) -> Estimate:
    """What's left of a job that's already running. Once it has run past its likely range, it's
    marked late, and it keeps a small amount left rather than claiming to be finished."""
    if elapsed <= 0:
        return estimate
    floor = max(estimate.seconds * 0.1, SHORTEST_LEFT)
    seconds = max(estimate.seconds - elapsed, floor)
    return Estimate(
        seconds,
        max(estimate.low - elapsed, min(floor, seconds)),
        max(estimate.high - elapsed, seconds),
        estimate.samples,
        elapsed > estimate.high,
    )


def _scaled(estimate: Estimate, by: float) -> Estimate:
    return Estimate(
        estimate.seconds * by,
        estimate.low * by,
        estimate.high * by,
        estimate.samples,
        estimate.late,
    )


class JobClock:
    """Real job times, kept beside the rest of the data so they last between runs."""

    def __init__(self, home: Path):
        self.path = home / FILE_NAME

    def _everything(self) -> dict:
        try:
            loaded = json.loads(self.path.read_text("utf-8"))
        except (OSError, ValueError):
            return {}
        return loaded if isinstance(loaded, dict) else {}

    def times(self) -> dict[str, list[float]]:
        return {kind: v for kind, v in self._everything().items() if not kind.startswith("_")}

    def record(self, kind: str, seconds: float) -> None:
        if not (0 < seconds <= LONGEST_BELIEVABLE) or not math.isfinite(seconds):
            return
        stored = self._everything()
        before = stored.get(kind, [])
        quoted = self.estimate(kind).seconds
        checks = [*stored.get(CHECKS_KEY, []), round(seconds / max(quoted, 0.1), 3)]
        stored[CHECKS_KEY] = checks[-KEEP_CHECKS:]
        if kind in STEADY_JOBS and len(before) >= LOAD_AFTER:
            usual = statistics.median(before)
            ratios = [*stored.get(LOAD_KEY, []), round(seconds / max(usual, 0.1), 3)]
            stored[LOAD_KEY] = ratios[-RECENT_JOBS:]
        stored[kind] = [*before, round(float(seconds), 2)][-KEEP:]
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # written whole and swapped in, since the app and the worker can both be recording
        descriptor, temporary = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(stored, stream)
        try:
            os.replace(temporary, self.path)
        except OSError:
            Path(temporary).unlink(missing_ok=True)

    def load(self) -> float:
        """How much slower than usual jobs have been lately, where 1 is usual."""
        ratios = self._everything().get(LOAD_KEY, [])
        if len(ratios) < LOAD_AFTER:
            return 1.0
        load = statistics.median(ratios)
        if 1.0 / BUSY_ENOUGH < load < BUSY_ENOUGH:
            return 1.0
        return max(QUICKEST_LOAD, min(load, SLOWEST_LOAD))

    def estimate(self, kind: str) -> Estimate:
        guess = GUESSES.get(kind, UNKNOWN_JOB_GUESS)
        return _scaled(estimate_from(self.times().get(kind, []), guess), self.load())

    def left(self, kind: str, elapsed: float) -> Estimate:
        """What's left of a job that has run this long. Among past jobs that ran at least this long,
        how much longer did they go? A job past all the quick ones is one of the slow ones."""
        estimate = self.estimate(kind)
        if elapsed <= 0:
            return estimate
        load = self.load()
        longer = [time * load - elapsed for time in self.times().get(kind, [])]
        longer = [time for time in longer if time > 0]
        if not longer:
            return still_to_go(estimate, elapsed)
        floor = max(estimate.seconds * 0.1, SHORTEST_LEFT)
        seconds = max(statistics.fmean(longer), floor)
        return Estimate(
            seconds,
            max(min(min(longer), seconds), min(floor, seconds)),
            max(max(longer), seconds),
            estimate.samples,
            elapsed > estimate.high,
        )

    def recent(self) -> dict[str, float]:
        """The expected time for each kind of job, for the page to quote."""
        times = self.times()
        load = self.load()
        return {
            kind: round(
                estimate_from(times.get(kind, []), GUESSES.get(kind, UNKNOWN_JOB_GUESS)).seconds
                * load,
                1,
            )
            for kind in {*GUESSES, *times}
        }

    def accuracy(self) -> dict:
        """How far out recent estimates really were: how many times too long or too short."""
        checks = [ratio for ratio in self._everything().get(CHECKS_KEY, []) if ratio > 0]
        if not checks:
            return {"jobs": 0, "typical_miss": None}
        misses = [max(ratio, 1.0 / ratio) for ratio in checks]
        return {"jobs": len(checks), "typical_miss": round(statistics.median(misses), 2)}


def _unfinished(item: dict) -> bool:
    seam = item.get("seam")
    return bool(seam) and seam["state"]["status"] in {"none", "queued", "rendering"}


def _seam_estimate(item: dict, clock: JobClock, now: float) -> Estimate:
    state = item["seam"]["state"]
    kind = item["seam"]["settings"].get("move") or "auto"
    if state["status"] == "rendering" and state.get("started_at"):
        return clock.left(kind, now - float(state["started_at"]))
    return clock.estimate(kind)


def _in_turn(items: list[dict]) -> list[dict]:
    waiting = [item for item in items if _unfinished(item)]
    waiting.sort(key=lambda item: item["seam"]["state"]["status"] != "rendering")
    return waiting


def mix_time_left(
    items: list[dict],
    clock: JobClock,
    now: float | None = None,
    ahead: list[Estimate] | None = None,
    seen: set[str] | None = None,
) -> dict:
    """How long until the mix is fully rendered. Each unfinished seam also gets an `eta`: how long
    until that seam is ready, which is everything ahead of it in line as well as its own time. The
    one being rendered goes first, then the rest in mix order, the order the worker takes them.
    `ahead` is whatever has to finish first, and `seen` the seams it already includes, since a seam
    shared by two mixes only renders once."""
    now = time.time() if now is None else now
    so_far = list(ahead or [])
    waiting = _in_turn(items)
    for item in waiting:
        state = item["seam"]["state"]
        if not seen or state.get("key") not in seen:
            so_far.append(_seam_estimate(item, clock, now))
        state["eta"] = round(combine(so_far).seconds)
    return {**combine(so_far).as_dict(), "seams": len(waiting)}


def time_ahead(
    mixes: list[list[dict]], clock: JobClock, now: float | None = None
) -> tuple[list[Estimate], set[str]]:
    """All the work in these mixes, in order, counting a seam that's in two of them once."""
    now = time.time() if now is None else now
    estimates: list[Estimate] = []
    seen: set[str] = set()
    for items in mixes:
        for item in _in_turn(items):
            key = item["seam"]["state"].get("key")
            if key is None or key not in seen:
                estimates.append(_seam_estimate(item, clock, now))
            if key is not None:
                seen.add(key)
    return estimates, seen


def analysis_rates(conn: sqlite3.Connection) -> list[float]:
    """Seconds of analysis per second of audio, for recently analysed songs. It's per second of
    audio since a seven-minute song takes far longer than a two-minute one."""
    rows = conn.execute(
        "SELECT a.timings timings, s.duration duration FROM analysis a "
        "JOIN songs s ON s.id=a.song_id WHERE a.error IS NULL AND a.timings IS NOT NULL "
        "ORDER BY a.analysed_at DESC, a.song_id DESC LIMIT ?",
        (RECENT_ANALYSES,),
    ).fetchall()
    rates = []
    for row in rows:
        try:
            total = float(json.loads(row["timings"])["total"])
        except (TypeError, ValueError, KeyError):
            continue
        if row["duration"] and total > 0:
            rates.append(total / float(row["duration"]))
    return rates


def _rate_range(rates: list[float], songs: int) -> tuple[float, float, float]:
    """Seconds of work per second of audio, with `rates` newest first."""
    if not rates:
        return (
            ANALYSIS_RATE_GUESS,
            ANALYSIS_RATE_GUESS * 0.5,
            ANALYSIS_RATE_GUESS * 2.0,
        )
    ordered = sorted(rates)
    share = min(max(songs, 1) / MANY_SONGS, 1.0)
    long_run = share * statistics.fmean(ordered) + (1.0 - share) * statistics.median(ordered)
    rate = 0.5 * long_run + 0.5 * statistics.median(rates[:RECENT_SONGS])
    root = math.sqrt(max(songs, 1))
    below = max((rate - _quantile(ordered, 0.1)) / root, rate * MOOD)
    above = max((_quantile(ordered, 0.9) - rate) / root, rate * MOOD)
    return rate, max(rate - below, 0.0), rate + above


def analysis_time(
    seconds_of_audio: float, rates: list[float], loaded: bool, songs: int = 1
) -> Estimate:
    """How long analysing this much audio should take, across this many songs. Loading the models
    costs once, unless the work is already under way."""
    rate, low, high = _rate_range(rates, songs)
    extra = 0.0 if loaded else MODEL_LOAD_SECONDS
    return Estimate(
        seconds_of_audio * rate + extra,
        seconds_of_audio * low + extra,
        seconds_of_audio * high + extra,
        len(rates),
    )


def analysis_left(
    conn: sqlite3.Connection,
    running: bool,
    waits_for_mix: bool,
    ahead: list[Estimate] | None = None,
) -> dict:
    """The rest of the library, once what's ahead of it has finished. It only counts songs that
    still need analysing."""
    row = conn.execute(
        "SELECT COUNT(*) songs, COALESCE(SUM(s.duration),0) audio FROM songs s "
        "LEFT JOIN analysis a ON a.song_id=s.id "
        "WHERE s.is_music=1 AND s.duplicate_of IS NULL "
        "AND (a.song_id IS NULL OR a.version<?)",
        (ANALYSIS_VERSION,),
    ).fetchone()
    estimate = analysis_time(row["audio"], analysis_rates(conn), running, row["songs"])
    total = combine([estimate, *(ahead or [])]) if row["songs"] else estimate
    return {**total.as_dict(), "songs": row["songs"], "after_mix": waits_for_mix}


def analysis_line_left(
    conn: sqlite3.Connection, line: list[int], ahead: list[Estimate] | None = None
) -> dict[int, int]:
    """For each song waiting to be analysed by request, how long until it's ready."""
    if not line:
        return {}
    rates = analysis_rates(conn)
    durations = {
        row["id"]: row["duration"]
        for row in conn.execute(
            f"SELECT id,duration FROM songs WHERE id IN ({','.join('?' * len(line))})",  # noqa: S608
            line,
        )
    }
    audio = 0.0
    ready_in = {}
    waiting = combine(ahead or []).seconds
    for count, song in enumerate(line, 1):
        audio += float(durations.get(song) or 0.0)
        own = analysis_time(audio, rates, loaded=False, songs=count).seconds
        ready_in[song] = round(own + waiting)
    return ready_in
