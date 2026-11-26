"""Song facts coming in: their shape, their limits, who measured them, and which measurement wins.

A song's facts are what analysis measured about it (docs/engineering/cloud-planning.md): the
`analysis` row's numbers and the per-beat and per-bar arrays the planner reads (`SONG_ARRAYS`).
In Cloud they arrive from the member's device or from a SelectaDJ worker. Nothing here is audio:

- `beats` are beat times in seconds, and `bar_starts` which beat starts each bar.
- The five bar arrays are one summary per bar (a bar is two seconds or so): its energy (0 to 1),
  its share of energy below 200 Hz, its level in dB, its 12 pitch-class weights, and 13 to 20
  averaged MFCC tone numbers. A bar-long average can't be turned back into the sound it came
  from, and nothing finer than a beat is accepted.

The waveform peaks, raw beats and raw downbeats that the Python analysis also keeps are never
accepted: the planner doesn't read them, and the peaks are the closest thing to a waveform.

`check` refuses, never clamps: every number finite and in the range the Python analysis can
produce, every array of its one shape and type, its length bounded by the song's duration.
`wins` is the one rule for which measurement a song keeps when two exist.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np

from selecta.analysis.key import camelot as camelot_of
from selecta.config import ANALYSIS_VERSION

DEVICE = "device"
WORKER = "worker"
SOURCES = (DEVICE, WORKER)


def python_implementation(version: int = ANALYSIS_VERSION) -> str:
    """SelectaDJ's own analysis (Beat This, the key model, the bar features) at `version`."""
    return f"python-beatthis-{int(version)}"


# What a device may say measured its facts, and the facts version each names its features
# artifact with (`engine_store.songs.features_key`). Device versions start at 1001, so they
# never share a key with the Python analysis's (`ANALYSIS_VERSION`, single digits). Add a new
# device implementation here, and to `RANK`.
DEVICE_IMPLEMENTATIONS: dict[str, int] = {
    # the browser's deterministic measurements (web/src/dsp, docs/engineering/device-analysis.md)
    "web-dsp-1": 1001,
}

# Lowest first. A measurement from a higher implementation replaces a lower one from the same
# source; an implementation not listed ranks below all of these.
RANK: tuple[str, ...] = ("web-dsp-1", python_implementation())

# Limits, from what the Python analysis can produce (analysis/beats.py, features.py, key.py).
MAX_SONG_SECONDS = 2 * 3600.0
MIN_TEMPO, MAX_TEMPO = 30.0, 300.0
MIN_BEAT_GAP = 0.1  # 600 beats a minute; nothing finer than a beat is ever a fact
MIN_BEATS = 16  # `beats.build_grid` gives up below this
MAX_SECTIONS = 512
BEATS_PER_BAR = range(2, 13)
LUFS_RANGE = (-70.0, 10.0)
PEAK_RANGE = (-120.0, 24.0)
RMS_DB_RANGE = (-120.0, 120.0)
MFCC_LIMIT = 2000.0
MFCC_WIDTHS = range(13, 21)  # librosa's 20, or the 13 the timbre space reads
SECTION_LABELS = frozenset({"intro", "verse", "chorus", "break", "outro"})
KEY = re.compile(r"^(C|C#|Db|D|D#|Eb|E|F|F#|Gb|G|G#|Ab|A|A#|Bb|B) (major|minor)$")
CAMELOT = re.compile(r"^(1[0-2]|[1-9])[AB]$")

# Each array's one wire type: little-endian float64, float32 or int32.
ARRAY_TYPES: dict[str, str] = {
    "beats": "<f8",
    "bar_starts": "<i4",
    "energy_bars": "<f4",
    "low_share_bars": "<f4",
    "rms_db_bars": "<f4",
    "chroma_bars": "<f4",
    "mfcc_bars": "<f4",
}
BAR_ARRAYS = ("energy_bars", "low_share_bars", "rms_db_bars", "chroma_bars", "mfcc_bars")


