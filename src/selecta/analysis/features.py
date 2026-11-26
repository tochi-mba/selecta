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
    pattern_bars: np.ndarray | None = None
    """Each bar's drum pattern: 16 steps of low-band onsets, then 16 of high-band onsets."""
    swing_bars: np.ndarray | None = None
    """Where each bar's off-beat hits land within the beat: 0.5 straight, about 0.67 swung."""


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


def extract(
    mono_22k: np.ndarray, bar_times: np.ndarray, duration: float, beats_per_bar: int = 4
) -> SongFeatures:
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
    # worked out last, from the same spectrum, so none of the other arrays' values move
    features.pattern_bars, features.swing_bars = rhythm_bars(
        power, frequencies, bar_times, duration, beats_per_bar
    )
    return features


PATTERN_STEPS = 16
PATTERN_LOW_HZ = 200.0
"""The kick's band: the same split as `low_share_bars` and the renderer's low band."""
PATTERN_HIGH_HZ = 2500.0
"""Hats and the snare's crack: the renderer's high band (`render.dsp.HIGH_SPLIT_HZ`)."""
SWING_LOW, SWING_HIGH = 0.40, 0.70
"""Where an off-beat may sit within its beat: a straight eighth at 0.5, a triplet swing at
0.67. The next sixteenth (0.75) is left out, so straight sixteenths never read as swing."""
SWING_PHASES = 48
ONSET_LEAD_SECONDS = 0.03
QUIET_OFFBEAT = 0.1
"""An off-beat peak below this share of the beat's strongest hit isn't heard as one."""


def _band_onsets(power: np.ndarray, rows: np.ndarray) -> np.ndarray:
    """How sharply one band gets louder at each frame, in dB, rises only."""
    level = 10.0 * np.log10(np.maximum(power[rows].sum(axis=0), 1e-10))
    return np.maximum(np.diff(level, prepend=level[:1]), 0.0)


def rhythm_bars(
    power: np.ndarray,
    frequencies: np.ndarray,
    bar_times: np.ndarray,
    duration: float,
    beats_per_bar: int = 4,
) -> tuple[np.ndarray, np.ndarray]:
    """Each bar's 16-step onset pattern, low band then high band (bars by 32; each band scaled
    so its strongest step is 1, a band with no rise at all is 0), and its swing: where the high
    band's off-beat peak sits within the beat, 0.5 when no off-beat is heard. A bar-long shape of
    where hits fall, normalised, so nothing of the sound itself can be read back from it."""
    bands = (
        _band_onsets(power, frequencies < PATTERN_LOW_HZ),
        _band_onsets(power, frequencies >= PATTERN_HIGH_HZ),
    )
    frame_seconds = HOP / FEATURE_SR
    # a centred 2048-point frame starts rising about 30 ms before the hit it hears (measured on
    # the synthetic grooves: straight eighths read 0.44 of a beat and triplets 0.60 without this)
    lead = ONSET_LEAD_SECONDS / frame_seconds
    frames = power.shape[1]
    edges = np.concatenate((bar_times, [duration]))
    patterns = np.zeros((bar_times.size, 2 * PATTERN_STEPS), dtype=np.float32)
    swing = np.full(bar_times.size, 0.5, dtype=np.float32)
    phases = np.arange(SWING_PHASES) / SWING_PHASES
    window = (phases >= SWING_LOW) & (phases <= SWING_HIGH)
    beats = max(int(beats_per_bar), 1)
    for bar in range(bar_times.size):
        start, end = float(edges[bar]), float(edges[bar + 1])
        step = (end - start) / PATTERN_STEPS
        if step <= frame_seconds * 0.5:
            continue
        for band, onsets in enumerate(bands):
            row = np.zeros(PATTERN_STEPS)
            for k in range(PATTERN_STEPS):
                # one step's window, centred on the step, so a hit a little early still counts
                centre = start + k * step
                lo = max(int(np.floor((centre - step / 2) / frame_seconds - lead)), 0)
                hi = min(int(np.ceil((centre + step / 2) / frame_seconds - lead)), frames)
                if hi > lo:
                    row[k] = onsets[lo:hi].max()
            peak = float(row.max())
            if peak > 1e-6:
                patterns[bar, band * PATTERN_STEPS : (band + 1) * PATTERN_STEPS] = row / peak
        beat = (end - start) / beats
        times = start + beat * (np.arange(beats)[:, None] + phases[None, :])
        profile = np.interp(times / frame_seconds - lead, np.arange(frames), bands[1]).mean(axis=0)
        # only a real peak counts: the rising edge of the next sixteenth at the window's end
        # would otherwise read as a late off-beat
        peaks = window & (profile >= np.roll(profile, 1)) & (profile >= np.roll(profile, -1))
        top = float(profile.max())
        if top > 1e-6 and peaks.any() and float(profile[peaks].max()) >= QUIET_OFFBEAT * top:
            found = np.flatnonzero(peaks)
            swing[bar] = float(phases[found[int(np.argmax(profile[found]))]])
    return patterns, swing


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
