"""Mixes that are ready to play, one for each feeling the library can support.

A mix is built around why someone would press it: a moment, a mood, a sound or a journey. Each one
says which songs belong and which belong most, what shape its energy takes, how far the tempo may
wander from song to song, and how its songs should hand over. Everything is measured against your
own library, because "high energy" or "a sad song" only means something next to your other songs.

Mixes favour pairs that can carry a real move, and a move is only planned if the songs can do it
and it hasn't already failed on them. The planner is judged by what a person hears, not by what it
hoped to render.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

import numpy as np

from selecta.analysis.song import SongInfo
from selecta.lyrics.lrclib import clean_artist
from selecta.planner.arc import target_energy
from selecta.planner.beam import PlannedSong, plan_set
from selecta.planner.choose import enumerate_candidates
from selecta.planner.moods import THEMES, is_english, is_seasonal, read_lyrics
from selecta.planner.wordreel import Verdicts, modes_for, ride_lines
from selecta.render.intertwine import can_intertwine
from selecta.styles.wordplay import felt_bpm

MIN_SONGS = 6
DEFAULT_SONGS = 12
WORD_SPACING = 4
"""Outside a wordplay mix, leave this many songs between word hand-offs, so they stay special."""
WORD_MOVES = ("word_blend", "word_exchange", "phrase_roll", "word_cut")
PLAYED_SHARE = 0.65
"""A mix plays about two thirds of each song, which is what a card's length is worked out from."""

# Weights follow the listening reels: rides and filter sweeps were loved, blends mostly liked, ramps
# mixed, effects mostly not. They say what to reach for first, and MAX_SHARE stops any one of them
# taking over, however well it scores, so a mix never settles into one trick.
MOVE_WEIGHTS: dict[str, dict[str, float]] = {
    "balanced": {
        "bass_swap_blend": 2.5,
        "filter_sweep": 2.0,
        "tempo_ramp": 0.7,
        "delay_throw": 0.5,
        "echo_out": 0.4,
    },
    "seamless": {"bass_swap_blend": 2.5, "filter_sweep": 2.0, "tempo_ramp": 0.8},
    "punchy": {"cut_on_one": 1.0, "echo_out": 1.0, "delay_throw": 1.0, "bass_swap_blend": 1.0},
    "wordplay": {"bass_swap_blend": 2.0, "filter_sweep": 1.5, "tempo_ramp": 0.5},
}
RIDE_WEIGHT = {"balanced": 3.0, "seamless": 3.0, "wordplay": 1.5, "punchy": 1.5}
MAX_SHARE = {
    "vocal_ride": 0.35,
    "stem_intertwine": 0.3,
    "bass_swap_blend": 0.4,
    "filter_sweep": 0.3,
    "tempo_ramp": 0.25,
    "cut_on_one": 0.3,
    "echo_out": 0.25,
    "delay_throw": 0.25,
}
"""The most of a mix's seams any one move should take."""
FAMILIES = {
    "bass_swap_blend": "blend",
    "filter_sweep": "blend",
    "tempo_ramp": "blend",
    "delay_throw": "effect",
    "echo_out": "effect",
    "cut_on_one": "effect",
    "vocal_ride": "voice",
    "stem_intertwine": "blend",
}
OVER_SHARE = 0.05
WARNED_BEFORE = 0.25
WARNING_COST = 0.15
"""Songs behind past warnings get picked a little less, up to three warnings' worth."""
RECENT_PENALTY = 0.45
SAME_FAMILY_PENALTY = 0.35
MOVE_WORDS = {
    "balanced": "Vocal rides and blends, with the odd echo",
    "seamless": "Vocal rides and long blends",
    "punchy": "Echoes, throws and hard landings",
    "wordplay": "Word hand-offs wherever they hold up",
}


@dataclass(frozen=True)
class Traits:
    """What a mix can ask about a song, on your library's own scale of 0 to 1."""

    energy: float
    felt: float
    year: int | None
    minor: bool = False
    hook: float = 0.0
    wordy: float = 0.0
    english: bool = False
    seasonal: bool = False
    themes: dict[str, float] = field(default_factory=dict)

    def about(self, theme: str) -> float:
        return self.themes.get(theme, 0.0)


def _anything(_: SongInfo, __: Traits) -> bool:
    return True


def _energetic(_: SongInfo, t: Traits) -> float:
    return t.energy


