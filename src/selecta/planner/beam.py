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
from selecta.planner.wordreel import (
    BLEND_MAX_GAP,
    BLEND_MAX_KEY_DISTANCE,
    BLEND_MIN_GRID,
    ride_entry_line,
    ride_exit_line,
)

ARTIST_SEPARATION = 10
"""No artist comes back within this many songs."""
CHECK_PER_STEP = 4
LOOK_PER_STEP = 40
FRESHNESS = 0.03
PLAN_EXITS = 2
PLAN_ENTRIES = 3
LINK_BONUS = 0.5


BELONGING = 0.3
HANDOFF_WEIGHT = 0.45
MIX_FIT_WEIGHT = 0.25
SAME_ARTIST_COST = 0.3
SURE_GRID = 0.9
OFF_MENU_PENALTY = 0.3


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
    arc: str = "slow_burn",
) -> float:
    """How promising a pair looks, from numbers already to hand."""
    low, high = energy_range
    level = (b.energy - low) / max(high - low, 1e-6)
    fit = 1.0 - abs(level - target_energy(progress, arc))
    tempo = max(0.0, 1.0 - folded_gap(a, b) / 0.2)
    key = 1.0 - min(camelot_distance(a.camelot, b.camelot), 4) / 4.0
    distance = space.distance(a, b) if space is not None else None
    timbre = 1.0 - min(distance, 2.0) / 2.0 if distance is not None else 0.5
    score = 0.25 * fit + 0.3 * tempo + 0.2 * key + 0.25 * timbre
    return score + (LINK_BONUS if (a.id, b.id) in linked else 0.0)


class _Riders:
    """Which songs have a line to ride out on or bring a voice in on, worked out once."""

    def __init__(self) -> None:
        self._out: dict[int, bool] = {}
        self._in: dict[int, bool] = {}

    def can_leave(self, song: SongInfo) -> bool:
        if song.id not in self._out:
            self._out[song.id] = ride_exit_line(song) is not None
        return self._out[song.id]

    def can_enter(self, song: SongInfo) -> bool:
        if song.id not in self._in:
            self._in[song.id] = ride_entry_line(song) is not None
        return self._in[song.id]


def can_ride(a: SongInfo, b: SongInfo, riders: _Riders) -> bool:
    return (
        a.beats_per_bar == b.beats_per_bar
        and min(a.grid_confidence, b.grid_confidence) >= BLEND_MIN_GRID
        and abs(a.bpm / b.bpm - 1.0) <= BLEND_MAX_GAP
        and camelot_distance(a.camelot, b.camelot) <= BLEND_MAX_KEY_DISTANCE
        and riders.can_leave(a)
        and riders.can_enter(b)
    )


