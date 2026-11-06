"""Measure a rendered transition before anyone hears it.

A live DJ gets one take. Selecta can listen back. The thresholds start from published work and
judgement, and none has been calibrated against ratings yet. That's what the Listening Room is
for. Each failure names the fix most likely to help.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import soxr

from selecta.config import SAMPLE_RATE
from selecta.render import dsp
from selecta.render.engine import Rendered
from selecta.render.script import Part, TransitionScript

BEAT_TARGET_MS = 10.0
BEAT_LIMIT_MS = 20.0
MIN_BEATS_MEASURED = 4
MIN_NUDGE_MS = 5.0
MAX_NUDGE_SPREAD_MS = 30.0
VOCAL_OVERLAP_TARGET = 1.0
VOCAL_OVERLAP_LIMIT = 2.0
QUIET_LIMIT_SECONDS = 1.2
MIN_ENERGY_RATIO = 0.22
ENTRY_LEVEL_LIMIT_DB = 2.5
LEVEL_FALL_LIMIT_DB = 3.5
TRUE_PEAK_LIMIT_DB = -1.0
LOW_CLASH_LIMIT = 0.15
STRETCH_TARGET = 0.05
STRETCH_LIMIT = 0.08
HARMONY_LIMIT = 0.16


@dataclass
class Check:
    name: str
    passed: bool
    value: float
    limit: float
    unit: str = ""
    fix: str | None = None
    detail: str = ""


@dataclass
class AuditReport:
    checks: list[Check] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(check.passed for check in self.checks)

    @property
    def failures(self) -> list[Check]:
        return [check for check in self.checks if not check.passed]

    def value(self, name: str) -> float | None:
        return next((check.value for check in self.checks if check.name == name), None)


def _audible_window(part: Part, count: int, threshold: float = 0.3) -> np.ndarray:
    return part.gain.sample(count, SAMPLE_RATE) >= threshold


def _beat_differences(rendered: Rendered) -> list[float]:
    """How many milliseconds later A's beats land than B's, for each beat clear enough to hear."""
    script = rendered.script
    period = script.meta["period"]
    start, end = script.overlap
    count = rendered.audio.shape[0]
    both = _audible_window(script.a, count, 0.2) & _audible_window(script.b, count, 0.2)
    env_a = dsp.transient_envelope(rendered.a_dry.mean(axis=1))
    env_b = dsp.transient_envelope(rendered.b_dry.mean(axis=1))
    hop = 128 / SAMPLE_RATE
    reach = int(0.045 / hop)
    differences = []
    for beat_time in np.arange(start, end, period):
        sample = int(beat_time * SAMPLE_RATE)
        frame = int(beat_time / hop)
        if sample >= count or not both[sample] or frame + reach >= min(env_a.size, env_b.size):
            continue
        lo = max(frame - reach, 0)
        slice_a = env_a[lo : frame + reach + 1]
        slice_b = env_b[lo : frame + reach + 1]
        if slice_a.max() < np.percentile(env_a, 92) or slice_b.max() < np.percentile(env_b, 92):
            continue
        differences.append((int(np.argmax(slice_a)) - int(np.argmax(slice_b))) * hop * 1000.0)
    return differences


def beat_offset(rendered: Rendered) -> float | None:
    """Seconds to delay B by to line the beats up, if they're apart by a steady amount. Beats that
    scatter are a different problem, or the check misreading the drums, and a nudge won't help."""
    differences = _beat_differences(rendered)
    if len(differences) < MIN_BEATS_MEASURED:
        return None
    low, middle, high = np.percentile(differences, [25, 50, 75])
    if abs(middle) < MIN_NUDGE_MS or high - low > MAX_NUDGE_SPREAD_MS:
        return None
    return float(middle) / 1000.0


