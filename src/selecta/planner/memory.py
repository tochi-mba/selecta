"""What Selecta has learned from trying transitions.

A rendered seam costs minutes, and everything it finds out is worth keeping: which moves work
between which two songs and in which direction, where they landed, what fell short, and what the
listener thought. Each finished seam's record is kept in the seam history, which outlasts the render
cache. This reads those records into something a mix, a fallback or a suggestion can ask about, so
each starts from what's already known rather than finding it out again.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field

from selecta.analysis.key import camelot_distance
from selecta.analysis.song import SongInfo

RULES_VERSION = 1
SHAPED_MOVES = {"stem_studio", "stem_arrange"}
"""Raise this when rendering changes enough that past failures no longer say what would happen now.
Ratings always count, since a person's opinion of a hand-over doesn't go out of date."""
WORD_TIMED_MOVES = {"word_blend", "word_exchange", "phrase_roll", "word_cut"}

Attempt = tuple[int, int, str]


def _taste(good: int, bad: int) -> float:
    """Around 1. It starts as if two good and two bad had been heard, so a single rating nudges
    what's wanted rather than swinging it."""
    return 2.0 * (good + 2.0) / (good + bad + 4.0)


def _traits_of_pair(a: SongInfo, b: SongInfo) -> tuple[str, str]:
    gap = abs(a.bpm / b.bpm - 1.0)
    tempo = "tempo close" if gap <= 0.04 else "tempo near" if gap <= 0.08 else "tempo far"
    keys = "keys far" if camelot_distance(a.camelot, b.camelot) >= 5 else "keys fine"
    return tempo, keys


