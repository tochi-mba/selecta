"""What runs inside the upload validation sandbox: read an untrusted file and say what it is.

`storage.sandbox` starts this module in a child process (`python -I -m
selecta.storage.audio_check`), hands it a JSON request on stdin and reads one JSON line back.
Nothing here trusts the file's name or its headers:

1. **Sniff** the first bytes. The extension is never looked at; text, a program or a zip
   renamed `.mp3` is "not audio".
2. **Read the header** with mutagen and check it agrees with the sniffed format, and that the
   sample rate, channel count and claimed length are sane and under the hard caps.
3. **Compare the claim with the bytes.** A WAV whose data chunk, or an MP3 whose Xing header,
   claims more bytes than the file holds is cut short.
4. **Decode it all**, in bounded blocks, counting frames. Decoding stops the moment the audio
   runs past what the header claimed or unpacks to far more than its size allows (a decode
   bomb), and a stream that ends early or breaks part way is cut short or corrupt.

On Linux the child also caps its own address space, CPU time, file writes and open files
before touching the file, so a decoder bug can't take more than its share; the parent's wall
clock timeout covers every platform.

Every refusal is a `Rejected` with a stable `code` the API returns and a plain message.
"""

from __future__ import annotations

import json
import math
import os
import struct
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, fields
from typing import Any

MiB = 1024 * 1024
GiB = 1024 * MiB
BLOCK_FRAMES = 65_536
SNIFF_BYTES = 64 * 1024
FFMPEG_RATE = 8_000  # m4a and AAC are decoded by ffmpeg, downmixed to this mono rate to count

# Refusal codes (stable: the API returns them and the web app may key copy on them).
EMPTY = "empty_file"
TOO_LARGE = "file_too_large"
NOT_AUDIO = "not_audio"
UNSUPPORTED = "unsupported_format"
MISMATCH = "format_mismatch"
BAD_HEADER = "bad_header"
TOO_LONG = "too_long"
TRUNCATED = "truncated"
CORRUPT = "corrupt"
DECODE_BOMB = "decode_bomb"
TIMEOUT = "validation_timeout"
FAILED = "validation_failed"

MESSAGES = {
    EMPTY: "This file is empty.",
    TOO_LARGE: "This file is larger than an upload may be.",
    NOT_AUDIO: "This file isn't a supported audio format, whatever its name says.",
    UNSUPPORTED: "This file's audio format isn't supported for Cloud uploads.",
    MISMATCH: "This file's contents don't match the audio format they start as.",
    BAD_HEADER: "This file's audio details don't make sense, so it can't be used.",
    TOO_LONG: "This file says it is longer than any upload may be.",
    TRUNCATED: "This file is cut short; please upload the whole file again.",
    CORRUPT: "This file's audio couldn't be decoded.",
    DECODE_BOMB: "This file unpacks to far more audio than a file its size could hold.",
    TIMEOUT: "Checking this file took too long, so it wasn't kept.",
    FAILED: "This file couldn't be checked safely, so it wasn't kept.",
}

# mutagen's class for each format Cloud takes.
KINDS = {
    "MP3": "mp3",
    "EasyMP3": "mp3",
    "FLAC": "flac",
    "WAVE": "wav",
    "AIFF": "aiff",
    "MP4": "m4a",
    "EasyMP4": "m4a",
    "AAC": "aac",
    "OggVorbis": "ogg",
    "OggOpus": "ogg",
    "OggFLAC": "ogg",
}
# Formats whose header states the size of the audio, so a short file shows it is cut short.
SIZED = frozenset({"wav", "aiff", "mp3"})


class Rejected(ValueError):
    """The file was refused; `code` says why in a word, the message in a sentence."""

    def __init__(self, code: str, message: str | None = None) -> None:
        self.code = code
        super().__init__(message or MESSAGES.get(code, MESSAGES[FAILED]))