def _beat_alignment(rendered: Rendered) -> Check | None:
    script = rendered.script
    if not script.expects_beats_aligned:
        return None
    differences = _beat_differences(rendered)
    if len(differences) < MIN_BEATS_MEASURED:
        return Check(
            "beat alignment",
            True,
            0.0,
            BEAT_LIMIT_MS,
            "ms",
            detail="too few clean beats to measure",
        )
    value = float(np.percentile(np.abs(differences), 75))
    limit = script.meta.get("beat_limit_ms", BEAT_LIMIT_MS)
    return Check(
        "beat alignment",
        value <= limit,
        round(value, 1),
        limit,
        "ms",
        fix="change_recipe",
        detail=f"{len(differences)} beats measured",
    )


def _vocal_overlap(script: TransitionScript, count: int) -> Check | None:
    a, b = script.a.song, script.b.song
    if script.overlap[1] - script.overlap[0] < 0.5 or script.meta.get("wordplay"):
        return None
    if not (a.vocals_known and b.vocals_known):
        return Check(
            "vocal overlap",
            script.overlap[1] - script.overlap[0] <= 8.0,
            0.0,
            VOCAL_OVERLAP_LIMIT,
            "s",
            fix="shorten",
            detail="vocals unknown for one song, so a long overlap isn't safe",
        )
    time_step = 0.05
    times = np.arange(script.overlap[0], script.overlap[1], time_step)
    vocal_gains = script.meta.get("vocal_gains", {})

    def singing(part: Part, side: str) -> np.ndarray:
        source = np.asarray(part.warp.source_at(times))
        gain = vocal_gains.get(side, part.gain)
        audible = np.interp(times, gain.times, gain.values) >= 0.25
        mask = np.zeros(times.size, dtype=bool)
        for line in part.song.lines:
            mask |= (source >= line.start) & (source <= line.end)
        return mask & audible

    seconds = float((singing(script.a, "a") & singing(script.b, "b")).sum() * time_step)
    return Check(
        "vocal overlap",
        seconds <= VOCAL_OVERLAP_LIMIT,
        round(seconds, 2),
        VOCAL_OVERLAP_LIMIT,
        "s",
        fix="shorten",
    )


def _phrase_integrity(script: TransitionScript) -> Check:
    a, b = script.a.song, script.b.song
    exit_source = float(script.a.warp.source_at(script.overlap[1]))
    if script.overlap[1] - script.overlap[0] < 1.5 and "cut" in script.meta:
        exit_source = float(script.a.warp.source_at(script.meta["cut"]))
    if script.meta.get("wordplay"):
        return Check("phrase integrity", True, 0.0, 0.0, "", detail="cut on aligned words")
    vocal_gains = script.meta.get("vocal_gains", {})
    def gain_at(side: str, part: Part, time: float) -> float:
        gain = vocal_gains.get(side)
        if gain is None:
            return 1.0
        return float(np.interp(time, gain.times, gain.values))
    a_midline = (
        gain_at("a", script.a, script.overlap[1]) >= 0.25
        and a.vocals_known
        and any(
        line.start + 0.2 < exit_source < line.end - 0.2 for line in a.lines
        )
    )
    entry_source = float(script.b.warp.source[0])
    b_midline = (
        gain_at("b", script.b, script.overlap[0]) >= 0.25
        and b.vocals_known
        and any(line.start + 0.2 < entry_source < line.end - 0.2 for line in b.lines)
    )
    return Check(
        "phrase integrity",
        not (a_midline or b_midline),
        float(a_midline or b_midline),
        0.0,
        "",
        fix="move_cue",
        detail=("A cut mid-line. " if a_midline else "")
        + ("B starts mid-line." if b_midline else ""),
    )


