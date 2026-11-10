"""The hostile-file test set for upload validation (ADR-0398, SC-0398-04), made at test time.

Every file is generated in the test's own temporary folder from a few seconds of tone or
silence, then lied about, cut short or disguised; nothing large is committed. `HOSTILE` maps a
name to (builder, the refusal code the sandbox must give). `GOOD` are real files it must keep.
"""

from __future__ import annotations

import shutil
import struct
import subprocess
from collections.abc import Callable
from pathlib import Path

import numpy as np
import soundfile

RATE = 44_100


def _tone(seconds: float, channels: int = 1) -> np.ndarray:
    t = np.arange(int(RATE * seconds)) / RATE
    wave = (0.3 * np.sin(2 * np.pi * 440 * t)).astype("float32")
    return wave if channels == 1 else np.column_stack([wave] * channels)


def _write(path: Path, fmt: str, seconds: float = 3.0, channels: int = 1) -> Path:
    soundfile.write(path, _tone(seconds, channels), RATE, format=fmt)
    return path


def wav(path: Path) -> Path:
    return _write(path, "WAV")


def flac(path: Path) -> Path:
    return _write(path, "FLAC", channels=2)


def mp3(path: Path) -> Path:
    return _write(path, "MP3")


def ogg(path: Path) -> Path:
    return _write(path, "OGG")


def aiff(path: Path) -> Path:
    return _write(path, "AIFF")


def m4a(path: Path) -> Path:
    """A real AAC-in-MP4 file, made by ffmpeg from a WAV (skipped where there's no ffmpeg)."""
    source = wav(path.with_name(path.stem + "-source.wav"))
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(source),
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-f",
            "mp4",
            str(path),
        ],
        check=True,
    )
    source.unlink()
    return path


def has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


# -- hostile ------------------------------------------------------------------------------------


def empty(path: Path) -> Path:
    path.write_bytes(b"")
    return path


def text_named_flac(path: Path) -> Path:
    path = path.with_suffix(".flac")
    path.write_text("<html><body>definitely not a song</body></html>\n" * 20)
    return path


def program_named_mp3(path: Path) -> Path:
    """A Windows program's header (MZ, then a PE signature) renamed .mp3."""
    path = path.with_suffix(".mp3")
    stub = bytearray(4096)
    stub[0:2] = b"MZ"
    stub[0x3C:0x40] = struct.pack("<I", 0x80)
    stub[0x80:0x84] = b"PE\0\0"
    path.write_bytes(bytes(stub))
    return path


def zip_named_wav(path: Path) -> Path:
    """A zip of a megabyte of zeros (a classic compression bomb's shape) renamed .wav."""
    import zipfile

    path = path.with_suffix(".wav")
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("song.wav", b"\0" * (1024 * 1024))
    return path


def _wav_header(data_bytes: int, rate: int = RATE, channels: int = 2, bits: int = 16) -> bytes:
    block = channels * bits // 8
    return (
        b"RIFF"
        + struct.pack("<I", (36 + data_bytes) & 0xFFFFFFFF)
        + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, channels, rate, rate * block, block, bits)
        + b"data"
        + struct.pack("<I", data_bytes & 0xFFFFFFFF)
    )


def wav_claiming_hours(path: Path) -> Path:
    """A 1 KB WAV whose data chunk claims 4 GB: about six and three-quarter hours of audio."""
    path.write_bytes(_wav_header(0xFFFFFFF0) + b"\0" * 1024)
    return path


def wav_claiming_ten_minutes(path: Path) -> Path:
    """A WAV whose header promises ten minutes but holds one second."""
    data = (_tone(1.0, 2) * 32767).astype("<i2").tobytes()
    path.write_bytes(_wav_header(RATE * 4 * 600) + data)
    return path


def wav_absurd_sample_rate(path: Path) -> Path:
    data = b"\0" * 4000
    path.write_bytes(_wav_header(len(data), rate=50_000_000, channels=2) + data)
    return path


def wav_absurd_channels(path: Path) -> Path:
    data = b"\0" * 64 * 2 * 100
    path.write_bytes(_wav_header(len(data), channels=64) + data)
    return path


def flac_claiming_billions_of_samples(path: Path) -> Path:
    """A real FLAC whose STREAMINFO says it holds 2^36 - 1 samples (about 18 days)."""
    flac(path)
    data = bytearray(path.read_bytes())
    # STREAMINFO starts at byte 8; total samples are the low 36 bits of bytes 21-25.
    data[21] = (data[21] & 0xF0) | 0x0F
    data[22:26] = b"\xff\xff\xff\xff"
    path.write_bytes(bytes(data))
    return path


def silence_flac_bomb(path: Path) -> Path:
    """Five minutes of stereo digital silence in about 50 KB: unpacks over a thousand times."""
    with soundfile.SoundFile(path, "w", RATE, 2, format="FLAC") as out:
        block = np.zeros((RATE * 10, 2), dtype="int16")
        for _ in range(30):
            out.write(block)
    return path


def _truncate(build: Callable[[Path], Path]) -> Callable[[Path], Path]:
    def truncated(path: Path) -> Path:
        path = build(path)
        data = path.read_bytes()
        path.write_bytes(data[: len(data) // 2])
        return path

    truncated.__name__ = f"truncated_{build.__name__}"
    return truncated


def garbage_after_magic(path: Path) -> Path:
    """Starts like a FLAC, then noise."""
    path.write_bytes(b"fLaC" + bytes(range(256)) * 16)
    return path


HOSTILE: dict[str, tuple[Callable[[Path], Path], str]] = {
    "zero-byte file": (empty, "empty_file"),
    "text renamed .flac": (text_named_flac, "not_audio"),
    "program renamed .mp3": (program_named_mp3, "not_audio"),
    "zip of zeros renamed .wav": (zip_named_wav, "not_audio"),
    "1 KB WAV claiming 4 GB of audio": (wav_claiming_hours, "too_long"),
    "FLAC claiming 2^36 samples": (flac_claiming_billions_of_samples, "too_long"),
    "WAV claiming ten minutes holding one second": (wav_claiming_ten_minutes, "truncated"),
    "WAV with a 50 MHz sample rate": (wav_absurd_sample_rate, "bad_header"),
    "WAV with 64 channels": (wav_absurd_channels, "bad_header"),
    "five minutes of silence in a tiny FLAC": (silence_flac_bomb, "decode_bomb"),
    "FLAC cut in half": (_truncate(flac), "truncated"),
    "MP3 cut in half": (_truncate(mp3), "truncated"),
    "WAV cut in half": (_truncate(wav), "truncated"),
    "Ogg cut in half": (_truncate(ogg), "truncated"),
    "FLAC magic then noise": (garbage_after_magic, "corrupt"),
}

GOOD: dict[str, Callable[[Path], Path]] = {
    "wav": wav,
    "flac": flac,
    "mp3": mp3,
    "ogg": ogg,
    "aiff": aiff,
}
