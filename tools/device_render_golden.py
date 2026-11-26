"""Generate the golden fixtures for rendering and auditing a transition in the browser (device
studio, phase 5; docs/engineering/device-render.md).

Builds short synthetic songs from code (the synthesis of ``tools/device_analysis_golden.py``,
whose browser twin is ``web/src/dsp/analysis/synth.ts``), makes transition scripts for pairs of
them with the REAL recipes (``planner_core/recipes``) and ``render/stem_seam.py``, writes each
script with ``script_json.to_json``, reads it back, renders it with the REAL ``render()`` through
a resolver that serves the synthetic audio, audits it with the REAL ``audit()``, and writes what
the browser port (``web/src/dsp/render/``) is compared with under
``web/src/dsp/golden/device-render/``. It also writes a table of repair-rule cases answered by
the REAL ``planner_core/repair.py``.

Two families of scripts:
  - ``a``: every warp plays at real speed (both songs at one tempo), so no time-stretch runs and
    the port must match sample for sample. Each stage is stored (decimated) for these.
  - ``b``: warps that stretch. The Desktop stretches with Rubber Band, the browser with WSOLA,
    so only the audit and a few perceptual measures can be compared.

Every script is rendered and audited twice: ``port`` with ``soxr.resample`` replaced by the
browser's resampler written in numpy (the limiter's and the audit's true peak and the harmony
check's 22,050 Hz signal), which the port must match closely, and ``desktop`` exactly as the
Desktop runs; the manifest records how far the two differ.

Nothing here downloads anything, reads a music file or loads a model. Script only - run by hand
when the renderer, the audit or the port's recipe changes:

    python tools/device_render_golden.py [--out FOLDER]
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import hashlib
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
import pyloudnorm
import soxr

from selecta.analysis.song import Cue, SongInfo
from selecta.audit.checks import audit, audit_facts, true_peak_db
from selecta.config import SAMPLE_RATE
from selecta.lyrics.lrclib import Line
from selecta.planner_core import repair
from selecta.planner_core.recipes.blend import bass_swap_blend, filter_sweep, tempo_ramp
from selecta.planner_core.recipes.exits import cut_on_one, delay_throw, echo_out, reverb_wash
from selecta.render import dsp, engine, script_json
from selecta.render.engine import SongCache, in_context, render
from selecta.render.script import Curve
from selecta.render.stem_seam import LANES, Lane, stem_script

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "web" / "src" / "dsp" / "golden" / "device-render"


def _analysis_golden():
    path = ROOT / "tools" / "device_analysis_golden.py"
    spec = importlib.util.spec_from_file_location("device_analysis_golden", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GOLDEN = _analysis_golden()

# --- Songs ---------------------------------------------------------------------------------------

FOUR = [0, 1, 2, 3]
OFFBEATS = [0.5, 1.5, 2.5, 3.5]
EIGHTHS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
A_MINOR = ([45, 41, 48, 43], [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]])
C_MAJOR = ([48, 45, 41, 43], [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]])


def _song(song_id, name, duration, bpm, start, keys, kicks, snares, hats):
    roots, chords = keys
    song = GOLDEN.groove_song(
        name, SAMPLE_RATE, duration, bpm, start, 4, roots, chords, kicks, snares, hats
    )
    # the exact grid groove_song placed its hits on (rawBeats is the tracker's rounded view)
    period, beats, t = 60.0 / bpm, [], start
    while t < duration - 0.2:
        beats.append(t)
        t = start + len(beats) * period
    beats = beats[: len(beats) // 4 * 4]
    return {"id": song_id, "bpm": bpm, "beats": beats, **song}


def songs() -> list[dict]:
    return [
        _song(1, "render-a-124-a-minor", 56.0, 124.0, 0.1, A_MINOR, FOUR, [1, 3], OFFBEATS),
        _song(2, "render-b-124-c-major", 48.0, 124.0, 0.3, C_MAJOR, [0, 1.5, 2], [1, 3], EIGHTHS),
        _song(3, "render-b-126-c-major", 48.0, 126.0, 0.3, C_MAJOR, [0, 1.5, 2], [1, 3], EIGHTHS),
        _song(4, "render-b-128-c-major", 48.0, 128.0, 0.3, C_MAJOR, [0, 1.5, 2], [1, 3], EIGHTHS),
        _song(5, "render-b-132-c-major", 48.0, 132.0, 0.3, C_MAJOR, [0, 1.5, 2], [1, 3], EIGHTHS),
    ]


def stem_of(event: dict) -> str:
    """Which separated stem a synthetic event belongs to; synth.ts decides the same way."""
    if event["kind"] in ("kick", "snare", "hat"):
        return "drums"
    return "bass" if len(event["harmonics"]) == 3 else "other"


def stem_audio(song: dict, stem: str) -> np.ndarray:
    if stem == "band":
        return GOLDEN.render({**song, "events": song["events"]})
    events = [e for e in song["events"] if stem != "vocals" and stem_of(e) == stem]
    return GOLDEN.render({**song, "events": events})


def song_info(song: dict, lufs: float, peak: float, beat_shift: float = 0.0, lines=()) -> SongInfo:
    beats = np.asarray(song["beats"], dtype=np.float64) + beat_shift
    bars = beats.size // 4
    return SongInfo(
        id=song["id"],
        path=f"synthetic/{song['name']}.wav",
        artist="Synthetic",
        title=song["name"],
        genre=None,
        family="dance",
        duration=song["durationS"],
        bpm=song["bpm"],
        beats=beats,
        bar_starts=np.arange(0, bars * 4, 4),
        beats_per_bar=4,
        constant_tempo=True,
        grid_confidence=1.0,
        sections=[],
        camelot="8A",
        key_confidence=0.5,
        lufs=lufs,
        peak_db=peak,
        energy=0.5,
        energy_bars=np.full(bars, 0.5),
        low_share_bars=np.full(bars, 0.3),
        lines=list(lines),
        vocals_known=bool(lines),
    )


def cue(song: SongInfo, bar: int) -> Cue:
    return Cue(bar, song.bar_time(bar), "phrase", 0.9, 4)


class SyntheticResolver:
    """Serves the synthetic audio for a source reference: a song's mix, or a stem window."""

    def __init__(self, by_id: dict[int, dict]):
        self.by_id = by_id
        self.mixes: dict[int, np.ndarray] = {}
        self.stems: dict[tuple[int, str], np.ndarray] = {}

    def mix(self, song_id: int) -> np.ndarray:
        if song_id not in self.mixes:
            self.mixes[song_id] = GOLDEN.render(self.by_id[song_id])
        return self.mixes[song_id]

    def resolve(self, ref, local_path):
        if ref.role == "mix":
            return self.mix(ref.song)
        key = (ref.song, ref.stem)
        if key not in self.stems:
            self.stems[key] = stem_audio(self.by_id[ref.song], ref.stem)
        first = round(ref.start * SAMPLE_RATE)
        return self.stems[key][first : round((ref.start + ref.duration) * SAMPLE_RATE)]


