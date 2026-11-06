"""Hand-offs built around a phrase two songs share.

The first word reel taught the rule here. A shared word isn't a reason on its own: the listener's
note was "ur just meshing them cuz they hv the same words". So the music has to meet first, and the
phrase is the payoff. Separated stems make that possible, because B's band can start well before
B's voice does.

- `word_blend`: B's band comes in under A, locked to the beat, while A's band leaves. A's voice ends
  up singing over B's music, then B's voice takes the phrase from it.
- `vocal_ride`: the same blend with no shared words, for any two songs that fit.
- `word_exchange`: call and response. A rides B's band, B takes the phrase, and A calls back in the
  gaps B leaves between its own lines.
- `phrase_roll`: the listener's own design. "Good news, good news", then "news news news news",
  then faster, while the bands change underneath, and B lands on "Good news is on the way". How many
  repeats it takes, and how quick, comes from the two songs, because the same pattern on every pair
  sounded like a machine.
- `word_cut`: A sets the phrase up and B sings it. B's top end swells in first, so the cut has
  something to land in.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from selecta.analysis.song import SongInfo
from selecta.lyrics.align import Word
from selecta.render.script import Curve, Echo, Part, TransitionScript, Warp, fade_in, sweep
from selecta.styles.blend import _low_curves
from selecta.styles.timing import beat_lock

_LEAD_SECONDS = 6.0
_AFTER_SECONDS = 8.0
_PAD = 0.02
_DECLICK = 0.006
_HALF_TIME_ABOVE_BPM = 135.0
_SLOW_BEAT = 0.66
_BAND_LEAVES = 0.3
_BAND_GONE = 0.65
"""Shares of the overlap. After this, A's voice rides B's band alone until it finishes."""
_VOICE_LEVEL = 1.1
_RIDE_BEAT_LIMIT_MS = 40.0
"""A ride's bands only overlap briefly while one is leaving. Syncopated drums read as off the beat
to this check, and it failed a blend the listener liked, so only clear doubling counts here."""
_FAST_START_LEVEL = 0.8
_LAST_HIT_SHARE = 0.6
"""The last repeat stops early, leaving a breath for B's word to land in."""
_MAX_ANSWERS = 3
_ANSWER_REACH = 24.0
_CALL_LEVELS = (0.85, 0.65, 0.5)
_MAX_FAST_HITS = 8
_MAX_PHRASE_PULSES = 8
_TIGHT_STEP = 0.45
_HIT_ATTACK = 0.006
_HIT_RELEASE = 0.025
_CROSSFADE = 0.015
_CONTEXT = 0.5
"""Time-stretching reads a little either side, so a stem has to reach this far past a warp."""


@dataclass(frozen=True)
class Stem:
    """One separated part of a song: a file that starts `origin` seconds into the song."""

    path: str
    origin: float


def pulse(song: SongInfo) -> float:
    """The beat a person would nod to, since fast grids are usually half-time songs."""
    return song.period * (2.0 if song.bpm > _HALF_TIME_ABOVE_BPM else 1.0)


def felt_bpm(song: SongInfo) -> float:
    return 60.0 / pulse(song)


def _reaches(stem: Stem, earliest_song_time: float) -> bool:
    return earliest_song_time - _CONTEXT >= stem.origin


def _a_full_mix_until(a: SongInfo, song_time: float, lead: float) -> Part:
    return Part(
        song=a,
        warp=Warp.identity(0.0, song_time - lead, lead + _DECLICK * 2),
        gain=Curve([(lead - _DECLICK, 1.0), (lead, 0.0)]),
    )


