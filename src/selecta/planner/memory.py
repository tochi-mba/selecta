"""What Selecta has learned from trying transitions, kept for good.

A rendered seam costs minutes, and everything it finds out is worth keeping: which moves work
between which two songs and in which direction, where they landed, what fell short, and what the
listener thought. Finished seams live in a cache that gets cleared, so this lives in the database.

Mixes, fallbacks and suggestions all read it, so each one starts from what's already known rather
than finding it out again.
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from selecta.config import ANALYSIS_VERSION

RULES_VERSION = 1
"""Raise this when rendering changes enough that past results no longer say what would happen now.
Ratings always survive it, since a person's opinion of a hand-over doesn't go out of date."""
WORD_TIMED_MOVES = {"word_blend", "word_exchange", "phrase_roll", "word_cut"}

Attempt = tuple[int, int, str]


@dataclass
class SeamMemory:
    """Everything known so far, ready to ask about. Every pair is one way round, because A into B
    says nothing about B into A: on the reels the same two songs rated differently each way."""

    failed: set[Attempt] = field(default_factory=set)
    clean: set[Attempt] = field(default_factory=set)
    warned: set[Attempt] = field(default_factory=set)
    liked: set[Attempt] = field(default_factory=set)
    disliked: set[Attempt] = field(default_factory=set)
    placements: dict[Attempt, tuple[int, int, int]] = field(default_factory=dict)
    timed: Counter[int] = field(default_factory=Counter)
    untimed: Counter[int] = field(default_factory=Counter)
    warned_songs: Counter[int] = field(default_factory=Counter)
    clean_songs: Counter[int] = field(default_factory=Counter)
    good_moves: Counter[str] = field(default_factory=Counter)
    bad_moves: Counter[str] = field(default_factory=Counter)

    def can_time_words(self, song_id: int) -> bool:
        return self.timed[song_id] > 0 or self.untimed[song_id] == 0

    def taste(self, move: str) -> float:
        """How much the listener's ratings favour this move, around 1. It starts as if two good
        and two bad had been heard, so a single rating nudges it rather than swings it."""
        good, bad = self.good_moves[move], self.bad_moves[move]
        return 2.0 * (good + 2.0) / (good + bad + 4.0)

    def move_factor(self, a: int, b: int, move: str) -> float:
        """How much more or less to want this move between these two, given what's known. Nought
        means it failed or the listener didn't like it, so it shouldn't be planned again."""
        attempt = (a, b, move)
        if attempt in self.disliked or attempt in self.failed:
            return 0.0
        if attempt in self.liked:
            known = 3.0
        elif attempt in self.clean:
            known = 1.5
        elif attempt in self.warned:
            known = 0.25
        else:
            known = 1.0
        return known * self.taste(move)

    def proven(self, a: int, b: int, move: str) -> bool:
        """Has this move already come out clean, or been liked, between these two?"""
        attempt = (a, b, move)
        return attempt in self.clean or attempt in self.liked

    def pair_value(self, a: int, b: int) -> float:
        """What's known about this hand-over overall, from -1 to 1, or nought if nothing is."""
        best = 0.0
        attempts = self._by_pair().get((a, b))
        if not attempts:
            return best
        if attempts & self.liked:
            return 1.0
        if attempts & self.clean:
            best = 0.5
        elif attempts & self.warned:
            best = 0.15
        if attempts & self.disliked and not best:
            return -1.0
        if not best and attempts <= self.failed:
            return -0.3
        return best

    def best_known(self, a: int, b: int) -> tuple[str, str] | None:
        """The move most worth mentioning between these two, and how it went."""
        for attempt in sorted(self._by_pair().get((a, b), ())):
            if attempt in self.liked:
                return attempt[2], "liked"
        for attempt in sorted(self._by_pair().get((a, b), ())):
            if attempt in self.clean:
                return attempt[2], "clean"
        for attempt in sorted(self._by_pair().get((a, b), ())):
            if attempt in self.disliked:
                return attempt[2], "disliked"
        return None

    def song_value(self, song_id: int) -> float:
        """How well this song tends to render, from -1 to 1. Past warnings cost it, clean takes
        earn it back, so a song isn't marked down for ever by one bad neighbour."""
        clean, warned = self.clean_songs[song_id], self.warned_songs[song_id]
        if not clean and not warned:
            return 0.0
        return (clean - 2.0 * warned) / (clean + 2.0 * warned + 1.0)

    def _by_pair(self) -> dict[tuple[int, int], set[Attempt]]:
        if self._pairs is None:
            self._pairs = {}
            for group in (self.failed, self.clean, self.warned, self.liked, self.disliked):
                for attempt in group:
                    self._pairs.setdefault(attempt[:2], set()).add(attempt)
        return self._pairs

    _pairs: dict[tuple[int, int], set[Attempt]] | None = field(default=None, repr=False)

    def summary(self) -> dict[str, int]:
        return {
            "tried": len(self.failed | self.clean | self.warned),
            "clean": len(self.clean),
            "warned": len(self.warned),
            "failed": len(self.failed),
            "liked": len(self.liked),
            "disliked": len(self.disliked),
        }