@dataclass(frozen=True)
class Vibe:
    key: str
    name: str
    blurb: str
    fits: Callable[[SongInfo, Traits], bool]
    group: str = ""
    belongs: Callable[[SongInfo, Traits], float] = _energetic
    """Among the songs that fit, which belong most. These lead, and they're who the card names."""
    language: str = "balanced"
    arc: str = "slow_burn"
    wordplay: bool = False
    seasonal: bool = False
    steady: float = 0.35
    """How strongly to stick to pairs that can carry a real move, rather than the best next song."""


MOMENT = "The moment"
MOOD = "The mood"
SOUND = "The sound"
JOURNEY = "The journey"
GROUPS = (MOMENT, MOOD, SOUND, JOURNEY)

VIBES: tuple[Vibe, ...] = (
    Vibe(
        "pick",
        "Selecta’s pick",
        "The strongest run it can find through your whole library, with a word hand-off or two.",
        _anything,
    ),
    # ---- the moment: why you've put music on
    Vibe(
        "getting_ready",
        "Getting ready",
        "For the mirror. Confident songs that climb towards going out.",
        lambda s, t: (
            s.family in {"pop", "rnb", "hiphop", "afro", "dance", "latin"}
            and 0.35 <= t.energy <= 0.9
            and 92 <= t.felt <= 128
            and (t.about("party") >= 0.5 or t.about("flex") >= 0.6 or t.hook >= 0.6)
        ),
        group=MOMENT,
        belongs=lambda _, t: max(t.about("party"), t.about("flex")) + 0.3 * t.hook,
        arc="climb",
    ),
    Vibe(
        "house_party",
        "House party",
        "Songs people know at dance floor tempos, with long blends, and nothing lets up.",
        lambda s, t: (
            s.family in {"dance", "pop", "afro", "latin", "rnb"}
            and 112 <= t.felt <= 135
            and t.energy >= 0.3
        ),
        group=MOMENT,
        belongs=lambda _, t: t.about("party") + 0.5 * t.hook + 0.3 * t.energy,
        language="seamless",
        arc="peak_time",
        steady=0.5,
    ),
    Vibe(
        "peak",
        "Peak time",
        "Your biggest songs, kept up high and locked to a tempo.",
        lambda _, t: t.energy >= 0.6 and 100 <= t.felt <= 145,
        group=MOMENT,
        language="seamless",
        arc="peak_time",
        steady=0.5,
    ),
    Vibe(
        "workout",
        "Workout",
        "Hard and steady, with no dips, so you can hold your pace.",
        lambda _, t: t.energy >= 0.55 and 118 <= t.felt <= 150,
        group=MOMENT,
        language="seamless",
        arc="steady",
        steady=0.6,
    ),
    Vibe(
        "road_trip",
        "Road trip",
        "Big choruses you can shout along to, windows down.",
        lambda s, t: (
            s.family in {"rock", "pop", "other", "rnb"}
            and 88 <= t.felt <= 140
            and (t.hook >= 0.5 or t.about("open_road") >= 0.7)
        ),
        group=MOMENT,
        belongs=lambda _, t: t.hook + 0.6 * t.about("open_road") + (0.2 if not t.minor else 0.0),
    ),
    # ---- the mood: how you're feeling
    Vibe(
        "feelings",
        "In your feelings",
        "Songs about the one who left. Slow and close, with no rush.",
        lambda _, t: (
            t.about("heartbreak") >= 0.65
            and t.felt <= 125
            and t.energy <= 0.75
            and t.about("party") < 0.75
        ),
        group=MOOD,
        belongs=lambda _, t: t.about("heartbreak") + (0.2 if t.minor else 0.0),
        language="seamless",
        arc="wind_down",
        steady=0.5,
    ),
    Vibe(
        "in_love",
        "Falling for you",
        "Love songs, warm and bright, that mean every word.",
        lambda s, t: (
            t.about("love") >= 0.65
            and t.felt <= 128
            and t.about("heartbreak") < 0.7
            and t.about("flex") < 0.7
            and s.family != "hiphop"
        ),
        group=MOOD,
        belongs=lambda _, t: t.about("love") + (0.2 if not t.minor else 0.0),
        language="seamless",
        steady=0.5,
    ),
    Vibe(
        "late_night",
        "Late night",
        "Low lights, slower tempos, voices up close.",
        lambda s, t: (
            s.family in {"rnb", "hiphop", "pop", "other", "afro"}
            and t.felt <= 108
            and t.energy <= 0.65
        ),
        group=MOOD,
        belongs=lambda _, t: t.about("night") + 0.5 * (1.0 - t.energy),
        language="seamless",
        steady=0.5,
    ),
    Vibe(
        "sunday",
        "Sunday morning",
        "Easy and warm, in major keys, with nothing in a hurry.",
        lambda s, t: (
            t.energy <= 0.45
            and t.felt <= 125
            and t.about("flex") < 0.7
            and s.family not in {"hiphop", "dance"}
        ),
        group=MOOD,
        belongs=lambda _, t: (1.0 - t.energy) + (0.5 if not t.minor else 0.0),
        language="seamless",
        arc="wind_down",
        steady=0.5,
    ),
    # ---- the sound: what you want to hear
    Vibe(
        "afro_heat",
        "Afro heat",
        "Afrobeats and amapiano, end to end, with voices riding each other’s drums.",
        lambda s, _: s.family == "afro",
        group=SOUND,
        language="seamless",
        steady=0.5,
    ),
    Vibe(
        "rap_run",
        "Rap run",
        "Hip-hop mixed the way rap gets mixed, landing hard on the one.",
        lambda s, t: s.family == "hiphop" or (t.wordy >= 0.9 and t.english),
        group=SOUND,
        belongs=lambda _, t: t.wordy + 0.5 * t.about("flex"),
        language="punchy",
    ),
    Vibe(
        "rnb_hours",
        "R&B hours",
        "Soul and R&B, with vocals that take turns.",
        lambda s, _: s.family == "rnb",
        group=SOUND,
        belongs=lambda _, t: t.about("love") + 0.3 * (1.0 - t.energy),
        language="seamless",
        steady=0.5,
    ),
    Vibe(
        "throwbacks",
        "Throwbacks",
        "Everything from before 2010, oldest on your shelf included.",
        lambda _, t: t.year is not None and t.year < 2010,
        group=SOUND,
        belongs=lambda _, t: t.hook + 0.3 * t.energy,
    ),
    Vibe(
        "christmas",
        "Christmas",
        "Only the Christmas songs, kept out of every other mix.",
        lambda _, t: t.seasonal,
        group=SOUND,
        belongs=lambda _, t: t.hook + 0.3 * t.energy,
        seasonal=True,
    ),
    # ---- the journey: where it goes
    Vibe(
        "slow_burn",
        "Slow burn",
        "Starts low and climbs, with a second peak near the end.",
        _anything,
        group=JOURNEY,
        language="seamless",
        steady=0.5,
    ),
    Vibe(
        "wordplay",
        "Wordplay showcase",
        "Runs through the phrases your songs share, one hand-off after another.",
        _anything,
        group=JOURNEY,
        language="wordplay",
        wordplay=True,
    ),
)
BY_KEY = {vibe.key: vibe for vibe in VIBES}


