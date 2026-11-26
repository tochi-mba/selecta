"""Generate the golden fixtures for whole-song measurement in the browser (device studio, phase 5).

Synthesises a handful of short songs from code, runs the REAL Desktop analysis functions over
them, and writes every intermediate and final value under
``web/src/dsp/golden/device-analysis/``. The browser side (``web/src/dsp/analysis/``) renders
the same songs from the same event lists (``synth.ts``), runs its TypeScript ports and compares.
The contract both follow is ``docs/engineering/device-analysis.md``.

Each song is measured twice:
  - ``port``: the Desktop functions (``onset_envelope``, ``build_grid``, ``extract``,
    ``chroma_key``, ``loudness``, ``waveform_peaks``) fed a 22,050 Hz signal made by the
    windowed-sinc resampler below, which is the browser's resampler (``resample.ts``) written
    in numpy. Every stage of the port must match this one nearly exactly.
  - ``desktop``: the same functions fed the Desktop's own resample (``soxr`` at quality "HQ",
    as ``analysis/pipeline.py`` does). The port must match this one within the planner's
    tolerances; the manifest records how far the two references differ, per measurement.

The neural beat tracker is not imported: the songs are generated, so their beat times are known,
and they go in where Beat This would (rounded to its 20 ms frames, as it reports them). Nothing
here downloads anything or touches the network.

Script only - run by hand when the Python analysis or the port's recipe changes:

    python tools/device_analysis_golden.py [--out FOLDER]
"""

from __future__ import annotations

import argparse
import json
import math
from math import gcd
from pathlib import Path

import librosa
import numpy as np
import pyloudnorm
import scipy
import scipy.signal
import soxr

from selecta.analysis.beats import build_grid, onset_envelope, regularize
from selecta.analysis.features import (
    FEATURE_SR,
    HOP,
    N_FFT,
    _aggregate,
    _bar_frames,
    extract,
    loudness,
    waveform_peaks,
)
from selecta.analysis.key import camelot, chroma_key
from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE

OUTPUT = (
    Path(__file__).resolve().parent.parent / "web" / "src" / "dsp" / "golden" / "device-analysis"
)

# --- The browser's resampler, in numpy: the shared contract with resample.ts -------------------

RESAMPLE_ZEROS = 28
RESAMPLE_ROLLOFF = 0.97
RESAMPLE_BETA = 9.0


def bessel_i0(x: float) -> float:
    """Modified Bessel function of the first kind, order 0, by its power series (as resample.ts)."""
    total, term, k = 1.0, 1.0, 1
    half = x / 2.0
    while True:
        term *= (half / k) * (half / k)
        total += term
        if term < 1e-21 * total:
            return total
        k += 1


def resample_taps(rate_in: int, rate_out: int) -> tuple[np.ndarray, int, int, int]:
    """One row of taps per output phase, each normalised to unit sum; offsets -reach..reach."""
    common = gcd(rate_in, rate_out)
    up, down = rate_out // common, rate_in // common
    cutoff = RESAMPLE_ROLLOFF * min(1.0, up / down)
    half = RESAMPLE_ZEROS / cutoff
    reach = math.ceil(half)
    norm = bessel_i0(RESAMPLE_BETA)
    taps = np.zeros((up, 2 * reach + 1))
    for phase in range(up):
        frac = phase / up
        for column, offset in enumerate(range(-reach, reach + 1)):
            distance = frac - offset
            if abs(distance) >= half:
                continue
            u = distance / half
            window = bessel_i0(RESAMPLE_BETA * math.sqrt(1.0 - u * u)) / norm
            x = cutoff * distance
            sinc = 1.0 if x == 0 else math.sin(math.pi * x) / (math.pi * x)
            taps[phase, column] = cutoff * sinc * window
        taps[phase] /= sum(float(v) for v in taps[phase])
    return taps, up, down, reach


