"""Validate a locally exported FLAC by decoding it, not just reading its header.

A completed encode can still leave a damaged or truncated file. Export state
may only become 'ready' after every frame was decoded successfully. The decode also yields a
checksum of the decoded 16-bit samples (SF-0246-06), so the job can record exactly which audio
it froze and a later check can compare a file against the frozen plan without trusting its bytes.
"""

import hashlib
import io
from pathlib import Path

import numpy as np
import soundfile as sf

from selecta.config import SAMPLE_RATE

CHUNK_FRAMES = 65536


def pcm_checksum(audio: np.ndarray) -> str:
    """The sha256 of these samples as the 16-bit stereo PCM a FLAC export holds. They go through
    the same FLAC encode an export does (libsndfile's FLAC float conversion differs from its WAV
    and raw ones), so the same audio gives the same checksum as its exported file."""
    buffer = io.BytesIO()
    sf.write(buffer, audio, SAMPLE_RATE, subtype="PCM_16", format="FLAC")
    buffer.seek(0)
    samples, _ = sf.read(buffer, dtype="int16", always_2d=True)
    return hashlib.sha256(np.ascontiguousarray(samples.astype("<i2")).tobytes()).hexdigest()


def verify_export(path: Path, expected_seconds: float) -> str:
    """Raise ValueError unless the exact completed stereo FLAC decodes in full. Returns the
    sha256 of its decoded 16-bit samples."""
    try:
        with sf.SoundFile(path, mode="r") as source:
            if (
                source.format != "FLAC"
                or source.subtype != "PCM_16"
                or source.samplerate != SAMPLE_RATE
                or source.channels != 2
                or source.frames <= 0
                or abs(source.frames / source.samplerate - expected_seconds) > 1 / SAMPLE_RATE
            ):
                raise ValueError("Unexpected export format, length or channel layout.")
            seen = 0
            digest = hashlib.sha256()
            while seen < source.frames:
                chunk = source.read(CHUNK_FRAMES, dtype="int16", always_2d=True)
                if not len(chunk):
                    raise ValueError("Export audio is incomplete or invalid.")
                digest.update(np.ascontiguousarray(chunk.astype("<i2")).tobytes())
                seen += len(chunk)
            if seen != source.frames:
                raise ValueError("Export audio was truncated.")
            return digest.hexdigest()
    except (OSError, RuntimeError) as error:
        raise ValueError("The exported file could not be decoded.") from error
