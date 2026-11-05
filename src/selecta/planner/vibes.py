"""Mixes that are ready to play, one for each feeling the library can support.

A vibe is a filter over your songs, an energy shape and a family of moves. Each is measured
against your own library: "high energy" means high for your music, not some absolute number, because
the raw scores sit in a narrow band. A vibe with too few songs says so, and comes alive as more are
analysed.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np

from selecta.analysis.song import SongInfo
from selecta.lyrics.lrclib import clean_artist
from selecta.planner.arc import target_energy
from selecta.planner.beam import PlannedSong, plan_set
from selecta.planner.choose import enumerate_candidates
from selecta.planner.wordreel import modes_for, ride_lines
from selecta.styles.wordplay import felt_bpm

MIN_SONGS = 6
DEFAULT_SONGS = 12
WORD_SPACING = 4
"""Outside a wordplay mix, leave this many songs between word hand-offs, so they stay special."""
WORD_MOVES = ("word_blend", "word_exchange", "phrase_roll", "word_cut")
MOVE_WEIGHTS: dict[str, dict[str, float]] = {
    "balanced": {
        "bass_swap_blend": 2.0,
        "filter_sweep": 1.0,
        "tempo_ramp": 0.5,
        "cut_on_one": 1.0,
        "echo_out": 0.7,
        "delay_throw": 0.5,
    },
    "seamless": {"bass_swap_blend": 2.0, "filter_sweep": 1.0, "tempo_ramp": 0.7},
    "punchy": {"cut_on_one": 2.0, "echo_out": 1.0, "delay_throw": 1.0},
    "wordplay": {"bass_swap_blend": 2.0, "filter_sweep": 1.0, "cut_on_one": 1.0},
}


@dataclass(frozen=True)
class Traits:
    """What a vibe can ask about a song, on your library's own scale."""

    energy: float
    felt: float
    year: int | None


@dataclass(frozen=True)
class Vibe:
    key: str
    name: str
    blurb: str
    fits: Callable[[SongInfo, Traits], bool]
    language: str = "balanced"
    arc: str = "slow_burn"
    wordplay: bool = False


def _anything(_: SongInfo, __: Traits) -> bool:
    return True


VIBES: tuple[Vibe, ...] = (
    Vibe(
        "pick",
        "Selecta’s pick",
        "The strongest run it can find through your whole library, with a word hand-off or two.",
        _anything,
    ),
    Vibe(
        "peak",
        "Peak time",
        "Your biggest songs, kept up high.",
        lambda _, t: t.energy >= 0.55 and t.felt >= 95,
        language="seamless",
        arc="peak_time",
    ),
    Vibe(
        "house_party",
        "House party",
        "Dance floor tempos, long blends, nothing lets up.",
        lambda s, t: s.family in {"dance", "pop", "afro"} and 112 <= t.felt <= 135,
        language="seamless",
        arc="peak_time",
    ),
    Vibe(
        "late_night",
        "Late night",
        "Low lights, slower tempos, voices up close.",
        lambda s, t: (
            s.family in {"rnb", "hiphop", "pop", "other"} and t.felt <= 108 and t.energy <= 0.7
        ),
        language="seamless",
    ),
    Vibe(
        "afro_heat",
        "Afro heat",
        "Afrobeats and amapiano, end to end.",
        lambda s, _: s.family == "afro",
        language="seamless",
    ),
    Vibe(
        "rap_run",
        "Rap run",
        "Hip-hop, mostly cut on the one, the way rap gets mixed.",
        lambda s, _: s.family == "hiphop",
        language="punchy",
    ),
    Vibe(
        "rnb_hours",
        "R&B hours",
        "Soul and R&B with vocals that take turns.",
        lambda s, _: s.family == "rnb",
        language="seamless",
    ),
    Vibe(
        "road_trip",
        "Road trip",
        "Guitars and big choruses, windows down.",
        lambda s, t: s.family in {"rock", "pop"} and 90 <= t.felt <= 140,
    ),
    Vibe(
        "throwbacks",
        "Throwbacks",
        "Everything from before 2006.",
        lambda _, t: t.year is not None and t.year < 2006,
    ),
    Vibe(
        "sunday",
        "Sunday morning",
        "Easy, warm, nothing in a hurry.",
        lambda s, t: t.energy <= 0.5 and t.felt <= 125,
        language="seamless",
        arc="wind_down",
    ),
    Vibe(
        "wordplay",
        "Wordplay showcase",
        "Runs through the phrases your songs share, one hand-off after another.",
        _anything,
        language="wordplay",
        wordplay=True,
    ),
    Vibe(
        "slow_burn",
        "Slow burn",
        "Starts low and climbs, with a second peak near the end.",
        _anything,
        language="seamless",
    ),
)
BY_KEY = {vibe.key: vibe for vibe in VIBES}


