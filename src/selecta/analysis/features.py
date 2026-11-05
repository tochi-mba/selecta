"""Bar-level features: timbre, harmony, energy, and sections.

Everything derives from one STFT, because on a laptop CPU that's the difference between a pass
over the library taking a night or a week.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import librosa
import numpy as np
import pyloudnorm

N_FFT = 2048
HOP = 512
FEATURE_SR = 22_050
PEAK_BINS = 1600
MAX_SECTION_BARS = 48


@dataclass
class SongFeatures:
    chroma_bars: np.ndarray
    mfcc_bars: np.ndarray
    energy_bars: np.ndarray
    rms_db_bars: np.ndarray
    low_share_bars: np.ndarray
    onset_density_bars: np.ndarray
    timbre: np.ndarray
    chroma_profile: np.ndarray
    energy: float
    sections: list[dict] = field(default_factory=list)


def _bar_frames(bar_times: np.ndarray, duration: float) -> np.ndarray:
    edges = np.concatenate((bar_times, [duration]))
    return librosa.time_to_frames(edges, sr=FEATURE_SR, hop_length=HOP)


def _aggregate(values: np.ndarray, frames: np.ndarray) -> np.ndarray:
    """Mean of each row between successive frame edges, using a cumulative sum for speed."""
    matrix = np.atleast_2d(values)
    padded = np.concatenate((np.zeros((matrix.shape[0], 1)), np.cumsum(matrix, axis=1)), axis=1)
    frames = np.clip(frames, 0, matrix.shape[1])
    lo, hi = frames[:-1], np.maximum(frames[1:], frames[:-1] + 1)
    hi = np.minimum(hi, matrix.shape[1])
    lo = np.minimum(lo, hi - 1)
    return (padded[:, hi] - padded[:, lo]) / (hi - lo)


def _scale(values: np.ndarray, low: float, high: float) -> np.ndarray:
    return np.clip((values - low) / (high - low), 0.0, 1.0)


def extract(mono_22k: np.ndarray, bar_times: np.ndarray, duration: float) -> SongFeatures:
    power = np.abs(librosa.stft(mono_22k, n_fft=N_FFT, hop_length=HOP)) ** 2
    frequencies = librosa.fft_frequencies(sr=FEATURE_SR, n_fft=N_FFT)

    mel = librosa.feature.melspectrogram(S=power, sr=FEATURE_SR, n_mels=64)
    log_mel = librosa.power_to_db(mel, top_db=80)
    mfcc = librosa.feature.mfcc(S=log_mel, n_mfcc=20)
    chroma = librosa.feature.chroma_stft(S=power, sr=FEATURE_SR)
    rms_db = 10.0 * np.log10(np.maximum(power.sum(axis=0) / N_FFT, 1e-10))
    low_share = power[frequencies < 200].sum(axis=0) / np.maximum(power.sum(axis=0), 1e-10)
    flux = np.maximum(np.diff(log_mel, axis=1, prepend=log_mel[:, :1]), 0.0).mean(axis=0)
    centroid = (frequencies[:, None] * power).sum(axis=0) / np.maximum(power.sum(axis=0), 1e-10)

    frames = _bar_frames(bar_times, duration)
    chroma_bars = _aggregate(chroma, frames)
    chroma_bars = chroma_bars / np.maximum(chroma_bars.max(axis=0, keepdims=True), 1e-6)
    mfcc_bars = _aggregate(mfcc, frames)
    rms_bars = _aggregate(rms_db, frames)[0]
    low_bars = _aggregate(low_share, frames)[0]
    flux_bars = _aggregate(flux, frames)[0]
    bright_bars = _aggregate(centroid, frames)[0]

    energy_bars = (
        0.45 * _scale(rms_bars, np.percentile(rms_db, 5) - 3, np.percentile(rms_db, 99) + 1)
        + 0.30 * _scale(flux_bars, 0.5, 6.0)
        + 0.15 * _scale(bright_bars, 800.0, 4000.0)
        + 0.10 * _scale(low_bars, 0.05, 0.5)
    )
    energy = float(np.mean(np.sort(energy_bars)[-max(1, energy_bars.size // 2) :]))

    timbre = np.concatenate(
        (
            mfcc[1:14].mean(axis=1),
            mfcc[1:14].std(axis=1),
            [centroid.mean(), low_share.mean(), flux.mean()],
        )
    )

    features = SongFeatures(
        chroma_bars=chroma_bars.T,
        mfcc_bars=mfcc_bars.T,
        energy_bars=energy_bars,
        rms_db_bars=rms_bars,
        low_share_bars=low_bars,
        onset_density_bars=flux_bars,
        timbre=timbre,
        chroma_profile=chroma.mean(axis=1),
        energy=energy,
    )
    features.sections = find_sections(features)
    return features


def _length_penalty(length: int) -> float:
    if length % 8 == 0:
        return 0.0
    if length % 4 == 0:
        return 0.08
    if length % 2 == 0:
        return 0.2
    return 0.32


def _similarity(features: SongFeatures) -> np.ndarray:
    def unit(matrix: np.ndarray) -> np.ndarray:
        centred = matrix - matrix.mean(axis=0, keepdims=True)
        return centred / np.maximum(np.linalg.norm(centred, axis=1, keepdims=True), 1e-6)

    timbre = unit(features.mfcc_bars[:, 1:14])
    harmony = unit(features.chroma_bars)
    return 0.5 * (timbre @ timbre.T) + 0.5 * (harmony @ harmony.T)


def segment(similarity: np.ndarray) -> list[tuple[int, int]]:
    """Block matching: split bars into blocks that are alike inside, by dynamic programming."""
    bars = similarity.shape[0]
    if bars < 4:
        return [(0, bars)]
    offset = similarity - float(np.mean(similarity))
    integral = np.zeros((bars + 1, bars + 1))
    integral[1:, 1:] = np.cumsum(np.cumsum(offset, axis=0), axis=1)

    best = np.full(bars + 1, -np.inf)
    best[0] = 0.0
    previous = np.zeros(bars + 1, dtype=int)
    for end in range(2, bars + 1):
        starts = np.arange(max(0, end - MAX_SECTION_BARS), end - 1)
        block = (
            integral[end, end]
            - integral[starts, end]
            - integral[end, starts]
            + integral[starts, starts]
        ) / (end - starts)
        penalties = np.array([_length_penalty(end - s) * 4.0 for s in starts])
        scores = best[starts] + block - penalties - 0.6
        choice = int(np.argmax(scores))
        best[end], previous[end] = scores[choice], starts[choice]

    cuts = [bars]
    while cuts[-1] > 0:
        cuts.append(int(previous[cuts[-1]]))
    cuts.reverse()
    return list(zip(cuts[:-1], cuts[1:], strict=True))


def _group_repeats(blocks: list[tuple[int, int]], similarity: np.ndarray) -> list[int]:
    groups: list[int] = []
    next_group = 0
    for i, (start, end) in enumerate(blocks):
        chosen = None
        best = 0.45
        for j in range(i):
            other_start, other_end = blocks[j]
            length = min(end - start, other_end - other_start)
            if length < 2:
                continue
            score = float(np.mean([similarity[start + k, other_start + k] for k in range(length)]))
            if score > best:
                best, chosen = score, groups[j]
        if chosen is None:
            chosen = next_group
            next_group += 1
        groups.append(chosen)
    return groups


def find_sections(features: SongFeatures) -> list[dict]:
    """Label blocks loosely. These are probabilities to be snapped to bars, not facts."""
    similarity = _similarity(features)
    blocks = segment(similarity)
    groups = _group_repeats(blocks, similarity)
    energy = features.energy_bars
    overall = float(np.mean(energy))
    peak = float(np.percentile(energy, 90))

    counts: dict[int, int] = {}
    for group in groups:
        counts[group] = counts.get(group, 0) + 1

    sections: list[dict] = []
    for i, ((start, end), group) in enumerate(zip(blocks, groups, strict=True)):
        level = float(np.mean(energy[start:end]))
        repeats = counts[group] - 1
        loud = float(np.clip((level - overall) / max(peak - overall, 1e-3), 0.0, 1.0))
        chorus = float(np.clip(0.55 * loud + 0.45 * min(repeats, 2) / 2, 0.0, 1.0))
        if i == 0 and level < overall:
            label = "intro"
            chorus = 0.0
        elif i == len(blocks) - 1 and level < overall:
            label = "outro"
            chorus = 0.0
        elif chorus >= 0.6:
            label = "chorus"
        elif level < overall - 0.08:
            label = "break"
        else:
            label = "verse"
        sections.append(
            {
                "start_bar": int(start),
                "end_bar": int(end),
                "label": label,
                "energy": round(level, 3),
                "group": int(group),
                "chorus_prob": round(chorus, 3),
            }
        )
    return sections


def loudness(stereo_44k: np.ndarray, sample_rate: int) -> tuple[float, float]:
    """Integrated loudness in LUFS and sample peak in dB."""
    meter = pyloudnorm.Meter(sample_rate)
    lufs = float(meter.integrated_loudness(stereo_44k.astype(np.float64)))
    peak = float(np.max(np.abs(stereo_44k))) or 1e-6
    return lufs, 20.0 * float(np.log10(peak))


def waveform_peaks(mono: np.ndarray, bins: int = PEAK_BINS) -> np.ndarray:
    """A compact amplitude envelope for the whole-song strip."""
    step = max(1, mono.size // bins)
    usable = mono[: step * bins] if mono.size >= step * bins else mono
    frames = usable[: usable.size - usable.size % step].reshape(-1, step)
    rms = np.sqrt(np.mean(frames**2, axis=1))
    scale = float(rms.max()) or 1.0
    return np.round(rms / scale * 255).astype(np.uint8)