class FactsRefused(ValueError):
    """Facts that can't be stored, with a stable code and the field that failed."""

    def __init__(self, code: str, field: str, message: str) -> None:
        super().__init__(message)
        self.code, self.field, self.message = code, field, message

    def detail(self) -> dict[str, str]:
        return {"code": self.code, "field": self.field, "message": self.message}


@dataclass(frozen=True)
class Provenance:
    """Who measured a song's facts, and when (UTC text that sorts by time)."""

    implementation: str
    source: str
    measured_at: str


def rank(implementation: str) -> int:
    return RANK.index(implementation) if implementation in RANK else -1


def wins(new: Provenance, old: Provenance) -> bool:
    """Whether `new` replaces `old` for one song. A worker's measurement beats a device's; from
    the same source a higher-ranked implementation beats a lower one; at equal rank the newer
    wins (a re-measure at the same time counts as newer)."""
    if new.source != old.source:
        return new.source == WORKER
    if rank(new.implementation) != rank(old.implementation):
        return rank(new.implementation) > rank(old.implementation)
    return new.measured_at >= old.measured_at


def implementation_of(row: Mapping[str, Any]) -> Provenance:
    """A stored row's provenance. Null columns are a row the Desktop's own Python analysis
    wrote: SelectaDJ measured it, at the row's version."""
    return Provenance(
        row.get("implementation") or python_implementation(row.get("version") or 0),
        row.get("source") or WORKER,
        str(row.get("analysed_at") or ""),
    )


@dataclass(frozen=True)
class SongFacts:
    """One song's facts, checked or about to be."""

    bpm: float
    constant_tempo: bool
    grid_confidence: float
    beats_per_bar: int
    key: str
    camelot: str
    key_confidence: float
    lufs: float
    peak_db: float
    energy: float
    sections: list[dict]
    arrays: dict[str, np.ndarray]
    implementation: str
    source: str
    key_agrees_chroma: bool | None = None


def _refuse(code: str, field: str, message: str) -> FactsRefused:
    return FactsRefused(code, field, message)


def decode_arrays(wire: Mapping[str, Any]) -> dict[str, np.ndarray]:
    """The arrays from their wire form: each `{"dtype", "shape", "data"}`, `data` base64 of the
    little-endian values. Only the planner's arrays, each in its one type."""
    unknown = sorted(set(wire) - set(ARRAY_TYPES))
    if unknown:
        raise _refuse("unknown_array", unknown[0], "Only the planner's arrays are accepted.")
    missing = [name for name in ARRAY_TYPES if name not in wire]
    if missing:
        raise _refuse("missing_array", missing[0], "Every planner array is needed.")
    arrays: dict[str, np.ndarray] = {}
    for name, dtype in ARRAY_TYPES.items():
        item = wire[name]
        if not isinstance(item, Mapping) or set(item) != {"dtype", "shape", "data"}:
            raise _refuse("bad_array", name, "An array is its dtype, shape and data.")
        if item["dtype"] != dtype:
            raise _refuse("bad_array", name, f"This array is sent as {dtype}.")
        shape = item["shape"]
        rank_ok = 2 if name in ("chroma_bars", "mfcc_bars") else 1
        if (
            not isinstance(shape, list)
            or len(shape) != rank_ok
            or not all(isinstance(n, int) and not isinstance(n, bool) and n >= 0 for n in shape)
        ):
            raise _refuse("bad_array", name, "The array's shape doesn't fit it.")
        if not isinstance(item["data"], str):
            raise _refuse("bad_array", name, "Array data is base64 text.")
        try:
            raw = base64.b64decode(item["data"], validate=True)
        except (binascii.Error, ValueError):
            raise _refuse("bad_array", name, "Array data is base64 text.") from None
        if len(raw) != math.prod(shape) * np.dtype(dtype).itemsize:
            raise _refuse("bad_array", name, "The data doesn't match the declared shape.")
        arrays[name] = np.frombuffer(raw, dtype=dtype).reshape(shape).astype(dtype[1:])
    return arrays


def encode_array(name: str, values: np.ndarray) -> dict[str, Any]:
    """One array in its wire form (the inverse of `decode_arrays`), for a studio or a test."""
    data = np.ascontiguousarray(values, dtype=ARRAY_TYPES[name])
    return {
        "dtype": ARRAY_TYPES[name],
        "shape": list(data.shape),
        "data": base64.b64encode(data.tobytes()).decode("ascii"),
    }


