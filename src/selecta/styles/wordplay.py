"""Cuts built around a phrase two songs share.

Three ways to hand it over, from plainest to showiest:

- `word_cut`: A sets the phrase up, and B sings it. The sentence carries on in a new voice.
- `word_echo`: A sings it, the band drops away, the last word rings out in time, and B lands
  singing the same words.
- `word_roll`: as above, but the last word stutters faster and faster into B's landing.

None of them need matched tempo or key, since the two songs never play together for long. They need
exact word times from alignment, which line-level lyrics can't give. Both echo moves also need A's
separated voice, so the word stands alone when the band stops.
"""

from __future__ import annotations

from dataclasses import dataclass

from selecta.analysis.song import SongInfo
from selecta.lyrics.align import Word
from selecta.render.script import Curve, Echo, Part, TransitionScript, Warp, fade_in, sweep

_LEAD_SECONDS = 6.0
_AFTER_SECONDS = 8.0
_PAD = 0.02
_DECLICK = 0.006
_PRE_ROLL_BEATS = 2
_ROLL_PATTERN = (0.0, 1.0, 2.0, 2.5, 3.0, 3.5)
"""Beats after the word starts: steady, then twice as fast, until B lands on beat four."""
_MAX_WAIT_SECONDS = 2.6


@dataclass(frozen=True)
class VocalWindow:
    """A's separated voice for part of the song. `origin` is where the file starts in the song."""

    path: str
    origin: float


def _a_full_mix_until(a: SongInfo, song_time: float, lead: float) -> Part:
    return Part(
        song=a,
        warp=Warp.identity(0.0, song_time - lead, lead + _DECLICK * 2),
        gain=Curve([(lead - _DECLICK, 1.0), (lead, 0.0)]),
    )


def word_cut(
    a: SongInfo, b: SongInfo, phrase_a: list[Word], phrase_b: list[Word]
) -> TransitionScript | None:
    """A's line reaches the shared words, and B sings them instead."""
    cut_a = phrase_a[0].start - _PAD
    lead = min(_LEAD_SECONDS, cut_a)
    enter_b = phrase_b[0].start - _PAD
    if lead < 2.0 or enter_b < 0:
        return None
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
        meta={"cut": lead, "wordplay": True},
    )


def _landing(a: SongInfo, word: Word, lead: float, minimum_beats: float) -> float | None:
    """When B's words land, counted in A's beats so the ringing word keeps time up to it."""
    beat = a.period
    held = word.end - word.start
    beats = max(minimum_beats, 1.0)
    while beats * beat < held + beat * 0.5:
        beats += 1.0
    wait = beats * beat
    if wait - held > _MAX_WAIT_SECONDS:
        return None
    return lead + wait


def _b_lands(
    b: SongInfo, phrase_b: list[Word], landing: float, free_before: float | None = None
) -> Part:
    """B's band opens up over its last moments before the words, or just lands if they're close."""
    enter_b = phrase_b[0].start - _PAD
    free = b.vocal_free_before(enter_b) if free_before is None else free_before
    pre_roll = min(_PRE_ROLL_BEATS * b.period, max(free - 0.1, 0.0), landing, enter_b)
    start = landing - pre_roll
    if pre_roll < 0.2:
        return Part(
            song=b,
            warp=Warp.identity(landing, enter_b, _AFTER_SECONDS),
            gain=fade_in(landing, landing + _DECLICK),
        )
    return Part(
        song=b,
        warp=Warp.identity(start, enter_b - pre_roll, pre_roll + _AFTER_SECONDS),
        gain=fade_in(start, landing),
        lowpass=sweep(start, landing, 350.0, 20000.0),
    )


def word_echo(
    a: SongInfo,
    b: SongInfo,
    phrase_a: list[Word],
    phrase_b: list[Word],
    vocal_a: VocalWindow,
    b_free_before: float | None = None,
) -> TransitionScript | None:
    """The band stops under A's last word, which rings out in time until B lands on the phrase."""
    word = phrase_a[-1]
    drop = word.start - _PAD
    lead = min(_LEAD_SECONDS, drop)
    if lead < 2.0 or phrase_b[0].start - _PAD < 0:
        return None
    landing = _landing(a, word, lead, 2.0)
    if landing is None:
        return None
    held = word.end - word.start
    voice_until = lead + held + 2 * _PAD
    voice = Part(
        song=a,
        warp=Warp.identity(lead, drop - vocal_a.origin, held + 3 * _PAD),
        source_path=vocal_a.path,
        gain=Curve(
            [
                (lead - 1e-6, 0.0),
                (lead, 1.0),
                (voice_until - _DECLICK, 1.0),
                (voice_until, 0.0),
            ]
        ),
        echo=Echo(
            delay_seconds=a.period,
            feedback=0.55,
            wet=0.55,
            return_highpass_hz=180.0,
            damp_lowpass_hz=7000.0,
        ),
        echo_send=Curve([(lead - 0.01, 1.0), (voice_until, 1.0), (voice_until + 0.02, 0.0)]),
    )
    return TransitionScript(
        style="word_echo",
        duration=landing + _AFTER_SECONDS,
        a=_a_full_mix_until(a, drop, lead),
        b=_b_lands(b, phrase_b, landing, b_free_before),
        overlap=(lead, landing),
        extras=[voice],
        quiet_allowed=landing - lead,
        meta={"cut": lead, "wordplay": True, "landing": landing},
    )


def word_roll(
    a: SongInfo,
    b: SongInfo,
    phrase_a: list[Word],
    phrase_b: list[Word],
    vocal_a: VocalWindow,
    b_free_before: float | None = None,
) -> TransitionScript | None:
    """The word repeats on the beat, then twice as fast, and B lands on the next downbeat."""
    word = phrase_a[-1]
    drop = word.start - _PAD
    lead = min(_LEAD_SECONDS, drop)
    if lead < 2.0 or phrase_b[0].start - _PAD < 0:
        return None
    beat = a.period
    landing = lead + 4.0 * beat
    voices: list[Part] = []
    source = drop - vocal_a.origin
    for i, at_beats in enumerate(_ROLL_PATTERN):
        at = lead + at_beats * beat
        following = _ROLL_PATTERN[i + 1] if i + 1 < len(_ROLL_PATTERN) else 4.0
        length = min((following - at_beats) * beat, word.end - word.start + 2 * _PAD)
        voices.append(
            Part(
                song=a,
                warp=Warp.identity(at, source, length + _DECLICK),
                source_path=vocal_a.path,
                gain=Curve(
                    [
                        (at - 1e-6, 0.0),
                        (at + _DECLICK * 0.5, 1.0),
                        (at + length - _DECLICK, 1.0),
                        (at + length, 0.0),
                    ]
                ),
            )
        )
    return TransitionScript(
        style="word_roll",
        duration=landing + _AFTER_SECONDS,
        a=_a_full_mix_until(a, drop, lead),
        b=_b_lands(b, phrase_b, landing, b_free_before),
        overlap=(lead, landing),
        extras=voices,
        quiet_allowed=landing - lead,
        meta={"cut": lead, "wordplay": True, "landing": landing},
    )
