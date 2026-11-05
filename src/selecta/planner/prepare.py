"""Which word links are worth offering, and which to prepare next in spare time."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from selecta.analysis.song import SongInfo
from selecta.lyrics.match import LyricLink
from selecta.planner.fit import TimbreSpace
from selecta.planner.wordreel import modes_for, rank_links
from selecta.seams import SeamRequest

LINKS_TO_PREPARE = 30


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
) -> SeamRequest | None:
    """The best link that has no good take yet, trying its next move if the last one fell short."""
    for link in unique[:LINKS_TO_PREPARE]:
        moves = modes_for(library[link.song_a], library[link.song_b], space)
        if not moves:
            continue
        move, state = link_state(link, moves, status)
        if state["status"] == "none":
            return SeamRequest(link.song_a, link.song_b, move, phrase=link.phrase)
    return None
