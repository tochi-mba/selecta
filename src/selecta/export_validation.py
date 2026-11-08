"""Validate a locally exported FLAC by decoding it, not just reading its header.

A completed encode can still leave a damaged or truncated file. Export state
may only become 'ready' after every frame was decoded successfully.
"""

from pathlib import Path

import numpy as np
import soundfile as sf

from selecta.config import SAMPLE_RATE

CHUNK_FRAMES = 65536


def verify_export(path: Path, expected_seconds: float) -> None:
    """Raise ValueError unless the exact completed stereo FLAC decodes in full."""
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
            while seen < source.frames:
                chunk = source.read(CHUNK_FRAMES, dtype="float32", always_2d=True)
                if not len(chunk) or not np.isfinite(chunk).all():
                    raise ValueError("Export audio is incomplete or invalid.")
                seen += len(chunk)
            if seen != source.frames:
                raise ValueError("Export audio was truncated.")
    except (OSError, RuntimeError) as error:
        raise ValueError("The exported file could not be decoded.") from error