def sinc_resample(signal: np.ndarray, rate_in: int, rate_out: int) -> np.ndarray:
    """Output n sits at input position n * rate_in / rate_out; zeros outside the signal."""
    if rate_in == rate_out:
        return signal.astype(np.float32)
    taps, up, down, reach = resample_taps(rate_in, rate_out)
    length = signal.size
    count = (length * up + down - 1) // down
    position = np.arange(count, dtype=np.int64) * down
    base, phase = position // up, position % up
    source = signal.astype(np.float64)
    total = np.zeros(count)
    for column, offset in enumerate(range(-reach, reach + 1)):
        index = base + offset
        inside = (index >= 0) & (index < length)
        total += taps[phase, column] * np.where(inside, source[np.clip(index, 0, length - 1)], 0.0)
    return total.astype(np.float32)


def soxr_resample(signal: np.ndarray, rate_in: int, rate_out: int) -> np.ndarray:
    return soxr.resample(signal, rate_in, rate_out, quality="HQ").astype(np.float32)


# --- Synthesis: the shared contract with synth.ts (same formulas, same order) ------------------

MASK = 0xFFFFFFFF


def hash_noise(index: np.ndarray, seed: int) -> np.ndarray:
    """White noise in [-1, 1) from a 32-bit integer hash of the sample index (lowbias32)."""
    x = (index.astype(np.uint64) + np.uint64((seed * 0x9E3779B9) & MASK)) & np.uint64(MASK)
    x ^= x >> np.uint64(16)
    x = (x * np.uint64(0x7FEB352D)) & np.uint64(MASK)
    x ^= x >> np.uint64(15)
    x = (x * np.uint64(0x846CA68B)) & np.uint64(MASK)
    x ^= x >> np.uint64(16)
    return x.astype(np.float64) / 4294967296.0 * 2.0 - 1.0


def render(song: dict) -> np.ndarray:
    """Stereo float32 (samples, 2), element for element as `renderSong` in synth.ts."""
    rate = song["sampleRate"]
    length = math.floor(song["durationS"] * rate + 0.5)
    left = np.zeros(length)
    right = np.zeros(length)
    two_pi = 2.0 * math.pi
    for event in song["events"]:
        first = math.floor(event["at"] * rate + 0.5)
        count = math.floor(event["dur"] * rate + 0.5)
        stop = min(first + count, length)
        if stop <= first:
            continue
        index = np.arange(first, stop, dtype=np.int64)
        tau = index / rate - event["at"]
        amp = event["amp"]
        kind = event["kind"]
        if kind == "kick":
            sweep = 45.0 * tau + 4.4 * (1.0 - np.exp(-tau / 0.04))
            voice = amp * np.sin(two_pi * sweep) * np.exp(-tau / 0.12)
        elif kind == "hat":
            voice = amp * hash_noise(index, event["seed"]) * np.exp(-tau / 0.012)
        elif kind == "snare":
            body = 0.6 * hash_noise(index, event["seed"]) + 0.4 * np.sin(two_pi * 190.0 * tau)
            voice = amp * body * np.exp(-tau / 0.07)
        elif kind == "tone":
            attack = event.get("attack", 0.01)
            shape = np.minimum(np.minimum(tau / attack, 1.0), (event["dur"] - tau) / 0.02)
            shape = np.maximum(shape, 0.0)
            wave = np.zeros(tau.size)
            for freq in event["freqs"]:
                for harmonic, weight in enumerate(event["harmonics"], start=1):
                    wave += weight * np.sin(two_pi * freq * harmonic * tau)
            voice = amp * shape * wave
        else:
            raise ValueError(f"Unknown event kind {kind!r}")
        left[first:stop] += voice * event["left"]
        right[first:stop] += voice * event["right"]
    return np.stack((left, right), axis=1).astype(np.float32)


def note(midi: int, a4: float = 442.0) -> float:
    return a4 * 2.0 ** ((midi - 69) / 12.0)


def _tone(at, dur, midis, amp, harmonics, pan=(1.0, 1.0), attack=0.01):
    return {
        "kind": "tone",
        "at": round(at, 9),
        "dur": round(dur, 9),
        "freqs": [round(note(m), 9) for m in midis],
        "amp": amp,
        "harmonics": harmonics,
        "attack": attack,
        "left": pan[0],
        "right": pan[1],
    }


