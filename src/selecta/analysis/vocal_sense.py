"""Hearing whether anyone is singing, from the separated voice itself.

Lyrics only say where the lead vocal is, and only when a song has line-synced lyrics. They say
nothing about backing vocals, choirs or ad-libs: on the first listening reel two voices sang over
each other where the lyric file showed one. This listens to the demucs voice stem over just the
stretch a seam needs, so a song without lyrics can still earn a long blend, and "nobody is
singing" is checked rather than assumed.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from selecta import flags
from selecta.config import Settings

FRAME_SECONDS = 0.05
PRESENT_DB = -35.0
"""A voice stem louder than this is someone singing. Quieter is bleed or silence."""
MIN_SING_SECONDS = 0.3
"""Shorter bursts are consonants and bleed, not a line."""
JOIN_GAP_SECONDS = 0.35
"""A breath inside a line, not a gap between lines."""


def sense_on() -> bool:
    return flags.on("analysis.vocal_sense") and flags.on("stems")


def singing_spans(
    settings: Settings, source: Path, start: float, seconds: float
) -> list[tuple[float, float]] | None:
    """Stretches of audible singing inside this window of a song, in song time, or None when the
    voice can't be separated here. Separation is cached by window, so a seam that was rendered
    from stems has already paid for this."""
    if not sense_on() or seconds <= 0:
        return None
    from selecta.stems import separate_window

    start = max(start, 0.0)
    try:
        stems = separate_window(settings, source, start, seconds)
        voice, rate = sf.read(stems.vocals, dtype="float32")
    except Exception:
        return None
    if voice.ndim > 1:
        voice = voice.mean(axis=1)
    frame = max(int(FRAME_SECONDS * rate), 1)
    usable = voice.size - voice.size % frame
    if usable == 0:
        return []
    rms = np.sqrt(np.mean(voice[:usable].reshape(-1, frame) ** 2, axis=1))
    loud = 20.0 * np.log10(np.maximum(rms, 1e-9)) >= PRESENT_DB
    spans: list[tuple[float, float]] = []
    opened: float | None = None
    for index, present in enumerate([*loud, False]):
        time = start + index * FRAME_SECONDS
        if present and opened is None:
            opened = time
        elif not present and opened is not None:
            if spans and opened - spans[-1][1] <= JOIN_GAP_SECONDS:
                spans[-1] = (spans[-1][0], time)
            elif time - opened >= MIN_SING_SECONDS:
                spans.append((opened, time))
            opened = None
    return [span for span in spans if span[1] - span[0] >= MIN_SING_SECONDS]
