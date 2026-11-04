"""Offline signal processing.

Nothing here runs live, which is the point. Filters are zero phase, so a band split with neutral
gains gives back the input exactly. That keeps seams with native playback invisible, which a
real-time mixer's EQ can't do.
"""

from __future__ import annotations

import numpy as np
import pedalboard
import soxr
from scipy.ndimage import median_filter, minimum_filter1d, uniform_filter1d
from scipy.signal import butter, sosfiltfilt

from selecta.config import SAMPLE_RATE

LOW_SPLIT_HZ = 200.0
HIGH_SPLIT_HZ = 2500.0

_ENV_HOP = 128
_ENV_HOP_TIME = _ENV_HOP / SAMPLE_RATE


def zero_phase_lowpass(audio: np.ndarray, cutoff_hz: float) -> np.ndarray:
    """A second-order Butterworth run both ways: 24 dB per octave with no phase shift."""
    sos = butter(2, cutoff_hz, btype="lowpass", fs=SAMPLE_RATE, output="sos")
    return sosfiltfilt(sos, audio, axis=0).astype(np.float32)


def zero_phase_highpass(audio: np.ndarray, cutoff_hz: float) -> np.ndarray:
    """The exact complement of the lowpass, so the two always sum back to the input."""
    return audio - zero_phase_lowpass(audio, cutoff_hz)


