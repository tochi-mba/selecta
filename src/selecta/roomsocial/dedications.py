"""The fixed list of dedication lines (ADR-0488).

A guest attaches one of these to their own request by its id. The words live here and nowhere
else, so nothing a guest types is ever shown to another guest, and a room with dedications
switched off carries none of these words.

Every line is one nobody could aim at a stranger: each speaks to the whole room, to the guest's
own friends, or to the host or staff. A host can hide any of them (no "One for the road" at a
children's party).
"""

from __future__ import annotations

from collections.abc import Collection, Iterable
from dataclasses import dataclass

PARTY = "party"
VENUE = "venue"
MAX_ID_LENGTH = 24  # the column that stores a line's id


@dataclass(frozen=True)
class Line:
    id: str
    words: str
    rooms: frozenset[str] = frozenset({PARTY, VENUE})


LINES: tuple[Line, ...] = (
    Line("birthday", "Happy birthday!"),
    Line("anniversary", "Happy anniversary!"),
    Line("congrats", "Congratulations!"),
    Line("host", "For the host", frozenset({PARTY})),
    Line("staff", "For the bar staff", frozenset({VENUE})),
    Line("friends", "For my friends"),
    Line("cheers", "Cheers, everyone"),
    Line("everybody_up", "Everybody up!"),
    Line("throwback", "A throwback"),
    Line("road", "One for the road"),
    Line("safe_travels", "Safe travels"),
)
_BY_ID = {line.id: line for line in LINES}


def lines_for(kind: str, hidden: Collection[str] = ()) -> tuple[Line, ...]:
    """The lines a guest may pick in this kind of room, without the ones the host hid."""
    return tuple(line for line in LINES if kind in line.rooms and line.id not in hidden)


def words_of(line_id: str | None) -> str | None:
    """The words for a stored id; None for an id this list no longer has."""
    line = _BY_ID.get(line_id or "")
    return None if line is None else line.words


def allowed(line_id: str, kind: str, hidden: Collection[str] = ()) -> bool:
    return any(line.id == line_id for line in lines_for(kind, hidden))


def known_ids(ids: Iterable[object]) -> tuple[str, ...]:
    """The ids from a submitted list that name a line, once each, in list order."""
    kept: list[str] = []
    for item in ids:
        if isinstance(item, str) and item in _BY_ID and item not in kept:
            kept.append(item)
    return tuple(kept)


__all__ = [
    "LINES",
    "MAX_ID_LENGTH",
    "PARTY",
    "VENUE",
    "Line",
    "allowed",
    "known_ids",
    "lines_for",
    "words_of",
]
