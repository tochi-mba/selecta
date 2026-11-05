"""Render a planned queue as one continuous set."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import numpy as np
import soundfile as sf

from selecta.analysis.song import SongInfo
from selecta.audit.checks import audit
from selecta.config import SAMPLE_RATE
from selecta.planner.choose import Choice, choose_transition, enumerate_candidates
from selecta.render import dsp
from selecta.render.engine import SongCache, render

SEAM_SECONDS = 0.03


def _native(cache: SongCache, song: SongInfo, start: float, end: float) -> np.ndarray:
    audio = cache.get(song.path)
    lo = max(0, int(round(start * SAMPLE_RATE)))
    hi = min(audio.shape[0], int(round(end * SAMPLE_RATE)))
    gain = 10.0 ** (song.gain_db / 20.0)
    return audio[lo:hi] * gain


def join(parts: list[np.ndarray], seam_seconds: float = SEAM_SECONDS) -> np.ndarray:
    """Join timeline-adjacent pieces with a tiny equal-gain declick."""
    if not parts:
        return np.zeros((0, 2), dtype=np.float32)
    out = parts[0].astype(np.float32, copy=True)
    for part in parts[1:]:
        part = part.astype(np.float32, copy=False)
        seam = min(int(seam_seconds * SAMPLE_RATE), out.shape[0], part.shape[0])
        if seam:
            up = np.linspace(0.0, 1.0, seam, dtype=np.float32)[:, None]
            merged = out[-seam:] * (1.0 - up) + part[:seam] * up
            out = np.concatenate((out[:-seam], merged, part[seam:]))
        else:
            out = np.concatenate((out, part))
    return out


def render_set(
    songs: list[SongInfo],
    output: Path,
    log: Callable[[str], None] = print,
) -> tuple[list[Choice], float]:
    if len(songs) < 2:
        raise ValueError("a set needs at least two songs")
    cache = SongCache(capacity=3)
    choices: list[Choice] = []
    for number, (a, b) in enumerate(zip(songs, songs[1:], strict=False), 1):
        if choices:
            earliest = choices[-1].rendered.script.b_source_end + 8.0
            choice = _choose_after(a, b, earliest, cache)
        else:
            choice = choose_transition(a, b, cache=cache)
        if not choice.report.passed:
            failed = ", ".join(check.name for check in choice.report.failures)
            raise RuntimeError(f"transition {number} failed its audit: {failed}")
        choices.append(choice)
        log(f"{number}/{len(songs) - 1} {a.name} -> {b.name}: {choice.rendered.script.style}")

    parts: list[np.ndarray] = []
    first_script = choices[0].rendered.script
    parts.append(_native(cache, songs[0], 0.0, first_script.a_source_start))
    for index, choice in enumerate(choices):
        rendered_audio = choice.rendered.audio
        if index + 1 < len(choices):
            current = songs[index + 1]
            end = choices[index + 1].rendered.script.a_source_start
            script = choice.rendered.script
            start = script.b_source_end
            if end <= start + 4.0:
                # A transition clip carries a few seconds of B for auditioning. In a full set,
                # hand that preview tail back to the identical native song early enough to leave
                # room before B's own exit. This changes no cue or cross-song overlap.
                desired_source = end - 4.0
                clip_end = float(script.b.warp.output_at(desired_source))
                clip_end = max(script.overlap[1] + 0.5, min(clip_end, script.duration))
                rendered_audio = rendered_audio[: int(round(clip_end * SAMPLE_RATE))]
                start = float(script.b.warp.source_at(clip_end))
            if end <= start:
                raise RuntimeError(f"the planned cues overlap inside {current.name}")
            parts.append(rendered_audio)
            parts.append(_native(cache, current, start, end))
        else:
            parts.append(rendered_audio)
    last_script = choices[-1].rendered.script
    parts.append(_native(cache, songs[-1], last_script.b_source_end, songs[-1].duration))

    mixed = dsp.limit(join(parts))
    output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output, mixed, SAMPLE_RATE, subtype="PCM_16")
    return choices, mixed.shape[0] / SAMPLE_RATE


def _choose_after(a: SongInfo, b: SongInfo, earliest: float, cache: SongCache) -> Choice:
    """Choose an audited handoff that leaves the current song time to play first."""
    for candidate in enumerate_candidates(a, b):
        script = candidate.recipe.make(
            a, b, candidate.exit_cue, candidate.entry_cue, candidate.bars
        )
        if script is None or script.a_source_start < earliest:
            continue
        rendered = render(script, cache)
        report = audit(rendered)
        if report.passed:
            return Choice(rendered, report, candidate)
    raise RuntimeError(f"no audited transition out of {a.name} occurs after {earliest:.1f}s")