def traits_of(songs: list[SongInfo], years: dict[int, Any]) -> dict[int, Traits]:
    """Each song's traits, with energy as its rank in this library from 0 to 1."""
    if not songs:
        return {}
    order = np.argsort([song.energy for song in songs])
    ranks = np.empty(len(songs))
    ranks[order] = np.linspace(0.0, 1.0, len(songs))
    traits = {}
    for song, rank in zip(songs, ranks, strict=True):
        text = str(years.get(song.id) or "")[:4]
        traits[song.id] = Traits(float(rank), felt_bpm(song), int(text) if text.isdigit() else None)
    return traits


def eligible(vibe: Vibe, songs: list[SongInfo], traits: dict[int, Traits]) -> list[SongInfo]:
    return [song for song in songs if vibe.fits(song, traits[song.id])]


def describe(vibe: Vibe, songs: list[SongInfo], traits: dict[int, Traits]) -> dict:
    """What a vibe's card shows. Picking artists here keeps cards honest about what's inside."""
    found = eligible(vibe, songs, traits)
    artists: list[str] = []
    for song in sorted(found, key=lambda s: -traits[s.id].energy):
        artist = clean_artist(song.artist)
        if artist not in artists:
            artists.append(artist)
        if len(artists) == 4:
            break
    return {
        "key": vibe.key,
        "name": vibe.name,
        "blurb": vibe.blurb,
        "songs": len(found),
        "ready": len(found) >= MIN_SONGS,
        "needs": max(MIN_SONGS - len(found), 0),
        "artists": artists,
    }


def _opening_song(
    vibe: Vibe, found: list[SongInfo], traits: dict[int, Traits], rng: np.random.Generator
) -> SongInfo:
    """A song near where this vibe's energy shape begins, with somewhere to leave it."""
    start = target_energy(0.0, vibe.arc)
    usable = [song for song in found if song.exit_cues()] or found
    usable.sort(key=lambda song: abs(traits[song.id].energy - start))
    return usable[int(rng.integers(0, min(5, len(usable))))]


def build_vibe(
    vibe: Vibe,
    songs: list[SongInfo],
    traits: dict[int, Traits],
    phrases: dict[tuple[int, int], str],
    count: int = DEFAULT_SONGS,
    start: int | None = None,
    seed: int | None = None,
) -> tuple[list[PlannedSong], dict[int, dict]]:
    """Plan a mix for this vibe, and say how each seam should land."""
    found = eligible(vibe, songs, traits)
    rng = np.random.default_rng(seed)
    first = start if start is not None else _opening_song(vibe, found, traits, rng).id
    planned = plan_set(
        found,
        first,
        count,
        mix_language=vibe.language,
        links=set(phrases) if vibe.wordplay or vibe.key == "pick" else set(),
        arc=vibe.arc,
        seed=int(rng.integers(0, 2**31)),
    )
    return planned, seam_choices(vibe, planned, phrases, rng)


def _moves_that_fit(vibe: Vibe, a: SongInfo, b: SongInfo) -> list[tuple[str, float]]:
    """Moves these two songs can carry, and how much to favour each. The vocal ride is the
    listener's favourite by a long way, so it comes up most, but not every time."""
    options: list[tuple[str, float]] = []
    if vibe.language != "punchy" and "word_blend" in modes_for(a, b) and ride_lines(a, b):
        options.append(("vocal_ride", 5.0))
    allowed = dict(MOVE_WEIGHTS[vibe.language])
    exits, entries = a.exit_cues()[:3], b.entry_cues()[:4]
    for name, weight in allowed.items():
        if enumerate_candidates(a, b, name, exits=exits, entries=entries):
            options.append((name, weight))
    return options


def seam_choices(
    vibe: Vibe,
    planned: list[PlannedSong],
    phrases: dict[tuple[int, int], str],
    rng: np.random.Generator | None = None,
) -> dict[int, dict]:
    """The move into each song, chosen from what fits, so no two mixes run the same way and no move
    comes twice in a row. Word hand-offs go where a real link exists, and stay rare unless the mix
    is all about them. Every choice is soft: if it doesn't pass, the seam uses what does."""
    rng = rng or np.random.default_rng()
    seams: dict[int, dict] = {}
    since_word = WORD_SPACING
    last_move = ""
    for before, item in zip(planned, planned[1:], strict=False):
        since_word += 1
        pair = (before.song.id, item.song.id)
        phrase = phrases.get(pair)
        if phrase and (vibe.wordplay or since_word >= WORD_SPACING):
            move = next(
                (name for name in modes_for(before.song, item.song) if name in WORD_MOVES), None
            )
            if move:
                seams[item.song.id] = {"move": move, "phrase": phrase, "soft": True}
                since_word = 0
                last_move = move
                continue
        options = _moves_that_fit(vibe, before.song, item.song)
        fresh = [option for option in options if option[0] != last_move] or options
        if not fresh:
            continue
        weights = np.array([weight for _, weight in fresh])
        move = fresh[int(rng.choice(len(fresh), p=weights / weights.sum()))][0]
        seams[item.song.id] = {"move": move, "soft": True}
        last_move = move
    return seams
