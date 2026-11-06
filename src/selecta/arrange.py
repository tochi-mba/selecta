"""Selecta arranging a seam itself, from what's really in the stems.

The other moves are recipes that know nothing about what each part of a song is doing. This one
listens first. It measures every stem of both songs, square by square: how loud it is, what notes
it's playing, and where a voice has a gap. Then it searches for the arrangement that sounds best by
those measures, renders it, checks the result, and repairs whatever didn't pass. A live DJ gets one
take. This can try thousands.

The first shape, and the shape of the energy it follows, came from the listener: a seam they made by
hand in the Seam Studio and rated Good. Every shape they rate after that joins in or rules itself
out, so this learns by being used. The weights are starting values: one seam can't settle them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf

from selecta.analysis.song import SongInfo
from selecta.config import SAMPLE_RATE
from selecta.planner.choose import tempo_gap
from selecta.planner.wordreel import modes_for
from selecta.studio import CELLS, LANES, SIDES, Shape, clean_shape, find_placement

STRIP_AND_LAND: Shape = {
    "a": {
        "vocals": [1, 1, 1, 1, 0, 0, 0, 0],
        "drums": [1, 1, 0, 0, 0, 0, 0, 0],
        "bass": [1, 0, 0, 0, 0, 0, 0, 0],
        "other": [1, 1, 1, 1, 1, 1, 1, 1],
    },
    "b": {
        "vocals": [0, 0, 0, 0, 0, 0, 0, 0],
        "drums": [0, 0, 0, 0, 0, 0, 0, 1],
        "bass": [0, 0, 0, 0, 0, 0, 1, 1],
        "other": [0, 0, 0, 1, 1, 0, 1, 1],
    },
}
"""A's bass goes first, then its drums, then its voice, and its melody carries on alone. B's melody
is teased and pulled away. Then B's bass arrives, and B's drums land last."""

FIRST_ARC = (0.0, -0.7, -5.3, -3.1, -3.6, -7.3, -0.8, 0.5)
"""How far the energy sat below a straight line from A at full to B at full, in decibels, measured
on the seam the listener liked. It holds, thins out, teases, drops to its lowest, and then lands."""

PRESENT_DB = -40.0
"""Louder than this, a stem really has something in that square. Separation leaves about -50 dB of
other instruments behind, and real parts measured at -20 to -30 dB on real songs."""
CLOSE_TEMPO = 0.045
SHORTEST_OVERLAP = 12
MIN_GRID = 0.8
LONGEST_CARRIER_GAP = 2
"""How many squares of the stripped-down stretch can pass without a melody before it isn't one."""
QUIET_AROUND_SECONDS = 0.25
VOICE_STOPS = (3, 4, 5, 6)
"""Where a voice can stop, in squares. Near the middle, so that it hands over but doesn't drag."""
FAR_FROM_MIDDLE_COST = 0.15
TOO_SIMILAR = 0.9
CLEAR_CLASH = 0.6
SEARCH_ROUNDS = 12
TAKES = 5
LONGEST_WITHOUT_DRUMS = 6
LONGEST_WITHOUT_BASS = 6
USUAL_CHANGES_PER_LANE = 3

# how much each thing counts in the search, in rough points
SILENT_SQUARE = 100.0
NO_LANDING = 50.0
TWO_VOICES = 30.0
TWO_DRUMS = 20.0
TWO_BASSES = 20.0
PER_DECIBEL_OFF_THE_ARC = 1.0
CLASH = 10.0
CLIPPED_WORD = 6.0
DRUMS_BEFORE_BASS = 3.0
JUMP_AT_THE_EDGE = 4.0
TOO_LONG_BARE = 5.0
FLICKER = 2.0
LIKE_A_LIKED_SHAPE = 12.0
LIKE_A_DISLIKED_SHAPE = 24.0
STAY_NEAR_YOURS = 30.0

Levels = dict[str, dict[str, list[float]]]


class WontWork(ValueError):
    """These two can't be arranged this way. The message says why, in plain words."""


def can_arrange(a: SongInfo, b: SongInfo) -> bool:
    """Cheap checks before spending minutes splitting stems."""
    return why_it_cant(a, b) is None