def _seam_energy(rendered: Rendered) -> list[Check]:
    mono = rendered.audio.mean(axis=1)
    frame = int(0.05 * SAMPLE_RATE)
    usable = mono.size - mono.size % frame
    rms = np.sqrt(np.mean(mono[:usable].reshape(-1, frame) ** 2, axis=1))
    mean = float(np.mean(rms)) or 1e-9
    ratio = rms / mean
    start, end = rendered.script.overlap
    margin = 2.0
    lo = max(int((start - margin) / 0.05), 0)
    hi = min(int((end + margin) / 0.05) + 1, ratio.size)
    zone = ratio[lo:hi]
    quiet = float((zone < MIN_ENERGY_RATIO).sum() * 0.05)
    allowed = QUIET_LIMIT_SECONDS + rendered.script.quiet_allowed
    return [
        Check("quiet time", quiet <= allowed, round(quiet, 2), allowed, "s", fix="close_gap"),
    ]


def _entry_level(rendered: Rendered) -> Check:
    script = rendered.script
    start, end = script.overlap
    window = int(3.0 * SAMPLE_RATE)
    a_end = int(start * SAMPLE_RATE)
    b_begin = int(end * SAMPLE_RATE)
    before = rendered.audio[max(0, a_end - window) : a_end]
    after = rendered.audio[b_begin : b_begin + window]
    if before.shape[0] < SAMPLE_RATE or after.shape[0] < SAMPLE_RATE:
        return Check("entry level", True, 0.0, ENTRY_LEVEL_LIMIT_DB, "dB", detail="too short")
    level = lambda x: 20.0 * np.log10(max(float(np.sqrt(np.mean(x**2))), 1e-6))  # noqa: E731
    jump = float(level(after) - level(before))
    return Check(
        "entry level",
        jump <= ENTRY_LEVEL_LIMIT_DB,
        round(jump, 2),
        ENTRY_LEVEL_LIMIT_DB,
        "dB",
        fix="move_cue",
    )


def _level_fall(rendered: Rendered) -> Check | None:
    """Whether the set sags after the seam and stays down.

    The first reel's seams that fell 6 to 9 dB were all disliked. A's echo or reverb tail can hide
    that for the first moment, so this measures from a second past the overlap.
    """
    script = rendered.script
    start, end = script.overlap
    before = rendered.audio[max(0, int((start - 3.0) * SAMPLE_RATE)) : int(start * SAMPLE_RATE)]
    after = rendered.audio[int((end + 1.0) * SAMPLE_RATE) : int((end + 8.0) * SAMPLE_RATE)]
    if before.shape[0] < SAMPLE_RATE or after.shape[0] < 2 * SAMPLE_RATE:
        return None
    fall = _level_db(before) - _level_db(after)
    return Check(
        "level fall",
        fall <= LEVEL_FALL_LIMIT_DB,
        round(fall, 2),
        LEVEL_FALL_LIMIT_DB,
        "dB",
        fix="move_cue",
    )


def _level_db(audio: np.ndarray) -> float:
    return 20.0 * float(np.log10(max(float(np.sqrt(np.mean(audio**2))), 1e-6)))


def true_peak_db(audio: np.ndarray) -> float:
    upsampled = soxr.resample(audio, SAMPLE_RATE, SAMPLE_RATE * 4, quality="HQ")
    return 20.0 * float(np.log10(max(float(np.max(np.abs(upsampled))), 1e-9)))


def _low_clash(rendered: Rendered) -> Check | None:
    start, end = rendered.script.overlap
    if end - start < 1.0:
        return None
    lo, hi = int(start * SAMPLE_RATE), int(end * SAMPLE_RATE)
    low_a = dsp.zero_phase_lowpass(rendered.a_dry[lo:hi], dsp.LOW_SPLIT_HZ).mean(axis=1)
    low_b = dsp.zero_phase_lowpass(rendered.b_dry[lo:hi], dsp.LOW_SPLIT_HZ).mean(axis=1)
    frame = int(0.1 * SAMPLE_RATE)
    usable = low_a.size - low_a.size % frame
    if usable == 0:
        return None
    rms_a = np.sqrt(np.mean(low_a[:usable].reshape(-1, frame) ** 2, axis=1))
    rms_b = np.sqrt(np.mean(low_b[:usable].reshape(-1, frame) ** 2, axis=1))
    reference = max(float(rms_a.max()), float(rms_b.max()), 1e-6)
    fighting = (rms_a > reference * 0.3) & (rms_b > reference * 0.3)
    value = float(fighting.mean())
    return Check(
        "low end clash",
        value <= LOW_CLASH_LIMIT,
        round(value, 3),
        LOW_CLASH_LIMIT,
        "",
        fix="change_recipe",
    )


