"""The real Beat This on the device-analysis golden songs (`--beat-this` of the golden tool).

For each synthetic song, the Desktop's own tracker (``beats.py::BeatTracker``, checkpoint
``small0``, minimal postprocessing) runs twice:

  - ``port``: on the 22,050 Hz signal the browser's resampler makes (``sinc_resample``). The
    browser's Beat This (``web/src/dsp/analysis/beatThis/``) must match this one: sample
    spectrogram frames within 1e-4, every logit within 1e-3, every beat within one 20 ms frame.
  - ``desktop``: on soxr's signal, as the Desktop runs. The difference between the two is what
    the resampler choice costs, recorded per song.

Then the whole measurement (``analyse``) runs on the port signal with the port's beats, so the
browser's ``measureSong`` with Beat This has a reference for every planner fact. Kept in a module
of its own so the original fixtures stay byte-identical and this one imports torch only here.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soxr

from selecta.analysis.beats import BeatTracker
from selecta.config import SAMPLE_RATE

FEATURE_SR = 22_050
FPS = 50
SPECT_SAMPLE_FRAMES = (0, 1, 7, 100, 777)


def _f32(values) -> list[float]:
    return [float(f"{float(v):.9g}") for v in np.asarray(values, dtype=np.float64).ravel()]


def _f64(values) -> list[float]:
    return [float(v) for v in np.asarray(values, dtype=np.float64).ravel()]


def desktop_signal(stereo: np.ndarray, rate: int) -> np.ndarray:
    """The Desktop's 22,050 Hz mono: ffmpeg to 44.1 kHz (soxr stands in), then soxr HQ."""
    if rate != SAMPLE_RATE:
        stereo = soxr.resample(stereo, rate, SAMPLE_RATE, quality="HQ").astype(np.float32)
    mono = stereo.mean(axis=1)
    return soxr.resample(mono, SAMPLE_RATE, FEATURE_SR, quality="HQ").astype(np.float32)


def nearest_gap_ms(a: np.ndarray, b: np.ndarray) -> float:
    """The largest distance from a beat in either list to the nearest in the other, in ms."""
    if a.size == 0 and b.size == 0:
        return 0.0
    if a.size == 0 or b.size == 0:
        return float("inf")
    one = np.abs(a[:, None] - b[None, :]).min(axis=1).max()
    two = np.abs(b[:, None] - a[None, :]).min(axis=1).max()
    return float(max(one, two) * 1000)


def track(tracker: BeatTracker, mono_22k: np.ndarray) -> dict:
    from beat_this.inference import Audio2Frames

    model = tracker._model
    signal = mono_22k.astype(np.float64)
    spect = model.signal2spect(signal, FEATURE_SR).numpy()
    beat, downbeat = Audio2Frames.__call__(model, signal, FEATURE_SR)
    beats, downbeats = tracker.raw(mono_22k, FEATURE_SR)
    return {
        "spect": spect,
        "beat": beat.numpy(),
        "downbeat": downbeat.numpy(),
        "beats": beats,
        "downbeats": downbeats,
    }


def write_beat_this(folder: Path, songs: list[dict], render, analyse, sinc_resample) -> None:
    import beat_this
    import torch

    folder.mkdir(parents=True, exist_ok=True)
    tracker = BeatTracker("small0")
    entries = []
    for song in songs:
        stereo = render(song)
        rate = song["sampleRate"]
        port_signal = sinc_resample(stereo.mean(axis=1), rate, FEATURE_SR)
        port = track(tracker, port_signal)
        desktop = track(tracker, desktop_signal(stereo, rate))
        frames = [f for f in SPECT_SAMPLE_FRAMES if f < port["spect"].shape[0]]
        frames.append(port["spect"].shape[0] - 1)
        with_beats = {
            **song,
            "rawBeats": _f64(port["beats"]),
            "rawDownbeats": _f64(port["downbeats"]),
        }
        measured = analyse(stereo, rate, with_beats, sinc_resample)
        agreement = {
            "beatsMs": nearest_gap_ms(port["beats"], desktop["beats"]),
            "downbeatsMs": nearest_gap_ms(port["downbeats"], desktop["downbeats"]),
            "beatCounts": [int(port["beats"].size), int(desktop["beats"].size)],
        }
        result = {
            "name": song["name"],
            "monoLength": int(port_signal.size),
            "frames": int(port["spect"].shape[0]),
            "spectSampleFrames": frames,
            "spect": [_f32(port["spect"][f]) for f in frames],
            "logits": {"beat": _f32(port["beat"]), "downbeat": _f32(port["downbeat"])},
            "port": {"beats": _f64(port["beats"]), "downbeats": _f64(port["downbeats"])},
            "desktop": {"beats": _f64(desktop["beats"]), "downbeats": _f64(desktop["downbeats"])},
            "resamplerEffect": agreement,
            "measured": {
                key: measured[key]
                for key in ("regularizedBeats", "grid", "features", "row", "barFrames")
                if key in measured
            },
        }
        file = f"{song['name']}.json"
        (folder / file).write_text(
            json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n"
        )
        entries.append({"name": song["name"], "file": file, "resamplerEffect": agreement})
        print(f"beat-this {song['name']}: {json.dumps(agreement)}")
    manifest = {
        "checkpoint": "small0",
        "postprocessor": "minimal",
        "fps": FPS,
        "versions": {
            "beat_this": getattr(beat_this, "__version__", "1.1.0"),
            "torch": torch.__version__,
        },
        "songs": entries,
    }
    (folder / "manifest.json").write_text(
        json.dumps(manifest, indent=1) + "\n", encoding="utf-8", newline="\n"
    )