def remember(
    conn: sqlite3.Connection,
    a: int,
    b: int,
    move: str,
    outcome: str,
    why: str = "",
    checks: dict[str, float] | None = None,
    placement: tuple[int, int, int] | None = None,
    blamed: int | None = None,
) -> None:
    """Keep what one attempt found. A newer result replaces an older one, but not its rating."""
    exit_bar, entry_bar, bars = placement or (None, None, None)
    conn.execute(
        "INSERT INTO seam_memory(song_a,song_b,move,outcome,why,checks,exit_bar,entry_bar,bars,"
        "blamed_song,analysis_version,rules_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(song_a,song_b,move) DO UPDATE SET outcome=excluded.outcome,why=excluded.why,"
        "checks=excluded.checks,exit_bar=excluded.exit_bar,entry_bar=excluded.entry_bar,"
        "bars=excluded.bars,blamed_song=excluded.blamed_song,"
        "analysis_version=excluded.analysis_version,rules_version=excluded.rules_version,"
        "updated_at=CURRENT_TIMESTAMP",
        (
            a,
            b,
            move,
            outcome,
            why,
            json.dumps(checks or {}),
            exit_bar,
            entry_bar,
            bars,
            blamed,
            ANALYSIS_VERSION,
            RULES_VERSION,
        ),
    )
    conn.commit()


def remember_rating(conn: sqlite3.Connection, a: int, b: int, move: str, rating: str) -> None:
    """Keep what the listener thought. Clearing a rating forgets the opinion, not the attempt."""
    conn.execute(
        "INSERT INTO seam_memory(song_a,song_b,move,outcome,analysis_version,rules_version,rating) "
        "VALUES(?,?,?,'clean',?,?,?) ON CONFLICT(song_a,song_b,move) DO UPDATE SET "
        "rating=excluded.rating,updated_at=CURRENT_TIMESTAMP",
        (a, b, move, ANALYSIS_VERSION, RULES_VERSION, None if rating == "none" else rating),
    )
    conn.commit()


def load_memory(conn: sqlite3.Connection) -> SeamMemory:
    found = SeamMemory()
    for row in conn.execute("SELECT * FROM seam_memory"):
        attempt = (row["song_a"], row["song_b"], row["move"])
        if row["rating"] == "good":
            found.liked.add(attempt)
            found.good_moves[row["move"]] += 1
        elif row["rating"] == "bad":
            found.disliked.add(attempt)
            found.bad_moves[row["move"]] += 1
        if row["analysis_version"] != ANALYSIS_VERSION or row["rules_version"] != RULES_VERSION:
            continue
        if row["blamed_song"] is not None:
            found.untimed[row["blamed_song"]] += 1
        if row["outcome"] == "failed":
            found.failed.add(attempt)
            continue
        (found.clean if row["outcome"] == "clean" else found.warned).add(attempt)
        counted = found.clean_songs if row["outcome"] == "clean" else found.warned_songs
        counted.update(attempt[:2])
        if row["move"] in WORD_TIMED_MOVES:
            found.timed.update(attempt[:2])
        if row["exit_bar"] is not None and row["entry_bar"] is not None:
            found.placements[attempt] = (row["exit_bar"], row["entry_bar"], row["bars"] or 0)
    return found


def fill_from_finished_seams(conn: sqlite3.Connection, root: Path) -> int:
    """Learn from seams finished before there was a memory, once. Moves that failed under older
    rules don't count against them now, except word timing, which hasn't changed. Nothing that's
    already known is replaced."""
    added = 0
    if not root.is_dir():
        return added
    known = {
        (row["song_a"], row["song_b"], row["move"])
        for row in conn.execute("SELECT song_a,song_b,move FROM seam_memory")
    }
    for meta in root.glob("*/seam.json"):
        try:
            state = json.loads(meta.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        request = state.get("request") or {}
        a, b = request.get("a"), request.get("b")
        if a is None or b is None:
            continue
        if state.get("status") == "failed":
            move = request.get("move")
            if move in WORD_TIMED_MOVES and (a, b, move) not in known:
                remember(conn, a, b, move, "failed", state.get("error") or "")
                known.add((a, b, move))
                added += 1
        elif state.get("status") == "ready":
            move = state.get("style")
            if (a, b, move) in known:
                continue
            checks = {
                check["name"]: check.get("value")
                for check in state.get("checks") or []
                if not check.get("passed")
            }
            outcome = "clean" if state.get("passed") else "warned"
            remember(conn, a, b, move, outcome, "", checks)
            if state.get("rating") in {"good", "bad"}:
                remember_rating(conn, a, b, move, state["rating"])
            known.add((a, b, move))
            added += 1
    return added
