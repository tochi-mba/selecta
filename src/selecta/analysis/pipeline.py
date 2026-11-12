"""Fast analysis of one song, timed step by step so estimates come from this machine."""

from __future__ import annotations

import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soxr

from selecta import audio, db
from selecta.analysis.beats import BeatGrid, BeatTracker, build_grid, onset_envelope
from selecta.analysis.features import (
    FEATURE_SR,
    SongFeatures,
    extract,
    loudness,
    waveform_peaks,
)
from selecta.analysis.key import KeyDetector, KeyResult
from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE, Settings


@dataclass
class Analysers:
    beats: BeatTracker
    key: KeyDetector | None

    @classmethod
    def load(cls, settings: Settings, beat_model: str | None = None) -> Analysers:
        tracker = BeatTracker(beat_model or settings.beat_model)
        try:
            detector = KeyDetector(settings.models_dir)
        except Exception as error:  # noqa: BLE001
            print(f"S-KEY unavailable, falling back to chroma: {error}")
            detector = None
        return cls(beats=tracker, key=detector)


@dataclass
class AnalysisResult:
    grid: BeatGrid
    features: SongFeatures
    key: KeyResult
    lufs: float
    peak_db: float
    timings: dict[str, float]


class _Timer:
    def __init__(self) -> None:
        self.timings: dict[str, float] = {}

    def lap(self, name: str, started: float) -> float:
        now = time.perf_counter()
        self.timings[name] = round(now - started, 3)
        return now


def features_path(settings: Settings, song_id: int) -> Path:
    return settings.features_dir / f"{song_id}.npz"


@dataclass
class Earlier:
    """Slow results worth keeping when only the later steps have changed."""

    raw_beats: np.ndarray
    raw_downbeats: np.ndarray
    key: KeyResult


def earlier_results(conn: sqlite3.Connection, settings: Settings, song_id: int) -> Earlier | None:
    path = features_path(settings, song_id)
    row = conn.execute(
        "SELECT key, camelot, key_confidence, key_agrees_chroma FROM analysis "
        "WHERE song_id = ? AND key IS NOT NULL",
        (song_id,),
    ).fetchone()
    if row is None or not path.exists():
        return None
    with np.load(path) as data:
        if "raw_beats" not in data.files:
            return None
        beats = data["raw_beats"].astype(np.float64)
        downbeats = data["raw_downbeats"].astype(np.float64)
    key = KeyResult(
        row["key"], row["camelot"], row["key_confidence"], bool(row["key_agrees_chroma"]), ""
    )
    return Earlier(beats, downbeats, key)


def analyse_audio(
    stereo: np.ndarray, analysers: Analysers, earlier: Earlier | None = None
) -> AnalysisResult | None:
    timer = _Timer()
    tick = time.perf_counter()
    mono = audio.to_mono(stereo)
    mono_22k = soxr.resample(mono, SAMPLE_RATE, FEATURE_SR, quality="HQ").astype(np.float32)
    duration = stereo.shape[0] / SAMPLE_RATE
    tick = timer.lap("resample", tick)

    if earlier is not None:
        raw_beats, raw_downbeats = earlier.raw_beats, earlier.raw_downbeats
    else:
        raw_beats, raw_downbeats = analysers.beats.raw(mono_22k, FEATURE_SR)
    tick = timer.lap("beats", tick)

    envelope = onset_envelope(mono_22k)
    grid = build_grid(raw_beats, raw_downbeats, envelope)
    tick = timer.lap("grid", tick)
    if grid is None or grid.bar_starts.size < 4:
        return None

    features = extract(mono_22k, grid.bar_times(), duration)
    tick = timer.lap("features", tick)

    if earlier is not None:
        key = earlier.key
    elif analysers.key is not None:
        key = analysers.key.detect(mono_22k, FEATURE_SR, features.chroma_profile)
    else:
        from selecta.analysis.key import camelot, chroma_key

        name = chroma_key(features.chroma_profile)
        key = KeyResult(name, camelot(name), 0.2, True, name)
    tick = timer.lap("key", tick)

    lufs, peak_db = loudness(stereo, SAMPLE_RATE)
    timer.lap("loudness", tick)

    return AnalysisResult(grid, features, key, lufs, peak_db, timer.timings)


def analyse_song(
    conn: sqlite3.Connection, settings: Settings, song: sqlite3.Row, analysers: Analysers
) -> AnalysisResult | None:
    started = time.perf_counter()
    try:
        stereo = audio.decode(song["path"])
        decode_seconds = time.perf_counter() - started
        earlier = earlier_results(conn, settings, song["id"])
        result = analyse_audio(stereo, analysers, earlier)
    except Exception as error:  # noqa: BLE001
        db.save_analysis(
            conn,
            song["id"],
            {"version": ANALYSIS_VERSION, "error": f"{type(error).__name__}: {error}"},
        )
        return None

    if result is None:
        db.save_analysis(
            conn, song["id"], {"version": ANALYSIS_VERSION, "error": "no steady beat found"}
        )
        return None

    result.timings["decode"] = round(decode_seconds, 3)
    save_started = time.perf_counter()
    mono = audio.to_mono(stereo)
    grid, features = result.grid, result.features
    # written beside its real name and swapped in whole, so a crash mid-save can't leave a
    # truncated file behind an older analysis that still points at it
    target = features_path(settings, song["id"])
    partial = target.with_name(target.name + ".part")
    with partial.open("wb") as stream:
        np.savez_compressed(
            stream,
            beats=grid.beats,
            bar_starts=grid.bar_starts.astype(np.int32),
            raw_beats=grid.raw_beats.astype(np.float32),
            raw_downbeats=grid.raw_downbeats.astype(np.float32),
            chroma_bars=features.chroma_bars.astype(np.float16),
            mfcc_bars=features.mfcc_bars.astype(np.float16),
            energy_bars=features.energy_bars.astype(np.float16),
            rms_db_bars=features.rms_db_bars.astype(np.float16),
            low_share_bars=features.low_share_bars.astype(np.float16),
            peaks=waveform_peaks(mono),
        )
    os.replace(partial, target)
    result.timings["save"] = round(time.perf_counter() - save_started, 3)
    result.timings["total"] = round(time.perf_counter() - started, 3)

    db.save_analysis(
        conn,
        song["id"],
        {
            "version": ANALYSIS_VERSION,
            "bpm": round(grid.bpm, 2),
            "constant_tempo": int(grid.constant_tempo),
            "grid_confidence": round(grid.confidence, 3),
            "beats_per_bar": grid.beats_per_bar,
            "key": result.key.name,
            "camelot": result.key.camelot,
            "key_confidence": round(result.key.confidence, 3),
            "key_agrees_chroma": int(result.key.agrees_with_chroma),
            "lufs": round(result.lufs, 2),
            "peak_db": round(result.peak_db, 2),
            "energy": round(features.energy, 3),
            "sections": features.sections,
            "timbre": [round(float(v), 3) for v in features.timbre],
            "timings": result.timings,
        },
    )
    return result


def load_features(
    settings: Settings, song_id: int, names: tuple[str, ...] | None = None
) -> dict[str, np.ndarray]:
    """A song's arrays. `names` reads only those (r8d): each member of the file is decompressed
    on its own, so planning skips the raw beats and the waveform it never looks at."""
    with np.load(features_path(settings, song_id)) as data:
        wanted = data.files if names is None else [name for name in names if name in data.files]
        return {name: data[name] for name in wanted}
