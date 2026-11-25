"""Moves with no beatmatching, so they work across a tempo or key gap.

These are how open-format DJs jump, and they only work with a musical reason and no dead air. The
first listening reel rated every one of them badly: one left a full second of near silence, and
most landed on a quiet intro. So B always lands on A's next beat with the tail still ringing, and
never into a hole. Where B enters is the planner's job.
"""

from __future__ import annotations

from selecta.analysis.song import Cue, SongInfo
from selecta.render.script import Curve, Echo, Part, TransitionScript, Warp, Wash, fade_in

_DECLICK = 0.008
_LEAD_IN_BARS = 2
_AFTER_SECONDS = 8.0
"""Long enough for the audit to hear where B settles, not just its first bar."""


def _next_vocal_room_beats(song: SongInfo, entry_time: float, beat: float) -> float:
    """How much rhythmic room B leaves before the next lyric can compete with A's tail."""
    if not song.vocals_known:
        return 0.5
    next_line = min((line.start for line in song.lines if line.start >= entry_time), default=None)
    if next_line is None:
        return 2.0
    return max(0.0, min((next_line - entry_time) / beat, 2.0))


def _tail_echo(entry: SongInfo, entry_cue: Cue, beat: float) -> Echo:
    """Keep a tail short when B's vocal arrives quickly; leave room when the intro is clear."""
    room = _next_vocal_room_beats(entry, entry_cue.time, beat) / 2.0
    # Echo is a send effect: a restrained floor keeps the handoff audible, while a clear
    # instrumental runway allows a longer, more obvious tail.
    feedback = 0.22 + 0.28 * room
    wet = 0.16 + 0.24 * room
    return Echo(
        delay_seconds=beat,
        feedback=feedback,
        wet=wet,
        return_highpass_hz=300.0,
    )


def _lead_in(a: SongInfo, exit_cue: Cue) -> float:
    return max(3.0, min(a.period * a.beats_per_bar * _LEAD_IN_BARS, exit_cue.time))


def cut_on_one(
    a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, bars: int = 0, **options
) -> TransitionScript | None:
    lead = _lead_in(a, exit_cue)
    cut = lead
    b_start = cut - _DECLICK * 1.5
    return TransitionScript(
        style="cut_on_one",
        duration=cut + _AFTER_SECONDS,
        a=Part(
            song=a,
            warp=Warp.identity(0.0, exit_cue.time - lead, lead + _DECLICK * 2),
            gain=Curve([(cut - _DECLICK * 0.25, 1.0), (cut + _DECLICK, 0.0)]),
        ),
        b=Part(
            song=b,
            warp=Warp.identity(
                b_start, entry_cue.time - _DECLICK * 1.5, _AFTER_SECONDS + _DECLICK * 1.5
            ),
            gain=Curve([(b_start, 0.0), (cut - _DECLICK * 0.25, 1.0)]),
        ),
        overlap=(cut, cut),
        meta={"cut": cut},
    )


def echo_out(
    a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, bars: int = 0, **options
) -> TransitionScript | None:
    """A's last beat rings on in time while B lands underneath it. There is no gap."""
    lead = _lead_in(a, exit_cue)
    beat = a.period
    send_from = lead - beat
    echo = _tail_echo(b, entry_cue, beat)
    return TransitionScript(
        style="echo_out",
        duration=lead + _AFTER_SECONDS,
        a=Part(
            song=a,
            warp=Warp.identity(0.0, exit_cue.time - lead, lead + 0.05),
            gain=Curve([(lead - 0.005, 1.0), (lead + 0.02, 0.0)]),
            echo=echo,
            echo_send=Curve(
                [(send_from - 0.02, 0.0), (send_from, 1.0), (lead, 1.0), (lead + 0.02, 0.0)]
            ),
        ),
        b=Part(
            song=b,
            warp=Warp.identity(lead, entry_cue.time, _AFTER_SECONDS),
            gain=fade_in(lead, lead + 0.02),
        ),
        overlap=(lead, lead + 0.02),
        meta={"cut": lead, "b_at": lead, "echo_wet": echo.wet, "echo_feedback": echo.feedback},
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
    vocal_room = _next_vocal_room_beats(b, entry_cue.time, beat) / 2.0
    echo = Echo(
        delay_seconds=beat,
        feedback=0.18 + 0.24 * vocal_room,
        wet=0.12 + 0.24 * vocal_room,
        return_highpass_hz=350.0,
    )
    return TransitionScript(
        style="delay_throw",
        duration=lead + _AFTER_SECONDS,
        a=Part(
            song=a,
            warp=Warp.identity(0.0, exit_cue.time - lead, lead + 0.05),
            gain=Curve([(lead - 0.005, 1.0), (lead + 0.015, 0.0)]),
            echo=echo,
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
            warp=Warp.identity(lead, entry_cue.time, _AFTER_SECONDS),
            gain=fade_in(lead, lead + 0.015),
        ),
        overlap=(lead, lead + 0.015),
        meta={"cut": lead, "echo_wet": echo.wet, "echo_feedback": echo.feedback},
    )


def reverb_wash(
    a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, bars: int = 2, **options
) -> TransitionScript | None:
    """Only A's last two beats go into the room. A longer send turns a full mix to mud, and the
    listener's note on the first reel was simply that the reverb wasn't nice."""
    beat = a.period
    wash_seconds = beat * 2
    lead = max(a.period * a.beats_per_bar * 2, 3.0)
    if exit_cue.time - lead < 0:
        return None
    fade_time = beat
    vocal_room = _next_vocal_room_beats(b, entry_cue.time, beat) / 2.0
    wash = Wash(
        wet=0.18 + 0.18 * vocal_room,
        decay_seconds=1.2 + 0.8 * vocal_room,
        damping=0.45,
        return_highpass_hz=350.0,
    )
    return TransitionScript(
        style="reverb_wash",
        duration=lead + _AFTER_SECONDS,
        a=Part(
            song=a,
            warp=Warp.identity(0.0, exit_cue.time - lead, lead + fade_time),
            gain=Curve([(lead - 0.01, 1.0), (lead + fade_time, 0.0)]),
            wash=wash,
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
            warp=Warp.identity(lead, entry_cue.time, _AFTER_SECONDS),
            gain=fade_in(lead, lead + beat / 2),
        ),
        overlap=(lead, lead + fade_time),
        meta={"cut": lead, "wash_wet": wash.wet, "wash_decay_seconds": wash.decay_seconds},
    )