@dataclass(frozen=True)
class Limits:
    """The hard limits of one check. Plans may be stricter (`Uploads.accept` checks the plan's
    duration); these bound what the sandbox will ever do."""

    timeout_s: float = 120.0
    memory_bytes: int = 2 * GiB
    max_output_bytes: int = 64 * 1024
    max_file_bytes: int = 5 * GiB
    max_duration_s: float = 2 * 3600.0
    min_sample_rate: int = 8_000
    max_sample_rate: int = 384_000
    max_channels: int = 8
    # Decoded 16-bit PCM bytes per stored byte. Real music: FLAC about 2, MP3 about 11, a very
    # low bitrate Opus about 250. Long digital silence in FLAC is over 1,000.
    max_expansion: float = 400.0
    expansion_floor_bytes: int = 32 * MiB

    @classmethod
    def from_json(cls, values: dict[str, Any]) -> Limits:
        names = {item.name for item in fields(cls)}
        return cls(**{key: value for key, value in values.items() if key in names})

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def _skip_id3(head: bytes) -> bytes:
    """The bytes after an ID3v2 tag, which MP3s (and some FLACs) start with."""
    if len(head) >= 10 and head[:3] == b"ID3":
        size = 0
        for byte in head[6:10]:
            size = (size << 7) | (byte & 0x7F)
        footer = 10 if head[5] & 0x10 else 0
        return head[10 + size + footer :]
    return head


def sniff(head: bytes) -> str | None:
    """The audio format the first bytes say, or None. Names and extensions are never used."""
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if len(head) >= 12 and head[:4] == b"FORM" and head[8:12] in (b"AIFF", b"AIFC"):
        return "aiff"
    if head[:4] == b"OggS":
        return "ogg"
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return "m4a"
    body = _skip_id3(head)
    if body[:4] == b"fLaC":
        return "flac"
    if len(body) >= 2 and body[0] == 0xFF and body[1] & 0xE0 == 0xE0:
        layer = (body[1] >> 1) & 0x3
        if layer == 0x1:
            return "mp3"
        if layer == 0x0 and body[1] & 0xF6 == 0xF0:
            return "aac"
    return None


def _wav_claim(head: bytes) -> tuple[int, int, int] | None:
    """(data offset, declared data bytes, byte rate) from a WAV's own chunks, read directly:
    mutagen gives a length of zero for a data chunk bigger than the file, hiding the lie."""
    offset, byte_rate = 12, 0
    while offset + 8 <= len(head):
        name = head[offset : offset + 4]
        (length,) = struct.unpack("<I", head[offset + 4 : offset + 8])
        if name == b"fmt " and offset + 20 <= len(head):
            (byte_rate,) = struct.unpack("<I", head[offset + 16 : offset + 20])
        if name == b"data":
            return offset + 8, length, byte_rate
        offset += 8 + length + (length & 1)
    return None


def _readers(sniffed: str) -> list[type]:
    from mutagen.aac import AAC
    from mutagen.aiff import AIFF
    from mutagen.flac import FLAC
    from mutagen.mp3 import MP3
    from mutagen.mp4 import MP4
    from mutagen.oggflac import OggFLAC
    from mutagen.oggopus import OggOpus
    from mutagen.oggvorbis import OggVorbis
    from mutagen.wave import WAVE

    return {
        "mp3": [MP3],
        "flac": [FLAC],
        "wav": [WAVE],
        "aiff": [AIFF],
        "m4a": [MP4],
        "aac": [AAC],
        "ogg": [OggVorbis, OggOpus, OggFLAC],
    }[sniffed]