def _hit(kind, at, amp, seed=0, pan=(1.0, 1.0), dur=None):
    lengths = {"kick": 0.35, "hat": 0.06, "snare": 0.25}
    return {
        "kind": kind,
        "at": round(at, 9),
        "dur": dur or lengths[kind],
        "amp": amp,
        "seed": seed,
        "left": pan[0],
        "right": pan[1],
    }


def tracker_view(times: list[float]) -> list[float]:
    """Times as Beat This reports them: on its 50 frames per second grid."""
    return [round(round(t / 0.02) * 0.02, 6) for t in times]


def groove_song(
    name, rate, duration, bpm, start, meter, roots, chords, kicks, snares, hats, quiet_bars=()
):
    """A song on a steady grid: drums by beat offsets within the bar, bass and a pad per bar."""
    period = 60.0 / bpm
    beats = []
    t = start
    while t < duration - 0.2:
        beats.append(t)
        t = start + len(beats) * period
    events, seed = [], 1
    bars = len(beats) // meter
    for bar in range(bars):
        at = beats[bar * meter]
        chord = bar % len(roots)
        quiet = bar in quiet_bars
        for offset in kicks:
            if not quiet:
                events.append(_hit("kick", at + offset * period, 0.5))
        for offset in snares:
            if not quiet:
                events.append(_hit("snare", at + offset * period, 0.2, seed, (1.1, 0.9)))
                seed += 1
        # a quiet bar is a breakdown: the pad alone, louder
        for offset in hats:
            if not quiet:
                events.append(_hit("hat", at + offset * period, 0.1, seed, (0.7, 1.3)))
                seed += 1
        for beat in range(meter):
            if not quiet:
                events.append(
                    _tone(at + beat * period, period * 0.85, [roots[chord]], 0.14, [1.0, 0.5, 0.25])
                )
        pad_amp = 0.055 if quiet else 0.03
        events.append(
            _tone(at, period * meter, chords[chord], pad_amp, [1.0, 0.3], (1.2, 0.8), 0.05)
        )
    downbeats = [beats[i] for i in range(0, bars * meter, meter)]
    return {
        "name": name,
        "sampleRate": rate,
        "durationS": duration,
        "events": events,
        "rawBeats": tracker_view(beats[: bars * meter]),
        "rawDownbeats": tracker_view(downbeats),
        "trueBpm": bpm,
    }


def drift_song():
    """A live drummer: tempo creeping from 98 to 106 BPM, and a tracker that wobbles by up to
    15 ms, so the grid must follow the tempo instead of fitting one straight line."""
    rate, duration = 44_100, 30.0
    beats, t, k = [], 0.3, 0
    while t < duration - 0.3:
        beats.append(t)
        k += 1
        t += 60.0 / (98.0 + 8.0 * min(1.0, t / duration))
    beats = beats[: len(beats) - len(beats) % 4]
    jitter = hash_noise(np.arange(len(beats)), 77) * 0.015
    raw = [b + float(j) for b, j in zip(beats, jitter, strict=True)]
    roots, chords = [40, 48, 43, 50], [[64, 67, 71], [60, 64, 67], [62, 67, 71], [62, 66, 69]]
    events, seed = [], 500
    for i, at in enumerate(beats):
        bar, beat = divmod(i, 4)
        if beat in (0, 2):
            events.append(_hit("kick", at, 0.5))
        else:
            events.append(_hit("snare", at, 0.2, seed, (1.1, 0.9)))
            seed += 1
        events.append(_hit("hat", at, 0.1, seed, (0.7, 1.3)))
        seed += 1
        nxt = beats[i + 1] if i + 1 < len(beats) else at + 0.6
        events.append(_tone(at, (nxt - at) * 0.85, [roots[bar % 4]], 0.14, [1.0, 0.5, 0.25]))
        if beat == 0:
            end = beats[i + 4] if i + 4 < len(beats) else at + 2.4
            events.append(_tone(at, end - at, chords[bar % 4], 0.03, [1.0, 0.3], (1.2, 0.8), 0.05))
    downbeats = [beats[i] for i in range(0, len(beats), 4)]
    # the tracker misses two downbeats, as it does in a real song's quiet stretch
    downbeats = [d for j, d in enumerate(downbeats) if j not in (3, 4)]
    return {
        "name": "live-drift-98-106-e-minor",
        "sampleRate": rate,
        "durationS": duration,
        "events": events,
        "rawBeats": tracker_view(raw),
        "rawDownbeats": tracker_view(downbeats),
        "trueBpm": None,
    }


