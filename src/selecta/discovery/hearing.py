"""Playing back what Selecta detected, so a person can check it by ear.

A claim that two passages share a chord pattern is hard to judge from two buttons and a memory. So
this makes the claim audible: the chords it read, played plainly, then each passage with those
chords underneath, with the second moved to the first's key and speed, then both at once. If the
reading is right, the chords will sit inside both songs. If it's wrong, it'll be obvious.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf
from pedalboard import time_stretch

from selecta.analysis.song import SongInfo
from selecta.audio import decode
from selecta.config import SAMPLE_RATE, Settings
from selecta.render import dsp

NOTES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
MAJOR = (0, 4, 7)
MINOR = (0, 3, 7)
GUIDE_UNDER_SONG = 0.28
GUIDE_ALONE = 0.8
STEPS = ("chords", "a", "b", "both")


def read_chords(chroma: np.ndarray) -> list[tuple[int, bool]]:
    """The closest major or minor chord for each bar, as a root and whether it's minor."""
    chords = []
    for bar in np.asarray(chroma, dtype=float):
        best, best_score = (0, False), -1.0
        for root in range(12):
            for shape, minor in ((MAJOR, False), (MINOR, True)):
                score = float(sum(bar[(root + step) % 12] for step in shape))
                if score > best_score:
                    best, best_score = (root, minor), score
        chords.append(best)
    return chords


def chord_name(root: int, minor: bool) -> str:
    return f"{NOTES[root]}{'m' if minor else ''}"


def _tone(hertz: float, seconds: float) -> np.ndarray:
    """A soft keyboard note: easy to pick out, and not mistakable for anything in the songs."""
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    wave = np.sin(2 * np.pi * hertz * t) + 0.3 * np.sin(4 * np.pi * hertz * t)
    return wave * np.minimum(t / 0.015, 1.0) * np.exp(-t * 1.1)


def chord_track(
    chords: list[tuple[int, bool]], bar_starts: np.ndarray, seconds: float
) -> np.ndarray:
    """The chords read from the audio, played plainly, on the same bars as the first song."""
    track = np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)
    ends = [*bar_starts[1:], seconds]
    for (root, minor), start, end in zip(chords, bar_starts, ends, strict=False):
        begin = int(start * SAMPLE_RATE)
        length = max(end - start, 0.05)
        shape = MINOR if minor else MAJOR
        # the chord sits around middle C, whichever root it has, with its root an octave below
        notes = [261.63 * 2 ** (((root + step) % 12) / 12) for step in shape]
        notes.append(130.81 * 2 ** (root / 12) / 2)
        for hertz in notes:
            tone = _tone(hertz, length)
            stop = min(begin + tone.size, track.size)
            track[begin:stop] += tone[: stop - begin] * (0.22 if hertz > 130 else 0.3)
    return np.stack((track, track), axis=1)


def _fit(audio: np.ndarray, count: int) -> np.ndarray:
    if audio.shape[0] < count:
        return np.pad(audio, ((0, count - audio.shape[0]), (0, 0)))
    return audio[:count]


def _in_step(audio: np.ndarray, semitones: int, seconds: float) -> np.ndarray:
    """Move a passage to another key and length, so two passages can be compared directly."""
    current = audio.shape[0] / SAMPLE_RATE
    moved = time_stretch(
        audio.T,
        SAMPLE_RATE,
        stretch_factor=current / max(seconds, 0.1),
        pitch_shift_in_semitones=float(semitones),
        high_quality=True,
    )
    return _fit(moved.T.astype(np.float32), int(seconds * SAMPLE_RATE))


def audition_folder(settings: Settings, discovery_id: int) -> Path:
    return settings.renders_dir / "auditions" / str(int(discovery_id))


def make_audition(
    settings: Settings, discovery_id: int, a: SongInfo, b: SongInfo, payload: dict
) -> dict:
    """Render every step of hearing one candidate, once, and say what's on each bar."""
    folder = audition_folder(settings, discovery_id)
    saved = folder / "info.json"
    if saved.exists():
        return json.loads(saved.read_text("utf-8"))
    a_at, a_end = float(payload["a_at"]), float(payload["a_end"])
    b_at, b_end = float(payload["b_at"]), float(payload["b_end"])
    bars, shift = int(payload["bars"]), int(payload.get("transpose") or 0)
    a_bar, b_bar = int(payload["a_bar"]), int(payload["b_bar"])
    semitones = shift - 12 if shift > 6 else shift
    seconds = a_end - a_at
    count = int(seconds * SAMPLE_RATE)
    first = _fit(decode(a.path, a_at, seconds), count) * 10.0 ** (a.gain_db / 20.0)
    second_raw = decode(b.path, b_at, b_end - b_at) * 10.0 ** (b.gain_db / 20.0)
    second = _in_step(second_raw, semitones, seconds)
    chroma_a = a.chroma_bars[a_bar : a_bar + bars]
    chroma_b = np.roll(b.chroma_bars[b_bar : b_bar + bars], shift, axis=1)
    chords = read_chords(chroma_a + chroma_b)
    bar_starts = np.asarray(a.bar_times[a_bar : a_bar + bars], dtype=float) - a_at
    guide = chord_track(chords, bar_starts, seconds)[:count]
    guide = _fit(guide, count)
    takes = {
        "chords": guide * GUIDE_ALONE,
        "a": first + guide * GUIDE_UNDER_SONG,
        "b": second + guide * GUIDE_UNDER_SONG,
        "both": 0.7 * first + 0.7 * second,
    }
    folder.mkdir(parents=True, exist_ok=True)
    for name, audio in takes.items():
        sf.write(folder / f"{name}.flac", dsp.limit(audio), SAMPLE_RATE, subtype="PCM_16")
    info = {
        "chords": [chord_name(root, minor) for root, minor in chords],
        "bar_starts": [round(float(value), 3) for value in bar_starts],
        "seconds": round(seconds, 3),
        "semitones": semitones,
    }
    saved.write_text(json.dumps(info), "utf-8")
    return info