def _header(path: str, sniffed: str) -> tuple[float, int, int, int]:
    import mutagen

    try:
        # Only the sniffed format's readers: mutagen would otherwise favour the file's name.
        audio = mutagen.File(path, options=_readers(sniffed))
    except Exception as error:
        raise Rejected(CORRUPT) from error
    if audio is None or getattr(audio, "info", None) is None:
        raise Rejected(CORRUPT)
    kind = KINDS.get(type(audio).__name__)
    if kind is None:
        raise Rejected(UNSUPPORTED)
    if kind != sniffed:
        raise Rejected(MISMATCH)
    info = audio.info
    try:
        length = float(getattr(info, "length", 0.0) or 0.0)
        rate = int(getattr(info, "sample_rate", 0) or 0)
        channels = int(getattr(info, "channels", 0) or 0)
        bitrate = int(getattr(info, "bitrate", 0) or 0)
    except (TypeError, ValueError, OverflowError) as error:
        raise Rejected(BAD_HEADER) from error
    return length, rate, channels, bitrate


def _check_header(
    sniffed: str, size: int, length: float, rate: int, channels: int, bitrate: int, limits: Limits
) -> None:
    if not limits.min_sample_rate <= rate <= limits.max_sample_rate:
        raise Rejected(BAD_HEADER)
    if not 1 <= channels <= limits.max_channels:
        raise Rejected(BAD_HEADER)
    if not math.isfinite(length) or length < 0:
        raise Rejected(BAD_HEADER)
    if length > limits.max_duration_s:
        raise Rejected(TOO_LONG)
    if length == 0:
        # A header with no length: an Ogg stream whose last page is missing, or nothing at all.
        raise Rejected(TRUNCATED)
    if sniffed in SIZED and bitrate > 0:
        claimed = length * bitrate / 8
        if claimed > size * 1.02 + 16_384:
            raise Rejected(TRUNCATED)


def _check_wav_claim(head: bytes, size: int, limits: Limits) -> None:
    claim = _wav_claim(head)
    if claim is None:
        raise Rejected(CORRUPT)
    offset, declared, byte_rate = claim
    if byte_rate <= 0:
        raise Rejected(BAD_HEADER)
    if declared / byte_rate > limits.max_duration_s:
        raise Rejected(TOO_LONG)
    if declared > (size - offset) * 1.02 + 16_384:
        raise Rejected(TRUNCATED)


class _Budget:
    """Counts decoded frames and stops the decode the moment it goes past any limit."""

    def __init__(self, size: int, length: float, rate: int, channels: int, limits: Limits):
        self.rate = rate
        self.channels = channels
        allowed_s = min(length, limits.max_duration_s) * 1.05 + 2.0
        self.max_frames = int(allowed_s * rate)
        self.max_pcm = max(limits.expansion_floor_bytes, int(limits.max_expansion * size))
        self.deadline = time.monotonic() + limits.timeout_s
        self.frames = 0

    def add(self, frames: int, rate: int | None = None) -> None:
        if rate is not None and rate != self.rate:
            frames = int(frames * self.rate / rate)  # ffmpeg counts at its own rate
        self.frames += frames
        if self.frames > self.max_frames:
            raise Rejected(DECODE_BOMB)
        if self.frames * self.channels * 2 > self.max_pcm:
            raise Rejected(DECODE_BOMB)
        if time.monotonic() > self.deadline:
            raise Rejected(TIMEOUT)


def _decode_soundfile(path: str, budget: _Budget) -> None:
    import soundfile

    try:
        with soundfile.SoundFile(path) as audio:
            if audio.samplerate != budget.rate or audio.channels != budget.channels:
                raise Rejected(MISMATCH)
            while True:
                block = audio.read(BLOCK_FRAMES, dtype="int16")
                if not len(block):
                    break
                budget.add(len(block))
    except Rejected:
        raise
    except Exception as error:
        if budget.frames:
            raise Rejected(TRUNCATED) from error
        # libsndfile refuses some damaged files outright (a FLAC cut short fails to open).
        # ffmpeg decodes what is there, so a cut-short file shows up as short, not corrupt.
        _decode_ffmpeg(path, budget)


