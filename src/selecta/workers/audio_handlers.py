"""Cloud playback proxy handler; inputs are downloaded only through the gateway.

``play.proxy`` input_ref requires ``source_sha256`` and ``sample_rate`` (the analysis
PCM rate). Input URL slot zero must be the matching original. No paths or URLs from
input_ref are passed to ffmpeg. Outputs are 24-bit lossless FLAC.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import threading
from collections.abc import Mapping

from selecta.work.model import Job
from selecta.work.provenance import build as build_provenance
from selecta.workers.context import Handler, InputInvalid, JobContext

PROXY_VERSION = 1


def playback_proxy(job: Job, ctx: JobContext, *, ffmpeg: str = "ffmpeg") -> dict:
    ref = job.input_ref
    if not isinstance(ref, Mapping):
        raise InputInvalid("Playback proxy input must be an object.")
    source_hash = ref.get("source_sha256")
    rate = ref.get("sample_rate")
    if not isinstance(source_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", source_hash):
        raise InputInvalid("Playback proxy requires the original SHA-256.")
    if isinstance(rate, bool) or not isinstance(rate, int) or not 8000 <= rate <= 192000:
        raise InputInvalid("Playback proxy requires a valid analysis sample rate.")
    ctx.check_in()
    source = ctx.download_input(0, ctx.scratch / "original.audio")
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            ctx.check_in()
            digest.update(chunk)
    if digest.hexdigest() != source_hash:
        raise InputInvalid("Playback source checksum does not match the job.")
    output = ctx.scratch / "playback.flac"
    # Local-file protocols only: uploaded playlists must never cause network reads.
    command = [
        ffmpeg, "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file,pipe",
        "-format_whitelist", "wav,flac,mp3,mov,ogg,aac,aiff,ape,wv",
        "-i", str(source), "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1",
        "-ar", str(rate), "-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample",
        "24", "-threads", "1", str(output),
    ]
    with subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
        try:
            while process.poll() is None:
                ctx.check_in()
                threading.Event().wait(0.1)
            if process.returncode != 0:
                raise InputInvalid("The original could not be decoded into a playback file.")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    ctx.check_in()
    hashed = {"source_sha256": source_hash, "sample_rate": rate,
              "proxy_version": PROXY_VERSION, "codec": "flac", "bits": 24}
    input_hash = hashlib.sha256(json.dumps(hashed, sort_keys=True).encode()).hexdigest()
    provenance = build_provenance(
        inputs={"source": source_hash},
        versions={"proxy": PROXY_VERSION},
        settings={"sample_rate": rate, "codec": "flac", "bits": 24},
    )
    artifact = ctx.publish_artifact(
        "playback", input_hash, output, "playback.flac", provenance=provenance,
    )
    ctx.progress(1, 1)
    return {"input_hash": input_hash, "keys": artifact.keys, "sample_rate": rate,
            "size_bytes": artifact.size_bytes, "checksum": artifact.checksum}


def handlers(*, ffmpeg: str = "ffmpeg") -> dict[str, Handler]:
    return {"play.proxy": lambda job, ctx: playback_proxy(job, ctx, ffmpeg=ffmpeg)}