def _ranks(values: list[float]) -> np.ndarray:
    """Each value's place among the rest, from 0 to 1. Ties share the lowest place, so a song with
    none of a thing doesn't rank above other songs with none of it."""
    array = np.array(values)
    if array.size < 2:
        return np.zeros(array.size)
    return np.searchsorted(np.sort(array), array, side="left") / (array.size - 1)


def traits_of(songs: list[SongInfo], years: dict[int, Any]) -> dict[int, Traits]:
    """Each song's traits, measured against the rest of this library."""
    if not songs:
        return {}
    facts = [read_lyrics(song) for song in songs]
    energy = np.argsort(np.argsort([song.energy for song in songs])) / max(len(songs) - 1, 1)
    hook = _ranks([fact.hook for fact in facts])
    wordy = _ranks([fact.density for fact in facts])
    theme = {name: _ranks([fact.themes.get(name, 0.0) for fact in facts]) for name in THEMES}
    traits = {}
    for i, (song, fact) in enumerate(zip(songs, facts, strict=True)):
        text = str(years.get(song.id) or "")[:4]
        traits[song.id] = Traits(
            energy=float(energy[i]),
            felt=felt_bpm(song),
            year=int(text) if text.isdigit() else None,
            minor=(song.camelot or "").endswith("A"),
            hook=float(hook[i]),
            wordy=float(wordy[i]),
            english=fact.english,
            seasonal=is_seasonal(song),
            themes={name: float(theme[name][i]) for name in THEMES},
        )
    return traits


