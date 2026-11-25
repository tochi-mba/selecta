"""Stem seams as scripts: each song's separated lanes as parts on one timeline.

The Seam Studio, strip and land and intertwined stems used to mix their own stems outside the
engine, so they never got the pocket nudge, the second take that lines the beats up, or a vocal
check that heard the real voices. With `render.one_engine` on they describe themselves with a
script built here and play through `render.engine.render` like every other move.

The hand-over is the old one, kept: the clip starts where native A hands over to A's stems, and
B's stems hand over to B's full mix at the end of the overlap with the same 30 ms linear
crossfade `in_context` used there. What's new is a short stretch of B's full mix after it, where
the pocket nudge eases B back onto its own audio before native B carries on.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import soundfile as sf

from selecta.analysis.song import SongInfo
from selecta.analysis.vocal_sense import spans_in
from selecta.render.script import Curve, Part, TransitionScript, Warp

LANES = ("vocals", "drums", "bass", "other")
HANDOVER_SECONDS = 0.03
"""The same length as `engine._SEAM_SECONDS`, where the old clip's stems met native B."""
TAIL_SECONDS = 2.0
"""B's full mix after the overlap. `engine._pocket_lag` needs a second or more there to fade
its nudge out, so B still arrives exactly on its native audio where the clip ends."""
AUDIBLE = 0.25
"""Under this gain a voice lane isn't singing: the level the audit's vocal check uses."""
_STEP = 0.01
_READ_PAST = 0.02


@dataclass(frozen=True)
class Lane:
    """One separated stem of one song, and its level over the overlap."""

    path: str
    origin: float
    """The song second where the stem file begins."""
    seconds: float
    """How long the separated window is."""
    gain: Curve


def _handed_over(gain: Curve, seconds: float) -> Curve:
    """The lane's own level up to the end of the overlap, then down to nothing as B's full mix
    comes up. Points inside the overlap are untouched, so the level there is exactly the lane's."""
    inside = gain.times <= seconds
    points = list(zip(gain.times[inside].tolist(), gain.values[inside].tolist(), strict=True))
    if not points or points[-1][0] < seconds:
        points.append((seconds, float(np.interp(seconds, gain.times, gain.values))))
    points.append((seconds + HANDOVER_SECONDS, 0.0))
    return Curve(points)


def stem_script(
    style: str,
    a: SongInfo,
    b: SongInfo,
    seconds: float,
    a_start: float,
    b_output: np.ndarray,
    b_source: np.ndarray,
    lanes: dict[tuple[str, str], Lane],
    meta: dict,
) -> TransitionScript:
    """Eight lanes as one script. Each side's drums are its main part, so the pocket nudge
    measures drums against drums; every other lane of B is an extra that takes the same nudge.

    `b_output` and `b_source` pin B's bars onto A's, in output and song seconds. A lane that never
    sounds is left out, since it would add nothing but time."""
    duration = seconds + TAIL_SECONDS
    b_end = float(b_source[-1])
    warps = {
        "a": Warp.identity(0.0, a_start, duration),
        "b": Warp(np.append(b_output, duration), np.append(b_source, b_end + TAIL_SECONDS)),
    }
    songs = {"a": a, "b": b}

    def part(side: str, stem: str, extra: bool) -> Part:
        lane = lanes[(side, stem)]
        return Part(
            song=songs[side],
            warp=warps[side],
            source_path=lane.path,
            window_origin=lane.origin,
            stem=stem,
            stem_seconds=lane.seconds,
            gain=_handed_over(lane.gain, seconds),
            render_until=seconds + HANDOVER_SECONDS + _READ_PAST,
            follows_b=extra and side == "b",
        )

    extras = [
        part(side, stem, True)
        for side in ("a", "b")
        for stem in LANES
        if stem != "drums" and not lanes[(side, stem)].gain.is_constant(0.0)
    ]
    extras.append(
        Part(
            song=b,
            warp=Warp.identity(seconds, b_end, TAIL_SECONDS),
            gain=Curve([(seconds, 0.0), (seconds + HANDOVER_SECONDS, 1.0)]),
            follows_b=True,
        )
    )
    return TransitionScript(
        style=style,
        duration=duration,
        a=part("a", "drums", False),
        b=part("b", "drums", False),
        overlap=(0.0, seconds),
        expects_beats_aligned=True,
        extras=extras,
        meta={**meta, "period": a.period, "stem_lanes": True},
    )


def _runs(source: np.ndarray, mask: np.ndarray) -> list[tuple[float, float]]:
    edges = np.flatnonzero(np.diff(np.concatenate(([0], mask.astype(np.int8), [0]))))
    return [
        (float(source[start]), float(source[min(end, source.size - 1)]))
        for start, end in zip(edges[::2], edges[1::2], strict=True)
    ]


def _heard_singing(part: Part) -> list[tuple[float, float]]:
    """Where this voice lane really sings and is turned up, in song seconds."""
    voice, rate = sf.read(part.source_path, dtype="float32")
    sung = spans_in(voice, rate, part.window_origin)
    if not sung:
        return []
    end = part.output_end if part.render_until is None else part.render_until
    times = np.arange(part.output_start, end, _STEP)
    source = np.asarray(part.warp.source_at(times))
    singing = np.zeros(times.size, dtype=bool)
    for start, stop in sung:
        singing |= (source >= start) & (source <= stop)
    up = np.interp(times, part.gain.times, part.gain.values) >= AUDIBLE
    return _runs(source, singing & up)


def vocal_spans(script: TransitionScript) -> dict[str, list[tuple[float, float]]]:
    """Singing measured from the voice stems the script already plays, for `audit(vocal_spans=)`.
    A muted voice lane isn't singing, and a lane left out of the script never sounds at all."""
    found: dict[str, list[tuple[float, float]]] = {"a": [], "b": []}
    for part in (script.a, script.b, *script.extras):
        if part.stem != "vocals" or not part.source_path:
            continue
        side = "b" if part.follows_b or part is script.b else "a"
        found[side].extend(_heard_singing(part))
    return {side: sorted(spans) for side, spans in found.items()}
