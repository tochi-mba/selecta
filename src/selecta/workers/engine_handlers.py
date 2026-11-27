"""Cloud handlers for analysis, seam rendering and export rendering (ADR-0396, SC-0396-02).

They wrap the same engine the local app runs (`analysis.pipeline.analyse_audio`,
`planner.choose.choose_transition`); `export.render` joins the parts the player plays
(`workers.export_join`) and runs no engine at all. They read and write files only
through the job context: `ctx.open_input(key)` for a stored object, or the claim's signed URL
(`ctx.download_input(name)`) behind the gateway, and `ctx.publish(...)` for outputs, which uses the
worker's `ArtifactStore` when it has one and the gateway's signed upload slot when it doesn't.

Input references (no paths or URLs; every source names its SHA-256 and is checked against it):

- `analyse.song`: `{"source_sha256", "source_key"?}`; the source is input `source` (or slot 0).
- `seam.render`: `{"a": side, "b": side, "style"?}`.
- `export.render`: `{"timeline": [part, ...]}` (`workers.export_join`).

A side is `{"source_sha256", "source_key"?, "analysis_key"?, "title"?, "artist"?, "genre"?}`;
without keys the worker downloads inputs named `{side}` and `{side}_analysis` (`a`, `a_analysis`,
`song0`, `song0_analysis` and so on). Each source is first normalised to a scratch FLAC by an
ffmpeg that allows local-file protocols only.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from selecta import audio
from selecta.analysis.features import waveform_peaks
from selecta.analysis.pipeline import Analysers, analyse_audio
from selecta.analysis.song import SongInfo, genre_family, refine_sections
from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE
from selecta.seam_kinds import RENDER_VERSION
from selecta.work.model import Job
from selecta.work.provenance import build as build_provenance
from selecta.workers.context import Handler, InputInvalid, JobContext, run_tool
from selecta.workers.export_join import EXPORT_VERSION, render_export  # noqa: F401 - re-exported

SHA256 = re.compile(r"[0-9a-f]{64}")
SUMMARY_FIELDS = (
    "bpm",
    "constant_tempo",
    "grid_confidence",
    "beats_per_bar",
    "key",
    "camelot",
    "key_confidence",
    "lufs",
    "peak_db",
    "energy",
    "sections",
    "duration",
)


def _hash(payload: Mapping[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _sha256_of(path: Path, ctx: JobContext) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            ctx.check_in()
            digest.update(chunk)
    return digest.hexdigest()


def _source_hash(ref: Any, what: str) -> str:
    value = ref.get("source_sha256") if isinstance(ref, Mapping) else None
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise InputInvalid(f"The {what} must name its original's SHA-256.")
    return value


def _fetch(ctx: JobContext, key: Any, selector: str | int, name: str) -> Path:
    """A private copy in scratch of a stored object (by key) or a claimed input (by name)."""
    destination = ctx.scratch / name
    if isinstance(key, str):
        with ctx.open_input(key) as path:
            shutil.copyfile(path, destination)
        return destination
    return ctx.download_input(selector, destination)


def normalise(source: Path, output: Path, ffmpeg: str = "ffmpeg",
              ctx: JobContext | None = None) -> Path:
    """The source as stereo 24-bit FLAC at the engine rate, reading local files only.

    Engine code then decodes this scratch copy with its own decoder, so an uploaded playlist or
    container can never make it read from the network. With `ctx` (every worker call) ffmpeg
    runs under `run_tool`: stopped at once by a cancel or the job's runtime limit, so a file
    that makes it hang never holds a worker past its job's limit.
    """
    command = [
        ffmpeg,
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "wav,flac,mp3,mov,ogg,aac,aiff,ape,wv",
        "-i",
        str(source),
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-ac",
        "2",
        "-ar",
        str(SAMPLE_RATE),
        "-c:a",
        "flac",
        "-sample_fmt",
        "s32",
        "-bits_per_raw_sample",
        "24",
        "-threads",
        "1",
        str(output),
    ]
    failure = "The original could not be decoded."
    if ctx is not None:
        run_tool(command, ctx, failure)
    elif subprocess.run(command, capture_output=True, check=False).returncode != 0:
        raise InputInvalid(failure)
    if not output.is_file() or output.stat().st_size == 0:
        raise InputInvalid(failure)
    return output


class _CheckedSource:
    """One source downloaded, checked against its SHA-256 and normalised for the engine."""

    def __init__(self, ctx: JobContext, ref: Any, selector: str, ffmpeg: str,
                 identify: bool = False):
        self.sha256 = _source_hash(ref, f"song {selector!r}")
        original = _fetch(ctx, ref.get("source_key"), selector, f"{selector}.original")
        if _sha256_of(original, ctx) != self.sha256:
            raise InputInvalid("A source checksum does not match the job.")
        ctx.check_in()
        # the stored original's audio id (library.audio_identity), so the server can match the
        # song by its audio as a device does; worked out before the original is let go
        self.audio_id = _audio_id(original) if identify else None
        self.path = normalise(original, ctx.scratch / f"{selector}.flac", ffmpeg, ctx)
        original.unlink(missing_ok=True)


def _audio_id(path: Path) -> str | None:
    from selecta import flags
    from selecta.library.audio_identity import audio_id

    if not flags.on("library.audio_identity"):
        return None  # off: no audio id is computed, sent or stored (audio-identity.md)
    try:
        return audio_id(path)
    except OSError:
        return None


# --- analyse.song --------------------------------------------------------------------------------


def default_analysers() -> Analysers:
    """The pinned beat model from the image; key falls back to chroma (S-KEY isn't pinned)."""
    from selecta.analysis.beats import BeatTracker

    return Analysers(beats=BeatTracker("small0"), key=None)


def analyse(
    job: Job, ctx: JobContext, *, analysers: Callable[[], Analysers], ffmpeg: str = "ffmpeg"
) -> dict:
    ref = job.input_ref
    if not isinstance(ref, Mapping):
        raise InputInvalid("Analysis input must be an object.")
    ctx.check_in()
    source = _CheckedSource(ctx, ref, "source", ffmpeg, identify=True)
    try:
        stereo = audio.decode(source.path)
    except audio.DecodeError as error:
        raise InputInvalid("The original could not be decoded.") from error
    ctx.progress(1, 3)
    ctx.check_in()
    result = analyse_audio(stereo, analysers())
    if result is None:
        raise InputInvalid("No steady beat was found in this song.")
    ctx.check_in()
    ctx.progress(2, 3)
    grid, features = result.grid, result.features
    summary = {
        "bpm": round(grid.bpm, 2),
        "constant_tempo": int(grid.constant_tempo),
        "grid_confidence": round(grid.confidence, 3),
        "beats_per_bar": grid.beats_per_bar,
        "key": result.key.name,
        "camelot": result.key.camelot,
        "key_confidence": round(result.key.confidence, 3),
        "lufs": round(result.lufs, 2),
        "peak_db": round(result.peak_db, 2),
        "energy": round(features.energy, 3),
        "sections": features.sections,
        "duration": stereo.shape[0] / SAMPLE_RATE,
    }
    output = ctx.scratch / "analysis.npz"
    # the drum pattern and swing, as the Desktop saves them (`features.rhythm_bars`); they only
    # travel as a pair, and a file without them reads as no opinion on rhythm
    rhythm = (
        {"pattern_bars": features.pattern_bars.astype(np.float16),
         "swing_bars": features.swing_bars.astype(np.float16)}
        if features.pattern_bars is not None and features.swing_bars is not None else {}
    )
    np.savez_compressed(
        output,
        **rhythm,
        beats=grid.beats,
        bar_starts=grid.bar_starts.astype(np.int32),
        raw_beats=grid.raw_beats.astype(np.float32),
        raw_downbeats=grid.raw_downbeats.astype(np.float32),
        chroma_bars=features.chroma_bars.astype(np.float16),
        mfcc_bars=features.mfcc_bars.astype(np.float16),
        energy_bars=features.energy_bars.astype(np.float16),
        rms_db_bars=features.rms_db_bars.astype(np.float16),
        low_share_bars=features.low_share_bars.astype(np.float16),
        peaks=waveform_peaks(stereo.mean(axis=1)),
        summary=np.array(json.dumps(summary)),
    )
    input_hash = _hash({"source_sha256": source.sha256, "analysis": ANALYSIS_VERSION})
    provenance = build_provenance(
        inputs={"source": source.sha256},
        versions={"analysis": ANALYSIS_VERSION},
        models={"beats": getattr(analysers().beats, "checkpoint", "small0")},
    )
    artifact = ctx.publish("analysis", input_hash, output, "analysis.npz", provenance=provenance)
    ctx.progress(3, 3)
    found = {
        "input_hash": input_hash,
        "keys": artifact.keys,
        "bpm": summary["bpm"],
        "camelot": summary["camelot"],
        # what a player needs to play the song at its mix level (SongInfo.gain_db)
        "lufs": summary["lufs"],
        "peak_db": summary["peak_db"],
        "checksum": artifact.checksum,
    }
    if source.audio_id:
        # a worker has no database: the server keeps the song's facts from this file and
        # matches the song by this id too (hosted_facts)
        found["audio_id"] = source.audio_id
    return found


# --- seam.render ---------------------------------------------------------------------------------


def song_from_analysis(
    analysis: Path, audio_path: Path, song_id: int, side: Mapping[str, Any]
) -> SongInfo:
    """A `SongInfo` built from an analysis artifact, as `load_song` builds one from the library."""
    try:
        with np.load(analysis) as data:
            arrays = {name: data[name] for name in data.files}
        summary = json.loads(str(arrays.pop("summary")))
        missing = [name for name in SUMMARY_FIELDS if name not in summary]
    except (OSError, ValueError, KeyError) as error:
        raise InputInvalid("An analysis file is unreadable.") from error
    if missing or "beats" not in arrays or "bar_starts" not in arrays:
        raise InputInvalid("An analysis file is incomplete.")
    beats, bar_starts = arrays["beats"], arrays["bar_starts"]
    genre = side.get("genre") if isinstance(side.get("genre"), str) else None
    return SongInfo(
        id=song_id,
        path=str(audio_path),
        artist=str(side.get("artist") or "Unknown artist"),
        title=str(side.get("title") or "Untitled"),
        genre=genre,
        family=genre_family(genre),
        duration=float(summary["duration"]),
        bpm=summary["bpm"],
        beats=beats,
        bar_starts=bar_starts,
        beats_per_bar=summary["beats_per_bar"],
        constant_tempo=bool(summary["constant_tempo"]),
        grid_confidence=summary["grid_confidence"],
        sections=refine_sections(summary["sections"], [], beats[bar_starts]),
        camelot=summary["camelot"],
        key_confidence=summary["key_confidence"],
        lufs=summary["lufs"],
        peak_db=summary["peak_db"],
        energy=summary["energy"],
        energy_bars=arrays["energy_bars"].astype(np.float32),
        low_share_bars=arrays["low_share_bars"].astype(np.float32),
        lines=[],
        vocals_known=False,
        instrumental=False,
        chroma_bars=arrays["chroma_bars"].astype(np.float32),
        rms_db_bars=arrays["rms_db_bars"].astype(np.float32),
        mfcc_bars=arrays["mfcc_bars"].astype(np.float32),
    )


def _song(ctx: JobContext, side: Any, name: str, number: int, ffmpeg: str,
          core: bool = False) -> SongInfo:
    if not isinstance(side, Mapping):
        raise InputInvalid(f"Song {name!r} must be an object.")
    source = _CheckedSource(ctx, side, name, ffmpeg)
    analysis = _fetch(ctx, side.get("analysis_key"), f"{name}_analysis", f"{name}.npz")
    if core:
        from selecta.workers.engine_core import song_from_facts

        return song_from_facts(analysis, source.path, number, side)
    return song_from_analysis(analysis, source.path, number, side)


def _versions() -> dict[str, int]:
    return {"analysis": ANALYSIS_VERSION, "render": RENDER_VERSION}


MAX_WARP_POINTS = 2_000


def _played(script) -> dict:
    """What a player joining the clip to the songs' own files needs beyond the cues
    (`hosted_pairs`): the level each song was rendered at (exact), the clip second the ear moves
    to B (the overlap's end), and B's warp from clip seconds to its own (left out when long)."""
    import math

    found: dict[str, Any] = {"switch_at": round(float(script.overlap[1]), 4)}
    gains = (float(script.a.song.gain_db), float(script.b.song.gain_db))
    if all(math.isfinite(gain) for gain in gains):
        found["levels"] = {"a_gain_db": gains[0], "b_gain_db": gains[1]}
    output, source = script.b.warp.output, script.b.warp.source
    if 2 <= len(output) <= MAX_WARP_POINTS:
        found["b_warp"] = {"output": [round(float(t), 4) for t in output],
                           "source": [round(float(t), 4) for t in source]}
    return found


def render_seam(job: Job, ctx: JobContext, *, ffmpeg: str = "ffmpeg") -> dict:
    from selecta.workers import engine_core, engine_seams

    ref = job.input_ref
    if not isinstance(ref, Mapping):
        raise InputInvalid("Seam input must be an object.")
    style = ref.get("style")
    if style is not None and not isinstance(style, str):
        raise InputInvalid("A seam style must be a name.")
    # `cloud.hosted_brain` on the server: the planner core's loop (engine_core); a job without
    # the mark (every kiosk seam, and hosted seams with the flag off) renders as before
    core = ref.get("brain") == engine_core.MARK
    ctx.check_in()
    a = _song(ctx, ref.get("a"), "a", 1, ffmpeg, core)
    b = _song(ctx, ref.get("b"), "b", 2, ffmpeg, core)
    ctx.progress(1, 2)
    if core:
        import os

        from selecta import flags
        from selecta.render.attempt_cache import RenderAttemptCache
        from selecta.storage.shared_derivations import FLAG

        directory = os.environ.get("SELECTA_HOSTED_TRANSITION_CACHE")
        runtime = os.environ.get("SELECTA_HOSTED_TRANSITION_CACHE_RUNTIME")
        render_attempt = None
        if directory and runtime and flags.on(FLAG) and not any(
            value
            for side in (ref["a"], ref["b"])
            for value in engine_core.facts_of(side).values()
        ):
            # _song already downloaded and checksum-verified both workspace assets.
            render_attempt = RenderAttemptCache(
                Path(directory), {a.id: ref["a"]["source_sha256"], b.id: ref["b"]["source_sha256"]},
                runtime,
            )
        take = engine_core.core_seam(a, b, style, render_attempt=render_attempt)
        engine_name = engine_core.ENGINE
    else:
        # The local app's own move choice (engine_seams): blends and effects placed and
        # beat-tightened as the local app places them, falling back to a clean cut.
        take, engine_name = engine_seams.best_seam(a, b, style), engine_seams.ENGINE
    ctx.check_in()
    output = ctx.scratch / "seam.flac"
    sf.write(output, take.rendered.audio, SAMPLE_RATE, subtype="PCM_24")
    hashes = {"a": ref["a"]["source_sha256"], "b": ref["b"]["source_sha256"]}
    extra = engine_core.hash_part(ref["a"], ref["b"]) if core else {}
    input_hash = _hash({**hashes, "style": style, **_versions(), **extra})
    # Where native playback of A hands over to the clip and of B takes over after it, so a
    # player that plays the songs and the clip as separate files can join them (ADR-0446).
    cues = {
        "a_source_start": round(take.rendered.script.a_source_start, 4),
        "b_source_end": round(take.rendered.script.b_source_end, 4),
        "seconds": round(take.rendered.seconds, 4),
    }
    provenance = build_provenance(
        inputs=hashes,
        versions=_versions(),
        settings={
            "style": style or "auto", "cues": cues, "engine": engine_name, "move": take.move,
            "passed": bool(take.report.passed), "fell_back": take.fell_back,
            **_played(take.rendered.script),
        },
    )
    artifact = ctx.publish("seam", input_hash, output, "seam.flac", provenance=provenance)
    ctx.progress(2, 2)
    return {
        "input_hash": input_hash,
        "keys": artifact.keys,
        "style": take.rendered.script.style,
        "move": take.move,
        "engine": engine_name,
        "why": take.why[:300],
        "audit_passed": bool(take.report.passed),
        "fell_back": take.fell_back,
        "checks": [
            {"name": c.name, "passed": bool(c.passed), "value": round(float(c.value), 3),
             "limit": round(float(c.limit), 3)}
            for c in take.report.checks
        ],
        "tried": take.tried[:8],
        "not_on_server": take.skipped,
        "seconds": round(take.rendered.seconds, 3),
        "checksum": artifact.checksum,
    }


def handlers(
    *, ffmpeg: str = "ffmpeg", analysers: Callable[[], Analysers] | None = None
) -> dict[str, Handler]:
    """The engine handlers; the analysers load once, on the first analysis job."""
    loaded: list[Analysers] = []

    def once() -> Analysers:
        if not loaded:
            loaded.append((analysers or default_analysers)())
        return loaded[0]

    return {
        "analyse.song": lambda job, ctx: analyse(job, ctx, analysers=once, ffmpeg=ffmpeg),
        "seam.render": lambda job, ctx: render_seam(job, ctx, ffmpeg=ffmpeg),
        # joins the parts the player plays (export_join): no engine, no ffmpeg
        "export.render": lambda job, ctx: render_export(job, ctx),
    }