def _number(field: str, value: Any, low: float, high: float) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _refuse("not_a_number", field, "This has to be a number.")
    if not math.isfinite(value):
        raise _refuse("not_finite", field, "Numbers have to be finite.")
    if not low <= value <= high:
        raise _refuse("out_of_range", field, f"This has to be from {low:g} to {high:g}.")


def _within(name: str, values: np.ndarray, low: float, high: float) -> None:
    if not np.all(np.isfinite(values)):
        raise _refuse("not_finite", name, "Numbers have to be finite.")
    if values.size and (float(values.min()) < low or float(values.max()) > high):
        raise _refuse("out_of_range", name, f"Values have to be from {low:g} to {high:g}.")


def _check_arrays(arrays: dict[str, np.ndarray], duration: float) -> int:
    beats, starts = arrays["beats"], arrays["bar_starts"]
    most = int(duration / MIN_BEAT_GAP) + 1
    if not MIN_BEATS <= beats.size <= most:
        raise _refuse("bad_length", "beats", f"A song this long has {MIN_BEATS} to {most} beats.")
    _within("beats", beats, 0.0, duration + 1.0)
    if np.any(np.diff(beats) < MIN_BEAT_GAP):
        raise _refuse("bad_order", "beats", "Beats rise, at least 0.1 seconds apart.")
    if not 2 <= starts.size <= beats.size:
        raise _refuse("bad_length", "bar_starts", "Bars number from 2 to the number of beats.")
    if int(starts.min()) < 0 or int(starts.max()) >= beats.size or np.any(np.diff(starts) <= 0):
        raise _refuse("bad_order", "bar_starts", "Bars start on rising beats of this song.")
    bars = int(starts.size)
    for name in BAR_ARRAYS:
        if arrays[name].shape[0] != bars:
            raise _refuse("bad_length", name, "Every bar array has one entry per bar.")
    if arrays["chroma_bars"].shape[1] != 12:
        raise _refuse("bad_array", "chroma_bars", "Twelve pitch classes per bar.")
    if arrays["mfcc_bars"].shape[1] not in MFCC_WIDTHS:
        raise _refuse("bad_array", "mfcc_bars", "13 to 20 tone numbers per bar.")
    for name in ("energy_bars", "low_share_bars", "chroma_bars"):
        _within(name, arrays[name], 0.0, 1.0)
    _within("rms_db_bars", arrays["rms_db_bars"], *RMS_DB_RANGE)
    _within("mfcc_bars", arrays["mfcc_bars"], -MFCC_LIMIT, MFCC_LIMIT)
    return bars


def _check_sections(sections: Any, bars: int) -> None:
    if not isinstance(sections, list) or not 1 <= len(sections) <= MAX_SECTIONS:
        raise _refuse("bad_sections", "sections", f"1 to {MAX_SECTIONS} sections.")
    shape = {"start_bar", "end_bar", "label", "energy", "group", "chorus_prob"}
    previous_end = 0
    for index, section in enumerate(sections):
        where = f"sections[{index}]"
        if not isinstance(section, dict) or set(section) != shape:
            raise _refuse("bad_sections", where, "A section is its bars, label and numbers.")
        start, end, group = section["start_bar"], section["end_bar"], section["group"]
        if not all(isinstance(n, int) and not isinstance(n, bool) for n in (start, end, group)):
            raise _refuse("bad_sections", where, "Bars and groups are whole numbers.")
        if not previous_end <= start < end <= bars or not 0 <= group <= MAX_SECTIONS:
            raise _refuse("bad_sections", where, "Sections run in order within the song.")
        if section["label"] not in SECTION_LABELS:
            raise _refuse("bad_sections", where, "That isn't a section label.")
        _number(f"{where}.energy", section["energy"], 0.0, 1.0)
        _number(f"{where}.chorus_prob", section["chorus_prob"], 0.0, 1.0)
        previous_end = end


