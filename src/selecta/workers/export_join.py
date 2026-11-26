"""`export.render`: one file of a hosted mix, joined from the parts the customer heard.

The first export (version 1) downloaded every original, decoded it and ran `render.setmix`, which
chose and rendered every transition again: about 3 to 7 minutes of engine work per hand-off, and
a file that could differ from what played (docs/engineering/cloud-library-walkthrough.md,
section 9). This one renders nothing. Its input is the timeline the web player plays
(`hosted_render.mix_state`, `web/src/cloud/hosted/timelinePlayer.ts`): song parts cut from each
song's lossless playback file at the seam cue points, the rendered seam clips between them, and
each song part's mix level. It reads each part a block at a time and writes the blocks one after
the other into a single 24-bit FLAC, cutting and levelling exactly as the player does:

- a part runs from sample `round(from_s * rate)` for `round(seconds * rate)` samples (JavaScript
  `Math.round`, half up), never past the file's last sample (`partReader.ts`);
- a song part is multiplied by the float32 gain `10 ** (gain_db / 20)` (the player's GainNode),
  a seam clip by 1 (its level is built in);
- the samples are decoded to float exactly as the browser decodes them (24-bit integer / 2^23),
  so the only difference from what the player sends to the speakers is the 24-bit rounding of
  each levelled sample (at most half a step, about 6e-8);
- a hand-off whose render failed is simply two song parts back to back, as it plays.

Input reference::

    {"timeline": [{"kind": "song" | "seam", "key": str, "sha256": str, "from_s": float,
                   "seconds": float, "gain_db": float}, ...],
     "objects": [key, ...], "output": {"kind": "export", "input_hash": str}}

Every file is checked against its `sha256` before it is read. The published input hash is
`export_hash(timeline)`, which the queue side declares as the job's output (one rule, here).
Progress is parts written of the parts plus one (the last unit is the upload).
"""

from __future__ import annotations

import hashlib
import json
import math
import shutil
from collections import deque
from collections.abc import Mapping, Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np

from selecta.config import SAMPLE_RATE
from selecta.work.model import Job
from selecta.work.provenance import build as build_provenance
from selecta.workers.context import InputInvalid, JobContext

# 2: joined from the heard parts (timeline input, 24-bit). 1 re-planned the set with setmix.
EXPORT_VERSION = 2
MAX_EXPORT_SONGS = 60
MAX_PARTS = 2 * MAX_EXPORT_SONGS - 1
BLOCK_FRAMES = 1 << 16
FETCH_AHEAD = 3
FULL_SCALE = float(1 << 23)
KINDS = ("song", "seam")
SHA256_CHARS = frozenset("0123456789abcdef")
OLD_INPUT = ("This export was asked for before exports were joined from the mix as it plays. "
             "Ask for the export again.")