def split_bands(audio: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Three bands that sum to the input exactly."""
    low = zero_phase_lowpass(audio, LOW_SPLIT_HZ)
    high = zero_phase_highpass(audio, HIGH_SPLIT_HZ)
    return low, audio - low - high, high


def _filter_bank(
    audio: np.ndarray, cutoffs: np.ndarray, highpass: bool
) -> tuple[np.ndarray, list[np.ndarray]]:
    low = float(np.min(cutoffs))
    high = float(np.max(cutoffs))
    count = max(2, int(np.ceil(np.log2(max(high / max(low, 1.0), 1.01)) * 3)) + 1)
    centres = np.geomspace(max(low, 10.0), min(high, SAMPLE_RATE * 0.45), count)
    filter_fn = zero_phase_highpass if highpass else zero_phase_lowpass
    return centres, [filter_fn(audio, float(c)) for c in centres]


def sweep_filter(audio: np.ndarray, cutoffs: np.ndarray, highpass: bool) -> np.ndarray:
    """A moving filter, built by crossfading a bank of fixed zero-phase filters.

    A filter whose coefficients change while it runs can click. These bank members are all in
    phase with each other, so crossfading between them can't.
    """
    centres, bank = _filter_bank(audio, cutoffs, highpass)
    positions = np.interp(
        np.log(np.maximum(cutoffs, 1.0)), np.log(centres), np.arange(centres.size)
    )
    lower = np.minimum(positions.astype(int), centres.size - 2)
    fraction = (positions - lower)[:, None].astype(np.float32)
    stack = np.stack(bank)
    samples = np.arange(audio.shape[0])
    return stack[lower, samples] * (1.0 - fraction) + stack[lower + 1, samples] * fraction


def echo_tail(
    send: np.ndarray,
    delay_seconds: float,
    feedback: float,
    wet: float,
    return_highpass_hz: float,
    damp_lowpass_hz: float,
    total: int,
) -> np.ndarray:
    """Repeats only, each one a little darker, the way a tape delay loses top end."""
    delay = int(round(delay_seconds * SAMPLE_RATE))
    tail = np.zeros((total, 2), dtype=np.float32)
    voice = send
    gain = wet
    while gain > 0.01:
        tail_end = min(total, send.shape[0] + delay)
        length = tail_end - delay
        if length <= 0:
            break
        voice = zero_phase_lowpass(voice, damp_lowpass_hz)
        tail[delay : delay + length] += voice[:length] * gain
        gain *= feedback
        delay += int(round(delay_seconds * SAMPLE_RATE))
    return zero_phase_highpass(tail, return_highpass_hz)


def reverb_tail(
    send: np.ndarray, room_size: float, damping: float, wet: float, return_highpass_hz: float
) -> np.ndarray:
    board = pedalboard.Reverb(room_size=room_size, damping=damping, wet_level=1.0, dry_level=0.0)
    tail = board(send.T.astype(np.float32), SAMPLE_RATE, reset=True).T
    if tail.shape[0] < send.shape[0]:
        tail = np.pad(tail, ((0, send.shape[0] - tail.shape[0]), (0, 0)))
    return zero_phase_highpass(tail[: send.shape[0]] * wet, return_highpass_hz)


def true_peaks(audio: np.ndarray) -> np.ndarray:
    """Per-sample peak including what happens between samples, read at four times the rate."""
    fine = np.abs(soxr.resample(audio, SAMPLE_RATE, SAMPLE_RATE * 4, quality="HQ"))
    usable = min(fine.shape[0] // 4, audio.shape[0])
    return fine[: usable * 4].reshape(usable, 4, audio.shape[1]).max(axis=(1, 2))


def limit(audio: np.ndarray, ceiling_db: float = -1.1, release_ms: float = 80.0) -> np.ndarray:
    """A look-ahead limiter that leaves anything under the ceiling sample-identical."""
    ceiling = 10.0 ** (ceiling_db / 20.0)
    peak = true_peaks(audio)
    if peak.size < audio.shape[0]:
        peak = np.pad(peak, (0, audio.shape[0] - peak.size), mode="edge")
    peak = np.maximum(peak, np.max(np.abs(audio), axis=1))
    needed = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    if needed.min() >= 1.0:
        return audio
    hold = max(3, int(release_ms / 1000 * SAMPLE_RATE)) | 1
    held = minimum_filter1d(needed, size=hold, mode="nearest")
    smooth = uniform_filter1d(held, size=hold, mode="nearest")
    gain = np.minimum(smooth, needed)
    return audio * gain[:, None].astype(np.float32)


def transient_envelope(mono: np.ndarray) -> np.ndarray:
    """Positive changes in short-term level, on a 2.9 ms grid. Peaks mark onsets."""
    change = np.abs(np.diff(mono, prepend=mono[:1]))
    usable = change.size - change.size % _ENV_HOP
    frames = change[:usable].reshape(-1, _ENV_HOP).sum(axis=1)
    logged = np.log1p(frames * 200.0)
    return np.maximum(np.diff(logged, prepend=logged[:1]), 0.0)


def _stretch_lag(
    reference: np.ndarray, actual: np.ndarray, window: float = 2.0, hop: float = 0.5
) -> tuple[np.ndarray, np.ndarray]:
    """Slide windows of the actual envelope against the expected one, and find the offset."""
    reach = int(0.09 / _ENV_HOP_TIME)
    width = int(window / _ENV_HOP_TIME)
    step_frames = int(hop / _ENV_HOP_TIME)
    centres, lags = [], []
    limit_frames = min(reference.size, actual.size)
    for start in range(reach, limit_frames - width - reach, step_frames):
        ref = reference[start : start + width]
        if ref.sum() < 1e-3:
            continue
        ref = ref - ref.mean()
        scores = np.array(
            [
                float(np.dot(ref, actual[start + lag : start + lag + width]))
                for lag in range(-reach, reach + 1)
            ]
        )
        best = int(np.argmax(scores))
        if scores[best] <= 0:
            continue
        lag = best - reach
        if 0 < best < scores.size - 1:
            left, mid, right = scores[best - 1 : best + 2]
            denominator = left - 2 * mid + right
            if abs(denominator) > 1e-9:
                lag += 0.5 * (left - right) / denominator
        centres.append((start + width / 2) * _ENV_HOP_TIME)
        lags.append(lag * _ENV_HOP_TIME)
    return np.asarray(centres), np.asarray(lags)


_SINC_TAPS = 16
_SINC_PHASES = 256


def _sinc_table() -> np.ndarray:
    half = _SINC_TAPS // 2
    table = np.zeros((_SINC_PHASES, _SINC_TAPS), dtype=np.float32)
    window = np.kaiser(_SINC_TAPS * 64 + 1, 8.6)
    for phase in range(_SINC_PHASES):
        fraction = phase / _SINC_PHASES
        x = np.arange(-half + 1, half + 1) - fraction
        positions = (x + half) / _SINC_TAPS * (window.size - 1)
        taper = np.interp(positions, np.arange(window.size), window)
        table[phase] = np.sinc(x) * taper
    return table / table.sum(axis=1, keepdims=True)


_TABLE = _sinc_table()


def fine_warp(audio: np.ndarray, positions: np.ndarray) -> np.ndarray:
    """Read audio at fractional sample positions, with a windowed sinc kernel."""
    half = _SINC_TAPS // 2
    padded = np.pad(audio, ((half, half), (0, 0)))
    output = np.zeros((positions.size, audio.shape[1]), dtype=np.float32)
    chunk = 200_000
    for begin in range(0, positions.size, chunk):
        where = positions[begin : begin + chunk]
        base = np.floor(where).astype(np.int64)
        phase = ((where - base) * _SINC_PHASES).astype(np.int64) % _SINC_PHASES
        kernels = _TABLE[phase]
        indices = base[:, None] + np.arange(1, _SINC_TAPS + 1)
        indices = np.clip(indices, 0, padded.shape[0] - 1)
        output[begin : begin + chunk] = np.einsum("ij,ijk->ik", kernels, padded[indices])
    return output


def correct_drift(
    stretched: np.ndarray, expected_envelope: np.ndarray, count: int
) -> tuple[np.ndarray, float]:
    """Remove the slow timing drift Rubber Band leaves behind.

    Rubber Band gets total length right, but beats wander by about 1.3 ms per second inside.
    The drift is measured against where onsets should be, and removed with a resample so small
    (under 0.2%, about 3 cents) that nobody can hear the pitch move.
    """
    mono = stretched.mean(axis=1)
    actual = transient_envelope(mono)
    centres, lags = _stretch_lag(expected_envelope, actual)
    times = np.arange(count, dtype=np.float64) / SAMPLE_RATE
    if lags.size < 2:
        return stretched[:count], 0.0
    size = min(5, lags.size if lags.size % 2 else lags.size - 1)
    smooth = median_filter(lags, size=size, mode="nearest") if size >= 3 else lags
    lag_curve = np.interp(times, centres, smooth)
    positions = times * SAMPLE_RATE + lag_curve * SAMPLE_RATE
    positions = np.clip(positions, 0, stretched.shape[0] - 1)
    return fine_warp(stretched, positions), float(np.max(np.abs(smooth)))


def stretch_to_warp(
    source: np.ndarray, warp_output: np.ndarray, warp_source: np.ndarray, source_start: float
) -> tuple[np.ndarray, float]:
    """Stretch so each matched source point lands on its output time.

    `source` begins at `source_start` seconds of the song and must cover the warp plus context.
    Returns audio for the warp's output span, and the drift that had to be corrected, in seconds.
    """
    context = 0.5
    first_source = warp_source[0] - context
    last_source = warp_source[-1] + context
    begin = int(round((first_source - source_start) * SAMPLE_RATE))
    end = int(round((last_source - source_start) * SAMPLE_RATE))
    segment = source[max(begin, 0) : end]

    segment_times = source_start + (max(begin, 0) + np.arange(segment.shape[0])) / SAMPLE_RATE
    slopes = np.diff(warp_source) / np.diff(warp_output)
    edges = np.searchsorted(warp_source, segment_times, side="right") - 1
    ratio = slopes[np.clip(edges, 0, slopes.size - 1)].astype(np.float64)

    stretched = pedalboard.time_stretch(
        segment.T.astype(np.float32),
        SAMPLE_RATE,
        stretch_factor=ratio,
        high_quality=True,
        transient_mode="crisp",
    ).T

    per_sample = 1.0 / ratio / SAMPLE_RATE
    output_position = np.concatenate(([0.0], np.cumsum(per_sample)))
    head = output_position[int(round((warp_source[0] - segment_times[0]) * SAMPLE_RATE))]
    count = int(round((warp_output[-1] - warp_output[0]) * SAMPLE_RATE))

    source_envelope = transient_envelope(segment.mean(axis=1))
    frame_times = np.arange(source_envelope.size) * _ENV_HOP_TIME
    target_frames = np.interp(
        frame_times * SAMPLE_RATE, np.arange(output_position.size), output_position
    )
    expected = np.zeros(int(stretched.shape[0] / _ENV_HOP) + 2)
    slots = np.clip((target_frames / _ENV_HOP_TIME).astype(int), 0, expected.size - 1)
    np.maximum.at(expected, slots, source_envelope)

    head_samples = int(round(head * SAMPLE_RATE))
    corrected, drift = correct_drift(stretched, expected, head_samples + count)
    return corrected[head_samples : head_samples + count], drift