@contextlib.contextmanager
def port_resampler():
    """soxr.resample replaced by the browser's resampler (resample.ts) written in numpy."""
    original = soxr.resample

    def stand_in(signal, rate_in, rate_out, quality="HQ"):
        signal = np.asarray(signal)
        if signal.ndim == 1:
            return GOLDEN.sinc_resample(signal, int(rate_in), int(rate_out))
        return np.stack(
            [GOLDEN.sinc_resample(signal[:, c], int(rate_in), int(rate_out)) for c in range(2)],
            axis=1,
        )

    soxr.resample = stand_in
    try:
        yield
    finally:
        soxr.resample = original


# --- Cases ---------------------------------------------------------------------------------------


def _stem_seam(a: SongInfo, b: SongInfo):
    bar = 4 * a.period
    seconds = 8 * bar
    a_start, b0 = a.bar_time(12), b.bar_time(4)
    steps = np.arange(9) * bar
    half = seconds * 0.5

    def lane(side, origin, gain):
        return Lane(f"synthetic/{side}.wav", origin, seconds + 1.0, gain)

    gains = {
        ("a", "drums"): Curve([(0.0, 1.0), (seconds * 0.6, 1.0), (seconds, 0.0)]),
        ("a", "bass"): Curve([(half - 0.1, 1.0), (half + 0.1, 0.0)]),
        ("a", "other"): Curve([(0.0, 1.0), (seconds, 0.2)]),
        ("a", "vocals"): Curve.constant(0.0),
        ("b", "drums"): Curve([(0.0, 0.0), (seconds * 0.4, 1.0)]),
        ("b", "bass"): Curve([(half - 0.1, 0.0), (half + 0.1, 1.0)]),
        ("b", "other"): Curve([(0.0, 0.3), (seconds, 1.0)]),
        ("b", "vocals"): Curve.constant(0.0),
    }
    lanes = {
        key: lane(key[0], (a_start if key[0] == "a" else b0) - 0.5, gain)
        for key, gain in gains.items()
    }
    assert set(lanes) == {(side, stem) for side in ("a", "b") for stem in LANES}
    vocal_gains = {"a": Curve([(0.0, 1.0), (half, 0.0)]), "b": Curve([(half, 0.0), (seconds, 1.0)])}
    script = stem_script(
        "seam_studio",
        a,
        b,
        seconds,
        a_start,
        steps,
        b0 + steps,
        lanes,
        {"bars": 8, "vocal_gains": vocal_gains},
    )
    spans = {"a": [(a_start + 2.0, a_start + 5.0)], "b": [(b0 + 4.0, b0 + 8.0)]}
    return script, spans


