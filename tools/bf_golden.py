"""Generate the ADR-0459 golden set for the browser DSP harness.

Synthesises small, fully owned test audio, runs the EXISTING Python engine functions over it
to produce expected values, and writes ``web/src/dsp/golden/golden.json``. The browser side
(``web/src/dsp/golden.ts``) regenerates the same audio from each fixture's ``synthSpec`` with
the same formulas, runs the JS implementations, and scores the deltas.

Expected values and where they come from:
  - ``lufs``: ``selecta.analysis.features.loudness`` (pyloudnorm, BS.1770), the engine's own
    loudness reader.
  - ``truePeakDb``: ``selecta.render.dsp.true_peaks`` (4x resample), the engine's own
    inter-sample peak reader. Fixtures are synthesised at ``selecta.config.SAMPLE_RATE``
    because ``true_peaks`` reads that constant.
  - ``key``/``mode``: ``selecta.analysis.key.chroma_key`` over a librosa chroma profile, the
    engine's chroma second opinion. The neural S-KEY model is deliberately not used here: the
    browser implementation is 'lightweight-chroma-v1' and must be compared against the chroma
    method, not against a model it never claims to be.
  - ``tempoBpm``: construction truth. The clicks are synthesised at a known tempo, which is a
    stronger reference than any estimator; the neural beat tracker is not imported because the
    golden generator must not need torch checkpoints to run.
  - ``seamStartSeconds``/``seamKind``: derived from ``selecta.mix.SHORTEST_STAY`` (the
    leave_after settle rule) and the fixture's beat grid, the same rule the browser scheduler
    enforces.

Keep fixtures short (<= 10 s of audio) and prefer synthSpec so the JSON stays small.

Script only - run by hand when regenerating the golden set:

    python tools/bf_golden.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import librosa
import numpy as np

from selecta.analysis.features import loudness
from selecta.analysis.key import chroma_key
from selecta.config import SAMPLE_RATE
from selecta.mix import SHORTEST_STAY
from selecta.render.dsp import true_peaks

OUTPUT = Path(__file__).resolve().parent.parent / "web" / "src" / "dsp" / "golden" / "golden.json"


# --- Synthesis: the shared contract with web/src/dsp/golden.ts (same formulas) -----------------


def _add_tone(
    output: np.ndarray, sr: int, freq_hz: float, amplitude: float, start_s: float, dur_s: float
) -> None:
    first = round(start_s * sr)
    count = round(dur_s * sr)
    index = np.arange(min(count, output.size - first))
    output[first : first + index.size] += amplitude * np.sin(2 * math.pi * freq_hz * index / sr)


def synthesize(spec: list[dict], sr: int, duration_s: float) -> np.ndarray:
    """Mono synthesis, element for element identical to `synthesize` in golden.ts."""
    output = np.zeros(round(duration_s * sr), dtype=np.float64)
    for element in spec:
        start_s = element.get("startS", 0.0)
        if element["type"] == "tone":
            _add_tone(output, sr, element["freqHz"], element["amplitude"], start_s, element["durS"])
        elif element["type"] == "toneStack":
            for freq_hz in element["freqsHz"]:
                _add_tone(output, sr, freq_hz, element["amplitude"], start_s, element["durS"])
        elif element["type"] == "clicks":
            amplitude = element.get("amplitude", 0.8)
            click_freq = element.get("clickFreqHz", 1000.0)
            click_ms = element.get("clickMs", 10.0)
            burst = max(2, round(click_ms / 1000 * sr))
            period = 60.0 / element["bpm"]
            index = np.arange(burst)
            hann = 0.5 * (1 - np.cos(2 * math.pi * index / (burst - 1)))
            voice = amplitude * hann * np.sin(2 * math.pi * click_freq * index / sr)
            click = 0
            while True:
                at = start_s + click * period
                if at >= start_s + element["durS"]:
                    break
                first = round(at * sr)
                usable = min(burst, output.size - first)
                if usable > 0:
                    output[first : first + usable] += voice[:usable]
                click += 1
        else:
            raise ValueError(f"Unknown synth element {element['type']!r}")
    return output


def stereo(mono: np.ndarray) -> np.ndarray:
    return np.stack((mono, mono), axis=1).astype(np.float32)


# --- Engine-derived expected values ------------------------------------------------------------


def measured_loudness(mono: np.ndarray) -> tuple[float, float]:
    """Integrated LUFS from the engine's reader, and true peak dB from the engine's 4x read."""
    wide = stereo(mono)
    lufs, _sample_peak_db = loudness(wide, SAMPLE_RATE)
    peak = float(np.max(true_peaks(wide)))
    return round(float(lufs), 4), round(20.0 * math.log10(max(peak, 1e-9)), 4)


def measured_key(mono: np.ndarray) -> tuple[str, str]:
    profile = librosa.feature.chroma_stft(y=mono.astype(np.float32), sr=SAMPLE_RATE).mean(axis=1)
    name, mode = chroma_key(profile).split()
    return name, mode


def beat_grid(bpm: float, duration_s: float) -> list[float]:
    period = 60.0 / bpm
    return [round(beat * period, 6) for beat in range(int(duration_s / period) + 1)]


# --- Fixtures ----------------------------------------------------------------------------------


def build_fixtures() -> list[dict]:
    fixtures: list[dict] = []
    sr = SAMPLE_RATE

    # 1. A steady 120 BPM click track: tempo is construction truth; loudness and true peak are
    # measured by the engine.
    spec_120 = [{"type": "clicks", "bpm": 120, "durS": 10.0, "amplitude": 0.8}]
    mono = synthesize(spec_120, sr, 10.0)
    lufs, peak_db = measured_loudness(mono)
    fixtures.append(
        {
            "name": "clicks-120bpm",
            "sampleRate": sr,
            "durationS": 10.0,
            "synthSpec": spec_120,
            "expected": {
                "tempoBpm": 120.0,
                "tempoAmbiguous": False,
                "lufs": lufs,
                "truePeakDb": peak_db,
            },
        }
    )

    # 2. The half-time trap: a uniform 170 BPM click reads equally well as 85 BPM. The honest
    # answer is ambiguity, not a confident number, so only the flag is expected.
    spec_trap = [{"type": "clicks", "bpm": 170, "durS": 10.0, "amplitude": 0.8}]
    fixtures.append(
        {
            "name": "clicks-170bpm-half-time-trap",
            "sampleRate": sr,
            "durationS": 10.0,
            "synthSpec": spec_trap,
            "expected": {"tempoAmbiguous": True},
        }
    )

    # 3. A key-bearing tone stack: C major triad across two octaves.
    spec_triad = [
        {
            "type": "toneStack",
            "freqsHz": [261.6256, 329.6276, 391.9954, 523.2511],
            "amplitude": 0.15,
            "durS": 6.0,
        }
    ]
    mono = synthesize(spec_triad, sr, 6.0)
    name, mode = measured_key(mono)
    lufs, peak_db = measured_loudness(mono)
    fixtures.append(
        {
            "name": "c-major-triad-stack",
            "sampleRate": sr,
            "durationS": 6.0,
            "synthSpec": spec_triad,
            "expected": {"key": name, "mode": mode, "lufs": lufs, "truePeakDb": peak_db},
        }
    )

    # 4. Loudness steps: a 997 Hz tone that steps up, exercising the BS.1770 gating.
    spec_steps = [
        {"type": "tone", "freqHz": 997.0, "amplitude": 0.05, "startS": 0.0, "durS": 4.0},
        {"type": "tone", "freqHz": 997.0, "amplitude": 0.3, "startS": 4.0, "durS": 4.0},
    ]
    mono = synthesize(spec_steps, sr, 8.0)
    lufs, peak_db = measured_loudness(mono)
    fixtures.append(
        {
            "name": "loudness-steps-997hz",
            "sampleRate": sr,
            "durationS": 8.0,
            "synthSpec": spec_steps,
            "expected": {"lufs": lufs, "truePeakDb": peak_db},
        }
    )

    # 5. A two-track seam case: confident grids at 120 and 122 BPM, exit asked at 20 s. The
    # settle rule (SHORTEST_STAY) forbids leaving before 30 s, so the expected seam start is
    # the first beat of A at or after 30 s.
    grid_a = beat_grid(120.0, 60.0)
    grid_b = beat_grid(122.0, 60.0)
    wanted_exit = 20.0
    floor = max(wanted_exit, SHORTEST_STAY)
    seam_start = next(beat for beat in grid_a if beat >= floor)
    fixtures.append(
        {
            "name": "seam-120-into-122",
            "sampleRate": sr,
            "durationS": 1.0,  # no audio metric reads it; kept positive for the JS validator
            "expected": {"seamStartSeconds": round(seam_start, 6), "seamKind": "beatmatch"},
            "seamCase": {
                "a": {
                    "beats": grid_a,
                    "tempo": {"bpm": 120.0, "confidence": 0.9, "ambiguous": False},
                    "durationSeconds": 60.0,
                },
                "b": {
                    "beats": grid_b,
                    "tempo": {"bpm": 122.0, "confidence": 0.9, "ambiguous": False},
                    "durationSeconds": 60.0,
                },
                "spec": {"exitSeconds": wanted_exit, "windowSeconds": 8.0},
            },
        }
    )
    return fixtures


def main() -> None:
    golden = {"fixtures": build_fixtures()}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(golden, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT} ({len(golden['fixtures'])} fixtures)")


if __name__ == "__main__":
    main()