_ROUGHNESS_BY_INTERVAL = np.array(
    [0.0, 1.0, 0.45, 0.12, 0.1, 0.03, 0.6, 0.03, 0.1, 0.12, 0.45, 1.0]
)


def _chroma_frames(audio: np.ndarray) -> np.ndarray:
    import librosa

    mono = soxr.resample(audio.mean(axis=1), SAMPLE_RATE, 22_050)
    power = np.abs(librosa.stft(mono, n_fft=4096, hop_length=2048)) ** 2
    return librosa.feature.chroma_stft(S=power, sr=22_050, norm=None)


def _roughness(chroma_a: np.ndarray, chroma_b: np.ndarray) -> float:
    a = chroma_a / np.maximum(chroma_a.sum(axis=0, keepdims=True), 1e-9)
    b = chroma_b / np.maximum(chroma_b.sum(axis=0, keepdims=True), 1e-9)
    kernel = np.stack([np.roll(_ROUGHNESS_BY_INTERVAL, i) for i in range(12)])
    return float(np.mean(np.einsum("it,ij,jt->t", a, kernel, b)))


def _harmony(rendered: Rendered) -> Check | None:
    """How rough the overlap really is, over and above how rough each song is alone.

    Trained listeners preferred alignments chosen by measured consonance over a key tool's picks,
    so this measures what's playing rather than comparing two key labels.
    """
    start, end = rendered.script.overlap
    bars = rendered.script.meta.get("bars", 0)
    if end - start < 4.0 or bars < 4:
        return None
    lo, hi = int(start * SAMPLE_RATE), int(end * SAMPLE_RATE)
    chroma_a = _chroma_frames(rendered.a_dry[lo:hi])
    chroma_b = _chroma_frames(rendered.b_dry[lo:hi])
    together = _roughness(chroma_a, chroma_b)
    alone = (_roughness(chroma_a, chroma_a) + _roughness(chroma_b, chroma_b)) / 2
    excess = together - alone
    limit = HARMONY_LIMIT if bars >= 8 else HARMONY_LIMIT * 1.5
    return Check("harmony", excess <= limit, round(excess, 3), round(limit, 3), "", fix="shorten")


def audit(rendered: Rendered) -> AuditReport:
    script = rendered.script
    count = rendered.audio.shape[0]
    report = AuditReport()
    for check in (
        _beat_alignment(rendered),
        _vocal_overlap(script, count),
        _phrase_integrity(script),
        *_seam_energy(rendered),
        _entry_level(rendered),
        _level_fall(rendered),
        _low_clash(rendered),
        _harmony(rendered),
    ):
        if check is not None:
            report.checks.append(check)

    peak = true_peak_db(rendered.audio)
    report.checks.append(
        Check(
            "true peak",
            peak <= TRUE_PEAK_LIMIT_DB + 0.1,
            round(peak, 2),
            TRUE_PEAK_LIMIT_DB,
            "dBTP",
            fix="change_recipe",
        )
    )
    stretch = max(script.a.warp.max_stretch, script.b.warp.max_stretch)
    report.checks.append(
        Check(
            "stretch",
            stretch <= STRETCH_LIMIT,
            round(stretch * 100, 2),
            STRETCH_LIMIT * 100,
            "%",
            fix="change_recipe",
        )
    )
    return report