def eligible(vibe: Vibe, songs: list[SongInfo], traits: dict[int, Traits]) -> list[SongInfo]:
    return [
        song
        for song in songs
        if vibe.fits(song, traits[song.id]) and (vibe.seasonal or not traits[song.id].seasonal)
    ]


def belonging(name: str, songs: list[SongInfo], traits: dict[int, Traits]) -> dict[int, float]:
    """How much each song suits the mix of this name, 0 to 1, for choosing what to add to it. Songs
    that fit start at a half. A mix someone made themselves has no such opinion."""
    vibe = next((item for item in VIBES if item.name == name), None)
    if vibe is None:
        return {}
    values = {
        song.id: vibe.belongs(song, traits[song.id]) for song in eligible(vibe, songs, traits)
    }
    top = max(values.values(), default=1.0) or 1.0
    return {song: 0.5 + 0.5 * max(value / top, 0.0) for song, value in values.items()}


def describe(vibe: Vibe, songs: list[SongInfo], traits: dict[int, Traits]) -> dict:
    """What a mix's card shows. Everything on it is read from the songs that would really play."""
    found = eligible(vibe, songs, traits)
    artists: list[str] = []
    for song in sorted(found, key=lambda s: -vibe.belongs(s, traits[s.id])):
        artist = clean_artist(song.artist)
        if artist not in artists:
            artists.append(artist)
        if len(artists) == 4:
            break
    felt = [traits[song.id].felt for song in found]
    return {
        "key": vibe.key,
        "name": vibe.name,
        "blurb": vibe.blurb,
        "group": vibe.group,
        "songs": len(found),
        "ready": len(found) >= MIN_SONGS,
        "needs": max(MIN_SONGS - len(found), 0),
        "artists": artists,
        "tempo": [round(float(np.percentile(felt, p))) for p in (10, 90)] if felt else None,
        "moves": MOVE_WORDS[vibe.language],
        "seconds": sum(song.duration for song in found) * PLAYED_SHARE,
    }


def _opening_song(
    vibe: Vibe,
    found: list[SongInfo],
    traits: dict[int, Traits],
    rng: np.random.Generator,
    energy_arc: Sequence[float] | None = None,
) -> SongInfo:
    """A song near where this mix's energy shape begins, with somewhere to leave it."""
    start = target_energy(0.0, vibe.arc, energy_arc)
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
    verdicts: Verdicts | None = None,
    mix_language: str | None = None,
    end_id: int | None = None,
    stems: str = "sometimes",
    energy_arc: Sequence[float] | None = None,
) -> tuple[list[PlannedSong], dict[int, dict]]:
    """Plan a mix for this vibe, and say how each seam should land."""
    found = eligible(vibe, songs, traits)
    if end_id is not None:
        destination = next((song for song in songs if song.id == end_id), None)
        if destination is None:
            raise ValueError(f"destination song {end_id} is not available in the mix-ready library")
        if all(song.id != end_id for song in found):
            if vibe.seasonal:
                raise ValueError("choose a Christmas song for the Christmas mix destination")
            found.append(destination)
    rng = np.random.default_rng(seed)
    first = (
        start if start is not None else _opening_song(vibe, found, traits, rng, energy_arc).id
    )
    verdicts = verdicts or Verdicts()
    belongs = {song.id: vibe.belongs(song, traits[song.id]) for song in found}
    top = max(belongs.values(), default=1.0) or 1.0
    language = mix_language or vibe.language
    selected_vibe = replace(vibe, language=language)
    planned = plan_set(
        found,
        first,
        count,
        mix_language=language,
        stems=stems,
        links=set(phrases) if vibe.wordplay or vibe.key == "pick" else set(),
        arc=vibe.arc,
        seed=int(rng.integers(0, 2**31)),
        steady=vibe.steady,
        belongs={
            song: value / top - WARNING_COST * min(verdicts.warned_songs[song], 3)
            for song, value in belongs.items()
        },
        end_id=end_id,
        energy_arc=energy_arc,
    )
    if end_id is not None and (not planned or planned[-1].song.id != end_id):
        raise ValueError(
            "No valid transition route reaches that song in this mix. Clear the destination or "
            "choose a different mix."
        )
    return planned, seam_choices(selected_vibe, planned, phrases, rng, verdicts, stems)