def _decode_ffmpeg(path: str, budget: _Budget) -> None:
    """m4a and AAC: libsndfile can't read them, so ffmpeg decodes to mono 8 kHz PCM on a pipe,
    capped at the allowed length plus a second so a longer stream shows itself."""
    cap_s = budget.max_frames / budget.rate + 1.0
    command = [
        "ffmpeg", "-v", "error", "-nostdin", "-xerror", "-i", path,
        "-map", "0:a:0", "-t", f"{cap_s:.3f}", "-ac", "1", "-ar", str(FFMPEG_RATE),
        "-f", "s16le", "pipe:1",
    ]  # fmt: skip
    try:
        process = subprocess.Popen(
            command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
        )
    except OSError as error:
        raise Rejected(FAILED) from error
    assert process.stdout is not None
    try:
        while chunk := process.stdout.read(FFMPEG_RATE * 2):
            budget.add(len(chunk) // 2, FFMPEG_RATE)
        code = process.wait(timeout=max(0.1, budget.deadline - time.monotonic()))
    except subprocess.TimeoutExpired as error:
        raise Rejected(TIMEOUT) from error
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
    if code != 0:
        raise Rejected(TRUNCATED if budget.frames else CORRUPT)


def inspect(path: str, limits: Limits) -> dict[str, Any]:
    """Check one file; the format, decoded length, sample rate and channels, or `Rejected`."""
    size = os.path.getsize(path)
    if size == 0:
        raise Rejected(EMPTY)
    if size > limits.max_file_bytes:
        raise Rejected(TOO_LARGE)
    with open(path, "rb") as handle:
        head = handle.read(SNIFF_BYTES)
    sniffed = sniff(head)
    if sniffed is None:
        raise Rejected(NOT_AUDIO)
    if sniffed == "wav":
        _check_wav_claim(head, size, limits)
    length, rate, channels, bitrate = _header(path, sniffed)
    _check_header(sniffed, size, length, rate, channels, bitrate, limits)
    budget = _Budget(size, length, rate, channels, limits)
    if sniffed in ("m4a", "aac"):
        _decode_ffmpeg(path, budget)
    else:
        _decode_soundfile(path, budget)
    if budget.frames == 0:
        raise Rejected(CORRUPT)
    decoded_s = budget.frames / rate
    if decoded_s < length * 0.97 - 0.5:
        raise Rejected(TRUNCATED)
    return {
        "format": sniffed,
        "duration_s": decoded_s,
        "sample_rate": rate,
        "channels": channels,
    }


def apply_limits(limits: Limits) -> dict[str, int]:
    """Cap this process (and anything it starts) on POSIX; what was set, for the parent."""
    try:
        import resource
    except ImportError:  # Windows: the parent's timeout is the bound
        return {}
    cpu = max(1, math.ceil(limits.timeout_s)) + 1
    wanted = {
        "RLIMIT_AS": limits.memory_bytes,
        "RLIMIT_CPU": cpu,
        "RLIMIT_FSIZE": 0,  # read only: the check writes no files
        "RLIMIT_NOFILE": 64,
        "RLIMIT_CORE": 0,
    }
    applied: dict[str, int] = {}
    for name, value in wanted.items():
        which = getattr(resource, name, None)
        if which is None:
            continue
        _soft, hard = resource.getrlimit(which)
        if hard != resource.RLIM_INFINITY:
            value = min(value, hard)
        resource.setrlimit(which, (value, value))
        applied[name] = value
    return applied


def main() -> int:
    try:
        request = json.loads(sys.stdin.read(64 * 1024))
        limits = Limits.from_json(request.get("limits") or {})
        applied = apply_limits(limits)
        answer: dict[str, Any] = {"ok": True, "rlimits": applied}
        answer.update(inspect(str(request["path"]), limits))
    except Rejected as rejected:
        answer = {"ok": False, "code": rejected.code}
    except MemoryError:
        answer = {"ok": False, "code": FAILED}
    except Exception:
        answer = {"ok": False, "code": CORRUPT}
    sys.stdout.write(json.dumps(answer) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
