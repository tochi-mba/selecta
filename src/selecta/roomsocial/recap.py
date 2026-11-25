"""Tonight in numbers: a room's totals, once it has ended (ADR-0488).

Totals only. Nothing here names a guest, shows a nickname or says what one person did, and with
fewer than three guests the "most loved" lines are left out, because a count of one or two is
one or two people's taps. A room nobody joined has no recap at all.

`build` turns plain counts into the stored recap; a figure with nothing behind it is left out,
so every reader shows only lines that are true of this room.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

MIN_GUESTS_FOR_LOVED = 3
MIN_LOVES = 2
TOP_SONGS = 3
SCREEN_SECONDS = 600.0  # how long a paired screen shows the recap after the room ends


def build(
    *,
    name: str,
    started_at: float,
    ended_at: float,
    guests: int,
    songs_played: int,
    requests_asked: int,
    requests_played: int,
    votes: int,
    loved: Sequence[Mapping[str, Any]] = (),
    blend: Mapping[str, Any] | None = None,
    rounds: int = 0,
    landslide: Mapping[str, Any] | None = None,
) -> dict[str, Any] | None:
    """The recap to keep, or None for a room nobody joined.

    `loved` is songs with their love counts, most first; `blend` the most-loved change between
    two songs; `landslide` the vote with the biggest share for its winner."""
    if guests <= 0:
        return None
    recap: dict[str, Any] = {
        "name": name,
        "started_at": started_at,
        "ended_at": ended_at,
        "minutes": max(1, round((ended_at - started_at) / 60.0)),
        "guests": guests,
    }
    for key, value in (
        ("songs_played", songs_played),
        ("requests_asked", requests_asked),
        ("requests_played", requests_played),
        ("votes", votes),
        ("rounds", rounds),
    ):
        if value > 0:
            recap[key] = value
    if guests >= MIN_GUESTS_FOR_LOVED:
        top = [dict(song) for song in loved if int(song.get("loves", 0)) >= MIN_LOVES][:TOP_SONGS]
        if top:
            recap["loved"] = top
        if blend is not None and int(blend.get("loves", 0)) >= MIN_LOVES:
            recap["blend"] = dict(blend)
    if landslide is not None and rounds > 0:
        recap["landslide"] = dict(landslide)
    return recap


def _count(number: int, one: str, many: str) -> str:
    return f"{number} {one if number == 1 else many}"


def _length(minutes: int) -> str:
    hours, rest = divmod(int(minutes), 60)
    if not hours:
        return _count(rest, "minute", "minutes")
    return _count(hours, "hour", "hours") + (f" {rest} min" if rest else "")


def lines(recap: Mapping[str, Any]) -> list[str]:
    """The recap as plain lines, for copying and for a reader that wants words."""
    said = [
        f"{recap['name']}: tonight in numbers",
        f"{_length(recap['minutes'])}, {_count(recap['guests'], 'guest', 'guests')}",
    ]
    if "songs_played" in recap:
        said.append(_count(recap["songs_played"], "song played", "songs played"))
    if "requests_asked" in recap:
        played = recap.get("requests_played", 0)
        said.append(
            f"{_count(recap['requests_asked'], 'request', 'requests')}, {played} in the mix"
        )
    if "votes" in recap:
        said.append(_count(recap["votes"], "vote", "votes"))
    if "rounds" in recap:
        said.append(
            f"The room picked the next song {_count(recap['rounds'], 'time', 'times')}"
        )
    for song in recap.get("loved", []):
        said.append(f"Loved: {song['title']} by {song['artist']} ({song['loves']})")
    blend = recap.get("blend")
    if blend:
        said.append(f"Best blend: {blend['from']} into {blend['to']} ({blend['loves']})")
    return said


__all__ = ["MIN_GUESTS_FOR_LOVED", "MIN_LOVES", "SCREEN_SECONDS", "build", "lines"]
