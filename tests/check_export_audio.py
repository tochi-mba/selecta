"""Does an exported file really contain the songs it says, in the order it says?

Run by the browser tests, on a file downloaded the way a person would get it:

    python tests/check_export_audio.py report.json export.flac one.flac two.flac --not other.flac

It decodes the export, then looks for each song's own audio inside it. Everything outside a
transition is copied from the song untouched, so a stretch of each one should turn up almost
exactly, and those places should be in the order given. A song that isn't in the mix should turn
up nowhere, which is what shows this can tell songs apart at all. It measures what's in the file.
It can't say how it sounds.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

RATE = 4000  # plenty to tell songs apart, and small enough to search quickly
WINDOW_SECONDS = 6.0
STEP_SECONDS = 4.0


def _mono(path: Path) -> tuple[np.ndarray, int, int, float]:
    audio, rate = sf.read(path, dtype="float32", always_2d=True)
    channels = audio.shape[1]
    seconds = audio.shape[0] / rate
    mono = audio.mean(axis=1)
    step = max(int(round(rate / RATE)), 1)
    # an average over each step, so nothing above the new rate folds back into it
    usable = mono[: mono.size - mono.size % step].reshape(-1, step).mean(axis=1)
    return usable, rate // step, channels, seconds


def _best_match(needle: np.ndarray, haystack: np.ndarray) -> tuple[float, int]:
    """How closely `needle` appears anywhere in `haystack`, from 0 to 1, and where. This is
    normalised cross-correlation, so a change of level doesn't matter, only a change of content."""
    size = needle.size + haystack.size
    length = int(2 ** np.ceil(np.log2(size)))
    needle = needle - needle.mean()
    spread = float(np.sqrt(np.sum(needle**2)))
    if spread == 0:
        return 0.0, 0
    product = np.fft.rfft(haystack, length) * np.conj(np.fft.rfft(needle, length))
    correlated = np.fft.irfft(product, length)[: haystack.size - needle.size + 1]
    running = np.cumsum(np.concatenate(([0.0], haystack)))
    running_squares = np.cumsum(np.concatenate(([0.0], haystack**2)))
    total = running[needle.size :] - running[: -needle.size]
    squares = running_squares[needle.size :] - running_squares[: -needle.size]
    variance = np.maximum(squares - total**2 / needle.size, 1e-9)
    score = correlated / (spread * np.sqrt(variance))
    at = int(np.argmax(score))
    return float(score[at]), at


def locate(song: Path, export: np.ndarray) -> dict:
    """The stretch of this song that matches the export best, of the many tried along its length."""
    audio, rate, _, seconds = _mono(song)
    window = int(WINDOW_SECONDS * rate)
    step = int(STEP_SECONDS * rate)
    best = {"score": -1.0, "seconds_into_export": 0.0, "seconds_into_song": 0.0}
    for start in range(0, max(audio.size - window, 1), step):
        score, at = _best_match(audio[start : start + window], export)
        if score > best["score"]:
            best = {
                "score": round(score, 4),
                "seconds_into_export": round(at / rate, 2),
                "seconds_into_song": round(start / rate, 2),
            }
    return {"song": song.name, "seconds": round(seconds, 2), **best}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("export", type=Path)
    parser.add_argument("songs", type=Path, nargs="+")
    parser.add_argument("--not", dest="absent", type=Path, action="append", default=[])
    args = parser.parse_args()

    info = sf.info(args.export)
    export, _, _, _ = _mono(args.export)
    report = {
        "format": info.format,
        "subtype": info.subtype,
        "samplerate": info.samplerate,
        "channels": info.channels,
        "seconds": round(info.frames / info.samplerate, 3),
        "songs": [locate(song, export) for song in args.songs],
        "absent": [locate(song, export) for song in args.absent],
    }
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