@dataclass
class SeamMemory:
    """Everything known so far. Every pair is one way round, because A into B says nothing about B
    into A: on the reels the same two songs rated differently each way."""

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
    good_traits: Counter[str] = field(default_factory=Counter)
    bad_traits: Counter[str] = field(default_factory=Counter)
    liked_shapes: list[dict] = field(default_factory=list)
    disliked_shapes: list[dict] = field(default_factory=list)
    pair_shapes: dict[tuple[int, int], dict] = field(default_factory=dict)
    liked_arcs: list[list[float]] = field(default_factory=list)
    _pairs: dict[tuple[int, int], set[Attempt]] | None = field(default=None, repr=False)

    @classmethod
    def from_states(cls, states: Iterable[dict]) -> SeamMemory:
        found = cls()
        for state in states:
            found.learn(state)
        return found

    def learn(self, state: dict) -> None:
        """Take in one seam's record. Failures from older rendering rules don't count against a move
        now, except word timing, which hasn't changed."""
        request = state.get("request") or {}
        a, b = request.get("a"), request.get("b")
        if a is None or b is None:
            return
        self._pairs = None
        current = state.get("rules") == RULES_VERSION
        if request.get("leave_after") is not None:
            # failing only says there's no room that late in A, not that these two don't work
            if state.get("status") == "failed":
                return
            state = {**state, "tried": []}
        for attempt in state.get("tried") or []:
            if current or attempt["move"] in WORD_TIMED_MOVES:
                self.failed.add((a, b, attempt["move"]))
                if attempt.get("song") is not None:
                    self.untimed[attempt["song"]] += 1
        if state.get("status") == "failed":
            move = request.get("move")
            if current or move in WORD_TIMED_MOVES:
                self.failed.add((a, b, move))
                if state.get("untimed_song") is not None:
                    self.untimed[state["untimed_song"]] += 1
        if state.get("status") != "ready":
            return
        style = state.get("style")
        if not style:
            return  # a Seam Studio session is stems laid out, not a move that was tried
        attempt = (a, b, style)
        (self.clean if state.get("passed") else self.warned).add(attempt)
        (self.clean_songs if state.get("passed") else self.warned_songs).update((a, b))
        if style in WORD_TIMED_MOVES:
            self.timed.update((a, b))
        if state.get("exit_bar") is not None and state.get("entry_bar") is not None:
            self.placements[attempt] = (
                state["exit_bar"],
                state["entry_bar"],
                state.get("placed_bars") or 0,
            )
        if state.get("rating") == "good":
            self.liked.add(attempt)
            self.good_moves[style] += 1
        elif state.get("rating") == "bad":
            self.disliked.add(attempt)
            self.bad_moves[style] += 1
        if style in SHAPED_MOVES:
            self._learn_shape(a, b, state)

    def _learn_shape(self, a: int, b: int, state: dict) -> None:
        """A rated shape is the clearest thing the listener can say. One they liked joins what
        Selecta arranges with, and one they made for this pair gets used for this pair. Rating a
        shape they made also counts for arranging in general, since it's the same kind of move."""
        rating = state.get("rating")
        raw = (state.get("request") or {}).get("shape") or state.get("shape_used")
        if rating not in {"good", "bad"} or not raw:
            return
        try:
            shape = json.loads(raw) if isinstance(raw, str) else raw
        except ValueError:
            return
        made_by_hand = state.get("style") == "stem_studio"
        if rating == "good":
            if shape not in self.liked_shapes:
                self.liked_shapes.append(shape)
            if state.get("arc"):
                self.liked_arcs.append(state["arc"])
            if made_by_hand:
                self.pair_shapes[(a, b)] = shape
                self.liked.add((a, b, "stem_arrange"))
                self.good_moves["stem_arrange"] += 1
        else:
            if shape not in self.disliked_shapes:
                self.disliked_shapes.append(shape)
            if made_by_hand:
                self.bad_moves["stem_arrange"] += 1

    def read_taste(self, library: Iterable[SongInfo]) -> SeamMemory:
        """Work out what the listener's ratings have in common, which needs the songs themselves."""
        songs = {song.id: song for song in library}
        for group, counted in ((self.liked, self.good_traits), (self.disliked, self.bad_traits)):
            for a, b, _ in group:
                if a in songs and b in songs:
                    counted.update(_traits_of_pair(songs[a], songs[b]))
        return self

    def learned_fit(self, a: SongInfo, b: SongInfo) -> float:
        """How the listener's ratings of other seams like this one lean, around 1."""
        tempo, keys = _traits_of_pair(a, b)
        return (
            _taste(self.good_traits[tempo], self.bad_traits[tempo])
            * _taste(self.good_traits[keys], self.bad_traits[keys])
        ) ** 0.5

    def can_time_words(self, song_id: int) -> bool:
        return self.timed[song_id] > 0 or self.untimed[song_id] == 0

    def taste(self, move: str) -> float:
        """How much the listener's ratings favour this move, around 1."""
        return _taste(self.good_moves[move], self.bad_moves[move])

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
        if attempt in self.disliked:
            return False
        return attempt in self.clean or attempt in self.liked

    def pair_value(self, a: int, b: int) -> float:
        """What's known about this hand-over overall, from -1 to 1, or nought if nothing is."""
        attempts = self._by_pair().get((a, b))
        if not attempts:
            return 0.0
        if attempts & self.liked:
            return 1.0
        kept = attempts - self.disliked
        if kept & self.clean:
            return 0.5
        if attempts & self.disliked:
            return -1.0
        if kept & self.warned:
            return 0.15
        return -0.3

    def best_known(self, a: int, b: int) -> tuple[str, str] | None:
        """The move most worth mentioning between these two, and how it went."""
        attempts = sorted(self._by_pair().get((a, b), ()))
        kinds = ((self.liked, "liked"), (self.disliked, "disliked"), (self.clean, "clean"))
        for wanted, how in kinds:
            for attempt in attempts:
                if attempt in wanted:
                    return attempt[2], how
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

    def summary(self) -> dict[str, int]:
        return {
            "tried": len(self.failed | self.clean | self.warned),
            "clean": len(self.clean),
            "warned": len(self.warned),
            "failed": len(self.failed),
            "liked": len(self.liked),
            "disliked": len(self.disliked),
        }