def cases(by_name: dict[str, dict]) -> list[dict]:
    a = song_info(by_name["a124"], -13.0, -3.0)
    b = song_info(by_name["b124"], -15.5, -4.0)
    b_hot_late = song_info(by_name["b124"], -20.0, -8.0, beat_shift=-0.009)
    exit_time = a.bar_time(20)
    a_sung = song_info(
        by_name["a124"],
        -13.0,
        -3.0,
        lines=[
            Line(exit_time - 9.0, exit_time - 4.5, "la"),
            Line(exit_time - 3.2, exit_time - 0.25, "la"),
        ],
    )
    out = [
        ("a", "blend-8", bass_swap_blend(a, b, cue(a, 20), cue(b, 4), bars=8), "blend"),
        (
            "a",
            "blend-8-nudged-hot",
            bass_swap_blend(a, b_hot_late, cue(a, 20), cue(b_hot_late, 4), bars=8),
            None,
        ),
        ("a", "filter-sweep-8", filter_sweep(a, b, cue(a, 20), cue(b, 4), bars=8), None),
        ("a", "cut-on-one", cut_on_one(a, b, cue(a, 20), cue(b, 4)), None),
        ("a", "echo-out", echo_out(a, b, cue(a, 20), cue(b, 4)), None),
        ("a", "delay-throw", delay_throw(a_sung, b, cue(a_sung, 20), cue(b, 4)), None),
        ("a", "reverb-wash", reverb_wash(a, b, cue(a, 20), cue(b, 4)), None),
    ]
    found = []
    for family, name, script, spans in out:
        assert script is not None, name
        found.append({"family": family, "name": name, "script": script, "spans": spans})
    seam, seam_spans = _stem_seam(a, b)
    found.append({"family": "a", "name": "stem-seam", "script": seam, "spans": seam_spans})
    b126 = song_info(by_name["b126"], -15.5, -4.0)
    b128 = song_info(by_name["b128"], -15.5, -4.0)
    b132 = song_info(by_name["b132"], -15.5, -4.0)
    for name, script in (
        ("blend-126", bass_swap_blend(a, b126, cue(a, 20), cue(b126, 4), bars=8)),
        ("sweep-128", filter_sweep(a, b128, cue(a, 20), cue(b128, 4), bars=8)),
        ("ramp-132", tempo_ramp(a, b132, cue(a, 20), cue(b132, 4), bars=4)),
    ):
        assert script is not None, name
        found.append({"family": "b", "name": name, "script": script, "spans": None})
    for case in found:
        if case["spans"] == "blend":
            script = case["script"]
            a_in = float(script.a.warp.source_at(script.overlap[0]))
            b_in = float(script.b.warp.source_at(script.overlap[0]))
            case["spans"] = {"a": [(a_in + 1.0, a_in + 6.0)], "b": [(b_in + 4.0, b_in + 9.0)]}
    return found


# --- Measuring -----------------------------------------------------------------------------------