def pad_song():
    """No drums at all: there is no beat to find, so the analysis must say so."""
    events = []
    chords = [[52, 56, 59, 64], [49, 52, 56, 61], [57, 61, 64, 69], [59, 63, 66, 71]]
    for i, chord in enumerate(chords):
        events.append(_tone(i * 6.0, 6.0, chord, 0.08, [1.0, 0.3], (1.2, 0.8), 1.5))
    return {
        "name": "beatless-pad-e-major",
        "sampleRate": 44_100,
        "durationS": 24.0,
        "events": events,
        "rawBeats": [],
        "rawDownbeats": [],
        "trueBpm": None,
    }


def songs() -> list[dict]:
    four = [0, 1, 2, 3]
    offbeats = [0.5, 1.5, 2.5, 3.5]
    return [
        # Beats at .25 + k/2 s fall midway between Beat This's 20 ms frames, so the reported
        # beats alternate 10 ms early and late; the median interval is then 0.52 s and
        # `_constant_grid`'s 3 percent search around it never reaches 0.50 s. Python reads this
        # steady song as moving (constant_tempo 0, 119.87 BPM). Kept: the port must agree.
        groove_song(
            "house-120-a-minor",
            44_100,
            32.0,
            120.0,
            0.25,
            4,
            [45, 41, 48, 43],
            [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],
            four,
            [],
            offbeats,
            quiet_bars=(8, 9, 10, 11),
        ),
        groove_song(
            "swing-93-c-then-d-major",
            44_100,
            36.0,
            93.0,
            0.1,
            4,
            [48, 45, 41, 43, 50, 47, 43, 45],
            [
                [60, 64, 67],
                [57, 60, 64],
                [53, 57, 60],
                [55, 59, 62],
                [62, 66, 69],
                [59, 62, 66],
                [55, 59, 62],
                [57, 61, 64],
            ],
            [0, 2],
            [1, 3],
            [0, 2 / 3, 1, 5 / 3, 2, 8 / 3, 3, 11 / 3],
        ),
        groove_song(
            "break-174-f-minor",
            44_100,
            24.0,
            174.0,
            0.05,
            4,
            [41, 37, 44, 39],
            [[53, 56, 60], [49, 53, 56], [56, 60, 63], [51, 55, 58]],
            [0, 2.5],
            [1, 3],
            [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
        ),
        groove_song(
            "waltz-132-g-major",
            44_100,
            30.0,
            132.0,
            0.2,
            3,
            [43, 48, 50, 43],
            [[55, 59, 62], [55, 60, 64], [54, 57, 62], [55, 59, 62]],
            [0],
            [],
            [1, 2],
        ),
        pad_song(),
        groove_song(
            "house-124-d-minor-48k",
            48_000,
            28.0,
            124.0,
            0.15,
            4,
            [50, 46, 41, 48],
            [[62, 65, 69], [58, 62, 65], [57, 60, 65], [55, 60, 64]],
            four,
            [],
            offbeats,
            quiet_bars=(6, 7),
        ),
        drift_song(),
    ]


# --- Measuring ---------------------------------------------------------------------------------


def f32(values) -> list[float]:
    """float32 values written with 9 significant digits, which round-trips any float32."""
    return [float(f"{float(v):.9g}") for v in np.asarray(values, dtype=np.float64).ravel()]


def f64(values) -> list[float]:
    return [float(v) for v in np.asarray(values, dtype=np.float64).ravel()]


SAMPLE_FRAMES = (0, 7, 40, 200)


def frame_level(mono_22k: np.ndarray) -> dict:
    """The frame-level values `features.extract` aggregates (the same calls, lines 57 to 67)."""
    power = np.abs(librosa.stft(mono_22k, n_fft=N_FFT, hop_length=HOP)) ** 2
    frequencies = librosa.fft_frequencies(sr=FEATURE_SR, n_fft=N_FFT)
    mel = librosa.feature.melspectrogram(S=power, sr=FEATURE_SR, n_mels=64)
    log_mel = librosa.power_to_db(mel, top_db=80)
    mfcc = librosa.feature.mfcc(S=log_mel, n_mfcc=20)
    tuning = librosa.estimate_tuning(S=power, sr=FEATURE_SR, bins_per_octave=12)
    chroma = librosa.feature.chroma_stft(S=power, sr=FEATURE_SR)
    rms_db = 10.0 * np.log10(np.maximum(power.sum(axis=0) / N_FFT, 1e-10))
    low_share = power[frequencies < 200].sum(axis=0) / np.maximum(power.sum(axis=0), 1e-10)
    flux = np.maximum(np.diff(log_mel, axis=1, prepend=log_mel[:, :1]), 0.0).mean(axis=0)
    centroid = (frequencies[:, None] * power).sum(axis=0) / np.maximum(power.sum(axis=0), 1e-10)
    frames = [f for f in SAMPLE_FRAMES if f < power.shape[1]]
    return {
        "arrays": {
            "chroma": chroma,
            "mfcc": mfcc,
            "rms_db": rms_db,
            "low_share": low_share,
            "flux": flux,
            "centroid": centroid,
        },
        "fixture": {
            "frames": int(power.shape[1]),
            "tuning": float(tuning),
            "sampleFrames": frames,
            "powerSum": f32([power[:, f].sum() for f in frames]),
            "logMel": [f32(log_mel[:, f]) for f in frames],
            "mfcc": [f32(mfcc[:, f]) for f in frames],
            "chroma": [f32(chroma[:, f]) for f in frames],
            "rmsDb": f32(rms_db),
            "lowShare": f32(low_share),
            "flux": f32(flux),
            "centroid": f64(centroid),
            "chromaProfile": f32(chroma.mean(axis=1)),
        },
    }


def analyse(stereo: np.ndarray, rate: int, song: dict, resampler) -> dict:
    mono = stereo.mean(axis=1)
    mono_22k = resampler(mono, rate, FEATURE_SR)
    duration = stereo.shape[0] / rate
    raw_beats = np.asarray(song["rawBeats"], dtype=np.float64)
    raw_downbeats = np.asarray(song["rawDownbeats"], dtype=np.float64)
    envelope = onset_envelope(mono_22k)
    grid = build_grid(raw_beats, raw_downbeats, envelope)
    lufs, peak_db = loudness(stereo, rate)
    out: dict = {
        "monoLength": int(mono_22k.size),
        "monoProbe": f32(
            mono_22k[[i for i in (0, 1000, 5000, 22050, 100000) if i < mono_22k.size]]
        ),
        "monoSum": float(np.sum(mono_22k.astype(np.float64))),
        "monoSumSquares": float(np.sum(mono_22k.astype(np.float64) ** 2)),
        "envelope": f32(envelope),
        "lufs": float(lufs),
        "peakDb": float(peak_db),
        "playbackMeterLufs": playback_meter_lufs(stereo, rate),
        "peaks": [int(v) for v in waveform_peaks(mono)],
        "regularizedBeats": int(regularize(raw_beats).size),
        "grid": None,
        "features": None,
        "row": None,
    }
    if grid is None or grid.bar_starts.size < 4:
        return out
    out["grid"] = {
        "beats": f64(grid.beats),
        "barStarts": [int(v) for v in grid.bar_starts],
        "beatsPerBar": int(grid.beats_per_bar),
        "bpm": float(grid.bpm),
        "constantTempo": bool(grid.constant_tempo),
        "gridRmsMs": float(grid.grid_rms_ms),
        "onsetAgreement": float(grid.onset_agreement),
        "downbeatRegularity": float(grid.downbeat_regularity),
        "tempoStability": float(grid.tempo_stability),
        "confidence": float(grid.confidence),
    }
    bar_times = grid.bar_times()
    features = extract(mono_22k, bar_times, duration)
    level = frame_level(mono_22k)
    # the frame-level capture must be what extract aggregated, or the stage fixtures would lie
    frames = _bar_frames(bar_times, duration)
    assert np.array_equal(_aggregate(level["arrays"]["rms_db"], frames)[0], features.rms_db_bars)
    assert np.array_equal(level["arrays"]["chroma"].mean(axis=1), features.chroma_profile)
    key = chroma_key(features.chroma_profile)
    out["frames"] = level["fixture"]
    out["barFrames"] = [int(v) for v in frames]
    out["features"] = {
        "chromaBars": [f64(row) for row in features.chroma_bars],
        "mfccBars": [f64(row) for row in features.mfcc_bars],
        "energyBars": f64(features.energy_bars),
        "rmsDbBars": f64(features.rms_db_bars),
        "lowShareBars": f64(features.low_share_bars),
        "onsetDensityBars": f64(features.onset_density_bars),
        "timbre": f64(features.timbre),
        "energy": float(features.energy),
        "sections": features.sections,
    }
    # the analysis row exactly as pipeline.analyse_song stores it, with the chroma key as the
    # key (S-KEY is not available in Cloud; pipeline.analyse_audio's own fallback)
    out["row"] = {
        "bpm": round(grid.bpm, 2),
        "constant_tempo": int(grid.constant_tempo),
        "grid_confidence": round(grid.confidence, 3),
        "beats_per_bar": grid.beats_per_bar,
        "key": key,
        "camelot": camelot(key),
        "key_confidence": 0.2,
        "key_agrees_chroma": 1,
        "lufs": round(lufs, 2),
        "peak_db": round(peak_db, 2),
        "energy": round(features.energy, 3),
        "sections": features.sections,
        "timbre": [round(float(v), 3) for v in features.timbre],
    }
    return out


def _max_abs(a, b) -> float:
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    if a.shape != b.shape or a.size == 0:
        return float("nan") if a.shape != b.shape else 0.0
    return float(np.max(np.abs(a - b)))


def _cosine_min(a, b) -> float:
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    if a.shape != b.shape:
        return float("nan")
    dots = (a * b).sum(axis=1)
    norms = np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1)
    return float(np.min(dots / np.maximum(norms, 1e-12)))


