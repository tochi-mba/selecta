"""How long things will take, worked out from how long they've taken on this machine.

Every job's real time is kept, so estimates start as rough guesses and quickly become measurements.
Three things keep them honest. Times are averaged after dropping the extremes, because a total is
what a person is waiting for, and one stall while a PC slept shouldn't skew it. Each estimate has a
likely range, which widens when there's little to go on. And a job that's running counts down from
when it really started, without ever claiming to be finished or going below a small floor.
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
"""With fewer times than this, an estimate leans partly on the starting guess."""
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
    "cut_on_one": 25.0,
    "echo_out": 30.0,
    "delay_throw": 30.0,
    "reverb_wash": 30.0,
    "bass_swap_blend": 40.0,
    "filter_sweep": 40.0,
    "tempo_ramp": 45.0,
    "vocal_ride": 200.0,
    "word_blend": 240.0,
    "word_exchange": 240.0,
    "phrase_roll": 220.0,
    "word_cut": 200.0,
    "stem_intertwine": 240.0,
    "auto": 120.0,
    "stem_studio": 15.0,
    "studio_session": 60.0,
    "stem_window": 100.0,
    "audition": 15.0,
    "export_per_song": 1.5,
}
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
        weight = count / TRUST_AFTER
        expected = weight * expected + (1.0 - weight) * guess
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


class JobClock:
    """Real job times, kept beside the rest of the data so they last between runs."""

    def __init__(self, home: Path):
        self.path = home / FILE_NAME

    def times(self) -> dict[str, list[float]]:
        try:
            loaded = json.loads(self.path.read_text("utf-8"))
        except (OSError, ValueError):
            return {}
        return loaded if isinstance(loaded, dict) else {}

    def record(self, kind: str, seconds: float) -> None:
        if not (0 < seconds <= LONGEST_BELIEVABLE) or not math.isfinite(seconds):
            return
        times = self.times()
        recent = [*times.get(kind, []), round(float(seconds), 2)][-KEEP:]
        times[kind] = recent
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # written whole and swapped in, since the app and the worker can both be recording
        descriptor, temporary = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(times, stream)
        try:
            os.replace(temporary, self.path)
        except OSError:
            Path(temporary).unlink(missing_ok=True)

    def estimate(self, kind: str) -> Estimate:
        return estimate_from(self.times().get(kind, []), GUESSES.get(kind, UNKNOWN_JOB_GUESS))

    def recent(self) -> dict[str, float]:
        """The expected time for each kind of job, for the page to quote."""
        times = self.times()
        return {
            kind: round(
                estimate_from(times.get(kind, []), GUESSES.get(kind, UNKNOWN_JOB_GUESS)).seconds, 1
            )
            for kind in {*GUESSES, *times}
        }


def _unfinished(item: dict) -> bool:
    seam = item.get("seam")
    return bool(seam) and seam["state"]["status"] in {"none", "queued", "rendering"}


def mix_time_left(items: list[dict], clock: JobClock, now: float | None = None) -> dict:
    """How long until the mix is fully rendered. Each unfinished seam also gets an `eta`: how long
    until that seam is ready, which is everything ahead of it in line as well as its own time. The
    one being rendered goes first, then the rest in mix order, the order the worker takes them."""
    now = time.time() if now is None else now
    waiting = [item for item in items if _unfinished(item)]
    waiting.sort(key=lambda item: item["seam"]["state"]["status"] != "rendering")
    so_far: list[Estimate] = []
    for item in waiting:
        state = item["seam"]["state"]
        estimate = clock.estimate(item["seam"]["settings"].get("move") or "auto")
        if state["status"] == "rendering" and state.get("started_at"):
            estimate = still_to_go(estimate, now - float(state["started_at"]))
        so_far.append(estimate)
        state["eta"] = round(combine(so_far).seconds)
    return {**combine(so_far).as_dict(), "seams": len(waiting)}


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
    if not rates:
        return (
            ANALYSIS_RATE_GUESS,
            ANALYSIS_RATE_GUESS * 0.5,
            ANALYSIS_RATE_GUESS * 2.0,
        )
    ordered = sorted(rates)
    share = min(max(songs, 1) / MANY_SONGS, 1.0)
    rate = share * statistics.fmean(ordered) + (1.0 - share) * statistics.median(ordered)
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


def analysis_left(conn: sqlite3.Connection, running: bool, waits_for_mix: bool) -> dict:
    """The rest of the library. It only counts songs that still need analysing."""
    row = conn.execute(
        "SELECT COUNT(*) songs, COALESCE(SUM(s.duration),0) audio FROM songs s "
        "LEFT JOIN analysis a ON a.song_id=s.id "
        "WHERE s.is_music=1 AND s.duplicate_of IS NULL "
        "AND (a.song_id IS NULL OR a.version<?)",
        (ANALYSIS_VERSION,),
    ).fetchone()
    estimate = analysis_time(row["audio"], analysis_rates(conn), running, row["songs"])
    return {**estimate.as_dict(), "songs": row["songs"], "after_mix": waits_for_mix}


def analysis_line_left(conn: sqlite3.Connection, line: list[int]) -> dict[int, int]:
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
    for count, song in enumerate(line, 1):
        audio += float(durations.get(song) or 0.0)
        ready_in[song] = round(analysis_time(audio, rates, loaded=False, songs=count).seconds)
    return ready_in