def _hash(payload: Mapping[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _sha(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and set(value) <= SHA256_CHARS


def _number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def timeline_identity(parts: Sequence[Mapping[str, Any]]) -> list[list[Any]]:
    """What decides the exported bytes: each part's file content, cut and level. Object keys are
    left out (a remade playback file of the same bytes is the same export)."""
    return [[str(p["kind"]), str(p["sha256"]), round(float(p["from_s"]), 4),
             round(float(p["seconds"]), 4),
             round(float(p.get("gain_db") or 0.0), 3) if p["kind"] == "song" else 0.0]
            for p in parts]


def export_hash(parts: Sequence[Mapping[str, Any]]) -> str:
    """The export's input hash, from its timeline: the job's idempotency key and the declared
    output both follow from it, so a later change of plan can't change a requested export."""
    return _hash({"timeline": timeline_identity(parts), "export": EXPORT_VERSION})


def check_timeline(raw: Any) -> list[dict[str, Any]]:
    """The timeline of an export input, or `InputInvalid` saying what is wrong with it."""
    if not isinstance(raw, list) or not 2 <= len(raw) <= MAX_PARTS:
        raise InputInvalid(f"An export needs two to {MAX_PARTS} parts.")
    parts = []
    for part in raw:
        if not isinstance(part, Mapping) or part.get("kind") not in KINDS:
            raise InputInvalid("Every part of an export is a song or a transition.")
        if not isinstance(part.get("key"), str) or not _sha(part.get("sha256")):
            raise InputInvalid("Every part of an export names its file and its SHA-256.")
        from_s, seconds = part.get("from_s"), part.get("seconds")
        gain = part.get("gain_db", 0.0) if part["kind"] == "song" else 0.0
        if not (_number(from_s) and _number(seconds) and _number(gain)):
            raise InputInvalid("Every part of an export has a start, a length and a level.")
        if from_s < 0 or seconds <= 0 or not -60.0 <= gain <= 24.0:
            raise InputInvalid("A part of this export has an impossible start, length or level.")
        parts.append({"kind": part["kind"], "key": part["key"], "sha256": part["sha256"],
                      "from_s": float(from_s), "seconds": float(seconds), "gain_db": float(gain)})
    if not any(p["kind"] == "song" for p in parts):
        raise InputInvalid("An export needs at least one song.")
    return parts


def js_round(value: float) -> int:
    """JavaScript's `Math.round` (half up), which the player uses for every cut."""
    return math.floor(value + 0.5)


def player_gain(part: Mapping[str, Any]) -> np.float32:
    """The level the player applies: a float32 GainNode at `10 ** (gain_db / 20)`."""
    if part["kind"] != "song":
        return np.float32(1.0)
    return np.float32(10.0 ** (float(part["gain_db"]) / 20.0))


def span(part: Mapping[str, Any], rate: int, frames: int) -> tuple[int, int]:
    """(first sample, end sample) of a part in its file, as `partReader.ts` cuts it."""
    begin = js_round(part["from_s"] * rate)
    end = min(frames, begin + js_round(part["seconds"] * rate)) if frames else (
        begin + js_round(part["seconds"] * rate))
    return min(begin, end), end


def to_pcm24(levelled: np.ndarray) -> np.ndarray:
    """Float samples as 24-bit steps (rounded, clipped), in the int32 layout soundfile writes to
    a 24-bit file (the low 8 bits are dropped)."""
    steps = np.rint(levelled.astype(np.float64) * FULL_SCALE)
    np.clip(steps, -FULL_SCALE, FULL_SCALE - 1, out=steps)
    return steps.astype(np.int32) << 8


def _stereo(block: np.ndarray) -> np.ndarray:
    if block.shape[1] == 2:
        return block
    if block.shape[1] == 1:  # Web Audio plays a mono buffer on both speakers
        return np.repeat(block, 2, axis=1)
    return block[:, :2]


def write_part(out, path: Path, part: Mapping[str, Any], ctx: JobContext | None = None) -> int:
    """Append one part to the open output file, a block at a time. Returns frames written."""
    import soundfile as sf

    gain = player_gain(part)
    written = 0
    with sf.SoundFile(str(path)) as source:
        rate = source.samplerate
        begin, end = span(part, rate, source.frames)
        source.seek(begin)
        resampler = None
        if rate != SAMPLE_RATE:
            # the browser resamples such a file to the context's 44.1 kHz; so must the export
            # (not sample-exact: a different resampler; playback files are made at 44.1 kHz)
            import soxr

            resampler = soxr.ResampleStream(rate, SAMPLE_RATE, 2, dtype="float32")
        left = end - begin
        while left > 0:
            if ctx is not None:
                ctx.check_in()
            # int32 then / 2^31: the browser's own decode of 16- and 24-bit files, exactly
            block = source.read(min(BLOCK_FRAMES, left), dtype="int32", always_2d=True)
            if not len(block):
                break
            left -= len(block)
            samples = _stereo(block).astype(np.float32) * np.float32(1.0 / 2147483648.0)
            if resampler is not None:
                samples = resampler.resample_chunk(samples, last=left <= 0)
            out.write(to_pcm24(samples * gain))
            written += len(samples)
        if resampler is not None and left > 0:
            tail = resampler.resample_chunk(np.zeros((0, 2), np.float32), last=True)
            out.write(to_pcm24(tail * gain))
            written += len(tail)
    return written


def _fetch(ctx: JobContext, part: Mapping[str, Any], number: int) -> Path:
    """A checked private copy in scratch of one part's file."""
    destination = ctx.scratch / f"part{number:03d}.audio"
    if ctx.store is None:
        ctx.download_input(part["key"], destination)
    else:
        with ctx.open_input(part["key"]) as path:
            shutil.copyfile(path, destination)
    digest = hashlib.sha256()
    with destination.open("rb") as stream:
        while chunk := stream.read(1 << 20):
            digest.update(chunk)
    if digest.hexdigest() != part["sha256"]:
        destination.unlink(missing_ok=True)
        raise InputInvalid("A part of this export does not match its checksum.")
    return destination


def join(ctx: JobContext, parts: list[dict[str, Any]], output: Path) -> int:
    """Write every part into `output`, fetching up to `FETCH_AHEAD` parts ahead of the writer and
    deleting each file once written, so scratch holds a few files, never the whole mix."""
    import soundfile as sf

    total = len(parts) + 1
    frames = 0
    with ThreadPoolExecutor(max_workers=FETCH_AHEAD, thread_name_prefix="export-fetch") as pool, \
            sf.SoundFile(str(output), "w", SAMPLE_RATE, 2, "PCM_24", format="FLAC") as out:
        pending: deque[Future[Path]] = deque()
        queued = 0
        try:
            for number, part in enumerate(parts):
                while queued < len(parts) and len(pending) < FETCH_AHEAD:
                    pending.append(pool.submit(_fetch, ctx, parts[queued], queued))
                    queued += 1
                ctx.check_in()
                path = pending.popleft().result()
                try:
                    frames += write_part(out, path, part, ctx)
                finally:
                    path.unlink(missing_ok=True)
                ctx.progress(number + 1, total)
        finally:
            for future in pending:
                future.cancel()
    return frames


def render_export(job: Job, ctx: JobContext) -> dict:
    ref = job.input_ref
    if not isinstance(ref, Mapping):
        raise InputInvalid("Export input must be an object.")
    if "timeline" not in ref and "songs" in ref:
        raise InputInvalid(OLD_INPUT)
    parts = check_timeline(ref.get("timeline"))
    ctx.check_in()
    ctx.progress(0, len(parts) + 1)
    output = ctx.scratch / "mix.flac"
    frames = join(ctx, parts, output)
    ctx.check_in()
    input_hash = export_hash(parts)
    provenance = build_provenance(
        inputs={"parts": [part["sha256"] for part in parts]},
        versions={"export": EXPORT_VERSION},
        settings={"timeline": timeline_identity(parts), "codec": "flac", "bits": 24,
                  "sample_rate": SAMPLE_RATE},
    )
    artifact = ctx.publish("export", input_hash, output, "mix.flac", provenance=provenance)
    ctx.progress(len(parts) + 1, len(parts) + 1)
    return {
        "input_hash": input_hash,
        "keys": artifact.keys,
        "songs": sum(1 for part in parts if part["kind"] == "song"),
        "parts": len(parts),
        "seconds": round(frames / SAMPLE_RATE, 3),
        "size_bytes": artifact.size_bytes,
        "checksum": artifact.checksum,
    }


__all__ = ["EXPORT_VERSION", "check_timeline", "export_hash", "render_export", "span",
           "timeline_identity", "to_pcm24", "write_part"]
