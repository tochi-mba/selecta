"""Choose an order of songs, looking a few steps ahead.

Every pair gets a cheap score first, from numbers already known. Only the few best are checked for a
real transition, which keeps planning fast enough to run while someone waits.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from selecta.analysis.key import camelot_distance
from selecta.analysis.song import SongInfo
from selecta.lyrics.lrclib import clean_artist
from selecta.planner.arc import target_energy
from selecta.planner.choose import enumerate_candidates, styles_for_language
from selecta.planner.fit import TimbreSpace, folded_gap

ARTIST_SEPARATION = 10
"""No artist comes back within this many songs."""
CHECK_PER_STEP = 4
LOOK_PER_STEP = 40
PLAN_EXITS = 3
PLAN_ENTRIES = 4
LINK_BONUS = 0.25


@dataclass(frozen=True)
class PlannedSong:
    song: SongInfo
    transition: str | None
    reason: str


def _artist(song: SongInfo) -> str:
    return clean_artist(song.artist).casefold()


def _quick_score(
    a: SongInfo,
    b: SongInfo,
    progress: float,
    energy_range: tuple[float, float],
    space: TimbreSpace | None,
    linked: set[tuple[int, int]],
) -> float:
    """How promising a pair looks, from numbers already to hand."""
    low, high = energy_range
    level = (b.energy - low) / max(high - low, 1e-6)
    arc = 1.0 - abs(level - target_energy(progress))
    tempo = max(0.0, 1.0 - folded_gap(a, b) / 0.2)
    key = 1.0 - min(camelot_distance(a.camelot, b.camelot), 4) / 4.0
    distance = space.distance(a, b) if space is not None else None
    timbre = 1.0 - min(distance, 2.0) / 2.0 if distance is not None else 0.5
    score = 0.25 * arc + 0.3 * tempo + 0.2 * key + 0.25 * timbre
    return score + (LINK_BONUS if (a.id, b.id) in linked else 0.0)


class _Cues:
    """Each song's best few cues, worked out once."""

    def __init__(self) -> None:
        self._exits: dict[int, list] = {}
        self._entries: dict[int, list] = {}

    def exits(self, song: SongInfo) -> list:
        if song.id not in self._exits:
            self._exits[song.id] = song.exit_cues()[:PLAN_EXITS]
        return self._exits[song.id]

    def entries(self, song: SongInfo) -> list:
        if song.id not in self._entries:
            self._entries[song.id] = song.entry_cues()[:PLAN_ENTRIES]
        return self._entries[song.id]


def _best_move(a: SongInfo, b: SongInfo, allowed: set[str] | None, cues: _Cues):
    candidates = enumerate_candidates(a, b, exits=cues.exits(a), entries=cues.entries(b))
    if allowed is not None:
        candidates = [candidate for candidate in candidates if candidate.recipe.name in allowed]
    return candidates[0] if candidates else None


def plan_set(
    songs: list[SongInfo],
    start_id: int | None = None,
    count: int = 20,
    width: int = 3,
    mix_language: str = "balanced",
    stems: str = "sometimes",
    links: set[tuple[int, int]] | None = None,
) -> list[PlannedSong]:
    """A set of up to `count` songs from `songs`, starting at `start_id`. `links` holds pairs that
    share a phrase, which get a head start when the person wants wordplay."""
    if not songs:
        return []
    links = links or set()
    first = next((song for song in songs if song.id == start_id), songs[0])
    allowed = styles_for_language(mix_language, stems)
    space = TimbreSpace.fit(songs)
    energies = np.array([song.energy for song in songs])
    energy_range = (float(energies.min()), float(energies.max()))
    cues = _Cues()
    beams: list[tuple[float, list[PlannedSong]]] = [
        (0.0, [PlannedSong(first, None, "You started here")])
    ]
    for step in range(1, min(count, len(songs))):
        progress = step / max(count - 1, 1)
        expanded: list[tuple[float, list[PlannedSong]]] = []
        for total, path in beams:
            current = path[-1].song
            used = {item.song.id for item in path}
            recent = {_artist(item.song) for item in path[-ARTIST_SEPARATION:]}
            options = [
                (_quick_score(current, song, progress, energy_range, space, links), song)
                for song in songs
                if song.id not in used and _artist(song) not in recent
            ]
            options.sort(key=lambda item: -item[0])
            kept = 0
            for score, song in options[:LOOK_PER_STEP]:
                if kept == CHECK_PER_STEP:
                    break
                move = _best_move(current, song, allowed, cues)
                if move is None:
                    continue
                kept += 1
                reason = (
                    "shares a phrase"
                    if (current.id, song.id) in links
                    else move.recipe.name.replace("_", " ")
                )
                expanded.append(
                    (
                        total + score + 0.2 * move.score,
                        [*path, PlannedSong(song, move.recipe.name, reason)],
                    )
                )
        if not expanded:
            break
        expanded.sort(key=lambda item: -item[0])
        beams = expanded[:width]
    return beams[0][1]


def suggest_next(
    current: SongInfo,
    songs: list[SongInfo],
    exclude: set[int],
    avoid_artists: set[str],
    direction: int = 0,
    avoid: int | None = None,
) -> SongInfo | None:
    """The best song to follow this one, for one tap of "bigger", "calmer" or "something else".

    `direction` is 1 for more energy, -1 for less, 0 for no preference. `avoid` is the song being
    replaced, whose energy sets what "bigger" and "calmer" are measured against.
    """
    space = TimbreSpace.fit(songs)
    energies = np.array([song.energy for song in songs])
    energy_range = (float(energies.min()), float(energies.max()))
    baseline = next((song.energy for song in songs if song.id == avoid), current.energy)
    options = []
    for song in songs:
        if song.id in exclude or song.id == current.id or _artist(song) in avoid_artists:
            continue
        if direction and (song.energy - baseline) * direction <= 0:
            continue
        options.append((_quick_score(current, song, 0.5, energy_range, space, set()), song))
    options.sort(key=lambda item: -item[0])
    cues = _Cues()
    for _, song in options[: CHECK_PER_STEP * 4]:
        if _best_move(current, song, None, cues) is not None:
            return song
    return None
