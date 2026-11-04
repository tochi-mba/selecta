"""Moves with no beatmatching, so they work across any tempo or key.

A mixed library needs these most. Tempo limits alone lock a set into one genre, and these are how
real open-format DJs jump: a clean break plus a musical reason.
"""

from __future__ import annotations

from selecta.analysis.song import Cue, SongInfo
from selecta.render.script import Curve, Echo, Part, TransitionScript, Warp, Wash, fade_in

_DECLICK = 0.008
_LEAD_IN_BARS = 2


def _lead_in(a: SongInfo, exit_cue: Cue) -> float:
    return max(3.0, min(a.period * a.beats_per_bar * _LEAD_IN_BARS, exit_cue.time))


def _entry_is_high_energy(b: SongInfo, entry_cue: Cue) -> bool:
    bars = b.energy_bars[entry_cue.bar : entry_cue.bar + 2]
    return bars.size > 0 and float(bars.mean()) >= float(b.energy) * 0.9


def cut_on_one(
    a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, bars: int = 0, **options
) -> TransitionScript | None:
    lead = _lead_in(a, exit_cue)
    tail = 4.0
    cut = lead
    b_start = cut - _DECLICK * 1.5
    return TransitionScript(
        style="cut_on_one",
        duration=cut + tail,
        a=Part(
            song=a,
            warp=Warp.identity(0.0, exit_cue.time - lead, lead + _DECLICK * 2),
            gain=Curve([(cut - _DECLICK * 0.25, 1.0), (cut + _DECLICK, 0.0)]),
        ),
        b=Part(
            song=b,
            warp=Warp.identity(b_start, entry_cue.time - _DECLICK * 1.5, tail + _DECLICK * 1.5),
            gain=Curve([(b_start, 0.0), (cut - _DECLICK * 0.25, 1.0)]),
        ),
        overlap=(cut, cut),
        meta={"cut": cut},
    )


def echo_out(
    a: SongInfo,
    b: SongInfo,
    exit_cue: Cue,
    entry_cue: Cue,
    bars: int = 0,
    gap_bars: float | None = None,
    **options,
) -> TransitionScript | None:
    lead = _lead_in(a, exit_cue)
    beat = a.period
    bar = beat * a.beats_per_bar
    if gap_bars is None:
        gap_bars = 1.0 if _entry_is_high_energy(b, entry_cue) else 0.0
    b_at = lead + gap_bars * bar
    tail_seconds = max(4.0, bar * 2.5)
    duration = b_at + tail_seconds
    send_from = lead - beat
    return TransitionScript(
        style="echo_out",
        duration=duration,
        a=Part(
            song=a,
            warp=Warp.identity(0.0, exit_cue.time - lead, lead + 0.05),
            gain=Curve([(lead - 0.005, 1.0), (lead + 0.02, 0.0)]),
            echo=Echo(delay_seconds=beat / 2, feedback=0.7, wet=0.55, return_highpass_hz=250.0),
            echo_send=Curve(
                [(send_from - 0.02, 0.0), (send_from, 1.0), (lead, 1.0), (lead + 0.02, 0.0)]
            ),
        ),
        b=Part(
            song=b,
            warp=Warp.identity(b_at, entry_cue.time, tail_seconds),
            gain=fade_in(b_at, b_at + 0.02),
        ),
        overlap=(lead, b_at + 0.02),
        quiet_allowed=gap_bars * bar,
        meta={"cut": lead, "b_at": b_at},
    )


def delay_throw(
    a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, bars: int = 0, **options
) -> TransitionScript | None:
    """A's last word gets thrown into a delay, then the fader slams. Needs a word to throw."""
    if not a.vocals_known:
        return None
    beat = a.period
    window = beat * 2
    last_word_end = max(
        (line.end for line in a.lines if exit_cue.time - window < line.end <= exit_cue.time + 0.1),
        default=None,
    )
    if last_word_end is None:
        return None
    lead = _lead_in(a, exit_cue)
    word_end = lead - (exit_cue.time - last_word_end)
    send_from = word_end - min(beat, 0.6)
    tail_seconds = max(3.5, beat * a.beats_per_bar * 2)
    return TransitionScript(
        style="delay_throw",
        duration=lead + tail_seconds,
        a=Part(
            song=a,
            warp=Warp.identity(0.0, exit_cue.time - lead, lead + 0.05),
            gain=Curve([(lead - 0.005, 1.0), (lead + 0.015, 0.0)]),
            echo=Echo(delay_seconds=beat, feedback=0.5, wet=0.45, return_highpass_hz=350.0),
            echo_send=Curve(
                [
                    (send_from - 0.02, 0.0),
                    (send_from, 1.0),
                    (word_end + 0.05, 1.0),
                    (word_end + 0.1, 0.0),
                ]
            ),
        ),
        b=Part(
            song=b,
            warp=Warp.identity(lead, entry_cue.time, tail_seconds),
            gain=fade_in(lead, lead + 0.015),
        ),
        overlap=(lead, lead + 0.015),
        meta={"cut": lead},
    )


def reverb_wash(
    a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, bars: int = 2, **options
) -> TransitionScript | None:
    wash_bars = max(bars, 2)
    bar = a.period * a.beats_per_bar
    wash_seconds = bar * wash_bars
    lead = max(wash_seconds + bar, 3.0)
    if exit_cue.time - lead < 0:
        return None
    fade_time = a.period
    b_at = lead
    tail_seconds = max(5.0, bar * 2)
    return TransitionScript(
        style="reverb_wash",
        duration=b_at + tail_seconds,
        a=Part(
            song=a,
            warp=Warp.identity(0.0, exit_cue.time - lead, lead + fade_time),
            gain=Curve([(lead - 0.01, 1.0), (lead + fade_time, 0.0)]),
            wash=Wash(wet=0.6, room_size=0.9, damping=0.35, return_highpass_hz=300.0),
            wash_send=Curve(
                [
                    (lead - wash_seconds, 0.0),
                    (lead, 1.0),
                    (lead + fade_time, 1.0),
                    (lead + fade_time + 0.05, 0.0),
                ]
            ),
        ),
        b=Part(
            song=b,
            warp=Warp.identity(b_at, entry_cue.time, tail_seconds),
            gain=fade_in(b_at, b_at + a.period / 2),
        ),
        overlap=(lead, lead + fade_time),
        meta={"cut": lead},
    )