def handoff_quality(a: SongInfo, b: SongInfo, riders: _Riders) -> float:
    """How good the best move between two songs should sound, going by what the listener rated.
    Vocal rides were the favourite, blends good, and effects and cuts mostly disliked, and those are
    all a person gets when a mix picks songs that can't carry anything better. A shaky beat grid is
    what most often puts beats out of line, so it counts against any move that matches beats."""
    grid = min(a.grid_confidence, b.grid_confidence)
    if a.beats_per_bar != b.beats_per_bar or grid < BLEND_MIN_GRID:
        return 0.1
    sure = 0.75 + 0.25 * min((grid - BLEND_MIN_GRID) / (SURE_GRID - BLEND_MIN_GRID), 1.0)
    gap = abs(a.bpm / b.bpm - 1.0)
    keys = camelot_distance(a.camelot, b.camelot)
    if can_ride(a, b, riders):
        return sure
    if gap <= 0.05:
        return (0.75 if keys <= 3 else 0.55) * sure
    if gap <= BLEND_MAX_GAP:
        return 0.55 * sure
    return 0.3 * sure if gap <= 0.3 else 0.1


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
    arc: str = "slow_burn",
    seed: int | None = None,
    steady: float = 0.35,
    belongs: dict[int, float] | None = None,
    end_id: int | None = None,
) -> list[PlannedSong]:
    """A set of up to `count` songs from `songs`, starting at `start_id`, following the energy
    shape `arc`. `links` holds pairs that share a phrase, which get a head start. With a `seed`,
    close calls can go either way, so two builds of the same mix don't come out the same. `steady`
    is how strongly to prefer pairs that can carry a real move, and `belongs` says which songs
    suit this mix most, from 0 to 1."""
    rng = None if seed is None else np.random.default_rng(seed)
    if not songs:
        return []
    links = links or set()
    first = next((song for song in songs if song.id == start_id), songs[0])
    destination = next((song for song in songs if song.id == end_id), None)
    if end_id is not None and destination is None:
        raise ValueError(f"destination song {end_id} is not in the planning library")
    if destination is not None and count == 1:
        if start_id is not None and start_id != destination.id:
            raise ValueError("a one-song mix cannot start and finish on different songs")
        first = destination
    elif destination is not None and first.id == destination.id:
        if start_id is not None:
            raise ValueError("the start song and destination are the same")
        opening_options = [song for song in songs if song.id != destination.id]
        if not opening_options:
            raise ValueError("a destination mix needs at least two songs")
        first = opening_options[0]
    allowed = styles_for_language(mix_language, stems)
    space = TimbreSpace.fit(songs)
    energies = np.array([song.energy for song in songs])
    energy_range = (float(energies.min()), float(energies.max()))
    cues = _Cues()
    riders = _Riders()
    belongs = belongs or {}
    # a mix from a few artists can't keep them ten songs apart, and shouldn't stop short for it
    separation = min(ARTIST_SEPARATION, max(len({_artist(song) for song in songs}) // 2, 1))
    beams: list[tuple[float, list[PlannedSong]]] = [
        (0.0, [PlannedSong(first, None, "You started here")])
    ]
    for step in range(1, min(count, len(songs))):
        progress = step / max(count - 1, 1)
        expanded: list[tuple[float, list[PlannedSong]]] = []
        for total, path in beams:
            current = path[-1].song
            used = {item.song.id for item in path}
            recent = {_artist(item.song) for item in path[-separation:]}
            is_destination_step = end_id is not None and step == min(count, len(songs)) - 1
            options = [
                (
                    _quick_score(current, song, progress, energy_range, space, links, arc)
                    + steady * handoff_quality(current, song, riders)
                    + BELONGING * belongs.get(song.id, 0.0),
                    song,
                )
                for song in songs
                if song.id not in used and _artist(song) not in recent
                and (end_id is None or song.id != end_id or is_destination_step)
                and (not is_destination_step or song.id == end_id)
            ]
            if is_destination_step and destination is not None and destination.id not in used:
                # A requested destination is allowed to override the usual artist-spacing rule.
                # The listener explicitly asked to reach this song; the route still scores its
                # handoff and searches alternative bridges earlier in the beam.
                options = [
                    (score, song)
                    for score, song in options
                    if song.id != destination.id
                ]
                target_score = (
                    _quick_score(current, destination, progress, energy_range, space, links, arc)
                    + steady * handoff_quality(current, destination, riders)
                    + BELONGING * belongs.get(destination.id, 0.0)
                )
                options.append((target_score, destination))
            if rng is not None:
                options = [
                    (score + float(rng.normal(0.0, FRESHNESS)), song) for score, song in options
                ]
            options.sort(key=lambda item: -item[0])
            kept = 0
            for looked, (score, song) in enumerate(options):
                if kept == CHECK_PER_STEP or (kept and looked >= LOOK_PER_STEP):
                    break
                move = _best_move(current, song, allowed, cues)
                if move is None:
                    # this mix's favourite moves don't fit here, which beats stopping the mix short
                    move = _best_move(current, song, None, cues)
                    score -= OFF_MENU_PENALTY
                if move is None:
                    continue
                kept += 1
                reason = (
                    "your requested destination"
                    if song.id == end_id
                    else (
                        "shares a phrase"
                        if (current.id, song.id) in links
                        else move.recipe.name.replace("_", " ")
                    )
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
    after: SongInfo | None = None,
    belongs: dict[int, float] | None = None,
) -> SongInfo | None:
    """The best song to follow this one, for one tap of "bigger", "calmer" or "something else".

    `direction` is 1 for more energy, -1 for less, 0 for no preference. `avoid` is the song being
    replaced, whose energy sets what "bigger" and "calmer" are measured against. `after` is the song
    it has to hand over to, and `belongs` says which songs suit the mix.
    """
    space = TimbreSpace.fit(songs)
    energies = np.array([song.energy for song in songs])
    energy_range = (float(energies.min()), float(energies.max()))
    baseline = next((song.energy for song in songs if song.id == avoid), current.energy)
    riders = _Riders()
    belongs = belongs or {}
    options = []
    for song in songs:
        if song.id in exclude or song.id == current.id or _artist(song) in avoid_artists:
            continue
        if direction and (song.energy - baseline) * direction <= 0:
            continue
        score = _quick_score(current, song, 0.5, energy_range, space, set())
        score += HANDOFF_WEIGHT * handoff_quality(current, song, riders)
        if after is not None:
            score += HANDOFF_WEIGHT * handoff_quality(song, after, riders)
        options.append((score + BELONGING * belongs.get(song.id, 0.0), song))
    options.sort(key=lambda item: -item[0])
    cues = _Cues()
    for _, song in options[: CHECK_PER_STEP * 4]:
        if _best_move(current, song, None, cues) is not None:
            return song
    return None


@dataclass(frozen=True)
class Suggestion:
    song: SongInfo
    score: float
    reason: str


def _why_it_fits(
    a: SongInfo, b: SongInfo, space: TimbreSpace | None, shares: str | None, riders: _Riders
) -> str:
    """What a person will hear if they pick this, in words they can check by ear. Never a score."""
    if shares:
        return f"Shares “{shares}”"
    if can_ride(a, b, riders):
        return "A voice can ride across"
    gap = abs(a.bpm / b.bpm - 1.0)
    if gap > 0.3:
        return "A big tempo jump, so an echo"
    if gap > BLEND_MAX_GAP:
        return "A tempo ramp gets there"
    parts = ["Same tempo" if gap <= 0.02 else "Close tempo"]
    distance = camelot_distance(a.camelot, b.camelot)
    if distance == 0:
        parts.append("same key")
    elif distance == 1:
        parts.append("matching key")
    timbre = space.distance(a, b) if space is not None else None
    if timbre is not None and timbre < 0.8:
        parts.append("similar sound")
    return ", ".join(parts)


def _suits_the_mix(song: SongInfo, around: list[SongInfo], energy_range: tuple) -> float:
    """How well a song sits with the rest of the mix it would join, 0 to 1."""
    if not around:
        return 0.0
    low, high = energy_range
    level = abs(song.energy - float(np.mean([item.energy for item in around])))
    energy = 1.0 - min(level / max(high - low, 1e-6), 1.0)
    bpm = float(np.median([item.bpm for item in around]))
    tempo = max(0.0, 1.0 - abs(song.bpm / bpm - 1.0) / 0.25)
    family = sum(item.family == song.family for item in around) / len(around)
    return (energy + tempo + family) / 3.0


def rank_candidates(
    before: SongInfo | None,
    after: SongInfo | None,
    songs: list[SongInfo],
    exclude: set[int],
    shares: dict[tuple[int, int], str] | None = None,
    around: list[SongInfo] | None = None,
    belongs: dict[int, float] | None = None,
    nearby_artists: set[str] | None = None,
) -> list[Suggestion]:
    """Every song, best first, for a place in a mix between `before` and `after`. The best song can
    hand over well on both sides and suits the mix it's joining, so it's judged the way a mix is
    built. `around` is the rest of the mix, `belongs` says which songs suit it, and `nearby_artists`
    are the artists just either side."""
    shares = shares or {}
    around = around or []
    belongs = belongs or {}
    nearby_artists = nearby_artists or set()
    space = TimbreSpace.fit(songs)
    energies = np.array([song.energy for song in songs]) if songs else np.zeros(1)
    energy_range = (float(energies.min()), float(energies.max()))
    riders = _Riders()
    ranked: list[Suggestion] = []
    links = set(shares)
    for song in songs:
        if song.id in exclude:
            continue
        scores = []
        if before is not None:
            scores.append(
                _quick_score(before, song, 0.5, energy_range, space, links)
                + HANDOFF_WEIGHT * handoff_quality(before, song, riders)
            )
        if after is not None:
            scores.append(
                _quick_score(song, after, 0.5, energy_range, space, links)
                + HANDOFF_WEIGHT * handoff_quality(song, after, riders)
            )
        score = float(np.mean(scores)) if scores else 0.0
        score += BELONGING * belongs.get(song.id, 0.0)
        score += MIX_FIT_WEIGHT * _suits_the_mix(song, around, energy_range)
        reference = before or after
        if reference is not None and _artist(reference) == _artist(song):
            score -= SAME_ARTIST_COST
        if _artist(song) in nearby_artists:
            score -= SAME_ARTIST_COST
        phrase = shares.get((before.id, song.id)) if before is not None else None
        if before is not None:
            reason = _why_it_fits(before, song, space, phrase, riders)
        elif after is not None:
            reason = _why_it_fits(song, after, space, None, riders)
        else:
            reason = ""
        ranked.append(Suggestion(song, score, reason))
    ranked.sort(key=lambda item: -item.score)
    return ranked