def b64(values: np.ndarray) -> str:
    """float32 values as little-endian bytes in base64."""
    return base64.b64encode(np.ascontiguousarray(values, dtype="<f4").tobytes()).decode("ascii")


def summary(audio: np.ndarray, stride: int, windows: list[int], block: int = 4096) -> dict:
    """A signal too long to store whole: every `stride`-th sample from `stride // 2`, 256-sample
    windows at the given samples, per-block RMS and peak, and a hash of every float32 byte."""
    audio = np.asarray(audio, dtype=np.float32)
    n = audio.shape[0]
    blocks = n // block
    shaped = audio[: blocks * block].astype(np.float64).reshape(blocks, block, 2)
    kept = []
    for at in windows:
        first = int(min(max(at - 128, 0), max(n - 256, 0)))
        kept.append({"at": first, "values": [b64(audio[first : first + 256, c]) for c in range(2)]})
    return {
        "length": int(n),
        "stride": stride,
        "probe": [b64(audio[stride // 2 :: stride, c]) for c in range(2)],
        "windows": kept,
        "block": block,
        "rms": [b64(np.sqrt(np.mean(shaped[:, :, c] ** 2, axis=1))) for c in range(2)],
        "peak": [b64(np.max(np.abs(shaped[:, :, c]), axis=1)) for c in range(2)],
        "sha256": hashlib.sha256(np.ascontiguousarray(audio).tobytes()).hexdigest(),
    }


def perceptual(audio: np.ndarray) -> dict:
    """Measures two renders can be compared by when their samples cannot: loudness, band levels
    in half-second blocks, and onset times. The port computes the same from its clip."""
    audio = np.asarray(audio, dtype=np.float32)
    mono = audio.mean(axis=1)
    low = dsp.zero_phase_lowpass(mono, dsp.LOW_SPLIT_HZ)
    high = mono - dsp.zero_phase_lowpass(mono, dsp.HIGH_SPLIT_HZ)
    mid = mono - low - high
    block = SAMPLE_RATE // 2

    def levels(x: np.ndarray) -> list[float]:
        count = x.size // block
        shaped = x[: count * block].astype(np.float64).reshape(count, block)
        rms = np.sqrt(np.mean(shaped**2, axis=1))
        return [float(20 * math.log10(max(v, 1e-6))) for v in rms]

    env = dsp.transient_envelope(mono).astype(np.float64)
    floor = 0.3 * float(env.max())
    peaks = [
        i
        for i in range(1, env.size - 1)
        if env[i] >= floor and env[i] >= env[i - 1] and env[i] > env[i + 1]
    ]
    kept: list[int] = []
    for i in sorted(peaks, key=lambda i: (-env[i], i)):
        if all(abs(i - k) > 20 for k in kept):
            kept.append(i)
    meter = pyloudnorm.Meter(SAMPLE_RATE)
    return {
        "lufs": float(meter.integrated_loudness(audio.astype(np.float64))),
        "lufs_playback_meter": GOLDEN.playback_meter_lufs(audio, SAMPLE_RATE),
        "true_peak_db": float(true_peak_db(audio)),
        "band_db": {"low": levels(low), "mid": levels(mid), "high": levels(high)},
        "onsets": [round(k * dsp._ENV_HOP_TIME, 6) for k in sorted(kept)],
    }


def staged(script, resolver) -> dict:
    """render() step by step through the engine's own functions, so each stage can be stored.
    The caller checks the limited sum against render()'s audio, sample for sample."""
    cache = SongCache()
    count = int(round(script.duration * SAMPLE_RATE))
    source_a = engine._part_source(script.a, resolver, cache)
    source_b = engine._part_source(script.b, resolver, cache)
    placed_a, _ = engine._part_audio(script.a, source_a, count)
    placed_b, _ = engine._part_audio(script.b, source_b, count)
    lag = engine._pocket_lag(script, placed_a, placed_b)
    nudged_b, nudge = engine._nudge_into_the_pocket(script, placed_a, placed_b)
    dry_a, tails_a = engine._apply_moves(script.a, placed_a)
    dry_b, tails_b = engine._apply_moves(script.b, nudged_b)
    mixed = dry_a + dry_b + tails_a + tails_b
    for extra in script.extras:
        source = engine._part_source(extra, resolver, cache)
        placed, _ = engine._part_audio(extra, source, count)
        if extra.follows_b:
            placed = engine._slide(script, placed, nudge)
        dry, tails = engine._apply_moves(extra, placed)
        mixed = mixed + dry + tails
    return {
        "placed_a": placed_a,
        "placed_b": nudged_b,
        "dry_a": dry_a,
        "tails_a": tails_a,
        "dry_b": dry_b,
        "tails_b": tails_b,
        "mixed": mixed,
        "limited": dsp.limit(mixed),
        "lag": lag,
    }


def report_json(report) -> dict:
    return {
        "passed": bool(report.passed),
        "checks": [
            {
                "name": c.name,
                "passed": bool(c.passed),
                "value": float(c.value),
                "limit": float(c.limit),
                "unit": c.unit,
                "fix": c.fix,
                "detail": c.detail,
            }
            for c in report.checks
        ],
    }


def _windows(script) -> list[int]:
    start, end = script.overlap
    marks = [start, (start + end) / 2, end, script.duration - 0.5]
    if "cut" in script.meta:
        marks.append(float(script.meta["cut"]))
    if "swap" in script.meta:
        marks.append(float(script.meta["swap"]))
    return [int(m * SAMPLE_RATE) for m in marks]


STAGES = ("placed_a", "placed_b", "dry_a", "tails_a", "dry_b", "tails_b", "mixed")


def measure(case: dict, resolver: SyntheticResolver) -> dict:
    text = script_json.to_json(case["script"])
    script = script_json.from_json(text)
    spans = case["spans"] or {}
    marks = _windows(script)
    out: dict = {"name": case["name"], "family": case["family"], "script": json.loads(text)}
    out["vocal_spans"] = {side: [list(s) for s in spans[side]] for side in spans}
    with port_resampler():
        rendered = render(script, cache=SongCache(), resolver=resolver)
        report = audit(rendered, vocal_spans=spans)
        port = {
            "drift_ms": rendered.drift_ms,
            "report": report_json(report),
            "facts": audit_facts(report).to_json(),
            "clip": summary(rendered.audio, 211, marks),
            "a_dry": summary(rendered.a_dry, 997, marks),
            "b_dry": summary(rendered.b_dry, 997, marks),
            "perceptual": perceptual(rendered.audio),
        }
        if case["family"] == "a":
            stages = staged(script, resolver)
            if not np.array_equal(stages["limited"], rendered.audio):
                raise AssertionError(f"{case['name']}: the staged render is not render()'s")
            port["nudge_seconds"] = float(stages["lag"])
            port["stages"] = {name: summary(stages[name], 997, marks) for name in STAGES}
            if case["name"] in ("blend-8", "cut-on-one"):
                audio, clip_at = in_context(
                    rendered, 3.0, 3.0, cache=SongCache(), resolver=resolver
                )
                port["in_context"] = {
                    "before": 3.0,
                    "after": 3.0,
                    "clip_at": clip_at,
                    "audio": summary(audio, 211, [int(clip_at * SAMPLE_RATE)]),
                }
    out["port"] = port
    desktop = render(script, cache=SongCache(), resolver=resolver)
    desktop_report = audit(desktop, vocal_spans=spans)
    out["desktop"] = {
        "drift_ms": desktop.drift_ms,
        "report": report_json(desktop_report),
        "facts": audit_facts(desktop_report).to_json(),
        "perceptual": perceptual(desktop.audio),
        "clip_max_abs_vs_port": float(np.max(np.abs(desktop.audio - rendered.audio))),
    }
    return out


# --- The repair rule -----------------------------------------------------------------------------


def _facts(passed: bool, *failures) -> repair.AuditFacts:
    return repair.AuditFacts(passed, tuple(repair.FailedCheck(*f) for f in failures))


def _cue(bar: int, time: float, quality: float = 0.8) -> tuple:
    return (bar, time, "phrase", quality, 2)


BEAT = ("beat alignment", 31.5, 20.0, "change_recipe")
VOCAL = ("vocal overlap", 3.4, 2.0, "shorten")
QUIET = ("quiet time", 1.6, 1.2, "close_gap")
ENTRY = ("entry level", 3.1, 2.5, "move_cue")
FALL = ("level fall", 6.0, 3.5, "move_cue")
PEAK = ("true peak", -0.5, -1.0, "change_recipe")
UNFIXED = ("entry level", 2.6, 2.5, None)
ENDLESS = ("harmony", float("inf"), 0.16, "shorten")


def _next_cases(options: list) -> list[tuple]:
    att = repair.Attempted
    clean = _facts(True)
    failed = lambda *checks: _facts(False, *checks)  # noqa: E731
    return [
        ("nothing tried", options, [], repair.MAX_REPAIRS),
        ("no options", [], [], repair.MAX_REPAIRS),
        ("last passed", options, [att(0, failed(BEAT)), att(3, clean)], repair.MAX_REPAIRS),
        ("recipe built nothing", options, [att(0, None)], repair.MAX_REPAIRS),
        ("two built nothing", options, [att(0, None), att(1, None)], repair.MAX_REPAIRS),
        ("shorten finds a shorter blend", options, [att(0, failed(VOCAL))], repair.MAX_REPAIRS),
        ("shorten, nothing shorter", options, [att(1, failed(VOCAL))], repair.MAX_REPAIRS),
        ("move_cue finds other cues", options, [att(0, failed(ENTRY))], repair.MAX_REPAIRS),
        ("close_gap finds other cues", options, [att(0, failed(QUIET))], repair.MAX_REPAIRS),
        ("change_recipe takes another move", options, [att(0, failed(PEAK))], repair.MAX_REPAIRS),
        ("no fix named", options, [att(0, failed(UNFIXED))], repair.MAX_REPAIRS),
        (
            "only the same move left",
            options[:3],
            [att(0, failed(PEAK)), att(1, failed(PEAK))],
            repair.MAX_REPAIRS,
        ),
        (
            "everything tried",
            options[:2],
            [att(0, failed(PEAK)), att(1, failed(PEAK))],
            repair.MAX_REPAIRS,
        ),
        ("too many renders", options, [att(i, failed(PEAK)) for i in range(5)], repair.MAX_REPAIRS),
        ("renders at the limit", options, [att(i, failed(PEAK)) for i in range(4)], 4),
        ("a tighter budget", options, [att(i, failed(PEAK)) for i in range(2)], 1),
        ("a negative place", options, [att(-1, failed(ENTRY))], repair.MAX_REPAIRS),
        ("an infinite value", options, [att(0, failed(ENDLESS))], repair.MAX_REPAIRS),
    ]


def repair_cases() -> list[dict]:
    """Ranked options, attempts and audit facts, with what the real rule answers: every branch of
    next_step, take_step, good_enough and closer."""
    options = [
        repair.Option("bass_swap_blend", 16, _cue(32, 61.9), _cue(8, 15.2)),
        repair.Option("bass_swap_blend", 8, _cue(32, 61.9), _cue(8, 15.2)),
        repair.Option("bass_swap_blend", 16, _cue(40, 77.4), _cue(8, 15.2)),
        repair.Option("filter_sweep", 8, _cue(32, 61.9), _cue(8, 15.2)),
        repair.Option("echo_out", 0, _cue(32, 61.9), _cue(4, 7.6)),
        repair.Option("bass_swap_blend", 16, _cue(32, 61.9), _cue(8, 15.2, 0.5)),
    ]
    out = []
    for name, opts, attempts, budget in _next_cases(options):
        out.append(
            {
                "kind": "next_step",
                "name": name,
                "max_repairs": budget,
                "options": [o.to_json() for o in opts],
                "attempts": [a.to_json() for a in attempts],
                "step": repair.next_step(opts, attempts, max_repairs=budget).to_json(),
            }
        )
    failed = lambda *checks: _facts(False, *checks)  # noqa: E731
    far_beat = ("beat alignment", 40.0, 20.0, "change_recipe")
    for name, first, second in (
        ("beats missed", failed(BEAT), None),
        ("beats fine", failed(ENTRY), None),
        ("clean first take", _facts(True), None),
        ("second closer", failed(BEAT, ENTRY), failed(BEAT)),
        ("second further", failed(BEAT), failed(BEAT, ENTRY)),
        ("equal takes", failed(BEAT), failed(BEAT)),
        ("same count, second less over", failed(far_beat), failed(BEAT)),
    ):
        out.append(
            {
                "kind": "take_step",
                "name": name,
                "first": first.to_json(),
                "second": None if second is None else second.to_json(),
                "step": repair.take_step(first, second).to_json(),
            }
        )
    for name, facts in (
        ("passed", _facts(True)),
        ("beats inside the slack", failed(("beat alignment", 39.0, 20.0, "change_recipe"))),
        ("beats at the slack", failed(far_beat)),
        ("beats past the slack", failed(("beat alignment", 40.5, 20.0, "change_recipe"))),
        (
            "fall and entry near misses",
            failed(("level fall", 6.4, 3.5, "move_cue"), ("entry level", 3.9, 2.5, "move_cue")),
        ),
        ("a check with no slack", failed(("quiet time", 1.25, 1.2, "close_gap"))),
        ("one near miss and one not", failed(BEAT, FALL)),
    ):
        out.append(
            {
                "kind": "good_enough",
                "name": name,
                "facts": facts.to_json(),
                "answer": repair.good_enough(facts),
            }
        )
    for name, x, y in (
        ("fewer failures", failed(BEAT), failed(BEAT, ENTRY)),
        ("more failures", failed(BEAT, ENTRY), failed(BEAT)),
        ("same count, less over", failed(BEAT), failed(far_beat)),
        ("identical", failed(BEAT), failed(BEAT)),
        ("clean against failed", _facts(True), failed(BEAT)),
        ("infinitely over", failed(ENDLESS), failed(VOCAL)),
    ):
        out.append(
            {
                "kind": "closer",
                "name": name,
                "facts": x.to_json(),
                "than": y.to_json(),
                "answer": repair.closer(x, y),
            }
        )
    # every JSON form must read back to what was written
    for case in out:
        for option in case.get("options", []):
            assert repair.Option.from_json(option).to_json() == option
        for attempt in case.get("attempts", []):
            assert repair.Attempted.from_json(attempt).to_json() == attempt
    return out


# --- Output --------------------------------------------------------------------------------------


def _versions() -> dict:
    import librosa
    import pedalboard
    import scipy

    return {
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "soxr": soxr.__version__,
        "librosa": librosa.__version__,
        "pedalboard": pedalboard.__version__,
    }


def _write(path: Path, text: str) -> None:
    """UTF-8 with LF line ends on every system, so the committed files do not churn."""
    path.write_text(text, "utf-8", newline="\n")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--out", type=Path, default=OUTPUT)
    args = parser.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    made = songs()
    by_name = dict(zip(("a124", "b124", "b126", "b128", "b132"), made, strict=True))
    resolver = SyntheticResolver({song["id"]: song for song in made})
    keep = ("id", "name", "sampleRate", "durationS", "bpm", "beats", "events")
    song_file = {"songs": [{key: song[key] for key in keep} for song in made]}
    _write(args.out / "songs.json", json.dumps(song_file, separators=(",", ":")))
    listed = []
    for case in cases(by_name):
        measured = measure(case, resolver)
        name = f"{case['name']}.json"
        _write(args.out / name, json.dumps(measured, separators=(",", ":")))
        listed.append(
            {
                "name": case["name"],
                "file": name,
                "family": case["family"],
                "style": measured["script"]["style"],
                "seconds": measured["script"]["duration"],
                "nudge_ms": measured["port"]["drift_ms"]["nudge"],
                "port_passed": measured["port"]["report"]["passed"],
                "desktop_passed": measured["desktop"]["report"]["passed"],
                "desktop_clip_max_abs_vs_port": measured["desktop"]["clip_max_abs_vs_port"],
            }
        )
        print(case["name"], "written")
    _write(args.out / "repair.json", json.dumps(repair_cases(), separators=(",", ":")))
    manifest = {
        "about": "Fixtures for the browser renderer and audit; docs/engineering/device-render.md",
        "generator": "tools/device_render_golden.py",
        "sample_rate": SAMPLE_RATE,
        "script_schema": script_json.SCHEMA_VERSION,
        "libraries": _versions(),
        "songs": "songs.json",
        "repair": "repair.json",
        "cases": listed,
    }
    _write(args.out / "manifest.json", json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