def _biquad(b0, b1, b2, a0, a1, a2):
    return np.array([b0, b1, b2]) / a0, np.array([1.0, a1 / a0, a2 / a0])


def playback_meter_lufs(stereo: np.ndarray, rate: int) -> float:
    """web/src/dsp/loudness.ts::integratedLoudness (the browser's playback meter) in numpy, to
    record how far it reads from pyloudnorm: libebur128's K-weighting constants, whole blocks
    only, and a strict absolute gate. The port does not use it (songLoudness.ts follows
    pyloudnorm); this is only the measured difference."""
    gain, centre, q = 3.999843853973347, 1681.974450955533, 0.7071752369554196
    amp = 10 ** (gain / 40)
    omega = 2 * math.pi * centre / rate
    cos, alpha = math.cos(omega), math.sin(omega) / (2 * q)
    root = 2 * math.sqrt(amp) * alpha
    shelf = _biquad(
        amp * (amp + 1 + (amp - 1) * cos + root),
        -2 * amp * (amp - 1 + (amp + 1) * cos),
        amp * (amp + 1 + (amp - 1) * cos - root),
        amp + 1 - (amp - 1) * cos + root,
        2 * (amp - 1 - (amp + 1) * cos),
        amp + 1 - (amp - 1) * cos - root,
    )
    omega = 2 * math.pi * 38.13547087602444 / rate
    cos, alpha = math.cos(omega), math.sin(omega) / (2 * 0.5003270373238773)
    high = _biquad((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha)
    weighted = [
        scipy.signal.lfilter(*high, scipy.signal.lfilter(*shelf, stereo[:, c].astype(np.float64)))
        for c in range(stereo.shape[1])
    ]
    block, step = round(0.4 * rate), round(0.1 * rate)
    energies = []
    for start in range(0, stereo.shape[0] - block + 1, step):
        energies.append(sum(float(np.sum(w[start : start + block] ** 2)) / block for w in weighted))
    energies = np.asarray(energies)
    level = -0.691 + 10 * np.log10(np.maximum(energies, 1e-30))
    above = energies[level > -70]
    gate = -0.691 + 10 * math.log10(above.mean()) - 10
    kept = above[(-0.691 + 10 * np.log10(np.maximum(above, 1e-30))) > gate]
    return float(-0.691 + 10 * math.log10(kept.mean()))


def resampler_effect(port: dict, desktop: dict) -> dict:
    """How far the two references are apart: what choosing the browser's resampler costs."""
    effect = {
        "lufs": abs(port["lufs"] - desktop["lufs"]),
        "peakDb": abs(port["peakDb"] - desktop["peakDb"]),
        "envelope": _max_abs(
            port["envelope"][: len(desktop["envelope"])],
            desktop["envelope"][: len(port["envelope"])],
        ),
    }
    if port["grid"] and desktop["grid"]:
        pg, dg = port["grid"], desktop["grid"]
        effect.update(
            {
                "bpm": abs(pg["bpm"] - dg["bpm"]),
                "beatsMs": _max_abs(pg["beats"], dg["beats"]) * 1000,
                "confidence": abs(pg["confidence"] - dg["confidence"]),
                "barStartsEqual": pg["barStarts"] == dg["barStarts"],
            }
        )
    if port["features"] and desktop["features"]:
        pf, df = port["features"], desktop["features"]
        energy = np.asarray(pf["energyBars"]), np.asarray(df["energyBars"])
        effect.update(
            {
                "energyBarsRelative": float(
                    np.max(np.abs(energy[0] - energy[1]) / np.maximum(np.abs(energy[1]), 1e-3))
                )
                if energy[0].shape == energy[1].shape
                else float("nan"),
                "chromaBarsCosineMin": _cosine_min(pf["chromaBars"], df["chromaBars"]),
                "keyEqual": port["row"]["key"] == desktop["row"]["key"],
                "sectionStartsPort": [s["start_bar"] for s in pf["sections"]],
                "sectionStartsDesktop": [s["start_bar"] for s in df["sections"]],
            }
        )
    return effect


def measure(song: dict) -> dict:
    stereo = render(song)
    rate = song["sampleRate"]
    port = analyse(stereo, rate, song, sinc_resample)
    if rate == SAMPLE_RATE:
        desktop = analyse(stereo, rate, song, soxr_resample)
    else:
        # the Desktop decodes every file to 44.1 kHz first (audio.decode, ffmpeg); soxr stands
        # in for ffmpeg's resampler here, then the Desktop path runs as usual
        at_44k = soxr.resample(stereo, rate, SAMPLE_RATE, quality="HQ").astype(np.float32)
        desktop = analyse(at_44k, SAMPLE_RATE, song, soxr_resample)
    return {
        "song": song,
        "port": port,
        "desktop": desktop,
        "resamplerEffect": resampler_effect(port, desktop),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=OUTPUT)
    folder = parser.parse_args().out
    folder.mkdir(parents=True, exist_ok=True)
    entries, playback = [], []
    for song in songs():
        result = measure(song)
        playback.append(abs(result["port"]["playbackMeterLufs"] - result["port"]["lufs"]))
        file = f"{song['name']}.json"
        (folder / file).write_text(
            json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n"
        )
        entries.append(
            {
                "name": song["name"],
                "file": file,
                "sampleRate": song["sampleRate"],
                "resamplerEffect": result["resamplerEffect"],
            }
        )
        print(f"{song['name']}: {json.dumps(result['resamplerEffect'])}")
    manifest = {
        "analysisVersion": ANALYSIS_VERSION,
        "featureRate": FEATURE_SR,
        "resampler": {"zeros": RESAMPLE_ZEROS, "rolloff": RESAMPLE_ROLLOFF, "beta": RESAMPLE_BETA},
        "versions": {
            "librosa": librosa.__version__,
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "soxr": soxr.__version__,
            "pyloudnorm": getattr(pyloudnorm, "__version__", "0.2.0"),
        },
        "songs": entries,
        # how far the browser's playback meter (../loudness.ts) reads from pyloudnorm, in LU
        "playbackMeterLufsDifference": max(playback),
    }
    (folder / "manifest.json").write_text(
        json.dumps(manifest, indent=1) + "\n", encoding="utf-8", newline="\n"
    )
    print(f"Wrote {len(entries)} songs to {folder}")


if __name__ == "__main__":
    main()