def word_cut(
    a: SongInfo,
    b: SongInfo,
    phrase_a: list[Word],
    phrase_b: list[Word],
    band_b: Stem | None = None,
    swell_beats: int = 4,
) -> TransitionScript | None:
    """A's line reaches the shared words, and B sings them instead."""
    cut_a = phrase_a[0].start - _PAD
    lead = min(_LEAD_SECONDS, cut_a)
    enter_b = phrase_b[0].start - _PAD
    if lead < 2.0 or enter_b < 0:
        return None
    extras: list[Part] = []
    swell = min(swell_beats * pulse(b), lead - 0.5)
    if band_b is not None and _reaches(band_b, enter_b - swell):
        begin = lead - swell
        extras.append(
            Part(
                song=b,
                warp=Warp.identity(begin, enter_b - swell, swell + _DECLICK),
                source_path=band_b.path,
                window_origin=band_b.origin,
                gain=Curve([(begin, 0.0), (lead - _DECLICK, 0.75), (lead, 0.0)]),
                low=Curve.constant(0.0),
                highpass=sweep(begin, lead, 2500.0, 250.0),
            )
        )
    return TransitionScript(
        style="word_cut",
        duration=lead + _AFTER_SECONDS,
        a=_a_full_mix_until(a, cut_a, lead),
        b=Part(
            song=b,
            warp=Warp.identity(lead - _DECLICK, enter_b - _DECLICK, _AFTER_SECONDS + _DECLICK),
            gain=Curve([(lead - _DECLICK, 0.0), (lead, 1.0)]),
        ),
        overlap=(lead, lead),
        extras=extras,
        meta={"cut": lead, "wordplay": True},
    )


def _handoff_shift(a: SongInfo, b: SongInfo, a_end: float, b_start: float) -> tuple[int, float]:
    """How many beats B must sit ahead of A so bars line up and B's phrase follows A's.

    Returns the shift and the fractional A beat where B's phrase begins. Of the shifts that keep
    downbeats together, this takes the smallest wait, so there's at most about a bar between voices.
    """
    bar = a.beats_per_bar
    a_beat = float(np.interp(a_end, a.beats, np.arange(a.beats.size)))
    b_beat = float(np.interp(b_start, b.beats, np.arange(b.beats.size)))
    a_downbeat = int(a.bar_starts[a.bar_at(a_end)])
    b_downbeat = int(b.bar_starts[b.bar_at(b_start)])
    base = b_downbeat - a_downbeat
    best = min(
        (base + k * bar for k in range(-64, 65) if (b_beat - (base + k * bar)) - a_beat >= -0.25),
        key=lambda shift: (b_beat - shift) - a_beat,
    )
    return best, b_beat - best


def word_blend(
    a: SongInfo,
    b: SongInfo,
    phrase_a: list[Word],
    phrase_b: list[Word],
    voice_a: Stem,
    band_a: Stem,
    band_b: Stem,
    bars: int = 8,
) -> TransitionScript | None:
    """B's band joins under A's voice, in time, and B's voice takes the phrase from A's."""
    return _ride("word_blend", a, b, phrase_a[-1], phrase_b[0], voice_a, band_a, band_b, bars)


def vocal_ride(
    a: SongInfo,
    b: SongInfo,
    last_word_a: Word,
    first_word_b: Word,
    voice_a: Stem,
    band_a: Stem,
    band_b: Stem,
    bars: int = 8,
) -> TransitionScript | None:
    """A's voice rides B's band for several bars, and B's voice starts once A's has finished.

    The listener asked for this three times over: "the prev vocals didnt ride the beat of the next
    song long enough", and "we could've played the instrumental with the vocals for a little longer
    before starting up the vocals". It needs no shared words."""
    return _ride("vocal_ride", a, b, last_word_a, first_word_b, voice_a, band_a, band_b, bars)