def check(facts: SongFacts, duration: float | None) -> None:
    """Refuse facts that don't fit what analysis can measure for a song of this duration."""
    if duration is None:
        raise _refuse("duration_unknown", "duration_s", "The song's length isn't known yet.")
    _number("duration_s", duration, 1.0, MAX_SONG_SECONDS)
    if facts.source not in SOURCES:
        raise _refuse("bad_source", "source", "Facts come from a device or a worker.")
    if facts.source == DEVICE and facts.implementation not in DEVICE_IMPLEMENTATIONS:
        raise _refuse("unknown_implementation", "implementation", "Unknown implementation.")
    version_of(facts.implementation, facts.source)
    _number("bpm", facts.bpm, MIN_TEMPO, MAX_TEMPO)
    _number("grid_confidence", facts.grid_confidence, 0.0, 1.0)
    _number("key_confidence", facts.key_confidence, 0.0, 1.0)
    _number("lufs", facts.lufs, *LUFS_RANGE)
    _number("peak_db", facts.peak_db, *PEAK_RANGE)
    _number("energy", facts.energy, 0.0, 1.0)
    if not isinstance(facts.beats_per_bar, int) or facts.beats_per_bar not in BEATS_PER_BAR:
        raise _refuse("out_of_range", "beats_per_bar", "2 to 12 beats to a bar.")
    if not isinstance(facts.key, str) or not KEY.fullmatch(facts.key):
        raise _refuse("bad_key", "key", "A key is like 'A minor'.")
    if not isinstance(facts.camelot, str) or not CAMELOT.fullmatch(facts.camelot):
        raise _refuse("bad_key", "camelot", "A Camelot code is like 8A.")
    if camelot_of(facts.key) != facts.camelot:
        raise _refuse("bad_key", "camelot", "The Camelot code doesn't name the same key.")
    bars = _check_arrays(facts.arrays, duration)
    _check_sections(facts.sections, bars)


def features_bytes(arrays: Mapping[str, np.ndarray]) -> bytes:
    """The features file the engine store reads (`analysis.pipeline.read_features`): only the
    planner's arrays, in their checked types."""
    stream = io.BytesIO()
    np.savez_compressed(stream, **{name: arrays[name] for name in ARRAY_TYPES})
    return stream.getvalue()


def analysis_row(facts: SongFacts, version: int, measured_at: str) -> dict[str, Any]:
    """The `analysis` row's values for these facts, as `db.save_analysis` writes them."""
    return {
        "version": int(version),
        "bpm": float(facts.bpm),
        "constant_tempo": int(bool(facts.constant_tempo)),
        "grid_confidence": float(facts.grid_confidence),
        "beats_per_bar": int(facts.beats_per_bar),
        "key": facts.key,
        "camelot": facts.camelot,
        "key_confidence": float(facts.key_confidence),
        "key_agrees_chroma": (
            None if facts.key_agrees_chroma is None else int(bool(facts.key_agrees_chroma))
        ),
        "lufs": float(facts.lufs),
        "peak_db": float(facts.peak_db),
        "energy": float(facts.energy),
        "sections": json.dumps(facts.sections),
        "timbre": None,
        "timings": None,
        "error": None,
        "analysed_at": measured_at,
        "implementation": facts.implementation,
        "source": facts.source,
    }


def version_of(implementation: str, source: str) -> int:
    """The facts version an implementation names its features artifact with."""
    if source == DEVICE:
        return DEVICE_IMPLEMENTATIONS[implementation]
    match = re.fullmatch(r"python-beatthis-(\d+)", implementation)
    if match is None:
        raise _refuse("unknown_implementation", "implementation", "Unknown implementation.")
    return int(match.group(1))


__all__ = [
    "ARRAY_TYPES",
    "DEVICE",
    "DEVICE_IMPLEMENTATIONS",
    "RANK",
    "WORKER",
    "FactsRefused",
    "Provenance",
    "SongFacts",
    "analysis_row",
    "check",
    "decode_arrays",
    "encode_array",
    "features_bytes",
    "implementation_of",
    "python_implementation",
    "rank",
    "version_of",
    "wins",
]