def why_it_cant(a: SongInfo, b: SongInfo) -> str | None:
    gap = tempo_gap(a, b)
    if gap > CLOSE_TEMPO:
        return f"The songs are {gap:.0%} apart in tempo, too far to play their parts together."
    if min(a.grid_confidence, b.grid_confidence) < MIN_GRID:
        return "This needs a steadier beat in both songs."
    if "word_blend" not in modes_for(a, b):
        return "These two are too far apart in key for their melodies to overlap."
    place = find_placement(a, b)
    if place is None or place.bars < SHORTEST_OVERLAP:
        return "These two don't have enough clear bars to line their stems up."
    return None


# ---- listening to the stems


@dataclass
class Hearing:
    """What's in each stem, square by square."""

    levels: np.ndarray
    """Decibels, by side, lane and square."""
    notes: np.ndarray
    """Twelve pitch classes, by side, lane and square, with a length of one or nothing there."""
    edges: np.ndarray
    """How loud each song's voice is at each boundary between squares, as plain amplitude."""


def _decibels(samples: np.ndarray) -> float:
    return float(20.0 * np.log10(np.sqrt(np.mean(samples**2)) + 1e-6)) if samples.size else -120.0


def _pitch_classes(mono: np.ndarray) -> np.ndarray:
    """Which notes are sounding, from a plain spectrum, between the bass and the top of a melody."""
    size = 8192
    if mono.size < size:
        return np.zeros(12)
    frames = np.lib.stride_tricks.sliding_window_view(mono, size)[:: size // 2]
    power = (np.abs(np.fft.rfft(frames * np.hanning(size), axis=1)) ** 2).mean(axis=0)
    freqs = np.fft.rfftfreq(size, 1.0 / SAMPLE_RATE)
    keep = (freqs >= 110.0) & (freqs <= 2000.0)
    classes = np.mod(np.round(12.0 * np.log2(freqs[keep] / 261.63)).astype(int), 12)
    notes = np.bincount(classes, weights=power[keep], minlength=12)
    length = np.linalg.norm(notes)
    return notes / length if length > 0 else notes


def listen(folder: Path, seconds: float) -> Hearing:
    """Measure both songs' stems. The result is kept beside them, so it only happens once."""
    saved = folder / "hearing.json"
    sources = {}
    for side in SIDES:
        for lane in LANES:
            path = folder / f"{side}_{lane}.flac"
            try:
                stat = path.stat()
                sources[path.name] = [stat.st_size, stat.st_mtime_ns]
            except FileNotFoundError:
                sources[path.name] = None
    try:
        data = json.loads(saved.read_text("utf-8"))
        kept = Hearing(*(np.array(data[name]) for name in ("levels", "notes", "edges")))
        if (
            data.get("version") == 1
            and data.get("seconds") == seconds
            and isinstance(data.get("sources"), dict)
            and all(
                signature is None or data["sources"].get(name) == signature
                for name, signature in sources.items()
            )
            and kept.levels.shape == (len(SIDES), len(LANES), CELLS)
            and kept.notes.shape == (len(SIDES), len(LANES), CELLS, 12)
            and kept.edges.shape == (len(SIDES), CELLS + 1)
            and all(np.isfinite(values).all() for values in (kept.levels, kept.notes, kept.edges))
        ):
            return kept
    except (OSError, ValueError, KeyError, TypeError):
        pass
    levels = np.zeros((len(SIDES), len(LANES), CELLS))
    notes = np.zeros((len(SIDES), len(LANES), CELLS, 12))
    edges = np.zeros((len(SIDES), CELLS + 1))
    reach = int(QUIET_AROUND_SECONDS * SAMPLE_RATE)
    step = seconds / CELLS
    for s, side in enumerate(SIDES):
        for n, lane in enumerate(LANES):
            audio, _ = sf.read(folder / f"{side}_{lane}.flac", dtype="float32", always_2d=True)
            mono = audio.mean(axis=1)
            for cell, piece in enumerate(np.array_split(mono, CELLS)):
                levels[s, n, cell] = round(_decibels(piece), 1)
                if lane in {"vocals", "other"} and levels[s, n, cell] >= PRESENT_DB:
                    notes[s, n, cell] = _pitch_classes(piece)
            if lane == "vocals":
                for boundary in range(CELLS + 1):
                    at = int(boundary * step * SAMPLE_RATE)
                    edges[s, boundary] = 10.0 ** (
                        _decibels(mono[max(at - reach, 0) : at + reach]) / 20.0
                    )
    hearing = Hearing(levels, notes, edges)
    saved.write_text(
        json.dumps(
            {
                "version": 1,
                "seconds": seconds,
                "sources": sources,
                "levels": levels.tolist(),
                "notes": notes.tolist(),
                "edges": edges.tolist(),
            }
        ),
        "utf-8",
    )
    return hearing


def as_array(shape: Shape) -> np.ndarray:
    return np.array([[shape[side][lane] for lane in LANES] for side in SIDES], dtype=bool)


def as_shape(array: np.ndarray) -> Shape:
    return {
        side: {lane: [int(v) for v in array[s, n]] for n, lane in enumerate(LANES)}
        for s, side in enumerate(SIDES)
    }


A, B = 0, 1
VOICE, DRUMS, BASS, MELODY = range(4)


def arc_of(shape: np.ndarray, hearing: Hearing) -> np.ndarray:
    """How far this arrangement's energy sits from a straight line between the two songs at full."""
    present = hearing.levels >= PRESENT_DB
    power = 10.0 ** (hearing.levels / 10.0) * present
    level = 10.0 * np.log10((power * shape).sum(axis=(0, 1)) + 1e-9)
    start = 10.0 * np.log10(power[A, :, 0].sum() + 1e-9)
    end = 10.0 * np.log10(power[B, :, -1].sum() + 1e-9)
    return level - np.linspace(start, end, CELLS)


# ---- what makes one arrangement better than another


@dataclass
class Taste:
    """What the listener's rated shapes have said so far."""

    liked: list[np.ndarray] = field(default_factory=list)
    disliked: list[np.ndarray] = field(default_factory=list)
    arcs: list[np.ndarray] = field(default_factory=lambda: [np.array(FIRST_ARC)])
    anchor: np.ndarray | None = None
    """A shape to stay close to, when fine tuning one a person made."""


def taste_from(memory) -> Taste:
    arcs = [np.array(FIRST_ARC), *(np.array(arc) for arc in memory.liked_arcs)]
    return Taste(
        [as_array(clean_shape(shape)) for shape in memory.liked_shapes],
        [as_array(clean_shape(shape)) for shape in memory.disliked_shapes],
        arcs,
    )


def _likeness(one: np.ndarray, other: np.ndarray) -> float:
    return float((one == other).mean())


def _longest_run(flags: np.ndarray) -> int:
    longest = run = 0
    for flag in flags:
        run = run + 1 if flag else 0
        longest = max(longest, run)
    return longest


def score(shape: np.ndarray, hearing: Hearing, taste: Taste) -> float:
    """How good this arrangement should sound, from what's in the stems and what's been liked."""
    present = hearing.levels >= PRESENT_DB
    heard = shape & present
    points = 0.0
    points -= SILENT_SQUARE * float((~heard.any(axis=(0, 1))).sum())

    # one voice, one set of drums, one bass, at any moment
    points -= TWO_VOICES * float((heard[A, VOICE] & heard[B, VOICE]).sum())
    points -= TWO_DRUMS * float((heard[A, DRUMS] & heard[B, DRUMS]).sum())
    points -= TWO_BASSES * float((heard[A, BASS] & heard[B, BASS]).sum())

    # the energy should follow a shape that's been liked
    arc = arc_of(shape, hearing)
    points -= PER_DECIBEL_OFF_THE_ARC * min(float(np.abs(arc - want).mean()) for want in taste.arcs)

    # the two songs should be in the same notes when they play together. A song's own voice and band
    # always agree, and real melodies in the same key measured 0.6 to 0.9 alike, none of it a clash
    for cell in range(CELLS):
        for mine in (VOICE, MELODY):
            for theirs in (VOICE, MELODY):
                if heard[A, mine, cell] and heard[B, theirs, cell]:
                    first, second = hearing.notes[A, mine, cell], hearing.notes[B, theirs, cell]
                    if first.any() and second.any():
                        points -= CLASH * max(CLEAR_CLASH - float(first @ second), 0.0)

    # a voice should stop and start between words
    loudest = max(float(hearing.edges.max()), 1e-6)
    for s in (A, B):
        voice = shape[s, VOICE]
        for boundary in range(1, CELLS):
            if voice[boundary - 1] != voice[boundary]:
                points -= CLIPPED_WORD * float(hearing.edges[s, boundary]) / loudest

    # the seam picks up from the whole song and hands over to the whole song, so a part missing at
    # either end is a jump. The next song's voice is the exception, since it comes in on the landing
    last = CELLS - 1
    points -= JUMP_AT_THE_EDGE * float((present[A, :, 0] & ~shape[A, :, 0]).sum())
    points -= JUMP_AT_THE_EDGE * float((present[B, 1:, last] & ~shape[B, 1:, last]).sum())

    # the whole point is the landing: the new bass, then the new drums
    if not (heard[B, DRUMS, last] or heard[B, BASS, last]):
        points -= NO_LANDING
    drums = np.flatnonzero(heard[B, DRUMS])
    bass = np.flatnonzero(heard[B, BASS])
    if drums.size and bass.size and drums[0] < bass[0]:
        points -= DRUMS_BEFORE_BASS

    # a long bare stretch is the tension, but it has a limit
    no_drums = ~(heard[A, DRUMS] | heard[B, DRUMS])
    no_bass = ~(heard[A, BASS] | heard[B, BASS])
    points -= TOO_LONG_BARE * max(_longest_run(no_drums) - LONGEST_WITHOUT_DRUMS, 0)
    points -= TOO_LONG_BARE * max(_longest_run(no_bass) - LONGEST_WITHOUT_BASS, 0)

    # switching a part on and off over and over stops sounding like a choice
    changes = (shape[:, :, 1:] != shape[:, :, :-1]).sum(axis=2)
    points -= FLICKER * float(np.maximum(changes - USUAL_CHANGES_PER_LANE, 0).sum())

    if taste.liked:
        points += LIKE_A_LIKED_SHAPE * max(_likeness(shape, liked) for liked in taste.liked)
    else:
        points += LIKE_A_LIKED_SHAPE * _likeness(shape, as_array(STRIP_AND_LAND))
    if taste.disliked:
        points -= LIKE_A_DISLIKED_SHAPE * max(_likeness(shape, bad) for bad in taste.disliked)
    if taste.anchor is not None:
        points += STAY_NEAR_YOURS * _likeness(shape, taste.anchor)
    return points


def tune(start: np.ndarray, hearing: Hearing, taste: Taste) -> np.ndarray:
    """Fine tune an arrangement: try changing each square, keep the best change, and carry on until
    nothing makes it better. It ends up as close to the start as the music allows."""
    best = start.copy()
    best_points = score(best, hearing, taste)
    for _ in range(SEARCH_ROUNDS):
        found = None
        for s in range(len(SIDES)):
            for n in range(len(LANES)):
                for cell in range(CELLS):
                    best[s, n, cell] = not best[s, n, cell]
                    points = score(best, hearing, taste)
                    best[s, n, cell] = not best[s, n, cell]
                    if points > best_points + 1e-9:
                        best_points, found = points, (s, n, cell)
        if found is None:
            break
        best[found] = not best[found]
    return best


# ---- making arrangements


def _fits_at_all(shape: np.ndarray, hearing: Hearing) -> None:
    """Rule out what fine tuning can't fix, in words a person would use."""
    present = hearing.levels >= PRESENT_DB
    heard = shape & present
    bare = ~(heard[A, DRUMS] | heard[B, DRUMS])
    carried = heard[A, MELODY] | heard[B, MELODY]
    if int((bare & ~carried).sum()) > LONGEST_CARRIER_GAP:
        raise WontWork("There's no melody here to carry the song once its drums drop out.")
    last = CELLS - 1
    if not (present[B, DRUMS, last - 1 :].any() or present[B, BASS, last - 1 :].any()):
        raise WontWork("The next song has no bass or drums to land with at this point.")
    if not present.any(axis=(0, 1)).all():
        raise WontWork("Both songs are nearly silent here, so there'd be nothing to hear.")


def _voice_moved_to_a_gap(shape: np.ndarray, hearing: Hearing) -> np.ndarray:
    """If A's voice stops once, stop it at the quietest moment nearby, leaning to the middle."""
    voice = shape[A, VOICE]
    stops = [cell for cell in range(1, CELLS) if voice[cell - 1] and not voice[cell]]
    if len(stops) != 1 or voice[stops[0] :].any():
        return shape
    loudness = hearing.edges[A]

    def cost(stop: int) -> float:
        return float(loudness[stop]) * (1.0 + FAR_FROM_MIDDLE_COST * abs(stop - 4))

    best = min(VOICE_STOPS, key=cost)
    moved = shape.copy()
    moved[A, VOICE] = [cell < best for cell in range(CELLS)]
    return moved


def arrangements(hearing: Hearing, taste: Taste, theirs: Shape | None = None) -> list[Shape]:
    """Arrangements to try, best first. One the listener made for this exact pair is used as it is.
    Otherwise every shape they've liked is fitted and fine tuned for these two songs, along with the
    first shape, and the search decides which suits them best. Anything very close to a shape they
    rated Bad is left out."""
    if theirs is not None:
        return [clean_shape(theirs)]
    starts = [*taste.liked, as_array(STRIP_AND_LAND)]
    made: list[tuple[float, np.ndarray]] = []
    problem: WontWork | None = None
    for start in starts:
        try:
            _fits_at_all(start, hearing)
        except WontWork as why:
            problem = problem or why
            continue
        tuned = tune(_voice_moved_to_a_gap(start, hearing), hearing, taste)
        if any(_likeness(tuned, bad) >= TOO_SIMILAR for bad in taste.disliked):
            continue
        if not any((tuned == other).all() for _, other in made):
            made.append((score(tuned, hearing, taste), tuned))
    if not made:
        if problem is not None:
            raise problem
        raise WontWork("You've rated shapes like this one Bad, so it's been left out.")
    made.sort(key=lambda item: -item[0])
    return [as_shape(shape) for _, shape in made]


def repair(shape: Shape, failed: list[str], hearing: Hearing) -> Shape | None:
    """A specific fix for what a render's checks found, or None if the shape can't fix it. Being
    able to hear a take and go again is the one thing a machine can do that a live DJ can't."""
    array = as_array(shape)
    fixed = array.copy()
    if "harmony" in failed:
        # the two melodies don't sit together: keep them apart until the landing
        fixed[B, MELODY, : CELLS - 2] = False
    if "low end clash" in failed:
        fixed[A, BASS, np.flatnonzero(fixed[B, BASS])] = False
        fixed[A, DRUMS, np.flatnonzero(fixed[B, DRUMS])] = False
    if "vocal overlap" in failed:
        fixed[B, VOICE] = False
    if {"phrase integrity"} & set(failed):
        fixed = _voice_moved_to_a_gap(fixed, hearing)
    if {"quiet time", "level fall", "seam energy"} & set(failed):
        # too thin at its lowest: keep the first song's drums for one more square
        drums = np.flatnonzero(fixed[A, DRUMS])
        fixed[A, DRUMS, int(drums[-1]) + 1 if drums.size else 0] = True
    if "entry level" in failed:
        # the landing jumps out: let the first song's melody thin out before it
        fixed[B, DRUMS, : CELLS - 1] = False
        fixed[B, BASS, : CELLS - 2] = False
    if (fixed == array).all():
        return None
    return as_shape(fixed)


def what_changed(
    before: Shape, after: Shape, hearing: Hearing, titles: dict[str, str]
) -> list[str]:
    """What fine tuning did, in plain words, with the reason where there's a clear one."""
    lane_words = {"vocals": "voice", "drums": "drums", "bass": "bass", "other": "melody"}
    old, new = as_array(before), as_array(after)
    changes = []
    voice_old, voice_new = old[A, VOICE], new[A, VOICE]
    if not (voice_old == voice_new).all() and voice_old.sum() and voice_new.sum():
        changes.append(
            f"{titles['a']}'s voice now stops at square {int(voice_new.sum()) + 1}, "
            "in a gap between words."
        )
    for s, side in enumerate(SIDES):
        for n, lane in enumerate(LANES):
            if side == "a" and lane == "vocals" and voice_old.sum() and voice_new.sum():
                continue
            turned_on = [c + 1 for c in range(CELLS) if new[s, n, c] and not old[s, n, c]]
            turned_off = [c + 1 for c in range(CELLS) if old[s, n, c] and not new[s, n, c]]
            part = f"{titles[side]}'s {lane_words[lane]}"
            for cells, verb in ((turned_on, "on"), (turned_off, "off")):
                if not cells:
                    continue
                where = ", ".join(map(str, cells))
                plural = "s" if len(cells) > 1 else ""
                line = f"Turned {part} {verb} in square{plural} {where}"
                other = hearing.notes[1 - s, MELODY]
                clashing = (
                    verb == "off"
                    and lane in {"vocals", "other"}
                    and any(
                        old[1 - s, MELODY, c - 1]
                        and other[c - 1].any()
                        and hearing.notes[s, n, c - 1].any()
                        and float(other[c - 1] @ hearing.notes[s, n, c - 1]) < CLEAR_CLASH
                        for c in cells
                    )
                )
                reason = ", where it clashed with the other song." if clashing else "."
                changes.append(f"{line}{reason}")
    return changes