def _ride(
    style: str,
    a: SongInfo,
    b: SongInfo,
    last_word_a: Word,
    first_word_b: Word,
    voice_a: Stem,
    band_a: Stem,
    band_b: Stem,
    bars: int,
    tail_seconds: float = 0.0,
) -> TransitionScript | None:
    if a.beats_per_bar != b.beats_per_bar:
        return None
    bar = a.beats_per_bar
    enter_b = first_word_b.start - _PAD
    word_end = last_word_a.end
    shift, handoff_beat = _handoff_shift(a, b, word_end, first_word_b.start)
    a_word_beat = float(np.interp(word_end, a.beats, np.arange(a.beats.size)))
    latest = max(handoff_beat, a_word_beat) + 0.5
    later_bars = a.bar_starts[a.bar_starts >= latest]
    if later_bars.size == 0:
        return None
    a_end = int(later_bars[0])
    a_start = a_end - bars * bar
    timing = beat_lock(a, b, a_start, a_end, a_start + shift)
    if timing is None:
        return None
    if not _reaches(band_b, float(timing.b_warp.source[0])):
        return None
    if tail_seconds > 0:
        timing.b_warp = Warp(
            np.append(timing.b_warp.output, timing.b_warp.output[-1] + tail_seconds),
            np.append(timing.b_warp.source, timing.b_warp.source[-1] + tail_seconds),
        )
        timing.duration += tail_seconds

    start = timing.overlap_start
    handoff = float(timing.b_warp.output_at(enter_b))
    voice_end = float(timing.a_warp.output_at(word_end + _PAD))
    last_word = float(timing.a_warp.output_at(last_word_a.start - _PAD))
    if handoff <= start + 2.0 or voice_end > handoff + timing.master_period / 2:
        return None
    span = voice_end - start
    first_voice = min(
        (
            float(timing.a_warp.output_at(line.start))
            for line in a.lines
            if line.start >= float(timing.a_warp.source_at(start))
        ),
        default=start,
    )
    # A's band leaves once A's own voice is there to carry the ride, however that song is built
    band_leaves = min(
        max(start + span * _BAND_LEAVES, first_voice), voice_end - 2 * timing.master_period
    )
    band_gone = min(
        band_leaves + span * (_BAND_GONE - _BAND_LEAVES), voice_end - timing.master_period
    )
    if band_gone <= band_leaves:
        band_leaves, band_gone = start + span * _BAND_LEAVES, start + span * _BAND_GONE
    stems_from = float(timing.a_warp.source_at(start)) - _CROSSFADE
    if not (_reaches(voice_a, stems_from) and _reaches(band_a, stems_from)):
        return None

    beat = timing.master_period
    echo_room_beats = max((handoff - voice_end) / beat, 0.0)
    echo_room = float(np.clip(echo_room_beats / 2.0, 0.0, 1.0))
    echo_feedback = 0.15 + 0.25 * echo_room
    echo_wet = 0.1 + 0.18 * echo_room
    swap = start + max(round(bars * _BAND_LEAVES), 1) * bar * beat
    a_low, b_low = _low_curves(swap, beat)
    rise = fade_in(start, band_gone)
    band_gain = Curve(
        [*zip(rise.times.tolist(), rise.values.tolist(), strict=True)]
        + [(handoff - _CROSSFADE, 1.0), (handoff + _CROSSFADE, 0.0)]
    )
    voice = Part(
        song=a,
        warp=timing.a_warp.trimmed(start - _CROSSFADE - 0.02, voice_end + 0.1),
        source_path=voice_a.path,
        window_origin=voice_a.origin,
        gain=Curve(
            [
                (start - _CROSSFADE, 0.0),
                (start + _CROSSFADE, 1.0),
                (voice_end - _CROSSFADE, 1.0),
                (voice_end + _CROSSFADE, 0.0),
            ]
        ),
        echo=Echo(
            delay_seconds=beat,
            feedback=echo_feedback,
            wet=echo_wet,
            return_highpass_hz=220.0,
            damp_lowpass_hz=6500.0,
        ),
        echo_send=Curve(
            [
                (last_word - 0.01, 0.0),
                (last_word, 1.0),
                (voice_end, 1.0),
                (voice_end + 0.02, 0.0),
            ]
        ),
    )
    b_full = Part(
        song=b,
        warp=timing.b_warp.trimmed(handoff - 0.05, timing.duration),
        gain=Curve([(handoff - _CROSSFADE, 0.0), (handoff + _CROSSFADE, 1.0)]),
        follows_b=True,
    )
    a_full = Part(
        song=a,
        warp=timing.a_warp.trimmed(float(timing.a_warp.output[0]), start + _CROSSFADE + 0.02),
        gain=Curve([(start - _CROSSFADE, 1.0), (start + _CROSSFADE, 0.0)]),
    )
    return TransitionScript(
        style=style,
        duration=timing.duration,
        a=Part(
            song=a,
            warp=timing.a_warp,
            source_path=band_a.path,
            window_origin=band_a.origin,
            render_from=start - _CROSSFADE - 0.02,
            render_until=band_gone + 0.1,
            gain=Curve(
                [
                    (start - _CROSSFADE, 0.0),
                    (start + _CROSSFADE, 1.0),
                    (band_leaves, 1.0),
                    (band_gone, 0.0),
                ]
            ),
            low=a_low,
        ),
        b=Part(
            song=b,
            warp=timing.b_warp,
            source_path=band_b.path,
            window_origin=band_b.origin,
            render_until=handoff + 0.1,
            gain=band_gain,
            low=b_low,
            lowpass=sweep(start, band_gone, 300.0, 20000.0),
        ),
        overlap=(start, handoff),
        expects_beats_aligned=True,
        extras=[voice, a_full, b_full],
        meta={
            "bars": bars,
            "swap": swap,
            "period": beat,
            "wordplay": True,
            "handoff": handoff,
            "voice_end": voice_end,
            "beat_limit_ms": _RIDE_BEAT_LIMIT_MS,
            "echo_room_beats": echo_room_beats,
            "echo_feedback": echo_feedback,
            "echo_wet": echo_wet,
        },
    )


