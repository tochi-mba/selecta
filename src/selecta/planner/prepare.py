"""Which word links are worth offering, and what to prepare next in spare time.

First the best word links, then the best transitions across the whole library. Having them ready
means requests and bridges can join at once, and what's learned from rendering them makes every mix
better, since a pair that's been tried doesn't have to be guessed at.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections.abc import Callable, Iterable
from typing import Any

from selecta.analysis.key import camelot_distance
from selecta.analysis.song import SongInfo
from selecta.lyrics.lrclib import clean_artist
from selecta.lyrics.match import LyricLink
from selecta.planner.fit import TimbreSpace
from selecta.planner.memory import SeamMemory
from selecta.planner.moods import is_english
from selecta.planner.wordreel import modes_for, rank_links
from selecta.request_planner import GOOD_ENOUGH, PairBook, same_song
from selecta.seams import SeamRequest

LINKS_TO_PREPARE = 30
PARTNERS_PER_SONG = 2
TEMPO_REACH = 0.08  # nothing further apart than this overlaps well enough to be worth rendering
NOT_IN_SPARE_TIME = {"tempo_ramp"}  # every one the listener has rated so far they didn't like
USE_OF_STORAGE = 0.8  # the rest is left for what's actually being played


def best_links(
    links: list[LyricLink], songs: list[SongInfo]
) -> tuple[list[LyricLink], dict[int, SongInfo], TimbreSpace | None]:
    """Links between analysed songs, best first, with no phrase repeated."""
    library = {song.id: song for song in songs}
    space = TimbreSpace.fit(songs)
    seen: set[str] = set()
    unique: list[LyricLink] = []
    for link in rank_links(links, library, space):
        if link.phrase not in seen:
            seen.add(link.phrase)
            unique.append(link)
    return unique, library, space


def link_state(
    link: LyricLink, moves: tuple[str, ...], status: Callable[[str], dict[str, Any]]
) -> tuple[str, dict[str, Any]]:
    """The move this link should show, and how far along it is: a finished one that passed if there
    is one, then one in progress, then one not tried yet, then whatever went wrong."""
    states = [
        (move, status(SeamRequest(link.song_a, link.song_b, move, phrase=link.phrase).key))
        for move in moves
    ]
    for move, state in states:
        if state["status"] == "ready" and state.get("passed") and state.get("rating") != "bad":
            return move, state
    for move, state in states:
        if state["status"] in {"queued", "rendering"}:
            return move, state
    for move, state in states:
        if state["status"] == "none":
            return move, state
    return states[0]


def next_to_prepare(
    unique: list[LyricLink],
    library: dict[int, SongInfo],
    space: TimbreSpace | None,
    status: Callable[[str], dict[str, Any]],
    memory: SeamMemory | None = None,
) -> SeamRequest | None:
    """The best link that has no good take yet, trying its next move if the last one fell short."""
    for link in unique[:LINKS_TO_PREPARE]:
        a, b = library[link.song_a], library[link.song_b]
        known = memory or SeamMemory()
        if not (known.can_time_words(a.id) and known.can_time_words(b.id)):
            continue
        moves = tuple(m for m in modes_for(a, b, space) if known.move_factor(a.id, b.id, m) > 0)
        if not moves or not (is_english(a) and is_english(b)):
            continue
        move, state = link_state(link, moves, status)
        if state["status"] == "none":
            return SeamRequest(link.song_a, link.song_b, move, phrase=link.phrase)
    return None


def best_transitions(
    songs: list[SongInfo],
    memory: SeamMemory,
    book: PairBook,
    allowed: set[int] | None = None,
) -> list[tuple[int, int]]:
    """Where each song could best go next, as (from, to), best first. Every song gets its best
    partner before any song gets its second, so the whole library comes along together rather than
    one corner of it. A song's own artist doesn't count, because a mix wouldn't put them together
    anyway, and neither does another version of the same song."""
    usable = sorted(
        (song for song in songs if allowed is None or song.id in allowed),
        key=lambda song: song.bpm,
    )
    tempos = [song.bpm for song in usable]
    names = {song.id: same_song(song) for song in usable}
    artists = {song.id: clean_artist(song.artist).casefold() for song in usable}
    book.sync(usable)
    rounds: list[list[tuple[float, int, int]]] = [[] for _ in range(PARTNERS_PER_SONG)]
    for a in usable:
        nearby = usable[
            bisect_left(tempos, a.bpm * (1 - TEMPO_REACH)) : bisect_right(
                tempos, a.bpm * (1 + TEMPO_REACH)
            )
        ]
        partners = []
        for b in nearby:
            if a.id == b.id or names[a.id] == names[b.id] or artists[a.id] == artists[b.id]:
                continue
            quality = book.quality(a, b)
            if quality < GOOD_ENOUGH:
                continue
            value = (
                quality
                + 0.2 * memory.pair_value(a.id, b.id)
                + 0.1 * (memory.learned_fit(a, b) - 1.0)
                - 0.02 * camelot_distance(a.camelot, b.camelot)
                - 2.0 * abs(a.bpm / b.bpm - 1.0)
            )
            partners.append((value, b.id))
        partners.sort(reverse=True)
        for turn, (value, b_id) in enumerate(partners[:PARTNERS_PER_SONG]):
            rounds[turn].append((value, a.id, b_id))
    return [(a, b) for turn in rounds for _value, a, b in sorted(turn, reverse=True)]


def _worth_making(
    a: int,
    b: int,
    moves: Iterable[str],
    status: Callable[[str], dict[str, Any]],
    memory: SeamMemory,
) -> SeamRequest | None:
    """The next of these to try for a pair, or None if it has a good one or nothing left to try.
    What's come out clean is remembered even after the cache clears its audio, so it's never made
    again in spare time just for having been cleared."""
    for move in moves:
        if (a, b, move) in memory.clean or (a, b, move) in memory.liked:
            return None
        if memory.move_factor(a, b, move) <= 0:
            continue
        request = SeamRequest(a, b, move)
        state = status(request.key)
        if state["status"] == "none":
            return request
        if state["status"] in {"queued", "rendering"}:
            return None
        if state["status"] == "ready" and state.get("passed"):
            return None
    return None


def next_transition(
    pairs: list[tuple[int, int]],
    library: dict[int, SongInfo],
    book: PairBook,
    status: Callable[[str], dict[str, Any]],
    memory: SeamMemory,
    stems: str = "never",
) -> SeamRequest | None:
    """The most useful thing left to make. A quick one for every pair comes first, then vocal rides,
    which the listener likes most but which take minutes each, and more room."""
    known = [(a, b) for a, b in pairs if a in library and b in library]
    for a, b in known:
        moves = [
            name for name, _ in book.moves(library[a], library[b]) if name not in NOT_IN_SPARE_TIME
        ]
        request = _worth_making(a, b, moves, status, memory)
        if request is not None:
            return request
    if stems == "never":
        return None
    for a, b in known:
        moves = [name for name, _ in book.moves(library[a], library[b], stems)]
        if "vocal_ride" in moves:
            request = _worth_making(a, b, ["vocal_ride"], status, memory)
            if request is not None:
                return request
    return None
