"""Counting a vote for the next song and choosing its winner (ADR-0488).

A round offers two to four songs. Each guest has one vote. The song with the most votes wins.
A tie is broken the same way on every app instance and for every reader, by a hash of the
round and the song: no clock, no randomness that two readers could disagree on, and no
advantage to the song that happened to be listed first. A round nobody voted in has no winner.

Where a round stands with its winner is read from the request that carries the winner into the
mix, so it is never written twice: waiting for the mix, in the mix, or not placed.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

MIN_OPTIONS = 2
MAX_OPTIONS = 4

OPEN = "open"
CLOSED = "closed"
CANCELLED = "cancelled"
VOID = "void"

WAITING = "waiting"
IN_MIX = "in_mix"
NOT_PLACED = "not_placed"


@dataclass(frozen=True)
class Option:
    position: int
    song_id: int
    votes: int = 0


def clean_options(song_ids: Iterable[object]) -> tuple[int, ...]:
    """The songs to offer: whole numbers, each once, in the order given, four at most.
    Raises `ValueError` when fewer than two are left, because one song is not a vote."""
    kept: list[int] = []
    for item in song_ids:
        if isinstance(item, bool) or not isinstance(item, int):
            continue
        if item not in kept:
            kept.append(item)
    kept = kept[:MAX_OPTIONS]
    if len(kept) < MIN_OPTIONS:
        raise ValueError("A vote needs at least two songs")
    return tuple(kept)


def _tie_break(round_id: str, song_id: int) -> str:
    return hashlib.sha256(f"{round_id}:{song_id}".encode()).hexdigest()


def ranked(round_id: str, options: Sequence[Option]) -> list[Option]:
    """The options from most votes to fewest, ties in an order every reader agrees on."""
    return sorted(options, key=lambda option: (-option.votes, _tie_break(round_id, option.song_id)))


def winner(
    round_id: str, options: Sequence[Option], still_playable: Iterable[int] | None = None
) -> Option | None:
    """The winning option, or None when nobody voted or no voted-for song can still be played.

    `still_playable` is the song ids that can still go into the mix; an option that has dropped
    out (its file gone, the speaker moved) is passed over for the next highest."""
    if sum(option.votes for option in options) <= 0:
        return None
    playable = None if still_playable is None else set(still_playable)
    for option in ranked(round_id, options):
        if option.votes <= 0:
            return None
        if playable is None or option.song_id in playable:
            return option
    return None


def outcome_of(request_status: str | None) -> str | None:
    """Where the winner stands, from the status of the request that carries it."""
    if request_status is None:
        return None
    if request_status in ("sent", "accepted"):
        return WAITING
    if request_status == "played":
        return IN_MIX
    return NOT_PLACED


__all__ = [
    "CANCELLED",
    "CLOSED",
    "IN_MIX",
    "MAX_OPTIONS",
    "MIN_OPTIONS",
    "NOT_PLACED",
    "OPEN",
    "VOID",
    "WAITING",
    "Option",
    "clean_options",
    "outcome_of",
    "ranked",
    "winner",
]