def _hit(
    song: SongInfo,
    stem: Stem,
    at: float,
    source: float,
    length: float,
    level: float = _VOICE_LEVEL,
    speed: float = 1.0,
) -> Part:
    """One piece of a voice, placed anywhere. Its edges are soft, so repeats don't click."""
    release = min(_HIT_RELEASE, length * 0.25)
    return Part(
        song=song,
        warp=Warp(
            np.array([at, at + length + _DECLICK]),
            np.array([source, source + (length + _DECLICK) * speed]),
        ),
        source_path=stem.path,
        window_origin=stem.origin,
        gain=Curve(
            [
                (at - 1e-6, 0.0),
                (at + _HIT_ATTACK, level),
                (at + length - release, level),
                (at + length, 0.0),
            ]
        ),
    )


def _quick_steps(b: SongInfo, enter_b: float) -> np.ndarray:
    """B's own beats, in song time, cut into quick steps of about a fifth to a third of a second."""
    steps = 2 if b.period < _SLOW_BEAT else 4
    before = int(np.searchsorted(b.beats, enter_b - 0.05))
    if before < _MAX_FAST_HITS // steps + 2:
        return np.zeros(0)
    last = min(before + 1, b.beats.size)
    pieces = [
        np.linspace(b.beats[i], b.beats[i + 1], steps, endpoint=False)
        for i in range(before - _MAX_FAST_HITS // steps - 2, last - 1)
    ]
    grid = np.concatenate(pieces)
    return grid[grid < enter_b - 0.05]


@dataclass(frozen=True)
class RollShape:
    """Phrase-roll choices scored from the source phrase and both songs' local arrangement."""

    phrase_loops: int
    word_hits: int
    fast_hits: int
    phrase_pulses: int
    energy_lift: float
    source_density: float
    acceleration: float
    bass_midpoint: float
    bass_mid_level: float


def _bar_mean(song: SongInfo, values: np.ndarray, start: float, end: float) -> float:
    if values.size == 0:
        return 0.5
    first = int(np.clip(song.bar_at(start), 0, values.size - 1))
    last = int(np.clip(song.bar_at(end) + 1, first + 1, values.size))
    return float(np.mean(values[first:last]))


def roll_shape(
    a: SongInfo,
    b: SongInfo,
    phrase_a: list[Word],
    entry_b: float | None = None,
    available_fast_hits: int | None = None,
) -> RollShape:
    """Adapt repeat count, acceleration, and bass arrival to this pair's actual material.

    The source phrase sets the rhythmic span. Local energy and low-band share describe how busy
    the phrase is; B's energy and bass share describe the landing. A crowded phrase gets less
    repetition, a sparse phrase into a clear lift can earn one more cycle, and a bass-heavy landing
    holds B's low end back until later. The available B-side beat grid caps the final stutter.
    """
    length = phrase_a[-1].end - phrase_a[0].start
    pulses = max(int(np.ceil(length / pulse(a) - 0.1)), 1)
    if len(phrase_a) < 2 or pulses > _MAX_PHRASE_PULSES:
        loops = 0
    else:
        loops = 2 if pulses <= a.beats_per_bar else 1

    source_start, source_end = phrase_a[0].start, phrase_a[-1].end
    entry = entry_b if entry_b is not None else (b.bar_time(0) if b.bar_times.size else 0.0)
    source_energy = _bar_mean(a, a.energy_bars, source_start, source_end)
    source_low = _bar_mean(a, a.low_share_bars, source_start, source_end)
    entry_energy = _bar_mean(b, b.energy_bars, entry, entry + b.period * b.beats_per_bar * 2)
    entry_low = _bar_mean(b, b.low_share_bars, entry, entry + b.period * b.beats_per_bar * 2)
    source_density = float(np.clip(source_energy * 0.7 + source_low * 0.3, 0.0, 1.0))
    energy_lift = entry_energy - source_energy
    if energy_lift > 0.18 and source_density < 0.58 and len(phrase_a) >= 2:
        loops = min(2, loops + 1)
    elif source_density > 0.66 or energy_lift < -0.16:
        loops = max(0, loops - 1)

    step = b.period / (2 if b.period < _SLOW_BEAT else 4)
    word_step = step * 2
    word_hits = 4 if word_step <= _TIGHT_STEP else 2
    if source_density > 0.68 or energy_lift < -0.2:
        word_hits = max(2, word_hits - 1)
    elif energy_lift > 0.24 and source_density < 0.48:
        word_hits = min(5, word_hits + 1)

    fast_hits = _MAX_FAST_HITS if step <= _TIGHT_STEP / 2 else _MAX_FAST_HITS // 2
    if energy_lift < -0.18:
        fast_hits = max(2, fast_hits // 2)
    elif energy_lift > 0.24:
        fast_hits = min(_MAX_FAST_HITS, fast_hits + 2)
    if available_fast_hits is not None:
        choices = [n for n in (2, 4, 6, 8) if n <= available_fast_hits]
        fast_hits = min(fast_hits, max(choices, default=0))

    acceleration = float(np.clip(1.0 + source_density * 0.65 - energy_lift * 0.9, 0.65, 1.5))
    bass_heaviness = float(np.clip((entry_low - 0.18) / 0.36, 0.0, 1.0))
    return RollShape(
        phrase_loops=loops,
        word_hits=word_hits,
        fast_hits=fast_hits,
        phrase_pulses=pulses,
        energy_lift=energy_lift,
        source_density=source_density,
        acceleration=acceleration,
        bass_midpoint=0.42 + 0.33 * bass_heaviness,
        bass_mid_level=0.55 - 0.4 * bass_heaviness,
    )


def phrase_roll(
    a: SongInfo,
    b: SongInfo,
    phrase_a: list[Word],
    phrase_b: list[Word],
    voice_a: Stem,
    band_a: Stem,
    band_b: Stem,
) -> TransitionScript | None:
    """The phrase repeats, then its last word, then faster, into B singing the phrase.

    This is the listener's own design, with the build the way DJs do it: one motion at a time. A's
    bass goes as the word starts and its band fades. B's band rises underneath on B's own beat, and
    its bass comes up in steps as the repeats tighten, fully there as B lands. The last repeat rings
    on into B, so nothing stops dead.
    """
    start_song = phrase_a[0].start - _PAD
    end_song = phrase_a[-1].end + _PAD
    word_start = phrase_a[-1].start - _PAD
    enter_b = phrase_b[0].start - _PAD
    lead = min(_LEAD_SECONDS, start_song)
    if lead < 2.0 or enter_b < 0:
        return None
    to_output = lambda time: lead + (time - start_song)  # noqa: E731
    phrase_end = to_output(end_song)

    following = a.beats[a.beats >= end_song - 0.08]
    grid = _quick_steps(b, enter_b)
    shape = roll_shape(a, b, phrase_a, phrase_b[0].start, grid.size)
    if following.size == 0 or shape.fast_hits < 2:
        return None
    fast = grid[-shape.fast_hits :]
    roll_start = to_output(float(following[0]))

    hits: list[Part] = []
    now = roll_start
    if shape.phrase_loops:
        length = end_song - start_song
        spacing = shape.phrase_pulses * pulse(a)
        for _ in range(shape.phrase_loops):
            hits.append(_hit(a, voice_a, now, start_song, min(length, spacing)))
            now += spacing

    word_length = end_song - word_start
    word_stage = now
    a_step = a.period if a.period < _SLOW_BEAT else a.period / 2
    b_step = 2.0 * float(np.median(np.diff(fast)))
    progress = np.linspace(0.0, 1.0, shape.word_hits)
    for spacing in a_step + (b_step - a_step) * progress**shape.acceleration:
        hits.append(_hit(a, voice_a, now, word_start, min(word_length, float(spacing))))
        now += float(spacing)

    fast_stage = now
    landing = now + (enter_b - float(fast[0]))
    for i, song_time in enumerate(fast):
        at = landing - (enter_b - float(song_time))
        next_at = landing - (enter_b - float(fast[i + 1])) if i + 1 < fast.size else landing
        rising = _FAST_START_LEVEL + (_VOICE_LEVEL - _FAST_START_LEVEL) * i / max(fast.size - 1, 1)
        room = (next_at - at) * (_LAST_HIT_SHARE if i + 1 == fast.size else 1.0)
        hits.append(_hit(a, voice_a, at, word_start, min(word_length, room), rising))
    ring = hits[-1]
    ring.echo = Echo(
        delay_seconds=b.period,
        feedback=0.35,
        wet=0.3,
        return_highpass_hz=220.0,
        damp_lowpass_hz=6500.0,
    )
    ring.echo_send = Curve.constant(1.0)

    bed = landing - word_stage
    if not (_reaches(band_b, enter_b - bed) and _reaches(band_a, end_song)):
        return None
    band_a_gone = word_stage + (fast_stage - word_stage) * 0.8
    leaves = Part(
        song=a,
        warp=Warp.identity(
            phrase_end - _CROSSFADE, end_song - _CROSSFADE, band_a_gone - phrase_end + _CROSSFADE
        ),
        source_path=band_a.path,
        window_origin=band_a.origin,
        gain=Curve(
            [
                (phrase_end - _CROSSFADE, 0.0),
                (phrase_end + _CROSSFADE, 1.0),
                (word_stage, 1.0),
                (band_a_gone, 0.0),
            ]
        ),
        low=Curve([(word_stage - 0.05, 1.0), (word_stage + 0.05, 0.0)]),
    )
    bass_middle = fast_stage + (landing - fast_stage) * shape.bass_midpoint
    rises = Part(
        song=b,
        warp=Warp.identity(word_stage, enter_b - bed, bed + _DECLICK),
        source_path=band_b.path,
        window_origin=band_b.origin,
        gain=Curve(
            [
                (word_stage, 0.0),
                (fast_stage, 0.75),
                (landing - _DECLICK, 1.0),
                (landing, 0.0),
            ]
        ),
        low=Curve(
            [
                (fast_stage - 0.02, 0.0),
                (fast_stage, min(shape.bass_mid_level * 0.45, 0.25)),
                (bass_middle - 0.02, min(shape.bass_mid_level * 0.45, 0.25)),
                (bass_middle, shape.bass_mid_level),
                (landing - 0.02, shape.bass_mid_level),
                (landing, 1.0),
            ]
        ),
    )
    return TransitionScript(
        style="phrase_roll",
        duration=landing + _AFTER_SECONDS,
        a=Part(
            song=a,
            warp=Warp.identity(0.0, start_song - lead, phrase_end + _CROSSFADE * 2),
            gain=Curve([(phrase_end - _CROSSFADE, 1.0), (phrase_end + _CROSSFADE, 0.0)]),
        ),
        b=Part(
            song=b,
            warp=Warp.identity(landing, enter_b, _AFTER_SECONDS),
            gain=fade_in(landing, landing + _DECLICK),
        ),
        overlap=(phrase_end, landing),
        extras=[leaves, rises, *hits],
        meta={
            "cut": phrase_end,
            "wordplay": True,
            "landing": landing,
            "roll_start": roll_start,
            "word_stage": word_stage,
            "fast_stage": fast_stage,
            "shape": f"{shape.phrase_loops}+{shape.word_hits}+{shape.fast_hits}",
            "energy_lift": round(shape.energy_lift, 3),
            "source_density": round(shape.source_density, 3),
            "acceleration": round(shape.acceleration, 3),
            "bass_midpoint": round(shape.bass_midpoint, 3),
            "bass_mid_level": round(shape.bass_mid_level, 3),
        },
    )


def _answer_gaps(b: SongInfo, after: float, length: float) -> list[float]:
    """Beats in B where a voice of this length fits between B's own lines, soonest first.

    This is what makes call and response depend on the song: how many answers there are, and where
    they fall, comes from where B actually leaves room. A busy hook has no gaps, and gets no move.
    """
    lines = [line for line in b.lines if line.end > after]
    edges = [(after, lines[0].start)] if lines else []
    edges += [(one.end, two.start) for one, two in zip(lines, lines[1:], strict=False)]
    found: list[float] = []
    for begin, end in edges:
        if begin - after > _ANSWER_REACH or len(found) == _MAX_ANSWERS:
            break
        beats = b.beats[(b.beats >= begin + 0.03) & (b.beats + length <= end - 0.05)]
        if beats.size:
            found.append(float(beats[0]))
    return found


def word_exchange(
    a: SongInfo,
    b: SongInfo,
    phrase_a: list[Word],
    phrase_b: list[Word],
    voice_a: Stem,
    band_a: Stem,
    band_b: Stem,
    bars: int = 8,
) -> TransitionScript | None:
    """Call and response: A rides B's band, B takes the phrase, and A calls back in B's own gaps.

    B just plays its song. A's phrase drops into the room B leaves between its lines, further away
    each time, until B has it to itself. An earlier version traded the phrase in fixed slots, and
    the listener called it too algorithmic, because it ignored what each song was doing.
    """
    start_a = phrase_a[0].start - _PAD
    length = phrase_a[-1].end + _PAD - start_a
    speed = a.bpm / b.bpm
    call = length / speed
    gaps = _answer_gaps(b, phrase_b[-1].end, call)
    if not gaps:
        return None
    tail = gaps[-1] + call + _AFTER_SECONDS - phrase_b[-1].end
    script = _ride(
        "word_exchange", a, b, phrase_a[-1], phrase_b[0], voice_a, band_a, band_b, bars, tail
    )
    if script is None or not _reaches(voice_a, start_a):
        return None
    near = float(a.beats[np.argmin(np.abs(a.beats - start_a))]) - start_a
    for index, beat in enumerate(gaps):
        at = float(script.b.warp.output_at(beat)) - max(near, 0.0) / speed
        level = _CALL_LEVELS[min(index, len(_CALL_LEVELS) - 1)]
        hit = _hit(a, voice_a, at, start_a, call, level, speed)
        script.extras.append(hit)
    last = script.extras[-1]
    last.echo = Echo(
        delay_seconds=b.period,
        feedback=0.45,
        wet=0.35,
        return_highpass_hz=220.0,
        damp_lowpass_hz=6500.0,
    )
    last.echo_send = Curve.constant(1.0)
    script.meta["calls"] = len(gaps)
    return script