def _word_move(a: SongInfo, b: SongInfo, verdicts: Verdicts) -> str | None:
    """A word hand-off these two can really carry. It needs both sets of words timed, which only
    works in English and has already failed on some songs."""
    if not (is_english(a) and is_english(b)):
        return None
    if not (verdicts.can_time_words(a.id) and verdicts.can_time_words(b.id)):
        return None
    options = [
        name
        for name in modes_for(a, b)
        if name in WORD_MOVES and (a.id, b.id, name) not in verdicts.failed
    ]
    proven = [name for name in options if (a.id, b.id, name) in verdicts.worked]
    return (proven or options or [None])[0]


def _moves_that_fit(
    vibe: Vibe, a: SongInfo, b: SongInfo, verdicts: Verdicts, stems: str = "sometimes"
) -> list[tuple[str, float]]:
    """Moves these two songs can carry, and how much to favour each."""
    options: list[tuple[str, float]] = []
    if stems != "never" and (
        (a.id, b.id, "vocal_ride") not in verdicts.failed
        and "word_blend" in modes_for(a, b)
        and ride_lines(a, b)
    ):
        ride_weight = RIDE_WEIGHT[vibe.language] * (1.5 if stems == "often" else 1.0)
        options.append(("vocal_ride", ride_weight))
    if (
        stems != "never"
        and (a.id, b.id, "stem_intertwine") not in verdicts.failed
        and can_intertwine(a, b)
    ):
        options.append(("stem_intertwine", 0.35 if stems == "sometimes" else 1.3))
    exits, entries = a.exit_cues()[:3], b.entry_cues()[:4]
    for name, weight in MOVE_WEIGHTS[vibe.language].items():
        if (a.id, b.id, name) in verdicts.failed:
            continue
        if enumerate_candidates(a, b, name, exits=exits, entries=entries):
            warned = (a.id, b.id, name) in verdicts.warned
            options.append((name, weight * (WARNED_BEFORE if warned else 1.0)))
    return options


def _choose_move(
    options: list[tuple[str, float]],
    history: list[str],
    total: int,
    rng: np.random.Generator,
) -> str | None:
    """Pick a move with the rest of the mix in mind. What works best gets picked most, but less
    so the more this mix has already used it, and never twice running if anything else fits."""
    fresh = [option for option in options if not history or option[0] != history[-1]] or options
    if not fresh:
        return None
    weights = []
    for name, weight in fresh:
        share_left = MAX_SHARE.get(name, 0.25) * total - history.count(name)
        weight *= OVER_SHARE if share_left < 1 else 1.0
        weight *= RECENT_PENALTY ** history[-3:].count(name)
        family = FAMILIES.get(name)
        if family and len(history) >= 2 and all(FAMILIES.get(m) == family for m in history[-2:]):
            weight *= SAME_FAMILY_PENALTY
        weights.append(weight)
    chances = np.array(weights)
    return fresh[int(rng.choice(len(fresh), p=chances / chances.sum()))][0]


def seam_choices(
    vibe: Vibe,
    planned: list[PlannedSong],
    phrases: dict[tuple[int, int], str],
    rng: np.random.Generator | None = None,
    verdicts: Verdicts | None = None,
    stems: str = "sometimes",
) -> dict[int, dict]:
    """The move into each song, chosen from what fits and what the mix has already used, so no two
    mixes run the same way and no one move takes over. Word hand-offs go where a real link can be
    timed, and stay rare unless the mix is all about them. Every choice is soft: if it doesn't work
    out when it's rendered, the seam uses the next best thing, and a cut only as a last resort."""
    rng = rng or np.random.default_rng()
    verdicts = verdicts or Verdicts()
    seams: dict[int, dict] = {}
    since_word = WORD_SPACING
    history: list[str] = []
    total = max(len(planned) - 1, 1)
    for before, item in zip(planned, planned[1:], strict=False):
        since_word += 1
        phrase = phrases.get((before.song.id, item.song.id))
        word_spacing = 2 if stems == "often" else WORD_SPACING
        if stems != "never" and phrase and (vibe.wordplay or since_word >= word_spacing):
            move = _word_move(before.song, item.song, verdicts)
            if move:
                seams[item.song.id] = {"move": move, "phrase": phrase, "soft": True}
                since_word = 0
                history.append(move)
                continue
        options = _moves_that_fit(vibe, before.song, item.song, verdicts, stems)
        move = _choose_move(options, history, total, rng)
        if move is None:
            continue
        seams[item.song.id] = {"move": move, "soft": True}
        history.append(move)
    return seams
